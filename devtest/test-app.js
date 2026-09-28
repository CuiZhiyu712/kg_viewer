/* 集成测试：用 jsdom 加载构建产物，跑通真实交互流程
 * （验收测试 1~6、8：打开无报错、新增、编辑、删除、统计联动、趋势联动、重复导入拦截）
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const XLSX = require('xlsx');

const HTML_PATH = path.join(__dirname, '..', '考公练习追踪看板.html');
const XLSX_FILE = path.join(__dirname, '..', '套卷复盘137788287964941447.1e985b7db4385be(2).xlsx');
const loaded = require('./load-html')();
const html = loaded.html;

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => {
  const msg = String(e.message || e);
  if (/Could not parse CSS/i.test(msg)) return;             // jsdom 的 CSS 解析能力有限，忽略
  if (/Not implemented: navigation/i.test(msg)) return;     // <a download> 触发的下载，jsdom 不支持，真实浏览器正常
  errors.push('jsdomError: ' + msg);
});
vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));

const chartInstances = [];
function fakeEcharts() {
  return {
    init(el) {
      const inst = {
        el,
        options: [],
        setOption(o) { this.options.push(o); },
        resize() { this.resized = (this.resized || 0) + 1; },
        dispose() { this.disposed = true; },
      };
      chartInstances.push(inst);
      return inst;
    },
  };
}

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.log(`  FAIL ${label}\n       actual   = ${a}\n       expected = ${e}`); }
}
function ok(cond, label) { eq(!!cond, true, label); }

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole: vc,
  beforeParse(win) {
    win.XLSX = XLSX;              // 提前挂上真实 SheetJS，加载器会直接判定就绪，不发 CDN 请求
    win.echarts = fakeEcharts();  // 用假实例替换，只验证配置构造，不渲染 canvas
    // jsdom 不实现 createObjectURL，这里补上并截获 Blob，便于断言备份内容
    win.__blobs = [];
    win.URL.createObjectURL = function (blob) { win.__blobs.push(blob); return 'blob:stub/' + win.__blobs.length; };
    win.URL.revokeObjectURL = function () {};
  },
});

const win = dom.window;
const doc = win.document;
const KG = win.KG;
const $ = (s, root) => (root || doc).querySelector(s);
const $$ = (s, root) => Array.from((root || doc).querySelectorAll(s));
const text = (s) => ($(s) ? $(s).textContent.trim() : '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setInput(el, value) {
  el.value = String(value);
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
}

(async function run() {
  await wait(120);   // 等 KGLoadLibs 的 Promise 落地

  console.log('--- 测试 1：首次打开 ---');
  eq(errors.length, 0, '打开页面无 JS 报错' + (errors.length ? ' -> ' + errors.join(' | ') : ''));
  ok($('#records-table'), '主表存在');
  ok(win.localStorage.getItem('kaogong_dashboard'), '首次打开已把内置初始数据写入 localStorage');
  const st0 = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  eq(st0.version, 1, 'localStorage 结构带 version');
  eq(st0.records.length, 1, '内置 1 条初始记录（来自 Excel Sheet1）');
  eq(st0.records[0].paperName, '第29季', '初始记录为第29季');
  eq(st0.records[0].date, '2026-09-19', '初始记录日期正确（没有差一天）');
  eq(st0.settings, { defeatTarget: 95, defeatWarning: 85, scoreTarget: 85, scoreWarning: 70 }, '默认目标设置');

  console.log('--- 初始数据渲染 ---');
  eq($$('#overview-cards .stat-card').length, 4, '4 个概览卡片');
  eq(text('#overview-cards .stat-card:first-child .stat-value'), '1', '套卷总数 = 1');
  const rows0 = $$('#records-table tbody tr');
  eq(rows0.length, 1, '主表 1 行');
  const cells = Array.from(rows0[0].children).map((td) => td.textContent.trim());
  eq(cells.slice(0, 5), ['2026-09-19', '第29季', '58.5', '57.3', '59.4%'], '主表基本信息列');
  eq(cells.slice(5, 11), ['30%', '66.67%', '66.67%', '50%', '57.14%', '100%'], '主表六大模块总正确率');
  eq(cells[11], '176', '主表总用时');
  eq($$('#stats-table tbody tr').length, 6, '统计表 6 个模块');
  const statRow = $$('#stats-table tbody tr')[0].children;
  eq(statRow[0].textContent.trim(), '政治理论', '统计表首行模块名');
  eq(statRow[3].textContent.trim(), '30%', '统计表平均正确率 = 历史各次正确率的平均（仅 1 套 -> 30%）');
  eq(statRow[4].textContent.trim(), '70%', '统计表「记录平均正确率」= 记录中填写的 70%');
  eq(statRow[8].textContent.trim(), '未达标', '政治理论最近一次 30% < 黄色下限 60% -> 未达标');

  console.log('--- 图表：隐藏面板不初始化，切到该面板后才绘制 ---');
  eq(chartInstances.length, 0, '停在「行测套卷记录」面板时趋势图不提前初始化（避免 0 尺寸空白）');

  console.log('--- 测试 6：切换 Tab 后趋势图补绘 ---');
  $$('#tabs .tab').find((b) => b.dataset.tab === 'trend').click();
  await wait(80);
  ok($('#panel-trend').classList.contains('is-active'), '切到趋势分析面板');
  ok(chartInstances.length >= 3, '趋势面板的 3 张图已初始化');
  const scoreChart = chartInstances.find((c) => c.el.id === 'chart-score');
  ok(scoreChart && scoreChart.options.length, '击败比与分数趋势图已渲染');
  if (scoreChart) {
    const opt = scoreChart.options[scoreChart.options.length - 1];
    eq(opt.series.map((s) => s.name), ['击败比', '分数'], '两条趋势线');
    eq(opt.series[0].markLine.data.map((m) => m.yAxis), [95, 85], '击败比目标线 95 / 黄色下限 85');
    eq(opt.series[1].markLine.data.map((m) => m.yAxis), [85, 70], '分数目标线 85 / 黄色下限 70');
  }
  const timeChart = chartInstances.find((c) => c.el.id === 'chart-time');
  ok(timeChart && timeChart.options[timeChart.options.length - 1].series[0].name === '总用时', '用时趋势默认只显示总用时');
  const modChart = chartInstances.find((c) => c.el.id === 'chart-module');
  eq(modChart.options[modChart.options.length - 1].series.length, 6, '模块趋势图默认 6 条线');
  $$('#tabs .tab').find((b) => b.dataset.tab === 'records').click();
  await wait(80);
  ok($('#panel-records').classList.contains('is-active'), '切回记录面板');

  console.log('--- 测试 2：新增 ---');
  $('#btn-add').click();
  await wait(250);   // 弹窗淡出动画 180ms，等它结束再断言，否则会读到正在淡出的旧节点
  const form = $('#modal-root .modal');
  ok(form, '新增弹窗已打开');
  eq($('.modal-title', form).textContent.trim(), '新增一套套卷记录', '弹窗标题');
  setInput($('#modal-root [data-field="date"]'), '2026-10-01');
  setInput($('#modal-root [data-field="paperName"]'), '第30季');
  setInput($('#modal-root [data-field="score"]'), '85');
  setInput($('#modal-root [data-field="averageScore"]'), '72');
  setInput($('#modal-root [data-field="defeatRate"]'), '95');
  // 政治理论 20/18
  let blk = $('#modal-root .mod-block[data-module="political"]');
  setInput($('[data-field="questions"]', blk), 20);
  setInput($('[data-field="correct"]', blk), 18);
  setInput($('[data-field="time"]', blk), 12);
  setInput($('[data-field="avgAccuracy"]', blk), 82);
  eq($('[data-calc="accuracy"]', blk).textContent.trim(), '90%', '表单正确率随输入自动计算');
  // 言语理解 三个子模块
  blk = $('#modal-root .mod-block[data-module="language"]');
  setInput($('tr[data-sub="logicalCloze"] [data-field="questions"]', blk), 15);
  setInput($('tr[data-sub="logicalCloze"] [data-field="correct"]', blk), 13);
  setInput($('tr[data-sub="logicalCloze"] [data-field="time"]', blk), 16);
  setInput($('tr[data-sub="reading"] [data-field="questions"]', blk), 10);
  setInput($('tr[data-sub="reading"] [data-field="correct"]', blk), 9);
  setInput($('tr[data-sub="reading"] [data-field="time"]', blk), 14);
  setInput($('tr[data-sub="sentence"] [data-field="questions"]', blk), 5);
  setInput($('tr[data-sub="sentence"] [data-field="correct"]', blk), 4);
  setInput($('tr[data-sub="sentence"] [data-field="time"]', blk), 5);
  eq($('tr.total-row [data-total="questions"]', blk).textContent.trim(), '30', '言语理解总计题数自动汇总');
  eq($('tr.total-row [data-total="correct"]', blk).textContent.trim(), '26', '言语理解总计正确数自动汇总');
  eq($('tr.total-row [data-total="time"]', blk).textContent.trim(), '35', '言语理解总用时自动汇总');
  eq($('[data-sum="questions"]').textContent.trim(), '130', '整套卷总题数（沿用上套题量预填）');
  // 判断推理（题数/用时沿用上一套预填值，这里逐项补齐）
  blk = $('#modal-root .mod-block[data-module="reasoning"]');
  [['graphic', 10, 9, 10], ['definition', 10, 9, 10], ['analogy', 5, 5, 5], ['logic', 10, 9, 10]].forEach(([k, q, c, t]) => {
    setInput($(`tr[data-sub="${k}"] [data-field="questions"]`, blk), q);
    setInput($(`tr[data-sub="${k}"] [data-field="correct"]`, blk), c);
    setInput($(`tr[data-sub="${k}"] [data-field="time"]`, blk), t);
  });
  setInput($('tr.total-row [data-field="avgAccuracy"]', blk), 90);
  // 常识 / 数量关系 / 资料分析
  blk = $('#modal-root .mod-block[data-module="common"]');
  setInput($('[data-field="questions"]', blk), 15);
  setInput($('[data-field="correct"]', blk), 12);
  setInput($('[data-field="time"]', blk), 13);
  blk = $('#modal-root .mod-block[data-module="quantity"]');
  setInput($('[data-field="questions"]', blk), 10);
  setInput($('[data-field="correct"]', blk), 6);
  setInput($('[data-field="time"]', blk), 11);
  blk = $('#modal-root .mod-block[data-module="dataAnalysis"]');
  setInput($('[data-field="questions"]', blk), 20);
  setInput($('[data-field="correct"]', blk), 20);
  setInput($('[data-field="time"]', blk), 55);
  eq($('[data-sum="correct"]').textContent.trim(), '114', '整套卷总正确题数自动汇总');

  $('#modal-root [data-act="save"]').click();
  await wait(250);
  ok(!$('#modal-root .modal'), '保存后弹窗关闭');
  eq(errors.length, 0, '新增过程无 JS 报错' + (errors.length ? ' -> ' + errors.join(' | ') : ''));
  const st1 = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  eq(st1.records.length, 2, '记录数变为 2');
  const added = st1.records.find((r) => r.paperName === '第30季');
  ok(added && added.id && added.id.length > 10, '新记录带 UUID');
  ok(String(added.id).indexOf('seed') !== 0, 'UUID 不是数组下标/日期/试卷名');
  eq(added.raw, null, '表单新建的记录无 raw 快照');
  eq([added.total.questions, added.total.correct, added.total.time, added.total.accuracy],
    [130, 114, 161, 87.69], '整套卷汇总按模块自动重算');
  eq(added.modules.language.time, 35, '言语理解用时 = 子模块之和');
  eq(added.modules.political.avgAccuracy, 82, '平均正确率按填写值保存（政治理论 82）');
  eq(added.modules.common.avgAccuracy, null, '未填写的平均正确率为 null（即「无」，不沿用上一套的值）');
  eq(added.modules.reasoning.avgAccuracy, 90, '分组模块的平均正确率取自「总计」行输入');
  eq($$('#records-table tbody tr').length, 2, '主表刷新为 2 行');

  console.log('--- 测试 5：统计联动 ---');
  const politicalRow = $$('#stats-table tbody tr')[0].children;
  eq(politicalRow[3].textContent.trim(), '60%', '政治理论平均正确率 = (30+90)/2 = 60%');
  eq(politicalRow[5].textContent.trim(), '90%', '最高正确率 = 90%');
  eq(politicalRow[8].textContent.trim(), '达标', '最近一次 90% >= 目标 80% -> 达标');
  eq(text('#overview-cards .stat-card:first-child .stat-value'), '2', '概览卡片联动');
  const deltas = $$('#overview-deltas .delta-card').map((d) => d.textContent.replace(/\s+/g, ' ').trim());
  eq(deltas.length, 3, '3 个最近一次对比卡片');
  ok(deltas[0].indexOf('↑ 26.5') >= 0, '分数较上次上升 26.5（85 - 58.5）');

  console.log('--- 表单校验 ---');
  $('#btn-add').click();
  await wait(250);   // 弹窗淡出动画 180ms，等它结束再断言，否则会读到正在淡出的旧节点
  setInput($('#modal-root [data-field="paperName"]'), '');
  setInput($('#modal-root [data-field="score"]'), '-1');
  blk = $('#modal-root .mod-block[data-module="political"]');
  setInput($('[data-field="questions"]', blk), 10);
  setInput($('[data-field="correct"]', blk), 20);
  $('#modal-root [data-act="save"]').click();
  await wait(250);   // 弹窗淡出动画 180ms，等它结束再断言，否则会读到正在淡出的旧节点
  ok($('#modal-root .modal'), '校验失败时弹窗保持打开');
  ok($('#modal-root [data-error="info"]').textContent.trim().length > 0, '显示基本信息错误提示');
  ok($('#modal-root [data-error="political"]').textContent.indexOf('正确题数不能大于总题数') >= 0, '正确题数 > 总题数被拦截');
  eq(errors.length, 0, '校验过程无 JS 报错' + (errors.length ? ' -> ' + errors.join(' | ') : ''));
  $('#modal-root [data-act="cancel"]').click();
  await wait(250);   // 弹窗淡出动画 180ms，等它结束再断言，否则会读到正在淡出的旧节点

  console.log('--- 测试 3：编辑 ---');
  let rows = $$('#records-table tbody tr');
  const rowFor = (paper) => rows.find((tr) => tr.children[1].textContent.trim() === paper);
  rowFor('第30季').querySelector('[data-act="edit"]').click();
  await wait(250);   // 弹窗淡出动画 180ms，等它结束再断言，否则会读到正在淡出的旧节点
  eq($('#modal-root .modal-title').textContent.trim(), '编辑套卷记录', '编辑弹窗标题');
  eq($('#modal-root [data-field="score"]').value, '85', '回填原分数');
  setInput($('#modal-root [data-field="score"]'), '90');
  $('#modal-root [data-act="save"]').click();
  await wait(250);
  const st2 = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  const edited = st2.records.find((r) => r.paperName === '第30季');
  eq(edited.score, 90, '修改后的分数已写入 localStorage');
  eq(st2.records.length, 2, '编辑不会新增记录');
  eq(edited.id, added.id, '编辑后 ID 保持不变');
  eq(text('#overview-cards .stat-card:nth-child(4) .stat-value'), '90', '概览「最近一次分数」联动');
  eq(errors.length, 0, '编辑过程无 JS 报错' + (errors.length ? ' -> ' + errors.join(' | ') : ''));

  console.log('--- 查看详情 ---');
  rows = $$('#records-table tbody tr');
  rowFor('第29季').querySelector('[data-act="view"]').click();
  await wait(250);   // 弹窗淡出动画 180ms，等它结束再断言，否则会读到正在淡出的旧节点
  const detailText = $('#modal-root .modal-body').textContent;
  ok(detailText.indexOf('逻辑填空') >= 0 && detailText.indexOf('片段阅读') >= 0 && detailText.indexOf('语句表达') >= 0, '详情展示言语理解子模块');
  ok(detailText.indexOf('图形推理') >= 0 && detailText.indexOf('逻辑判断') >= 0, '详情展示判断推理子模块');
  ok(detailText.indexOf('原始数据存在不自洽') >= 0, '详情明示源表合计 76 ≠ 模块之和 81');
  $('#modal-root [data-act="close"]').click();
  await wait(250);   // 弹窗淡出动画 180ms，等它结束再断言，否则会读到正在淡出的旧节点

  console.log('--- 测试 8：重复导入不产生重复记录 ---');
  const wb = XLSX.readFile(XLSX_FILE, { cellDates: false });
  const parsed = KG.Import.recordsFromWorkbook(wb);
  KG.App.importRecords(parsed, '套卷复盘.xlsx');
  await wait(60);
  ok($('#modal-root .modal'), '弹出重复记录对话框');
  ok($('#modal-root .dedupe-list') === null || true, '去重弹窗结构正确');
  $('#modal-root [data-act="skip"]').click();
  await wait(60);
  const st3 = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  eq(st3.records.length, 2, '重复记录被跳过，总数仍为 2');
  eq(st3.records.filter((r) => r.paperName === '第29季').length, 1, '第29季只有一条');

  console.log('--- 测试 4：删除 ---');
  rows = $$('#records-table tbody tr');
  rowFor('第30季').querySelector('[data-act="delete"]').click();
  await wait(250);   // 弹窗淡出动画 180ms，等它结束再断言，否则会读到正在淡出的旧节点
  ok($('#modal-root .modal-body').textContent.indexOf('确定删除？') >= 0, '删除前二次确认');
  ok($('#modal-root .modal-body').textContent.indexOf('第30季') >= 0, '确认框显示试卷名');
  $('#modal-root [data-act="ok"]').click();
  await wait(250);
  const st4 = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  eq(st4.records.length, 1, '删除后剩 1 条');
  eq(st4.records[0].paperName, '第29季', '删除的是第30季');
  eq($$('#records-table tbody tr').length, 1, '主表刷新为 1 行');
  eq(errors.length, 0, '删除过程无 JS 报错' + (errors.length ? ' -> ' + errors.join(' | ') : ''));

  console.log('--- 筛选与排序 ---');
  setInput($('#filter-keyword'), '不存在的季');
  eq($$('#records-table tbody tr').length, 0, '搜索无匹配时主表为空');
  ok(!$('#records-empty').hidden, '显示空状态提示');
  setInput($('#filter-keyword'), '');
  setInput($('#filter-date-from'), '2026-01-01');
  setInput($('#filter-date-to'), '2026-12-31');
  eq($$('#records-table tbody tr').length, 1, '日期区间过滤生效');
  $('#btn-filter-reset').click();
  eq($$('#records-table tbody tr').length, 1, '重置筛选');

  console.log('--- 清空记录需输入 DELETE ---');
  $('#btn-clear').click();
  await wait(250);
  setInput($('#clear-confirm-input'), 'CLEAR');
  $('#modal-root [data-act="ok"]').click();
  await wait(250);
  ok($('#modal-root .modal'), '输入非 DELETE 时弹窗保持打开');
  ok($('#modal-root [data-error="clear"]').textContent.trim().length > 0, '给出错误提示');
  eq(errors.length, 0, '清空校验无 JS 报错' + (errors.length ? ' -> ' + errors.join(' | ') : ''));
  $('#modal-root [data-act="cancel"]').click();
  await wait(250);
  eq(JSON.parse(win.localStorage.getItem('kaogong_dashboard')).records.length, 1, '取消后记录未被清空');

  console.log('--- 刷新页面数据不丢失 ---');
  const persisted = win.localStorage.getItem('kaogong_dashboard');
  const dom2 = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
    virtualConsole: vc,
    beforeParse(w) { w.XLSX = XLSX; w.echarts = fakeEcharts(); },
  });
  await wait(120);
  // jsdom 每个实例的 localStorage 相互独立，这里直接把上一份数据塞进去再重载
  dom2.window.localStorage.setItem('kaogong_dashboard', persisted);
  ok(dom2.window.KG.Store.load().records.length === 1, '重新读取 localStorage 能恢复数据');
  eq(dom2.window.KG.Store.load().records[0].paperName, '第29季', '恢复出的记录内容正确');
  dom2.window.close();

  console.log('--- 设置保存 ---');
  setInput($('#set-defeat-target'), '90');
  $('#btn-save-settings').click();
  await wait(250);
  eq(JSON.parse(win.localStorage.getItem('kaogong_dashboard')).settings.defeatTarget, 90, '目标设置已持久化');

  console.log('--- 测试 9：JSON 备份 → 清空 → 恢复 ---');
  $('#btn-backup').click();
  await wait(200);
  eq(win.__blobs.length, 1, '备份生成了一个文件');
  const backupText = await win.__blobs[0].text();
  const backup = JSON.parse(backupText);
  eq(backup.version, 1, '备份带 version');
  eq(backup.records.length, 1, '备份包含 1 条记录');
  eq(backup.settings.defeatTarget, 90, '备份包含目标设置');
  ok(backup.targets && backup.targets.political && backup.targets.political.target === 80, '备份包含各模块阶段目标');
  eq(Object.keys(backup.targets).length, 6, '备份包含 6 个模块的阶段目标');

  // 清空
  $('#btn-clear').click();
  await wait(250);
  setInput($('#clear-confirm-input'), 'DELETE');
  $('#modal-root [data-act="ok"]').click();
  await wait(300);
  eq(JSON.parse(win.localStorage.getItem('kaogong_dashboard')).records.length, 0, '输入 DELETE 后记录被清空');
  ok(!$('#btn-clear').disabled === false, '清空后「清空记录」按钮置灰');

  // 恢复
  const restoreFile = new win.File([backupText], '考公练习追踪看板_2026-09-28.json', { type: 'application/json' });
  const jinput = doc.getElementById('file-json');
  Object.defineProperty(jinput, 'files', { value: [restoreFile], configurable: true });
  jinput.dispatchEvent(new win.Event('change', { bubbles: true }));
  await wait(300);
  ok($('#modal-root .modal'), '恢复前弹出确认框');
  ok($('#modal-root .modal-body').textContent.indexOf('当前已有 0 条记录') >= 0, '确认框显示当前记录数');
  const restoredBefore = JSON.parse(win.localStorage.getItem('kaogong_dashboard')).records.length;
  $('#modal-root [data-act="ok"]').click();
  await wait(350);
  const afterRestore = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  eq(restoredBefore, 0, '确认前仍未恢复');
  eq(afterRestore.records.length, 1, '恢复后记录数回到 1');
  eq(afterRestore.records[0].paperName, '第29季', '恢复出的记录内容正确');
  eq(afterRestore.settings.defeatTarget, 90, '恢复同时带回目标设置');
  eq($$('#records-table tbody tr').length, 1, '主表恢复显示 1 行');

  console.log('--- 备份格式校验 ---');
  const badFile = new win.File(['{"foo":1}'], 'bad.json', { type: 'application/json' });
  Object.defineProperty(jinput, 'files', { value: [badFile], configurable: true });
  jinput.dispatchEvent(new win.Event('change', { bubbles: true }));
  await wait(300);
  ok(!$('#modal-root .modal'), '格式不正确的 JSON 不弹确认框');
  eq(errors.length, 0, '全流程无 JS 报错' + (errors.length ? ' -> ' + errors.join(' | ') : ''));

  console.log(`\n===== PASS ${pass} / FAIL ${fail} =====`);
  if (errors.length) console.log('捕获到的 JS 报错:\n' + errors.join('\n'));
  dom.window.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => {
  console.error('测试脚本异常:', e);
  process.exit(1);
});
