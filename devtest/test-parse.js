/* 用真实 xlsx 验证 Sheet1 解析结果 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const XLSX = require('xlsx');

const SRC = path.join(__dirname, '..', 'src', 'js');
const XLSX_FILE = path.join(__dirname, '..', '套卷复盘137788287964941447.1e985b7db4385be(2).xlsx');

const sandbox = {
  console, Date, Math, JSON, parseFloat, parseInt, isFinite, isNaN,
  String, Number, Boolean, Object, Array, Uint8Array, Error, RegExp,
};
sandbox.window = sandbox;
sandbox.XLSX = XLSX;
sandbox.crypto = require('crypto').webcrypto;
vm.createContext(sandbox);

['utils.js', 'model.js', 'excel-import.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
});

const KG = sandbox.KG;

let pass = 0;
let fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.log(`  FAIL ${label}\n       actual   = ${a}\n       expected = ${e}`); }
}

const wb = XLSX.readFile(XLSX_FILE, { cellDates: false });
console.log('SheetNames:', wb.SheetNames);

const res = KG.Import.recordsFromWorkbook(wb);
console.log('blocks =', res.blocks, '| records =', res.records.length, '| skipped =', res.skipped);
console.log('warnings =', res.warnings);

const r = res.records[0];

console.log('\n--- 基本信息 ---');
eq(r.date, '2026-09-19', 'date');
eq(r.paperName, '第29季', 'paperName');
eq(r.score, 58.5, 'score');
eq(r.averageScore, 57.3, 'averageScore');
eq(r.defeatRate, 59.4, 'defeatRate  (源表 0.594 / 应归一化为 59.4)');

console.log('--- 整套卷汇总 ---');
eq([r.total.questions, r.total.correct, r.total.time, r.total.accuracy], [130, 76, 176, 58.46], 'total 保留 Excel 合计列');
eq([r.computedTotal.questions, r.computedTotal.correct, r.computedTotal.time], [130, 81, 153], 'computedTotal 模块之和');
eq(KG.Model.totalMismatch(r).length, 2, '应检出 2 处合计不一致');

console.log('--- 六大模块 ---');
eq([r.modules.political.questions, r.modules.political.correct, r.modules.political.accuracy, r.modules.political.time],
  [20, 6, 30, 11], 'political');
eq([r.modules.common.questions, r.modules.common.correct, r.modules.common.accuracy, r.modules.common.time],
  [15, 10, 66.67, null], 'common (用时空缺 -> null，不得为 NaN)');
eq([r.modules.quantity.questions, r.modules.quantity.correct, r.modules.quantity.accuracy, r.modules.quantity.time],
  [10, 5, 50, 10], 'quantity');
eq([r.modules.dataAnalysis.questions, r.modules.dataAnalysis.correct, r.modules.dataAnalysis.accuracy, r.modules.dataAnalysis.time],
  [20, 20, 100, 60], 'dataAnalysis');

console.log('--- 言语理解（保留子模块） ---');
eq([r.modules.language.questions, r.modules.language.correct, r.modules.language.accuracy, r.modules.language.time],
  [30, 20, 66.67, 37], 'language 自动汇总子模块');
eq([r.modules.language.subModules.logicalCloze.questions, r.modules.language.subModules.logicalCloze.correct, r.modules.language.subModules.logicalCloze.accuracy, r.modules.language.subModules.logicalCloze.time],
  [15, 9, 60, 17], 'logicalCloze');
eq([r.modules.language.subModules.reading.questions, r.modules.language.subModules.reading.correct, r.modules.language.subModules.reading.accuracy, r.modules.language.subModules.reading.time],
  [10, 7, 70, 15], 'reading');
eq([r.modules.language.subModules.sentence.questions, r.modules.language.subModules.sentence.correct, r.modules.language.subModules.sentence.accuracy, r.modules.language.subModules.sentence.time],
  [5, 4, 80, 5], 'sentence');
eq(KG.Model.groupMismatch(r, 'language'), ['用时原表 38 ≠ 子模块之和 37'], '言语理解总用时不一致需检出');

console.log('--- 判断推理（保留子模块 + 脏数据 50%%） ---');
eq([r.modules.reasoning.questions, r.modules.reasoning.correct, r.modules.reasoning.accuracy, r.modules.reasoning.time],
  [35, 20, 57.14, 35], 'reasoning 自动汇总子模块');
eq([r.modules.reasoning.subModules.graphic.questions, r.modules.reasoning.subModules.graphic.correct, r.modules.reasoning.subModules.graphic.accuracy, r.modules.reasoning.subModules.graphic.time],
  [10, 5, 50, 10], 'graphic ("50%%" 必须归一化为 50)');
eq([r.modules.reasoning.subModules.analogy.questions, r.modules.reasoning.subModules.analogy.correct, r.modules.reasoning.subModules.analogy.accuracy, r.modules.reasoning.subModules.analogy.time],
  [5, 5, 100, 5], 'analogy ("100%%" 必须归一化为 100)');
eq([r.modules.reasoning.subModules.definition.correct, r.modules.reasoning.subModules.logic.correct], [5, 5], 'definition/logic');

console.log('--- 平均正确率（用户可填字段，允许「无」） ---');
eq(r.modules.political.avgAccuracy, 70, 'political 平均正确率 0.7 -> 70');
eq(r.modules.common.avgAccuracy, 60, 'common 平均正确率 0.6 -> 60');
eq(r.modules.language.avgAccuracy, 70, 'language 平均正确率取「总计」列 M6=0.7 -> 70');
eq(r.modules.language.subModules.logicalCloze.avgAccuracy, null, 'logicalCloze "无" -> null');
eq(r.modules.language.subModules.reading.avgAccuracy, null, 'reading 空 -> null');
eq(r.modules.quantity.avgAccuracy, 60, 'quantity 0.6 -> 60');
eq(r.modules.reasoning.avgAccuracy, 67, 'reasoning 取「总计」列 S6=0.67 -> 67（浮点需四舍五入）');
eq(r.modules.reasoning.subModules.graphic.avgAccuracy, null, 'graphic "无" -> null');
eq(r.modules.dataAnalysis.avgAccuracy, 100, 'dataAnalysis 1 -> 100');

console.log('--- raw 快照（导出无损） ---');
eq(r.raw['正确率'].O, '50%%', 'raw 保留 "50%%" 原样');
eq(r.raw['平均正确率'].H, 0.7, 'raw 保留历史平均正确率');
eq(r.raw['平均正确率'].J, '无', 'raw 保留 "无"');
eq(r.raw['用时'].M, 38, 'raw 保留言语理解总计 38');
eq(r.raw['正确题数'].B, '第29季', 'raw 保留试卷名');
eq(r.raw['正确题数'].A, undefined, 'raw 不保存日期列（导出时按 date 重建为真日期）');

console.log('--- 边界：空表 / 结构不可识别 ---');
let threw = '';
try { KG.Import.recordsFromSheet(null); } catch (e) { threw = e.message; }
eq(threw, 'Excel 文件为空', '空表提示');
threw = '';
try { KG.Import.recordsFromSheet({ '!ref': 'A1:C3' }); } catch (e) { threw = e.message; }
eq(threw.indexOf('无法识别该 Excel 的 Sheet1 结构') === 0, true, '无法识别结构提示');

console.log('--- 边界：0 题不产生 NaN / Infinity ---');
eq(KG.Utils.calcAccuracy(0, 5), null, 'questions=0 -> null');
eq(KG.Utils.calcAccuracy(null, 5), null, 'questions=null -> null');
eq(KG.Utils.calcAccuracy(20, null), null, 'correct=null -> null');

console.log('--- 边界：日期时区（不得差一天） ---');
eq(KG.Utils.toDateString(46284), '2026-09-19', 'Excel 序列号 46284 -> 2026-09-19');
eq(KG.Utils.toDateString('2026/9/19'), '2026-09-19', '"2026/9/19" -> 2026-09-19');
eq(KG.Utils.toDateString('2026.9.19 00:00'), '2026-09-19', '"2026.9.19" -> 2026-09-19');
eq(KG.Utils.toDateString('2026-09-19'), '2026-09-19', '"2026-09-19" -> 2026-09-19');
eq(KG.Utils.dateStringToSerial('2026-09-19'), 46284, '2026-09-19 -> 序列号 46284（往返一致）');
eq(KG.Utils.serialToDateString(KG.Utils.dateStringToSerial('2026-01-01')), '2026-01-01', '跨年往返一致');
eq(KG.Utils.serialToDateString(KG.Utils.dateStringToSerial('2024-02-29')), '2024-02-29', '闰日往返一致');

console.log('--- 边界：脏数据归一化 ---');
eq(KG.Utils.toPercent('50%%'), 50, '"50%%" -> 50');
eq(KG.Utils.toPercent('100%%'), 100, '"100%%" -> 100');
eq(KG.Utils.toPercent('无'), null, '"无" -> null');
eq(KG.Utils.toPercent('None'), null, '"None" -> null');
eq(KG.Utils.toPercent(0.594), 59.4, '0.594 -> 59.4');
eq(KG.Utils.toPercent(1), 100, '1 -> 100');
eq(KG.Utils.toPercent('67%'), 67, '"67%" -> 67');

console.log(`\n===== PASS ${pass} / FAIL ${fail} =====`);
process.exit(fail ? 1 : 0);
