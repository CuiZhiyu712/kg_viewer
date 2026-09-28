/* 导出 → 重新导入 往返一致性测试（对应验收测试 7 / 8） */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const XLSX = require('xlsx');

const SRC = path.join(__dirname, '..', 'src', 'js');
const XLSX_FILE = path.join(__dirname, '..', '套卷复盘137788287964941447.1e985b7db4385be(2).xlsx');
const OUT_FILE = path.join(__dirname, '_out_roundtrip.xlsx');

const sandbox = {
  console, Date, Math, JSON, parseFloat, parseInt, isFinite, isNaN,
  String, Number, Boolean, Object, Array, Uint8Array, Error, RegExp,
};
sandbox.window = sandbox;
sandbox.XLSX = XLSX;
sandbox.crypto = require('crypto').webcrypto;
vm.createContext(sandbox);
['utils.js', 'model.js', 'excel-import.js', 'excel-export.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
});
const KG = sandbox.KG;

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.log(`  FAIL ${label}\n       actual   = ${a}\n       expected = ${e}`); }
}

/* ---------- 1. 原始文件 -> records ---------- */
const wb0 = XLSX.readFile(XLSX_FILE, { cellDates: false });
const r0 = KG.Import.recordsFromWorkbook(wb0).records[0];

/* ---------- 2. records -> xlsx ---------- */
const wbOut = KG.Export.recordsToWorkbook([r0]);
console.log('导出 SheetNames =', wbOut.SheetNames);
const wsOut = wbOut.Sheets[wbOut.SheetNames[0]];

console.log('--- 导出结构 ---');
eq(wbOut.SheetNames, ['粉笔模考'], '只生成一个 Sheet，名为「粉笔模考」');
eq(wsOut['A1'].v, '日期', 'A1');
eq(wsOut['B1'].v, '试卷', 'B1');
eq(wsOut['F1'].v, '模块', 'F1');
eq(wsOut['G1'].v, '合计', 'G1');
eq(wsOut['H1'].v, '政治理论', 'H1');
eq(wsOut['J1'].v, '言语理解', 'J1');
eq(wsOut['O1'].v, '判断推理', 'O1');
eq(wsOut['J2'].v, '逻辑填空', 'J2');
eq(wsOut['M2'].v, '总计', 'M2');
eq(wsOut['O2'].v, '图形推理', 'O2');
eq(wsOut['S2'].v, '总计', 'S2');
eq(wsOut['F3'].v, '总题数', 'F3');
eq(wsOut['F4'].v, '正确题数', 'F4');
eq(wsOut['F5'].v, '正确率', 'F5');
eq(wsOut['F6'].v, '平均正确率', 'F6');
eq(wsOut['F7'].v, '用时', 'F7');
eq(wsOut['A4'].v, 46284, 'A4 为真日期序列号（不是文本）');
eq(wsOut['A4'].z, 'yyyy/m/d', 'A4 带日期格式');
eq(wsOut['E4'].z, '0.00%', '击败比带百分比格式');
eq(wsOut['H5'].z, '0.00%', '正确率带百分比格式');
eq(wsOut['H6'].z, '0.00%', '平均正确率带百分比格式');
eq(wsOut['G4'].v, 76, 'G4 保留原始合计 76');
eq(wsOut['O5'].v, '50%%', 'O5 保留源表脏数据 "50%%"');
eq(wsOut['J6'].v, '无', 'J6 保留 "无"');
eq(wsOut['M7'].v, 38, 'M7 保留源表言语理解总计 38');
const hasAMerge = wsOut['!merges'].some((m) => m.s.r === 3 && m.e.r === 6 && m.s.c === 0 && m.e.c === 0);
eq(hasAMerge, true, '存在 A4:A7 合并（基本信息竖跨 4 行）');

/* ---------- 3. 写出到磁盘并重新导入 ---------- */
XLSX.writeFile(wbOut, OUT_FILE, { bookType: 'xlsx' });
const wb1 = XLSX.readFile(OUT_FILE, { cellDates: false });
const r1 = KG.Import.recordsFromWorkbook(wb1).records[0];

