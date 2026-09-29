/* 快速检查工具栏（现在 7 个按钮）与吸顶偏移，并截图 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '..', '考公练习追踪看板.html');
const SHOTS = path.join(__dirname, 'shots');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9455;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-tb-'));
  const url = 'file:///' + APP.replace(/\\/g, '/');
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1920,1080',
    '--hide-scrollbars', '--no-first-run', '--disable-gpu', `--user-data-dir=${prof}`, url,
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let id = 0;
  const pend = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  });
  const send = (method, params) => new Promise((r) => {
    const i = ++id; pend.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(3500);

  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;

  const info = await ev(`({
    btns: [...document.querySelectorAll('.toolbar .btn')].map(b => b.textContent.trim()),
    disabled: [...document.querySelectorAll('.toolbar .btn')].map(b => b.disabled),
    headerH: Math.round(document.querySelector('.app-header').getBoundingClientRect().height),
    headerVar: getComputedStyle(document.documentElement).getPropertyValue('--header-h').trim(),
    tabsTop: getComputedStyle(document.getElementById('tabs')).top,
    toast: (document.querySelector('.toast') || {}).textContent || ''
  })`);
  console.log(JSON.stringify(info, null, 1));

  const shot = async (name, w, h) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 900 });
    await sleep(700);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
    console.log('  截图', name);
  };
  await shot('T1-toolbar-1920.png', 1920, 1080);
  await shot('T2-toolbar-1366.png', 1366, 768);

  ws.close(); chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('异常:', e); process.exit(1); });
