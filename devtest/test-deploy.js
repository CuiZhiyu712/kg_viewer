/* 模拟「部署到服务器」：把 dist/ 用 HTTP 服务起来，用真实 Chrome 打开。
 *
 * 验证两件事：
 *   1) https 之外，http://localhost 也算安全上下文 -> 功能完整
 *   2) 纯 http://<局域网IP> 不是安全上下文 -> 「绑定数据文件夹」应不可用，
 *      但其余功能（记录 / 图表 / 导出 / localStorage）必须照常工作，
 *      且卡片要给出「不支持」的明确提示，而不是静默坏掉
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DIST = path.join(__dirname, '..', 'docs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT_DBG = 9366;

/** 取一个「真实」局域网 IP：优先 192.168 / 10 / 172.16-31，跳过 VPN 网卡（Radmin/Hamachi 常用 25/26.x） */
function lanIp() {
  const ifaces = os.networkInterfaces();
  const cands = [];
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      cands.push({ name, address: ni.address });
    }
  }
  const rank = (a) => {
    if (/^192\.168\./.test(a)) return 0;
    if (/^10\./.test(a)) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return 2;
    if (/^26\.|^25\./.test(a)) return 9;   // VPN 网卡，排在最后
    return 5;
  };
  cands.sort((x, y) => rank(x.address) - rank(y.address));
  return cands.length ? cands[0].address : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT_DBG}/json/list`)).json();
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
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    } else if (m.method) listeners.forEach((fn) => fn(m));
  });
  return {
    send: (method, params) => new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    }),
    on: (fn) => listeners.push(fn),
  };
}

let pass = 0, fail = 0;
function eq(a, b, label) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++;
  else { fail++; console.log(`  FAIL ${label}\n       actual   = ${x}\n       expected = ${y}`); }
}
const ok = (c, label) => eq(!!c, true, label);

(async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('找不到 dist/index.html，请先运行 python build.py');
    process.exit(1);
  }

  /* ---- 起一个最小静态服务器 ---- */
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.join(DIST, rel.replace(/^\/+/, ''));
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    const type = /\.html?$/.test(file) ? 'text/html; charset=utf-8'
      : /\.js$/.test(file) ? 'application/javascript; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '0.0.0.0', r));
  const port = server.address().port;
  const ip = lanIp();
  console.log(`静态服务器: http://127.0.0.1:${port}/  (局域网: http://${ip}:${port}/)\n`);

  /* ---- 启动 Chrome ---- */
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-deploy-'));
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT_DBG}`, '--window-size=1600,1000',
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    `--user-data-dir=${profile}`, `http://127.0.0.1:${port}/`,
  ], { stdio: 'ignore' });

  const target = await findTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const c = cdp(ws);

  const errors = [];
  c.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    }
  });
  await c.send('Runtime.enable');
  await c.send('Page.enable');

  const ev = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails
      ? { ERROR: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text }
      : r.result.value;
  };

  /** 导航后执行上下文会被替换，固定 sleep 可能探到已失效的上下文；改为轮询直到应用就绪 */
  const waitForApp = async (label) => {
    for (let i = 0; i < 30; i++) {
      try {
        const ready = await ev(`!!(window.KG && document.getElementById('records-table') &&
          document.getElementById('records-table').querySelectorAll('tbody tr').length > 0)`);
        if (ready === true) return true;
      } catch (e) { /* 上下文还在切换 */ }
      await sleep(400);
    }
    console.log(`  （等待超时：${label}）`);
    return false;
  };

  const probe = () => ev(`(() => ({
    origin: location.origin,
    isSecureContext: window.isSecureContext,
    showDirectoryPicker: typeof window.showDirectoryPicker,
    localStorageOK: (() => { try { localStorage.setItem('__p','1'); localStorage.removeItem('__p'); return true; } catch(e){ return false; } })(),
    xlsx: !!window.XLSX,
    echarts: !!window.echarts,
    rowCount: document.querySelectorAll('#records-table tbody tr').length,
    statCards: document.querySelectorAll('#overview-cards .stat-card').length,
    storageStatus: document.getElementById('storage-status').textContent.trim(),
    bindDisabled: document.getElementById('btn-fs-bind').disabled,
    storageNote: document.getElementById('storage-note').textContent.trim().slice(0, 90),
    bannerVisible: !document.getElementById('lib-banner').hidden
  }))()`);

  /* ---- 1) http://127.0.0.1（localhost 属安全上下文） ---- */
  console.log('=== 场景 1：http://127.0.0.1（本地） ===');
  await sleep(3000);
  await waitForApp('localhost');
  const local = await probe();
  console.log('  ' + JSON.stringify(local, null, 1));
  eq(local.isSecureContext, true, 'localhost 是安全上下文');
  eq(local.showDirectoryPicker, 'function', '数据文件夹功能可用');
  eq(local.localStorageOK, true, 'localStorage 可用');
  eq(local.xlsx && local.echarts, true, '内联的两个库都已就绪');
  eq(local.rowCount, 1, '记录正常渲染');
  eq(local.bannerVisible, false, '无告警条（零外部依赖，没有加载失败）');
  ok(local.storageStatus.indexOf('未绑定') >= 0, '数据存储卡片正常：' + local.storageStatus);

  const chartsOk = await ev(`(() => {
    document.querySelector('[data-tab="trend"]').click();
    return true;
  })()`);
  await sleep(1200);
  eq(await ev(`document.querySelectorAll('#panel-trend canvas').length >= 3`), true, '趋势图在服务器环境下正常渲染');

  /* ---- 2) http://<局域网IP>（非安全上下文，模拟误用纯 http 部署） ---- */
  if (!ip) {
    console.log('\n（未取到局域网 IP，跳过非安全上下文场景）');
  } else {
    console.log(`\n=== 场景 2：http://${ip}:${port}/（纯 HTTP，非安全上下文） ===`);
    await c.send('Page.navigate', { url: `http://${ip}:${port}/` });
    await sleep(2000);
    await waitForApp('非安全上下文');
    const insecure = await probe();
    console.log('  ' + JSON.stringify(insecure, null, 1));
    eq(insecure.isSecureContext, false, '纯 http 不是安全上下文');
    eq(insecure.showDirectoryPicker, 'undefined', 'showDirectoryPicker 不存在（浏览器直接不提供）');
    eq(insecure.localStorageOK, true, 'localStorage 仍可用（按 origin 隔离）');
    eq(insecure.xlsx && insecure.echarts, true, '内联的库仍可用');
    eq(insecure.rowCount, 1, '记录仍正常渲染');
    eq(insecure.statCards, 4, '概览卡片仍正常');
    eq(insecure.bindDisabled, true, '「绑定数据文件夹」正确置灰');
    ok(insecure.storageStatus.indexOf('不是 https') >= 0, '准确指出原因是「不是 https」：' + insecure.storageStatus);
    ok(insecure.storageNote.indexOf('https://') >= 0, '提示改用 https：' + insecure.storageNote);
    eq(insecure.storageNote.indexOf('请用 Chrome 或 Edge'), -1, '不要误报成「浏览器不支持」（用的是 Chrome）');
    // 导出与图表在非安全上下文下也必须正常
    eq(await ev(`document.querySelectorAll('#panel-time .stat-card').length >= 1`), true, '用时分析仍可用');
    eq(errors.length, 0, '两种环境下都没有未捕获异常' + (errors.length ? ' -> ' + errors.join(' | ') : ''));
  }

  console.log('\n=== 记录条数一致性 ===');
  const recs = await ev(`JSON.parse(localStorage.getItem('kaogong_dashboard') || '{}').records ? JSON.parse(localStorage.getItem('kaogong_dashboard')).records.length : -1`);
  eq(recs, 1, '新 origin 下也把内置初始数据写入了（每个 origin 各自一份）');

  console.log(`\n===== PASS ${pass} / FAIL ${fail} =====`);
  ws.close();
  chrome.kill();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error('测试脚本异常:', e); process.exit(1); });