console.log('--- 往返一致性（值必须完全一致） ---');
eq(r1.date, r0.date, 'date');
eq(r1.paperName, r0.paperName, 'paperName');
eq(r1.score, r0.score, 'score');
eq(r1.averageScore, r0.averageScore, 'averageScore');
eq(r1.defeatRate, r0.defeatRate, 'defeatRate');
eq(r1.total, r0.total, 'total');
eq(r1.modules, r0.modules, 'modules（含子模块与平均正确率）');
eq(r1.raw, r0.raw, 'raw 逐格快照完全一致');

/* ---------- 4. 去重键必须一致（重新导入不会新增重复记录） ---------- */
console.log('--- 去重 ---');
eq(KG.Import.dedupeKey(r1) === KG.Import.dedupeKey(r0), true, '去重键（日期+试卷）一致，重新导入会被判重');

/* ---------- 5. 只读第一个 Sheet ---------- */
console.log('--- 只读 Sheet1 ---');
const wbMulti = XLSX.utils.book_new();
const ws1 = XLSX.utils.aoa_to_sheet([[], [], [], ['2026-01-01', '不该被读到的表']]);
XLSX.utils.book_append_sheet(wbMulti, wsOut, '粉笔模考');
XLSX.utils.book_append_sheet(wbMulti, ws1, '花生套卷');
XLSX.utils.book_append_sheet(wbMulti, XLSX.utils.aoa_to_sheet([[1]]), '国考真题');
eq(wbMulti.SheetNames.length, 3, '构造 3 个 Sheet 的工作簿');
const rMulti = KG.Import.recordsFromWorkbook(wbMulti);
eq(rMulti.records.length, 1, '只解析 Sheet1，不读取 Sheet2/3');
eq(rMulti.records[0].paperName, '第29季', '取到的是 Sheet1 的数据');

/* ---------- 6. 表单新建记录（无 raw）→ 导出 → 再导入 ---------- */
console.log('--- 新建记录（raw=null，走字段派生） ---');
const fresh = KG.Model.blankRecord();
fresh.date = '2026-10-01';
fresh.paperName = '第30季';
fresh.score = 85;
fresh.averageScore = 72;
fresh.defeatRate = 95;
fresh.modules.political = { name: '政治理论', questions: 20, correct: 18, avgAccuracy: 82, time: 12 };
fresh.modules.common = { name: '常识', questions: 15, correct: 12, avgAccuracy: null, time: 13 };
fresh.modules.language = {
  name: '言语理解', avgAccuracy: 88, time: null,
  subModules: {
    logicalCloze: { name: '逻辑填空', questions: 15, correct: 13, time: 16 },
    reading: { name: '片段阅读', questions: 10, correct: 9, time: 14 },
    sentence: { name: '语句表达', questions: 5, correct: 4, time: 5 },
  },
};
fresh.modules.quantity = { name: '数量关系', questions: 10, correct: 6, avgAccuracy: 55, time: 11 };
fresh.modules.reasoning = {
  name: '判断推理', avgAccuracy: 90, time: null,
  subModules: {
    graphic: { name: '图形推理', questions: 10, correct: 9, time: 9 },
    definition: { name: '定义判断', questions: 10, correct: 9, time: 10 },
    analogy: { name: '类比推理', questions: 5, correct: 5, time: 4 },
    logic: { name: '逻辑判断', questions: 10, correct: 9, time: 12 },
  },
};
fresh.modules.dataAnalysis = { name: '资料分析', questions: 20, correct: 20, avgAccuracy: 100, time: 55 };
fresh.total = { questions: null, correct: null, accuracy: null, time: null };
KG.Model.normalizeRecord(fresh);

