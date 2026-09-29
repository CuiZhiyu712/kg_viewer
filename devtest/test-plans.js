/* 每日计划模块测试：日期/周计算、两种内容形态、循环补齐、作用域语义、界面交互、备份往返 */
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

let pass = 0, fail = 0;
function eq(a, b, label) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++;
  else { fail++; console.log(`  FAIL ${label}\n       actual   = ${x}\n       expected = ${y}`); }
}
const ok = (c, label) => eq(!!c, true, label);

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  virtualConsole: vc,
  beforeParse(win) {
    win.XLSX = XLSX;
    win.echarts = { init: () => ({ setOption() {}, resize() {}, dispose() {} }), getInstanceByDom: () => null };
    win.__blobs = [];
    win.URL.createObjectURL = (b) => { win.__blobs.push(b); return 'blob:stub'; };
    win.URL.revokeObjectURL = () => {};
  },
});
const win = dom.window;
const doc = win.document;
const KG = win.KG;
const M = KG.Model;
const U = KG.Utils;
const P = KG.Plans;
const $ = (s, r) => (r || doc).querySelector(s);
const $$ = (s, r) => Array.from((r || doc).querySelectorAll(s));
const text = (s) => ($(s) ? $(s).textContent.trim() : '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const setInput = (el, v) => { el.value = String(v); el.dispatchEvent(new win.Event('input', { bubbles: true })); el.dispatchEvent(new win.Event('change', { bubbles: true })); };

const TODAY = U.today();
const WEEK_START = M.weekStartOf(TODAY);
const WEEK_END = M.weekEndOf(TODAY);

(async function run() {
  await wait(300);
  eq($$('#tabs .tab').length, 6, '六个 Tab（多了每日计划与学习计时）');
  eq(text('#tabs .tab:nth-child(5)'), '模块五：每日计划', '模块五名称');
  eq(text('#tabs .tab:last-child'), '模块六：学习计时', '模块六名称');

  console.log('--- 日期与周（周一开始） ---');
  eq(M.dayOfWeek('2026-09-28'), 1, '2026-09-28 是周一');
  eq(M.dayOfWeek('2026-09-29'), 2, '2026-09-29 是周二');
  eq(M.dayOfWeek('2026-10-04'), 7, '2026-10-04 是周日');
  eq(M.weekdayName('2026-09-28'), '周一', '中文星期名');
  eq(M.weekStartOf('2026-09-29'), '2026-09-28', '周二归到本周一');
  eq(M.weekStartOf('2026-10-04'), '2026-09-28', '周日仍归到同一个周一（不是下周一）');
  eq(M.weekEndOf('2026-09-29'), '2026-10-04', '周日为周尾');
  eq(M.addDays('2026-09-28', -3), '2026-09-25', '日期减法');
  eq(M.addDays('2026-09-28', 7), '2026-10-05', '日期跨月加法');
  eq(M.dayOfWeek('乱写'), null, '非法日期返回 null');
  eq(M.weekStartOf(''), '', '空日期返回空串（不抛出）');

  console.log('--- 两种内容形态的派生 ---');
  let p = M.blankPlan('day', '2026-09-29');
  p.title = 't'; p.contentMode = 'text'; p.content = '做题\n复盘'; p.minutes = 120; p.done = true;
  M.normalizePlan(p);
  eq([p.minutes, p.done], [120, true], '文本模式：时长与完成由用户填');
  eq(p.items.length, 0, '文本模式没有子项');

  let q = M.blankPlan('day', '2026-09-29');
  q.title = 'q'; q.contentMode = 'list';
  q.items = [{ text: 'a', minutes: 120, done: true }, { text: 'b', minutes: 30, done: false }];
  M.normalizePlan(q);
  eq(q.minutes, 150, '清单模式：时长自动求和');
  eq(q.done, false, '清单模式：有未完成子项 -> 未完成');
  q.items[1].done = true;
  M.normalizePlan(q);
  eq(q.done, true, '清单模式：全部子项完成 -> 完成');
  eq(M.itemsMinutes([]), null, '空清单返回 null（不产生 NaN）');
  eq(M.itemsDone([]), false, '空清单不算完成');

  console.log('--- 循环补齐 ---');
  // 三天前开始的每日循环：应补出 前3天 + 今天 + 本周剩余
  const start = M.addDays(TODAY, -3);
  const state = { plans: [], planRules: [], sessions: [] };
  const rule = M.blankPlanRule({ freq: 'daily', startDate: start, kind: 'day', title: '每天背常识', contentMode: 'text', content: '背 20 个', minutes: 20 });
  state.planRules.push(rule);
  let created = P.materialize(state, TODAY);
  const expectCount = (U.dateStringToSerial(WEEK_END) - U.dateStringToSerial(start)) + 1;
  eq(created, expectCount, '补齐条数 = 起始日到本周日（含）共 ' + expectCount + ' 天');
  eq(state.plans.length, expectCount, '实例数一致');
  eq(state.plans.map((x) => x.date)[0], start, '第一条就是起始日（历史也补）');
  eq(state.plans[state.plans.length - 1].date, WEEK_END, '最后一条是本周日');
  eq(state.plans.filter((x) => x.ruleId === rule.id).length, expectCount, '都带 ruleId');
  eq(state.plans[0].title, '每天背常识', '实例继承模板标题');
  eq(state.plans[0].done, false, '新实例未完成');

  eq(P.materialize(state, TODAY), 0, '再补一次不重复生成（幂等）');
  eq(state.plans.length, expectCount, '实例数没变');

  // 截止日期
  const s2 = { plans: [], planRules: [], sessions: [] };
  s2.planRules.push(M.blankPlanRule({ freq: 'daily', startDate: M.addDays(TODAY, -5), until: M.addDays(TODAY, -3), kind: 'day', title: 'x' }));
  eq(P.materialize(s2, TODAY), 3, '有截止日期时只补到截止日（5天前到3天前共 3 天）');

  // 每周循环
  const s3 = { plans: [], planRules: [], sessions: [] };
  s3.planRules.push(M.blankPlanRule({ freq: 'weekly', startDate: M.addDays(TODAY, -14), kind: 'week', title: '每周目标' }));
  P.materialize(s3, TODAY);
  const weekDates = s3.plans.map((x) => x.date);
  eq(weekDates.length, 3, '两周前一周期：补出 3 个（前两周 + 本周）');
  eq(weekDates.every((d) => M.dayOfWeek(d) === M.dayOfWeek(M.addDays(TODAY, -14))), true, '每个实例都是同一个星期几');

  // 周计划不做每日循环
  const s4 = { plans: [], planRules: [], sessions: [] };
  s4.planRules.push(M.blankPlanRule({ freq: 'daily', startDate: TODAY, kind: 'week', title: '不合法的组合' }));
  eq(P.materialize(s4, TODAY), 0, '周计划 + 每日循环被忽略（不生成）');

  // 起始日在未来
  const s5 = { plans: [], planRules: [], sessions: [] };
  s5.planRules.push(M.blankPlanRule({ freq: 'daily', startDate: M.addDays(TODAY, 5), kind: 'day', title: '未来' }));
  const n5 = P.materialize(s5, TODAY);
  eq(s5.plans[0].date, M.addDays(TODAY, 5), '未来的规则从起始日才开始铺');
  eq(n5 >= 1, true, '仍会铺本周日之前的那部分');

  console.log('--- 分组：今天 / 本周 / 其他 ---');
  const g = P.group(state, TODAY);
  eq(g.today, TODAY, '今天');
  eq(g.weekStart, WEEK_START, '本周一');
  eq(g.weekEnd, WEEK_END, '本周日');
  eq(g.todayPlans.length, 1, '今天有 1 条');
  eq(g.todayPlans[0].date, TODAY, '今天的日期正确');
  eq(g.weekPlans.every((x) => x.date >= WEEK_START && x.date <= WEEK_END && x.date !== TODAY), true, '本周其余都落在本周内且不含今天');
  eq(g.weekRules.length, 0, '日计划循环不会出「周计划」规则卡');

  const g2 = P.group(s3, TODAY);
  eq(g2.weekRules.length, 1, '周计划循环会出一条规则卡');
  eq(g2.weekRules[0].title, '每周目标', '规则卡内容');
  const rc = P.ruleCompletion(s3, g2.weekRules[0], WEEK_START, WEEK_END);
  eq(rc.total, 1, '本周有 1 个实例');
  eq(rc.done, 0, '还没完成');

  console.log('--- 作用域：改整个循环 ---');
  const s6 = { plans: [], planRules: [], sessions: [] };
  const r6 = M.blankPlanRule({
    freq: 'daily', startDate: M.addDays(TODAY, -2), kind: 'day', title: '旧标题', contentMode: 'list',
    items: [{ text: '旧项1', minutes: 10 }, { text: '旧项2', minutes: 20 }]
  });
  s6.planRules.push(r6);
  P.materialize(s6, TODAY);
  // 把今天那条勾一部分，验证改规则时按位置继承完成状态
  const todayPlan = s6.plans.filter((x) => x.date === TODAY)[0];
  todayPlan.items[0].done = true;
  M.normalizePlan(todayPlan);
  const pastPlan = s6.plans.filter((x) => x.date === M.addDays(TODAY, -2))[0];
  const pastTitle = pastPlan.title;

  r6.title = '新标题';
  r6.items = [{ text: '新项1', minutes: 15 }, { text: '新项2', minutes: 25 }, { text: '新增项3', minutes: 5 }];
  const changed = P.applyRuleToFuture(s6, r6, TODAY);
  eq(changed, s6.plans.filter((x) => x.date >= TODAY).length, '只更新今天及以后的实例');
  eq(s6.plans.filter((x) => x.date === TODAY)[0].title, '新标题', '今天那条已更新');
  eq(s6.plans.filter((x) => x.date === M.addDays(TODAY, -1))[0].title, '旧标题', '昨天那条属于历史，保留原样');
  eq(pastPlan.title, pastTitle, '两天前那条历史保留原样');
  eq(s6.plans.filter((x) => x.date === TODAY)[0].items.length, 3, '子项换成新的 3 条');
  eq(s6.plans.filter((x) => x.date === TODAY)[0].items[0].done, true, '第 1 项按位置继承了「已完成」');
  eq(s6.plans.filter((x) => x.date === TODAY)[0].items[2].done, false, '新增的那项是未完成');

  console.log('--- 作用域：删整个循环 ---');
  const before = s6.plans.length;
  const removed = P.removeFutureInstances(s6, r6.id, TODAY);
  eq(s6.plans.length, before - removed, '实例数相应减少');
  eq(s6.plans.some((x) => x.ruleId === r6.id && x.date >= TODAY), false, '今天及以后的都没了');
  eq(s6.plans.some((x) => x.date === M.addDays(TODAY, -2)), true, '两天前的历史还在（关键）');

  console.log('--- 完成情况统计 ---');
  const c1 = P.completionOf([]);
  eq([c1.total, c1.done, c1.rate], [0, 0, null], '空列表：完成率为 null，不产生 NaN');
  const c2 = P.completionOf([
    { minutes: 60, done: true }, { minutes: 30, done: false }, { minutes: null, done: true }
  ]);
  eq([c2.total, c2.done], [3, 2], '计数');
  eq(c2.rate, 66.7, '完成率');
  eq(c2.planMinutes, 90, '计划时长只加有值的');
  eq(c2.doneMinutes, 60, '已完成时长');

  console.log('--- 界面：计划卡片 ---');
  $$('#tabs .tab').find((b) => b.dataset.tab === 'plans').click();
  await wait(200);
  ok($('#panel-plans').classList.contains('is-active'), '切到模块五');
  ok(text('#plans-cards').length > 0, '概览卡片有内容');
  eq($$('#plans-filter .chip').length, 3, '三个筛选按钮');

  // 通过表单新增一条「每日重复」的计划（走真实交互）
  $('#btn-add-plan').click();
  await wait(250);
  ok($('#modal-root .modal'), '新增计划弹窗打开');
  eq($('#modal-root [data-field="kind"]').value, 'day', '默认日计划');
  setInput($('#modal-root [data-field="date"]'), M.addDays(TODAY, -2));
  setInput($('#modal-root [data-field="title"]'), '每天背常识');
  setInput($('#modal-root [data-field="category"]'), '常识');
  setInput($('#modal-root [data-field="content"]'), '背 20 个常识点');
  setInput($('#modal-root [data-field="minutes"]'), '20');
  setInput($('#modal-root [data-field="repeat"]'), 'daily');
  $('#modal-root [data-act="save"]').click();
  await wait(350);

  const st = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  const uiStart = M.addDays(TODAY, -2);
  const expectUi = (U.dateStringToSerial(WEEK_END) - U.dateStringToSerial(uiStart)) + 1;
  eq(st.planRules.length, 1, '生成了一条循环规则');
  eq(st.planRules[0].freq, 'daily', '规则是每日重复');
  eq(st.planRules[0].category, '常识', '科目带上了');
  eq(st.plans.length, expectUi, '实例按补齐逻辑生成 ' + expectUi + ' 条（2 天前到今天本周日）');
  eq(st.plans.filter((x) => x.date === TODAY).length, 1, '今天有一条');
  ok($$('#plan-today .plan-card').length === 1, '今天的区块里渲染出卡片');
  ok($$('#plan-week .plan-card').length > 0, '本周区块里有卡片');
  ok(!$('#plan-rules-card').hidden, '出现了「循环计划」管理区');
  eq($$('#plan-rules .plan-card').length, 1, '管理区里列出 1 条规则');

  console.log('--- 界面：勾选完成 ---');
  const todayCard = $$('#plan-today .plan-card')[0];
  eq(todayCard.className.indexOf('is-done') >= 0, false, '初始未完成');
  todayCard.querySelector('.plan-check').checked = true;
  todayCard.querySelector('.plan-check').dispatchEvent(new win.Event('change', { bubbles: true }));
  await wait(200);
  let saved = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  eq(saved.plans.filter((x) => x.date === TODAY)[0].done, true, '勾选后已落盘');
  ok($$('#plan-today .plan-card')[0].className.indexOf('is-done') >= 0, '卡片变成完成态');

  console.log('--- 界面：清单形态与逐条勾选 ---');
  $('#btn-add-plan').click();
  await wait(250);
  setInput($('#modal-root [data-field="title"]'), '清单计划');
  $$('#modal-root #plan-mode-switch .chip').find((c) => c.getAttribute('data-mode') === 'list').click();
  await wait(100);
  $('#modal-root [data-act="item-add"]').click();
  $('#modal-root [data-act="item-add"]').click();
  await wait(100);
  const rows = $$('#modal-root [data-items-box] [data-item-row]');
  eq(rows.length, 2, '加了两条子项');
  setInput(rows[0].querySelector('[data-field="item-text"]'), '做套卷');
  setInput(rows[0].querySelector('[data-field="item-minutes"]'), '120');
  setInput(rows[1].querySelector('[data-field="item-text"]'), '复盘');
  setInput(rows[1].querySelector('[data-field="item-minutes"]'), '30');
  await wait(100);
  eq(text('#modal-root [data-items-total]'), '150', '合计自动汇总为 150');
  $('#modal-root [data-act="save"]').click();
  await wait(350);

  saved = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  const listPlan = saved.plans.filter((x) => x.title === '清单计划')[0];
  ok(listPlan, '清单计划已保存');
  eq(listPlan.contentMode, 'list', '内容形态是清单');
  eq(listPlan.minutes, 150, '时长自动汇总（不是手填）');
  ok($$('#plan-today .plan-card').some((c) => c.textContent.indexOf('清单计划') >= 0), '今天区块里渲染出清单卡片');

  const listCard = $$('#plan-today .plan-card').find((c) => c.textContent.indexOf('清单计划') >= 0);
  eq(listCard.querySelectorAll('.plan-item').length, 2, '渲染出 2 个子项');
  const itemBox = listCard.querySelector('[data-act="item-toggle"]');
  itemBox.checked = true;
  itemBox.dispatchEvent(new win.Event('click', { bubbles: true }));
  await wait(200);
  saved = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  const lp = saved.plans.filter((x) => x.title === '清单计划')[0];
  eq(lp.items[0].done, true, '子项可单独勾选');
  eq(lp.done, false, '还有一项没勾 -> 整条仍未完成');
  eq(lp.minutes, 150, '时长不受勾选影响');

  console.log('--- 界面：从管理区编辑循环规则 ---');
  const ruleCard = $$('#plan-rules .plan-card')[0];
  ok(ruleCard, '循环计划管理区里有规则卡（每日循环也能在这里管理）');
  ruleCard.querySelector('[data-act="rule-edit"]').click();
  await wait(300);
  ok($('#modal-root .modal'), '规则编辑弹窗打开');
  eq($('#modal-root [data-field="repeat"]').value, 'daily', '回填了重复方式');
  eq($('#modal-root [data-field="title"]').value, '每天背常识', '回填了标题');
  $('#modal-root [data-act="save"]').click();
  await wait(350);
  ok(!$('#modal-root .modal'), '保存后关闭');

  const instCard = $$('#plan-today .plan-card')[0];
  instCard.querySelector('[data-act="edit"]').click();
  await wait(300);
  ok($('#modal-root .modal'), '编辑循环实例先弹作用域询问');
  ok($('#modal-root .modal-body').textContent.indexOf('只改这一次') >= 0, '提供了「只改这一次」');
  $('#modal-root [data-act="once"]').click();
  await wait(300);
  eq(text('#modal-root .modal-title'), '编辑计划', '选「只改这一次」进入的是单条计划表单');
  ok($('#modal-root .modal-body').textContent.indexOf('重复方式请在') >= 0 || $('#modal-root .modal-body').textContent.indexOf('循环计划') >= 0,
    '单条编辑时说明了重复由循环规则管');
  $('#modal-root [data-act="cancel"]').click();
  await wait(250);

  console.log('--- 界面：删除循环实例也要问作用域 ---');
  $$('#plan-today .plan-card')[0].querySelector('[data-act="delete"]').click();
  await wait(300);
  ok($('#modal-root .modal-body').textContent.indexOf('只删这一次') >= 0, '提供了「只删这一次」');
  const beforeCount = JSON.parse(win.localStorage.getItem('kaogong_dashboard')).plans.length;
  $('#modal-root [data-act="once"]').click();
  await wait(350);
  const afterCount = JSON.parse(win.localStorage.getItem('kaogong_dashboard')).plans.length;
  eq(afterCount, beforeCount - 1, '只删掉了这一天');
  eq(JSON.parse(win.localStorage.getItem('kaogong_dashboard')).planRules.length, 1, '循环规则还在');

  console.log('--- 备份 / 数据文件都要带上计划 ---');
  $('#btn-backup').click();
  await wait(200);
  const backup = JSON.parse(await win.__blobs[win.__blobs.length - 1].text());
  ok(Array.isArray(backup.plans) && backup.plans.length > 0, '备份含 plans');
  ok(Array.isArray(backup.planRules) && backup.planRules.length > 0, '备份含 planRules');
  ok(Array.isArray(backup.sessions), '备份含 sessions');
  const sig = KG.FileStore.signature(KG.FileStore.payloadOf(KG.App.state, false));
  ok(sig.indexOf('"plans"') >= 0 && sig.indexOf('"planRules"') >= 0 && sig.indexOf('"sessions"') >= 0,
    '数据文件内容与签名都包含三个新实体');
  ok(sig.indexOf('"timer"') < 0, 'running 计时器刻意不进数据文件（避免无意义的不一致）');

  console.log('--- 恢复备份能把计划带回来 ---');
  const text2 = await win.__blobs[win.__blobs.length - 1].text();
  const jinput = doc.getElementById('file-json');
  Object.defineProperty(jinput, 'files', { value: [new win.File([text2], 'b.json', { type: 'application/json' })], configurable: true });
  jinput.dispatchEvent(new win.Event('change', { bubbles: true }));
  await wait(300);
  $('#modal-root [data-act="ok"]').click();
  await wait(400);
  const restored = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  ok(restored.plans.length > 0, '恢复后有计划');
  ok(restored.planRules.length > 0, '恢复后有循环规则');
  eq(restored.timer, null, '运行中的计时器不跟着恢复（避免假运行）');

  eq(errors.length, 0, '全程无 JS 报错' + (errors.length ? ' -> ' + errors.join(' | ') : ''));
  console.log(`\n===== PASS ${pass} / FAIL ${fail} =====`);
  if (errors.length) console.log(errors.join('\n'));
  dom.window.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error('测试脚本异常:', e); process.exit(1); });
