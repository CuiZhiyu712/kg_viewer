/* 给模块五 / 模块六 截图（塞入示例计划与计时记录），用于目视检查 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '..', '考公练习追踪看板.html');
const SHOTS = path.join(__dirname, 'shots');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9411;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SHOTS, { recursive: true });

async function findTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('调试端口未就绪');
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  return {
    send: (method, params) => new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    }),
  };
}

(async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-shot-'));
  const fileUrl = 'file:///' + APP.replace(/\\/g, '/');
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1920,1080',
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    `--user-data-dir=${profile}`, fileUrl,
  ], { stdio: 'ignore' });

  const target = await findTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const c = cdp(ws);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await sleep(3500);

  const ev = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };

  // 塞入示例数据：今天/明天的日计划、一个清单模式、一个每日循环、一个周计划
  await ev(`(() => {
    const U = KG.Utils, M = KG.Model;
    const today = U.today();
    const mk = (kind, date, title, category, mode, content, items, minutes, done, ruleId) => {
      const p = M.blankPlan(kind, date);
      p.title = title; p.category = category; p.contentMode = mode;
      p.content = content; p.minutes = minutes; p.done = !!done; p.ruleId = ruleId || null;
      if (mode === 'list') {
        p.items = items.map((it) => ({ id: U.uuid(), text: it[0], minutes: it[1], done: !!it[2] }));
      }
      return M.normalizePlan(p);
    };

    const rule = M.blankPlanRule({ freq: 'daily', startDate: M.addDays(today, -3), kind: 'day',
      title: '每天背常识 20 个', category: '常识', contentMode: 'text', content: '背 20 个常识考点，睡前复习一遍', minutes: 20 });

    const plans = [
      mk('day', today, '行测第30季套卷', '资料分析', 'list', '', [
        ['做套卷', 120, true], ['复盘错题', 30, true], ['听言语理解课', 45, false], ['背常识', 20, false]
      ], null, false),
      mk('week', today, '本周目标：3 套行测 + 2 篇申论', '申论', 'text', '周一至周五每天一套行测；周末两篇申论大作文并复盘', 600, false),
      mk('day', today, '错题本整理', '判断推理', 'text', '把上周图形推理的错题重看一遍', 40, true),
      mk('day', M.addDays(today, -1), '资料分析专项', '资料分析', 'text', '速算练习 3 组', 60, false),
      mk('day', M.addDays(today, 1), '申论大作文', '申论', 'text', '写一篇大作文并对照范文', 90, false)
    ];

    // 循环规则生成的实例（今天已完成一条，另一条未完成）
    plans.push(mk('day', today, '每天背常识 20 个', '常识', 'text', '背 20 个常识考点，睡前复习一遍', 20, true, rule.id));
    plans.push(mk('day', M.addDays(today, -1), '每天背常识 20 个', '常识', 'text', '背 20 个常识考点，睡前复习一遍', 20, false, rule.id));

    const raw = JSON.parse(localStorage.getItem('kaogong_dashboard'));
    raw.plans = plans;
    raw.planRules = [rule];
    const mkS = (h, m, label, cat, secs, pomos) => {
      const start = new Date(); start.setHours(h, m, 0, 0);
      const end = new Date(start.getTime() + secs * 1000);
      return { id: U.uuid(), planId: null, label: label, category: cat,
        date: U.today(), startAt: start.toISOString(), endAt: end.toISOString(),
        seconds: secs, pomodoros: pomos || 0, createdAt: new Date().toISOString() };
    };
    raw.sessions = [
      mkS(8, 30, '每天背常识 20 个', '常识', 22 * 60, 1),
      mkS(9, 10, '行测第30季套卷', '资料分析', 92 * 60, 3),
      mkS(14, 0, '言语理解专项', '言语理解', 65 * 60, 2),
      mkS(19, 30, '申论大作文', '申论', 48 * 60, 2)
    ];
    localStorage.setItem('kaogong_dashboard', JSON.stringify(raw));
    location.reload();
    return true;
  })()`);
  await sleep(4000);

  const shot = async (name, w, h) => {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 900 });
    await sleep(900);
    const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
    console.log('  截图', name);
  };

  console.log('=== 模块五：每日计划 ===');
  await ev(`document.querySelector('[data-tab="plans"]').click()`);
  await sleep(1200);
  const info5 = await ev(`({
    active: document.getElementById('panel-plans').classList.contains('is-active'),
    todayCards: document.querySelectorAll('#plan-today .plan-card').length,
    weekCards: document.querySelectorAll('#plan-week .plan-card').length,
    ruleCards: document.querySelectorAll('#plan-rules .plan-card').length,
    overview: [...document.querySelectorAll('#plans-cards .stat-card')].map(c => c.textContent.replace(/\\s+/g,' ').trim()),
    firstCard: document.querySelector('#plan-today .plan-card') ? document.querySelector('#plan-today .plan-card').textContent.replace(/\\s+/g,' ').trim().slice(0,120) : ''
  })`);
  console.log('  ' + JSON.stringify(info5, null, 1));
  await shot('P1-plans-1920.png', 1920, 1080);

  console.log('=== 模块六：学习计时 ===');
  await ev(`document.querySelector('[data-tab="timer"]').click()`);
  await sleep(1600);
  const info6 = await ev(`(() => {
    const inst = window.echarts.getInstanceByDom(document.getElementById('chart-dist'));
    return {
      active: document.getElementById('panel-timer').classList.contains('is-active'),
      cards: [...document.querySelectorAll('#timer-cards .stat-card')].map(c => c.textContent.replace(/\\s+/g,' ').trim()),
      timelineRows: document.querySelectorAll('#session-table tbody tr').length,
      legend: [...document.querySelectorAll('#dist-legend .pie-legend-item')].map(x => x.textContent.replace(/\\s+/g,' ').trim()),
      pieSeries: inst ? (inst.getOption().series || []).length : 0,
      startVisible: !document.getElementById('timer-start-area').hidden
    };
  })()`);
  console.log('  ' + JSON.stringify(info6, null, 1));
  await shot('P2-timer-1920.png', 1920, 1080);

  console.log('=== 计时进行中的悬浮条 + 手机尺寸 ===');
  await ev(`(() => {
    const sel = document.getElementById('timer-plan-select');
    sel.value = KG.App.state.plans.filter(p => p.title === '申论大作文')[0].id;
    sel.dispatchEvent(new Event('change', {bubbles:true}));
    document.getElementById('btn-timer-start').click();
    return true;
  })()`);
  await sleep(1200);
  const infoBar = await ev(`({
    barVisible: !document.getElementById('timer-bar').hidden,
    barText: document.getElementById('timer-bar').textContent.replace(/\\s+/g,' ').trim(),
    runningArea: !document.getElementById('timer-running-area').hidden,
    clock: document.getElementById('timer-live-clock').textContent.trim()
  })`);
  console.log('  ' + JSON.stringify(infoBar, null, 1));

  // 计时条是 fixed 的，会盖住右下角；滚到底部量一下有没有真遮挡
  const overlap = await ev(`(() => {
    window.scrollTo(0, document.body.scrollHeight);
    const bar = document.getElementById('timer-bar');
    const legend = document.getElementById('dist-legend');
    if (!bar || !legend) return { error: 'missing' };
    const b = bar.getBoundingClientRect();
    const l = legend.getBoundingClientRect();
    return {
      barTop: Math.round(b.top), barLeft: Math.round(b.left),
      legendBottom: Math.round(l.bottom), legendRight: Math.round(l.right),
      overlaps: l.bottom > b.top && l.top < b.bottom && l.right > b.left && l.left < b.right,
      bodyHasClass: document.body.classList.contains('has-timer-bar')
    };
  })()`);
  console.log('  计时条遮挡检测: ' + JSON.stringify(overlap));
  if (overlap.overlaps) console.log('  ⚠️ 图例仍被计时条盖住');
  else console.log('  ✅ 图例没有被计时条盖住');
  await ev(`window.scrollTo(0,0)`);
  await sleep(300);
  await shot('P3-timer-running-1920.png', 1920, 1080);

  await ev(`document.querySelector('[data-tab="plans"]').click()`);
  await sleep(900);
  await shot('P4-plans-390.png', 390, 844);
  await ev(`document.querySelector('[data-tab="timer"]').click()`);
  await sleep(1200);
  await shot('P5-timer-390.png', 390, 844);

  ws.close(); chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('截图脚本异常:', e); process.exit(1); });