eq([fresh.modules.language.questions, fresh.modules.language.correct, fresh.modules.language.time], [30, 26, 35], '言语理解自动汇总子模块');
eq([fresh.modules.reasoning.questions, fresh.modules.reasoning.correct, fresh.modules.reasoning.time], [35, 32, 35], '判断推理自动汇总子模块');
// 18+12+26+6+32+20 = 114 正确；用时 12+13+35+11+35+55 = 161
eq([fresh.total.questions, fresh.total.correct, fresh.total.time, fresh.total.accuracy], [130, 114, 161, 87.69], '整套卷汇总自动计算');
eq(fresh.modules.political.accuracy, 90, '政治理论正确率自动计算 18/20');
eq(fresh.modules.common.avgAccuracy, null, '平均正确率允许填「无」');
eq(KG.Model.totalMismatch(fresh), [], '新建记录汇总自洽，无不一致');

const wbFresh = KG.Export.recordsToWorkbook([fresh]);
const OUT2 = path.join(__dirname, '_out_fresh.xlsx');
XLSX.writeFile(wbFresh, OUT2, { bookType: 'xlsx' });
const r2 = KG.Import.recordsFromWorkbook(XLSX.readFile(OUT2, { cellDates: false })).records[0];

eq(r2.date, '2026-10-01', '新建记录 date 往返');
eq(r2.paperName, '第30季', '新建记录 paperName 往返');
eq(r2.score, 85, '新建记录 score 往返');
eq(r2.defeatRate, 95, '新建记录 defeatRate 往返');
eq([r2.modules.political.questions, r2.modules.political.correct, r2.modules.political.accuracy, r2.modules.political.avgAccuracy, r2.modules.political.time],
  [20, 18, 90, 82, 12], '新建记录 political 往返（正确率 90% / 平均正确率 82%）');
eq(r2.modules.common.avgAccuracy, null, '「无」往返后仍为空');
eq([r2.modules.language.questions, r2.modules.language.correct, r2.modules.language.avgAccuracy],
  [30, 26, 88], '新建记录 language 往返');
eq([r2.modules.reasoning.subModules.graphic.correct, r2.modules.reasoning.subModules.graphic.accuracy],
  [9, 90], '新建记录 reasoning 子模块往返');
eq([r2.total.questions, r2.total.correct, r2.total.time], [130, 114, 161], '新建记录合计往返');

/* ---------- 7. 多套卷：块不重叠、顺序稳定 ---------- */
console.log('--- 多套卷 ---');
const wbTwo = KG.Export.recordsToWorkbook([r0, fresh]);
const OUTF = path.join(__dirname, '_out_two.xlsx');
XLSX.writeFile(wbTwo, OUTF, { bookType: 'xlsx' });
const two = KG.Import.recordsFromWorkbook(XLSX.readFile(OUTF, { cellDates: false }));
eq(two.records.length, 2, '两套卷各自识别为一个数据块');
eq(two.records[0].paperName, '第29季', '第 1 块');
eq(two.records[1].paperName, '第30季', '第 2 块');
eq(two.records[1].date, '2026-10-01', '第 2 块日期未被第 1 块污染');
eq(two.records[0].raw !== null, true, '第 1 块保留 raw');
eq(two.records[1].raw["正确题数"].G, 114, '第 2 块 raw 记录合计 109');

/* ---------- 8. 导出文件在 Excel 中可读性：合并区左上角必须有值 ---------- */
console.log('--- 合并区左上角有值 ---');
const wsTwo = wbTwo.Sheets['粉笔模考'];
wsTwo['!merges'].forEach((m) => {
  const topLeft = XLSX.utils.encode_cell(m.s);
  eq(!!wsTwo[topLeft] && wsTwo[topLeft].v !== null && wsTwo[topLeft].v !== undefined, true, `合并区左上角 ${topLeft} 有值`);
});

console.log(`\n===== PASS ${pass} / FAIL ${fail} =====`);
[OUT_FILE, OUT2, OUTF].forEach((f) => { try { fs.unlinkSync(f); } catch (e) {} });
process.exit(fail ? 1 : 0);
