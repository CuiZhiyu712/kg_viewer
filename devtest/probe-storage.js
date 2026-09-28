/* 探测 file:// 下 IndexedDB（记住目录句柄）与 OPFS（用于测试读写代码）是否可用 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP = path.join(__dirname, '..', '考公练习追踪看板.html');
const PORT = 9355;
const fileUrl = 'file:///' + APP.replace(/\\/g, '/');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-probe2-'));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run',
  '--no-default-browser-check', '--disable-gpu', `--user-data-dir=${profile}`, fileUrl,
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
  await sleep(2200);

  const ev = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails
      ? { ERROR: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text }
      : r.result.value;
  };

  console.log('=== IndexedDB（用于记住目录句柄） ===');
  console.log(JSON.stringify(await ev(`new Promise(res => {
    try {
      const req = indexedDB.open('probe_db', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => res('open 失败: ' + (req.error && req.error.name));
      req.onblocked = () => res('blocked');
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put({ hello: 'world', n: 42 }, 'k');
          tx.oncomplete = () => {
            const tx2 = db.transaction('kv', 'readonly');
            const g = tx2.objectStore('kv').get('k');
            g.onsuccess = () => res('可用，读回: ' + JSON.stringify(g.result));
            g.onerror = () => res('读取失败');
          };
          tx.onerror = () => res('写入失败: ' + tx.error);
        } catch (e) { res('异常: ' + e.message); }
      };
    } catch (e) { res('throw: ' + e.message); }
  })`), null, 1));

  console.log('\n=== OPFS（navigator.storage.getDirectory，用来在无选择框时测读写代码） ===');
  console.log(JSON.stringify(await ev(`
    (async () => {
      try {
        const root = await navigator.storage.getDirectory();
        const fh = await root.getFileHandle('probe.json', { create: true });
        const w = await fh.createWritable();
        await w.write(JSON.stringify({ ok: true, 中文: '可以' }));
        await w.close();
        const f2 = await root.getFileHandle('probe.json');
        const text = await (await f2.getFile()).text();
        const names = [];
        for await (const [n] of root.entries()) names.push(n);
        return '可用 | 读回: ' + text + ' | 目录内容: ' + JSON.stringify(names);
      } catch (e) { return '不可用: ' + e.name + ' ' + e.message; }
    })()
  `), null, 1));

  console.log('\n=== 目录句柄能否结构化克隆进 IndexedDB（决定刷新后能否记住） ===');
  console.log(JSON.stringify(await ev(`
    (async () => {
      try {
        const root = await navigator.storage.getDirectory();   // 用 OPFS 句柄代替真实目录句柄
        await new Promise((res, rej) => {
          const r = indexedDB.open('probe_handle', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onerror = () => rej(r.error);
          r.onsuccess = () => {
            const tx = r.result.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(root, 'dir');
            tx.oncomplete = res;
            tx.onerror = () => rej(tx.error);
          };
        });
        const got = await new Promise((res, rej) => {
          const r = indexedDB.open('probe_handle', 1);
          r.onsuccess = () => {
            const g = r.result.transaction('kv','readonly').objectStore('kv').get('dir');
            g.onsuccess = () => res(g.result);
            g.onerror = () => rej(g.error);
          };
        });
        return '句柄可持久化 | 取回类型: ' + Object.prototype.toString.call(got) +
               ' | queryPermission: ' + (got.queryPermission ? '有方法' : '无方法');
      } catch (e) { return '不可行: ' + e.name + ' ' + e.message; }
    })()
  `), null, 1));

  ws.close();
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('探测失败:', e); try { chrome.kill(); } catch (_) {} process.exit(1); });
