/* 模块四「用时分析」测试：标准用时默认值 / 达成率 / 超时排行 / 对比表 / 编辑 / 图表 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const XLSX = require('xlsx');

const html = require('./load-html')().html;

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => {
  const m = String(e.message || e);
  if (/Could not parse CSS/i.test(m)) return;
  if (/Not implemented: navigation/i.test(m)) return;
  errors.push('jsdomError: ' + m);
});
vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));

const charts = [];
const fakeEcharts = () => ({
  init(el) {
    const inst = { el, options: [], setOption(o) { this.options.push(o); }, resize() {}, dispose() {} };
    charts.push(inst);
    return inst;
  },
});

let pass = 0, fail = 0;
function eq(a, b, label) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++;
  else { fail++; console.log(`  FAIL ${label}\n       actual   = ${x}\n       expected = ${y}`); }
}
const ok = (c, label) => eq(!!c, true, label);

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole: vc,
  beforeParse(win) {
    win.XLSX = XLSX;
    win.echarts = fakeEcharts();
    win.__blobs = [];
    win.URL.createObjectURL = (b) => { win.__blobs.push(b); return 'blob:stub'; };
    win.URL.revokeObjectURL = () => {};
  },
});

const win = dom.window;
const doc = win.document;
const KG = win.KG;
const $ = (s, r) => (r || doc).querySelector(s);
const $$ = (s, r) => Array.from((r || doc).querySelectorAll(s));
const text = (s) => ($(s) ? $(s).textContent.trim() : '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const setInput = (el, v) => {
  el.value = String(v);
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
};

/** 读一行用时对比表 */
function readRow(name) {
  const tr = $$('#time-table tbody tr').find((t) => t.children[0].textContent.trim() === name);
  if (!tr) return null;
  const c = Array.from(tr.children).map((td) => td.textContent.trim());
  return { name: c[0], plan: c[1], latest: c[2], avg: c[3], diff: c[4], max: c[5], min: c[6], status: c[7] };
}
function planOf(state) { return state.timePlan; }

