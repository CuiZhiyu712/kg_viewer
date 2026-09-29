/* 「分享版 / 使用者版」出厂验收
 * 解压到临时目录，用真实 Chrome 以 file:// 打开（模拟接收者双击），
 * 并检查两个包的差异是否符合预期、是否泄漏私人数据。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SHARE = path.join(ROOT, '分享版');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9388;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function eq(a, b, label) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++;
  else { fail++; console.log(`  FAIL ${label}  actual=${x} expected=${y}`); }
}
const ok = (c, label) => eq(!!c, true, label);

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

const tmps = [];
function extract(zip) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-share-'));
  tmps.push(tmp);
  // 用 Python 的 zipfile：Windows 的 tar 会把 "D:\..." 误当成远程主机名
  execFileSync('python', ['-c',
    'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',
    zip, tmp], { stdio: 'inherit' });
  const tops = fs.readdirSync(tmp).filter((n) => fs.statSync(path.join(tmp, n)).isDirectory());
  const top = tops[0];
  const base = path.join(tmp, top);
  const files = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p); else files.push(p);
    }
  })(base);
  return { top, base, files, rel: files.map((f) => path.relative(base, f).replace(/\\/g, '/')) };
}

function sha(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

async function browserCheck(htmlPath) {
  const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-share-prof-'));
  tmps.push(profile);
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1600,1000',
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    `--user-data-dir=${profile}`, fileUrl,
  ], { stdio: 'ignore' });

  const target = await findTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const c = cdp(ws);
  const errors = [], requests = [];
  c.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    }
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  });
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.send('Network.enable');
  await sleep(5000);

  const ev = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? { ERROR: r.exceptionDetails.text } : r.result.value;
  };

  const st = await ev(`(() => ({
    rowCount: document.querySelectorAll('#records-table tbody tr').length,
    statCards: document.querySelectorAll('#overview-cards .stat-card').length,
    tabs: document.querySelectorAll('#tabs .tab').length,
    xlsx: !!window.XLSX, echarts: !!window.echarts,
    bannerVisible: !document.getElementById('lib-banner').hidden
  }))()`);
  console.log('  ' + JSON.stringify(st));

  await ev(`document.getElementById('btn-add').click()`);
  await sleep(700);
  await ev(`(() => {
    const set = (sel, v) => { const el = document.querySelector(sel); el.value = v;
      el.dispatchEvent(new Event('input', {bubbles:true})); };
    set('#modal-root [data-field="date"]', '2026-10-10');
    set('#modal-root [data-field="paperName"]', '第32季');
    set('#modal-root [data-field="score"]', '77');
    set('#modal-root [data-field="averageScore"]', '70');
    set('#modal-root [data-field="defeatRate"]', '88');
    set('#modal-root .mod-block[data-module="political"] [data-field="questions"]', '20');
    set('#modal-root .mod-block[data-module="political"] [data-field="correct"]', '15');
    return true;
  })()`);
  await sleep(400);
  await ev(`document.querySelector('#modal-root [data-act="save"]').click()`);
  await sleep(800);
  const after = await ev(`(() => {
    const s = JSON.parse(localStorage.getItem('kaogong_dashboard'));
    return { rows: document.querySelectorAll('#records-table tbody tr').length,
             stored: s ? s.records.length : -1 };
  })()`);
  await ev(`document.querySelector('[data-tab="trend"]').click()`);
  await sleep(1500);
  const canvases = await ev(`document.querySelectorAll('#panel-trend canvas').length`);

  ws.close(); chrome.kill();
  return { st, after, canvases, errors, external: requests.filter((u) => !/^(file|data|blob):/.test(u)) };
}

(async function main() {
  if (!fs.existsSync(SHARE)) throw new Error('找不到 分享版/ 目录，请先运行 python pack.py');
  const zips = fs.readdirSync(SHARE).filter((f) => f.endsWith('.zip')).sort();
  eq(zips.length, 2, '分享版/ 下有两个 zip');

  // 按「包内容」识别是哪个包，而不是按文件名——文件名可能被人改过
  const infos = zips.map((z) => Object.assign({ zip: z }, extract(path.join(SHARE, z))));
  const full = infos.find((i) => i.rel.some((r) => r.indexOf('源码/') === 0));
  const user = infos.find((i) => !i.rel.some((r) => r.indexOf('源码/') === 0));
  ok(full, '找到完整包（含源码）：' + (full && full.zip));
  ok(user, '找到使用者包（不含源码）：' + (user && user.zip));

  /* ============ 分享版 ============ */
  console.log('\n================ 分享版 ================');
  console.log('  文件名: ' + full.zip);
  full.rel.filter((r) => r.indexOf('/') < 0).forEach((r) => console.log('  ' + r));
  console.log('  源码/ 下 %d 个文件', full.rel.filter((r) => r.indexOf('源码/') === 0).length);
  eq(full.top, '考公练习追踪看板-分享版', '包内顶层目录名正确');
  ok(full.rel.indexOf('考公练习追踪看板.html') >= 0, '根目录有单文件');
  ok(full.rel.indexOf('使用说明.txt') >= 0, '根目录有使用说明');
  ok(full.rel.some((r) => r === '源码/build.py'), '含源码（构建脚本）');
  ok(full.rel.some((r) => r.indexOf('源码/src/js/ui.js') >= 0), '含源码（前端逻辑）');
  ok(full.rel.some((r) => r.indexOf('源码/vendor/') >= 0), '含源码（第三方库原文件）');
  ok(full.rel.some((r) => r.indexOf('源码/feishu/') >= 0), '含源码（飞书版）');

  /* ============ 使用者版 ============ */
  console.log('\n================ 使用者版 ================');
  console.log('  文件名: ' + user.zip);
  user.rel.forEach((r) => console.log('  ' + r));
  eq(user.top, '考公练习追踪看板', '包内顶层目录名正确');
  eq(user.rel.length, 2, '只有 2 个文件');
  eq(user.rel.sort(), ['使用说明.txt', '考公练习追踪看板.html'].sort(), '就这两样');
  eq(user.rel.some((r) => r.indexOf('源码') >= 0), false, '不含源码目录');
  eq(user.rel.some((r) => /\.(js|css|py|md|json)$/i.test(r)), false, '不含任何 js/css/py/md/json');

  /* ============ 两个包的 HTML 必须逐字节一致 ============ */
  console.log('\n================ 一致性 ================');
  // 注意：源码目录里也有 .html（src/index.html 是模板），必须按确切路径取产物
  const h1 = path.join(full.base, '考公练习追踪看板.html');
  const h2 = path.join(user.base, '考公练习追踪看板.html');
  ok(fs.existsSync(h1) && fs.existsSync(h2), '两个包的根目录都有产物 HTML');
  eq(sha(h1) === sha(h2), true, '两个包里的产物 HTML 逐字节相同（不会分叉）');
  const localHtml = path.join(ROOT, '考公练习追踪看板.html');
  eq(sha(h2) === sha(localHtml), true, '与本地已测构建产物一致');

  /* ============ 说明文件 ============ */
  console.log('\n================ 使用说明 ================');
  const txt = user.files.find((f) => f.endsWith('.txt'));
  const buf = fs.readFileSync(txt);
  eq(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF, true, '带 UTF-8 BOM（记事本不会乱码）');
  const text = buf.toString('utf8');
  ok(text.indexOf('数据存在哪') >= 0, '包含「数据存在哪」这一节');
  ok(text.indexOf('7 天') >= 0, '包含 iPhone 7 天提醒');
  ok(text.indexOf('数据备份') >= 0, '包含备份指引');

  /* ============ 私人数据泄漏检查 ============ */
  console.log('\n================ 私人数据泄漏检查 ================');
  const isLeak = (r) => /node_modules|shots\/|\.xlsx$|kaogong_data\.json|\.git\/|\.claude\//.test(r);
  eq(full.rel.filter(isLeak), [], '分享版：无泄漏');
  eq(user.rel.filter(isLeak), [], '使用者版：无泄漏');

  /* ============ 浏览器实跑（使用者版，最严格的那个） ============ */
  console.log('\n================ 接收者视角：解压后直接打开（使用者版） ================');
  const r = await browserCheck(h2);
  eq(r.st.rowCount, 1, '示例数据正常渲染');
  eq(r.st.statCards, 4, '概览卡片正常');
  eq(r.st.tabs, 4, '四个页签都在');
  eq(r.st.xlsx && r.st.echarts, true, '内联的库已就绪');
  eq(r.st.bannerVisible, false, '无告警条');
  eq(r.external, [], '零外部请求（可离线运行）');
  eq(r.after.stored, 2, '新增记录已写入 localStorage');
  eq(r.after.rows, 2, '主表同步刷新');
  ok(r.canvases >= 3, '趋势图渲染正常');
  eq(r.errors, [], r.errors.length ? r.errors.join(' | ') : '无未捕获异常');

  console.log(`\n===== PASS ${pass} / FAIL ${fail} =====`);
  tmps.forEach((t) => { try { fs.rmSync(t, { recursive: true, force: true }); } catch (e) {} });
  process.exit(fail || r.errors.length ? 1 : 0);
})().catch((e) => { console.error('测试脚本异常:', e); process.exit(1); });
