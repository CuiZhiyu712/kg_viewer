/* 学习计时引擎测试：秒表 / 番茄钟 / 暂停 / 长时间未打开 / 失控检测
 * timer.js 的所有函数都接受 now 参数，所以这里注入明确的时间戳，不依赖真实时钟。
 */
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
    win.URL.createObjectURL = () => 'blob:stub';
    win.URL.revokeObjectURL = () => {};
  },
});
const win = dom.window;
const doc = win.document;
const KG = win.KG;
const $ = (s, r) => (r || doc).querySelector(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const MIN = 60000;
const T = KG.Timer;
const POMO = { focusMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4 };

(async function run() {
  await wait(300);
  ok(T, '计时引擎已加载');

  console.log('--- 正计时（秒表） ---');
  let t = T.create({ mode: 'stopwatch', label: '资料分析', category: '资料分析' }, 1000);
  eq(t.active, true, '创建后处于运行中');
  eq(t.segmentStart, 1000, '记录了这一段的起点');
  eq(T.studyMs(t, 1000), 0, '刚开始为 0');
  eq(T.studyMs(t, 1000 + 60 * 1000), 60 * 1000, '1 分钟后 = 60000ms');
  eq(T.studySeconds(t, 1000 + 90 * 1000), 90, '90 秒');

  console.log('--- 暂停 / 继续 ---');
  T.pause(t, 1000 + 120 * 1000);                       // 累计 120s 后暂停
  eq(t.segmentStart, null, '暂停后没有进行中的段');
  eq(T.running(t), false, 'running=false');
  eq(T.studyMs(t, 1000 + 999 * 1000), 120 * 1000, '暂停期间时间不走（关键）');
  T.resume(t, 1000 + 999 * 1000);
  eq(T.studyMs(t, 1000 + 1029 * 1000), 150 * 1000, '继续后接上，共 150 秒');
  T.pause(t, 1000 + 1029 * 1000);

  console.log('--- 结束 -> 生成学习记录 ---');
  const s = T.finish(t, 1000 + 1029 * 1000);
  ok(s, '返回了一条记录');
  eq(s.seconds, 150, '时长 150 秒');
  eq(s.label, '资料分析', '标签');
  eq(s.category, '资料分析', '科目');
  eq(s.date, KG.Utils.toDateString(new Date(1000)), '按开始时刻归属日期');
  ok(s.startAt && s.endAt, '起止时间都记下了');
  eq(s.pomodoros, 0, '秒表模式没有番茄数');

  console.log('--- 零时长不产生记录 ---');
  const t0 = T.create({ mode: 'stopwatch', label: 'x' }, 5000);
  eq(T.finish(t0, 5000), null, '0 秒结束返回 null（不会产生空记录）');

  console.log('--- 番茄钟：专注/休息交替 ---');
  let p = T.create({ mode: 'pomodoro', label: '套卷', pomo: POMO }, 0);
  eq(T.phaseTargetMs(p), 25 * MIN, '第一个阶段目标是 25 分钟');
  eq(T.phaseRemainSeconds(p, 0), 25 * 60, '剩余 1500 秒');
  eq(T.advance(p, 24 * MIN), null, '不到点不换阶段');
  eq(p.phase, 'focus', '还在专注');
  eq(T.advance(p, 25 * MIN), 'focus-done', '到点返回 focus-done');
  eq(p.pomodoros, 1, '完成 1 个番茄');
  eq(p.phase, 'break', '进入休息');
  eq(T.studyMs(p, 25 * MIN), 25 * MIN, '学习时长 = 25 分钟');

  console.log('--- 休息不计入学习时长 ---');
  eq(T.studyMs(p, 25 * MIN + 3 * MIN), 25 * MIN, '休息了 3 分钟，学习时长不变（关键）');
  eq(T.advance(p, 30 * MIN), 'break-done', '休息到点');
  eq(p.phase, 'focus', '回到专注');
  eq(T.studyMs(p, 30 * MIN), 25 * MIN, '仍是 25 分钟');
  eq(T.advance(p, 55 * MIN), 'focus-done', '第二个番茄完成');
  eq(T.studyMs(p, 55 * MIN), 50 * MIN, '累计 50 分钟');

  console.log('--- 每 4 个番茄后是长休息 ---');
  // 现在 pomodoros=2，再走两个番茄到 4
  let clock = 55 * MIN;
  clock += 5 * MIN; T.advance(p, clock);          // 休息结束 -> focus (pomodoros=2)
  clock += 25 * MIN; T.advance(p, clock);         // 第3个番茄完成
  clock += 5 * MIN; T.advance(p, clock);
  clock += 25 * MIN; T.advance(p, clock);         // 第4个番茄完成
  eq(p.pomodoros, 4, '已完成 4 个番茄');
  eq(p.phase, 'break', '进入休息');
  eq(T.phaseTargetMs(p), 15 * MIN, '第 4 个番茄后是长休息 15 分钟');
  eq(T.studyMs(p, clock), 100 * MIN, '学习时长 100 分钟（休息都没算进来）');

  console.log('--- 番茄模式下中途结束：进行中的专注段计入，休息段不计入 ---');
  let q = T.create({ mode: 'pomodoro', label: 'y', pomo: POMO }, 0);
  let sq = T.finish(q, 10 * MIN);
  eq(sq.seconds, 10 * 60, '专注 10 分钟后结束 -> 记 600 秒');
  let q2 = T.create({ mode: 'pomodoro', label: 'y', pomo: POMO }, 0);
  T.advance(q2, 25 * MIN);                        // 进入休息
  let sq2 = T.finish(q2, 25 * MIN + 4 * MIN);      // 休息 4 分钟后结束
  eq(sq2.seconds, 25 * 60, '结束时有 4 分钟休息，只记 25 分钟专注（关键）');

  console.log('--- 长时间未打开：按时间戳追赶，不会漂移 ---');
  let r = T.create({ mode: 'stopwatch', label: 'z' }, 0);
  eq(T.studyMs(r, 8 * 3600 * 1000), 8 * 3600 * 1000, '关了 8 小时再回来，计时照走');
  ok(T.isRunaway(r, 8 * 3600 * 1000), '超过 6 小时判定为失控');
  ok(!T.isRunaway(r, 60 * 1000), '1 分钟不算失控');
  let r2 = T.create({ mode: 'pomodoro', label: 'z2', pomo: POMO }, 0);
  // 一小时没开：25专注+5休息+25专注 = 应完成 2 个番茄、学习 50 分钟
  T.advance(r2, 60 * MIN);
  eq(r2.pomodoros, 2, '一小时里自动走完 2 个专注轮');
  ok(T.studyMs(r2, 60 * MIN) === 50 * MIN, '学习时长只累计专注阶段');

  console.log('--- 换阶段的跳跃有上限（防死循环） ---');
  let big = T.create({ mode: 'pomodoro', label: 'big', pomo: { focusMin: 1, breakMin: 1, longBreakMin: 1, longEvery: 1 } }, 0);
  T.advance(big, 100000 * MIN, 10);               // 只允许跳 10 次
  eq(big.pomodoros <= 10, true, '跳跃次数受 maxHops 限制（实际 ' + big.pomodoros + '）');

  console.log('--- 界面：计时条与开始区 ---');
  // 通过 App 启动一次计时（走真实交互路径）
  $('#tabs .tab').click();
  const startBtn = $('#btn-timer-start');
  ok(startBtn, '有「开始计时」按钮');
  $('#timer-label').value = '测试学习';
  $('#timer-category').value = '申论';
  startBtn.click();
  await wait(150);
  const st = KG.App.state;
  ok(st.timer && st.timer.active, '计时已启动');
  eq(st.timer.label, '测试学习', '标签带上了');
  eq(st.timer.category, '申论', '科目带上了');
  ok(!$('#timer-bar').hidden, '悬浮计时条显示出来了');
  ok($('#timer-start-area').hidden, '开始区隐藏');
  ok(!$('#timer-running-area').hidden, '运行区显示');

  console.log('--- 暂停按钮 ---');
  $('#btn-timer-pause').click();
  await wait(120);
  eq(KG.Timer.running(KG.App.state.timer), false, '点了暂停');
  eq($('#btn-timer-pause').textContent.trim(), '继续', '按钮文案变成「继续」');
  ok($('#timer-bar').classList.contains('is-paused'), '计时条显示暂停样式');
  $('#btn-bar-pause').click();
  await wait(120);
  eq(KG.Timer.running(KG.App.state.timer), true, '从计时条恢复');

  console.log('--- 结束 -> 落库 + 统计联动 ---');
  // 把这一段时长顶到 20 分钟（直接改时间戳，避免真等）
  KG.App.state.timer.segmentStart = Date.now() - 20 * 60 * 1000;
  $('#btn-bar-stop').click();
  await wait(250);
  eq(KG.App.state.timer, null, '计时器已清空');
  eq(KG.App.state.sessions.length, 1, '生成了 1 条计时记录');
  const rec = KG.App.state.sessions[0];
  ok(rec.seconds >= 20 * 60, '记录时长 ≥ 20 分钟（实际 ' + rec.seconds + ' 秒）');
  eq(rec.label, '测试学习', '记录标签');
  eq(rec.category, '申论', '记录科目');
  const saved = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  eq(saved.sessions.length, 1, '已写入 localStorage');
  eq(saved.timer, null, '计时器状态也已落盘（null）');

  console.log('--- 统计：今日/本周/平均 ---');
  const ov = KG.Plans.overview(KG.App.state, KG.Utils.today());
  ok(ov.today.seconds >= 20 * 60, '今日学习时长');
  eq(ov.today.activeDays, 1, '今天有 1 天有记录');
  ok(ov.week.seconds >= ov.today.seconds, '本周 ≥ 今日');
  eq(ov.month.avgPerActiveDay, ov.month.seconds, '只有 1 天有记录时，平均 = 当天总时长');

  console.log('--- 分布：按科目 / 按计划 ---');
  const distCat = KG.Plans.distribution(KG.App.state, KG.Utils.today(), 'category');
  eq(distCat.length, 1, '一个科目一个扇区');
  eq(distCat[0].name, '申论', '科目名');
  eq(distCat[0].percent, 100, '占比 100%');
  const distPlan = KG.Plans.distribution(KG.App.state, KG.Utils.today(), 'plan');
  eq(distPlan[0].name, '测试学习', '按计划时用标签名');

  console.log('--- 重启后能恢复运行中的计时 ---');
  const raw = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  raw.timer = { active: true, mode: 'stopwatch', label: '重启恢复', category: '', planId: null, phase: 'focus', pomodoros: 0, studyMs: 60000, phaseMs: 0, segmentStart: Date.now() - 60000, startedAt: Date.now() - 60000, pausedMs: 0, pomo: POMO };
  win.localStorage.setItem('kaogong_dashboard', JSON.stringify(raw));
  const loaded = KG.Store.load();
  ok(loaded.timer && loaded.timer.active, '计时器状态被读回来了');
  eq(KG.Timer.studySeconds(loaded.timer), 120, '恢复后接着算：60 秒已存 + 60 秒进行中 = 120 秒');

  eq(errors.length, 0, '全程无 JS 报错' + (errors.length ? ' -> ' + errors.join(' | ') : ''));
  console.log(`\n===== PASS ${pass} / FAIL ${fail} =====`);
  dom.window.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error('测试脚本异常:', e); process.exit(1); });