(async function run() {
  await wait(300);

  console.log('--- 默认标准用时 ---');
  const st0 = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  eq(planOf(st0).political.plan, 10, '政治理论 10');
  eq(planOf(st0).common.plan, 5, '常识 5');
  eq(planOf(st0).language.plan, 30, '言语理解 30');
  eq(planOf(st0).quantity.plan, 10, '数量 10');
  eq(planOf(st0).reasoning.plan, 33, '判断推理 33');
  eq(planOf(st0).dataAnalysis.plan, 25, '资料分析 25');
  eq(planOf(st0).reasoning.subs, { graphic: 10, definition: 10, analogy: 3, logic: 10 }, '判断推理子模块标准；一拖五不单列（计入逻辑判断）');
  eq(planOf(st0).language.subs, { logicalCloze: null, reading: null, sentence: null }, '言语理解子模块默认不设标准');
  eq(KG.Model.timePlanTotal(st0.timePlan), 113, '六模块合计 113 分钟');
  eq(Object.prototype.hasOwnProperty.call(planOf(st0).political, 'subs') && planOf(st0).political.subs, null, '非分组模块无子模块');

  console.log('--- 模块四 Tab ---');
  eq($$('#tabs .tab').length, 4, '4 个 Tab');
  eq(text('#tabs .tab:last-child'), '模块四：用时分析', '新 Tab 名称');
  $$('#tabs .tab').find((b) => b.dataset.tab === 'time').click();
  await wait(120);
  ok($('#panel-time').classList.contains('is-active'), '切到用时分析面板');

  console.log('--- 达成率 ---');
  const cardTexts = $$('#time-cards .stat-card').map((c) => c.textContent.replace(/\s+/g, ' ').trim());
  eq(cardTexts.length, 4, '4 个概览卡片');
  ok(cardTexts[0].indexOf('113') >= 0, '标准用时合计 113：' + cardTexts[0]);
  ok(cardTexts[1].indexOf('176') >= 0, '最近一次总用时 176：' + cardTexts[1]);
  ok(cardTexts[2].indexOf('155.8') >= 0, '达成率 155.8%：' + cardTexts[2]);
  ok(cardTexts[3].indexOf('63') >= 0 && cardTexts[3].indexOf('超时') >= 0, '超时 63 分钟：' + cardTexts[3]);
  eq(KG.Stats.timeOverview(KG.App.state.records, KG.App.state.timePlan).achievement, 155.8, '达成率计算值');

  console.log('--- 超时排行 ---');
  const ranks = $$('#time-ranking .rank-item').map((li) => li.textContent.replace(/\s+/g, ' ').trim());
  eq(ranks.length, 4, '只有超时的 4 个模块进排行（常食用时缺失、数量刚好不超）');
  ok(ranks[0].indexOf('资料分析') >= 0 && ranks[0].indexOf('+35') >= 0, '第 1 名 资料分析 +35：' + ranks[0]);
  ok(ranks[1].indexOf('言语理解') >= 0 && ranks[1].indexOf('+7') >= 0, '第 2 名 言语理解 +7：' + ranks[1]);
  ok(ranks[2].indexOf('判断推理') >= 0 && ranks[2].indexOf('+2') >= 0, '第 3 名 判断推理 +2：' + ranks[2]);
  ok(ranks[3].indexOf('政治理论') >= 0 && ranks[3].indexOf('+1') >= 0, '第 4 名 政治理论 +1：' + ranks[3]);

  console.log('--- 对比表 ---');
  eq($$('#time-table tbody tr').length, 13, '6 个模块 + 7 个子模块 = 13 行');
  const names = $$('#time-table tbody tr').map((t) => t.children[0].textContent.trim());
  eq(names.slice(0, 4), ['政治理论', '常识', '言语理解', '逻辑填空'], '模块行与子模块行顺序（子模块紧跟其模块）');
  ok($$('#time-table tbody tr')[3].classList.contains('time-sub-row'), '子模块行有缩进样式');

  eq(readRow('政治理论'), { name: '政治理论', plan: '10', latest: '11', avg: '11', diff: '+1', max: '11', min: '11', status: '超时' }, '政治理论行');
  eq(readRow('常识').status, '无数据', '常识缺用时 -> 无数据');
  eq(readRow('常识').diff, '—', '常识差值显示 —（不产生 NaN）');
  eq(readRow('言语理解'), { name: '言语理解', plan: '30', latest: '37', avg: '37', diff: '+7', max: '37', min: '37', status: '超时' }, '言语理解行（自动汇总子模块用时 37）');
  eq(readRow('数量关系').status, '达标', '数量关系 10/10 -> 达标');
  eq(readRow('数量关系').diff, '0', '刚好达标差值 0');
  eq(readRow('资料分析').diff, '+35', '资料分析 60 vs 25 -> +35');
  eq(readRow('逻辑填空').plan, '—', '未设标准的子模块显示 —');
  eq(readRow('逻辑填空').status, '未设标准', '未设标准的状态文案');
  eq(readRow('类比推理').diff, '+2', '类比推理 5 vs 3 -> +2');
  eq(readRow('图形推理').status, '达标', '图形推理 10/10 -> 达标');

  console.log('--- 图表：含标准用时线 + 所分析标记 ---');
  const chart = charts.find((c) => c.el.id === 'chart-time-analysis');
  ok(chart && chart.options.length, '用时分析图已渲染');
  const opt = chart.options[chart.options.length - 1];
  const mlY = (o) => o.series[0].markLine.data.filter((m) => m.yAxis !== undefined).map((m) => m.yAxis);
  const mlX = (o) => o.series[0].markLine.data.filter((m) => m.xAxis !== undefined).map((m) => m.xAxis);
  eq(opt.series[0].name, '总用时', '默认显示总用时');
  eq(mlY(opt), [113], '画出标准用时合计线 113');
  eq(mlX(opt), ['2026-09-19'], '在图上标出正在分析的那一套（日期）');
  eq(opt.yAxis.max >= 176, true, 'y 轴上限覆盖实际值 176（标准线才不会被裁掉）');
  ok($$('#time-analysis-switch .chip').length === 7, '切换按钮：总用时 + 6 模块');

  // 切到「资料分析」
  $$('#time-analysis-switch .chip').find((b) => b.textContent.trim() === '资料分析').click();
  await wait(80);
  const opt2 = chart.options[chart.options.length - 1];
  eq(opt2.series[0].name, '资料分析用时', '切到模块视图');
  eq(mlY(opt2), [25], '标准线切换为该模块的 25 分钟');

  console.log('--- 编辑标准用时（用户可自行修改） ---');
  $('#btn-edit-timeplan').click();
  await wait(250);
  ok($('#modal-root .modal'), '打开编辑弹窗');
  eq($$('#modal-root tr[data-key]').length, 13, '弹窗里也是 13 行（模块 + 子模块）');
  eq($('#modal-root tr[data-key="political"] [data-field="plan"]').value, '10', '回填政治理论 10');
  eq($('#modal-root [data-plan-total]').textContent.trim(), '113 分钟', '实时显示合计 113');
  setInput($('#modal-root tr[data-key="political"] [data-field="plan"]'), 20);
  eq($('#modal-root [data-plan-total]').textContent.trim(), '123 分钟', '改一个数合计实时变化');
  // 言语理解子模块填上，验证与模块值不一致时的提示
  setInput($('#modal-root tr[data-key="language.logicalCloze"] [data-field="plan"]'), 20);
  setInput($('#modal-root tr[data-key="language.reading"] [data-field="plan"]'), 10);
  setInput($('#modal-root tr[data-key="language.sentence"] [data-field="plan"]'), 5);
  $('#modal-root [data-act="save"]').click();
  await wait(300);

  const st1 = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  eq(st1.timePlan.political.plan, 20, '修改后的政治理论 20 已持久化');
  eq(st1.timePlan.language.subs, { logicalCloze: 20, reading: 10, sentence: 5 }, '子模块标准已保存');
  eq(KG.Model.timePlanTotal(st1.timePlan), 123, '合计 123');
  eq(readRow('政治理论').plan, '20', '表格联动');
  eq(readRow('政治理论').status, '富余', '政治理论 11 vs 20 -> 富余');
  eq(readRow('政治理论').diff, '-9', '富余 -9');
  eq(readRow('逻辑填空').status, '富余', '逻辑填空 17 vs 20 -> 富余（实际小于标准）');
  eq(readRow('逻辑填空').diff, '-3', '富余 -3');

  console.log('--- 标准用时与子模块之和不一致时的提示 ---');
  ok(!$('#time-plan-note').hidden, '言语理解 20+10+5=35 ≠ 模块 30，给出提示');
  ok(text('#time-plan-note').indexOf('模块 30 ≠ 子模块之和 35') >= 0, '提示内容指明差异：' + text('#time-plan-note'));

  console.log('--- 清空某个标准 -> 不设标准（不被默认值弹回） ---');
  $('#btn-edit-timeplan').click();
  await wait(250);
  setInput($('#modal-root tr[data-key="political"] [data-field="plan"]'), '');
  $('#modal-root [data-act="save"]').click();
  await wait(300);
  const st2 = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  eq(st2.timePlan.political.plan, null, '清空后保存为 null，而不是弹回默认 10');
  eq(readRow('政治理论').plan, '—', '表格显示 —');
  eq(readRow('政治理论').status, '未设标准', '状态为未设标准');
  eq(KG.Model.timePlanTotal(st2.timePlan), 103, '不参与合计（123 - 20）');

  console.log('--- 恢复默认 ---');
  $('#btn-edit-timeplan').click();
  await wait(250);
  $('#modal-root [data-act="reset"]').click();
  await wait(100);
  eq($('#modal-root tr[data-key="political"] [data-field="plan"]').value, '10', '恢复默认后政治理论回到 10');
  eq($('#modal-root tr[data-key="language.logicalCloze"] [data-field="plan"]').value, '', '子模块回到留空');
  $('#modal-root [data-act="save"]').click();
  await wait(300);
  const st3 = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  eq(KG.Model.timePlanTotal(st3.timePlan), 113, '又回到 113');
  eq(st3.timePlan.language.subs.logicalCloze, null, '子模块重新变回 null');

  console.log('--- 选择要对比的套卷（不再固定用最近一次） ---');
  // 先加一套更晚的记录，制造「两次可选」的局面
  $('#btn-add').click();
  await wait(250);
  setInput($('#modal-root [data-field="date"]'), '2026-10-10');
  setInput($('#modal-root [data-field="paperName"]'), '第32季');
  setInput($('#modal-root [data-field="score"]'), '80');
  setInput($('#modal-root [data-field="averageScore"]'), '70');
  setInput($('#modal-root [data-field="defeatRate"]'), '90');
  let b32 = $('#modal-root .mod-block[data-module="political"]');
  setInput($('[data-field="questions"]', b32), 20);
  setInput($('[data-field="correct"]', b32), 15);
  setInput($('[data-field="time"]', b32), 30);       // 政治理论 30 分钟，明显区别于第一套的 11
  $('#modal-root [data-act="save"]').click();
  await wait(300);

  const st = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  const recs = KG.Stats.sortedAsc(st.records);
  eq(recs.length, 2, '现在有两套卷');
  const olderId = recs[0].id, newerId = recs[1].id;
  eq(recs.map((r) => r.paperName), ['第29季', '第32季'], '按日期升序');

  const sel = $('#time-focus');
  ok(sel, '用时分析里有「对比套卷」下拉');
  eq($$('#time-focus option').length, 3, '选项 = 最近一次 + 2 套记录');
  eq($$('#time-focus option')[0].textContent.trim(), '最近一次（自动跟随）', '第一个选项是自动跟随');
  ok($$('#time-focus option')[1].textContent.indexOf('第32季') >= 0, '最新的排在最前');
  eq(sel.value, '', '默认选中「最近一次」');
  ok(text('#time-hint').indexOf('第 2/2 套') >= 0, '提示显示当前是第几套：' + text('#time-hint'));
  ok(text('#time-hint').indexOf('最近一次') >= 0, '提示标明是最近一次');

  // 默认（最近一次）下：政治理论实际用时 = 第二套的 30
  eq(readRow('政治理论').latest, '30', '默认用最近一次：政治理论 30 分钟');
  eq(readRow('政治理论').status, '超时', '30 vs 标准 10 -> 超时');

  // 切到第一套
  sel.value = olderId;
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  await wait(200);
  ok(text('#time-hint').indexOf('第 1/2 套') >= 0, '切到第 1 套：' + text('#time-hint'));
  eq(text('#time-hint').indexOf('最近一次'), -1, '切到非最近一次后不再显示「最近一次」');
  eq(readRow('政治理论').latest, '11', '政治理论实际用时变成第一套的 11');
  eq(readRow('政治理论').status, '超时', '11 vs 标准 10 -> 仍超时');
  eq(readRow('资料分析').latest, '60', '资料分析实际用时来自第一套的 60');
  const cards = $$('#time-cards .stat-card').map((c) => c.textContent.replace(/\s+/g, ' ').trim());
  ok(cards[1].indexOf('176') >= 0, '卡片「该套总用时」变成第一套的 176：' + cards[1]);
  ok(cards[3].indexOf('63') >= 0, '超时量随之变成 63：' + cards[3]);
  const rank = $$('#time-ranking .rank-item').map((li) => li.textContent.replace(/\s+/g, ' ').trim());
  ok(rank[0].indexOf('资料分析') >= 0 && rank[0].indexOf('+35') >= 0, '超时排行跟着切换：' + rank[0]);
  eq(mlX(chart.options[chart.options.length - 1]), ['2026-09-19'], '图上的「所分析」竖线移到第一套');

  // 切回自动跟随
  sel.value = '';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  await wait(200);
  eq(readRow('政治理论').latest, '30', '切回自动跟随后又用最近一次');

  // 锁定第一套后把它删掉：应优雅回退，不报错
  sel.value = olderId;
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  await wait(200);
  eq(readRow('政治理论').latest, '11', '已锁定第一套');
  const rowOld = $$('#records-table tbody tr').find((tr) => tr.children[1].textContent.trim() === '第29季');
  rowOld.querySelector('[data-act="delete"]').click();
  await wait(250);
  $('#modal-root [data-act="ok"]').click();
  await wait(300);
  eq(JSON.parse(win.localStorage.getItem('kaogong_dashboard')).records.length, 1, '第一套已删除');
  eq($('#time-focus').value, '', '选中的记录被删后，下拉回退到「最近一次」');
  eq($$('#time-focus option').length, 2, '选项变成 1 + 1');
  eq(readRow('政治理论').latest, '30', '回退后仍能正常显示');
  eq(errors.length, 0, '切换/删除过程无 JS 报错' + (errors.length ? ' -> ' + errors.join(' | ') : ''));

  console.log('--- 标准用时随备份 / 数据文件一起走 ---');
  $('#btn-backup').click();
  await wait(200);
  const backup = JSON.parse(await win.__blobs[win.__blobs.length - 1].text());
  eq(backup.timePlan.reasoning.plan, 33, 'JSON 备份包含标准用时');
  eq(KG.FileStore.signature(KG.FileStore.payloadOf(KG.App.state, false)).indexOf('timePlan') >= 0, true, '数据文件内容包含标准用时');

  console.log('--- 无数据时的空状态 ---');
  const emptyState = KG.Stats.timeOverview([], st3.timePlan);
  eq(emptyState.achievement, null, '无记录时达成率为 null，不是 NaN/Infinity');
  eq(emptyState.overage, null, '无记录时差值为 null');
  eq(emptyState.planTotal, 113, '标准用时合计与记录无关');

  console.log('--- 0 / 空值边界 ---');
  eq(KG.Stats.timeStats([], st3.timePlan).length, 13, '无记录时仍返回 13 行（计划值照常显示）');
  eq(KG.Stats.timeStats([], st3.timePlan)[0].status.text, '无数据', '无记录时状态为无数据');

  eq(errors.length, 0, '全程无 JS 报错' + (errors.length ? ' -> ' + errors.join(' | ') : ''));
  console.log(`\n===== PASS ${pass} / FAIL ${fail} =====`);
  if (errors.length) console.log('捕获到的 JS 报错:\n' + errors.join('\n'));
  dom.window.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error('测试脚本异常:', e); process.exit(1); });
