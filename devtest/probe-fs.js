/* 探测 file:// 下能否获得文件系统写入能力（决定「数据存到 ./data/」是否可行） */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP = path.join(__dirname, '..', '考公练习追踪看板.html');
const PORT = 9344;
const fileUrl = 'file:///' + APP.replace(/\\/g, '/');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-probe-'));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1280,900',
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  `--user-data-dir=${profile}`, fileUrl,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const target = await findTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const c = cdp(ws);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await sleep(2500);

  const ev = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? { ERROR: r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description) } : r.result.value;
  };

  console.log('=== file:// 环境能力探测 ===');
  console.log(JSON.stringify(await ev(`({
    isSecureContext: window.isSecureContext,
    origin: window.location.origin,
    showOpenFilePicker: typeof window.showOpenFilePicker,
    showSaveFilePicker: typeof window.showSaveFilePicker,
    showDirectoryPicker: typeof window.showDirectoryPicker,
    hasIndexedDB: typeof indexedDB,
    hasFetch: typeof fetch,
    storageManager: typeof navigator.storage
  })`), null, 1));

  console.log('\n=== 能否直接读同目录文件（fetch / XHR） ===');
  console.log('fetch 相对路径:', JSON.stringify(await ev(`
    fetch('./data/kaogong_data.json').then(r => 'ok ' + r.status).catch(e => 'blocked: ' + e.message)
  `)));
  console.log('XHR 相对路径:', JSON.stringify(await ev(`
    new Promise(res => { try {
      const x = new XMLHttpRequest(); x.open('GET','./data/kaogong_data.json',true);
      x.onload = () => res('ok ' + x.status); x.onerror = () => res('onerror(被拦截)');
      x.send();
    } catch (e) { res('throw: ' + e.message); } })
  `)));

  console.log('\n=== 真实点击触发 showDirectoryPicker（看报错类型） ===');
  await ev(`(() => {
    const b = document.createElement('button');
    b.id = 'probe-btn'; b.textContent = 'probe';
    b.style.cssText = 'position:fixed;left:10px;top:10px;z-index:99999;width:100px;height:40px';
    b.onclick = async () => {
      try {
        const h = await window.showDirectoryPicker({ mode: 'readwrite' });
        window.__probe = 'SUCCESS: ' + h.name;
      } catch (e) { window.__probe = 'ERR ' + e.name + ': ' + e.message; }
    };
    document.body.appendChild(b);
    window.__probe = null;
  })()`);
  const box = await ev(`(() => { const r = document.getElementById('probe-btn').getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sleep(2500);
  console.log('showDirectoryPicker 结果:', JSON.stringify(await ev(`window.__probe`)));

  ws.close();
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('探测失败:', e); try { chrome.kill(); } catch (_) {} process.exit(1); });
