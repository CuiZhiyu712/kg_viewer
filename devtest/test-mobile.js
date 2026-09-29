/* 手机 / 平板适配实测：用 Chrome 设备模拟量几何关系 + 截图
 *
 * 重点查：
 *   1) 页面级横向溢出（不该有；表格内部横向滚动是预期的）
 *   2) 吸顶页头 + 吸顶 Tab 是否互相遮挡（页头换行变高时最容易出这个 bug）
 *   3) 点击区域尺寸、字号可读性
 *   4) 弹窗在小屏上是否放得下
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DIST = path.join(__dirname, '..', 'docs');
const SHOTS = path.join(__dirname, 'shots');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT_DBG = 9377;

const DEVICES = [
  { name: 'iPhone SE 375x667', w: 375, h: 667, mobile: true, dsf: 2 },
  { name: 'iPhone 14 390x844', w: 390, h: 844, mobile: true, dsf: 3 },
  { name: 'iPad 竖屏 768x1024', w: 768, h: 1024, mobile: true, dsf: 2 },
  { name: 'iPad 横屏 1024x768', w: 1024, h: 768, mobile: true, dsf: 2 },
  { name: '小笔记本 1366x768', w: 1366, h: 768, mobile: false, dsf: 1 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SHOTS, { recursive: true });

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
  else { fail++; console.log(`    FAIL ${label}  actual=${x} expected=${y}`); }
}
const ok = (c, label) => eq(!!c, true, label);

(async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('找不到 docs/index.html，请先 python build.py');
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.join(DIST, rel.replace(/^\/+/, ''));
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '0.0.0.0', r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-mobile-'));
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT_DBG}`, '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    `--user-data-dir=${profile}`, url,
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
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }).catch(() => {});

  const ev = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails
      ? { ERROR: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text }
      : r.result.value;
  };

  const measure = () => ev(`(() => {
    const hdr = document.querySelector('.app-header');
    const tabs = document.getElementById('tabs');
    const ts = document.querySelector('#records-table').closest('.table-scroll');
    const btns = [...document.querySelectorAll('.toolbar .btn, .tab')];
    const sizes = btns.map(b => b.getBoundingClientRect().height).filter(Boolean);
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      pageOverflowX: document.documentElement.scrollWidth - window.innerWidth,
      headerH: Math.round(hdr.getBoundingClientRect().height),
      headerSticky: getComputedStyle(hdr).position === 'sticky',
      headerPct: Math.round(hdr.getBoundingClientRect().height / window.innerHeight * 100),
      tabsPos: getComputedStyle(tabs).position,
      tabsTopStyle: getComputedStyle(tabs).top,
      tabsH: Math.round(tabs.getBoundingClientRect().height),
      headerVar: getComputedStyle(document.documentElement).getPropertyValue('--header-h').trim(),
      tableScrollClipped: ts ? ts.scrollWidth - ts.clientWidth : null,
      tableRows: document.querySelectorAll('#records-table tbody tr').length,
      minTapH: sizes.length ? Math.round(Math.min(...sizes)) : null,
      bodyFont: getComputedStyle(document.body).fontSize,
      modalMaxW: getComputedStyle(document.querySelector('#modal-root .modal') || document.body).maxWidth
    };
  })()`);

  const overlapCheck = () => ev(`(() => {
    window.scrollTo(0, 400);
    const hdr = document.querySelector('.app-header');
    const tabs = document.getElementById('tabs');
    const hb = hdr.getBoundingClientRect().bottom;
    const tt = tabs.getBoundingClientRect().top;
    const sticky = getComputedStyle(tabs).position === 'sticky';
    return { headerBottom: Math.round(hb), tabsTop: Math.round(tt), tabsSticky: sticky,
             overlapPx: Math.round(hb - tt), hidden: sticky && tt < hb - 1 };
  })()`);

  const shot = async (name) => {
    const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
  };

  for (const d of DEVICES) {
    console.log(`\n=== ${d.name} ===`);
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: d.w, height: d.h, deviceScaleFactor: d.dsf, mobile: d.mobile,
    });
    await c.send('Page.navigate', { url });
    await sleep(3500);
    // 回到记录面板
    await ev(`document.querySelector('[data-tab="records"]').click()`);
    await sleep(600);
    await ev(`window.scrollTo(0,0)`);
    await sleep(300);

    const m = await measure();
    console.log('    ' + JSON.stringify(m));
    eq(m.pageOverflowX <= 0, true, `页面级横向溢出不超过 0（实际 ${m.pageOverflowX}px）`);
    eq(m.tableRows, 1, '数据渲染正常');
    ok(m.minTapH >= 28, `按钮最小高度 ${m.minTapH}px（≥28 可点）`);
    // 吸顶元素长期占屏不能超过 25%
    // Tab 的 top 已经含页头高度，所以取「页头与 Tab 底边」的并集，不能相加
    const tabBottom = m.tabsPos === 'sticky' ? (parseFloat(m.tabsTopStyle) || 0) + m.tabsH : 0;
    const pinned = Math.max(m.headerSticky ? m.headerH : 0, tabBottom);
    ok(pinned / m.vh <= 0.25, `吸顶占用 ${pinned}px / ${m.vh}px = ${Math.round(pinned / m.vh * 100)}%（≤25%）`);
    // 页头不吸顶时偏移量必须归零，否则 Tab 会悬在半空
    eq(m.headerVar, m.headerSticky ? m.headerH + 'px' : '0px', `--header-h 与页头状态一致（${m.headerVar}）`);

    const ov = await overlapCheck();
    console.log('    吸顶检查: ' + JSON.stringify(ov));
    eq(ov.hidden, false, `页头没有遮住 Tab（页头高 ${ov.headerBottom}px、Tab 顶 ${ov.tabsTop}px）`);

    await ev(`window.scrollTo(0,0)`);
    await sleep(300);
    await shot(`M-${d.w}x${d.h}-records.png`);

    // 小屏上打开新增表单，看弹窗是否放得下
    await ev(`document.getElementById('btn-add').click()`);
    await sleep(700);
    const modal = await ev(`(() => {
      const el = document.querySelector('#modal-root .modal');
      if (!el) return { open: false };
      const r = el.getBoundingClientRect();
      const body = el.querySelector('.modal-body');
      const block = el.querySelector('.mod-block[data-module="language"]');
      return { open: true, w: Math.round(r.width), h: Math.round(r.height),
               fitsX: r.left >= 0 && r.right <= window.innerWidth + 1,
               bodyScrolls: body.scrollHeight > body.clientHeight,
               footVisible: !!el.querySelector('.modal-foot') &&
                 el.querySelector('.modal-foot').getBoundingClientRect().bottom <= window.innerHeight + 1,
               subTableScrollable: block ? block.scrollWidth > block.clientWidth : null,
               subTableOverflowHidden: block ? block.scrollWidth - block.clientWidth : null };
    })()`);
    console.log('    弹窗: ' + JSON.stringify(modal));
    ok(modal.open, '新增弹窗能打开');
    eq(modal.fitsX, true, '弹窗横向不超出屏幕');
    eq(modal.footVisible, true, '弹窗底部按钮在可视区内');
    // 子模块表在窄屏可以内部横向滚动，但不能把弹窗撑破
    ok(modal.bodyScrolls || modal.subTableScrollable === false, '弹窗内容可滚动或本就放得下');
    if (d.w <= 900) await shot(`M-${d.w}x${d.h}-form.png`);
    await ev(`document.querySelector('#modal-root [data-act="cancel"]').click()`);
    await sleep(400);

    // 手机上图表必须真的画出来（面板刚显示时容器才有尺寸，最易出 0 尺寸空白）
    if (d.w <= 768) {
      await ev(`document.querySelector('[data-tab="trend"]').click()`);
      await sleep(1400);
      const ch = await ev(`(() => {
        const el = document.getElementById('chart-score');
        const inst = window.echarts.getInstanceByDom(el);
        return { hidden: el.hidden, w: el.offsetWidth, h: el.offsetHeight,
                 series: inst ? (inst.getOption().series || []).length : 0,
                 canvases: el.querySelectorAll('canvas').length };
      })()`);
      console.log('    趋势图: ' + JSON.stringify(ch));
      eq(ch.hidden, false, '趋势图容器可见');
      ok(ch.w > 200 && ch.h >= 200, `图表尺寸 ${ch.w}x${ch.h}（不是 0 尺寸空白）`);
      ok(ch.series >= 2, '图表数据已填充');
      if (d.w <= 390) await shot(`M-${d.w}x${d.h}-trend.png`);
      await ev(`document.querySelector('[data-tab="records"]').click()`);
      await sleep(500);
    }
    await ev(`document.querySelector('#modal-root [data-act="cancel"]').click()`);
    await sleep(400);
  }

  console.log('\n=== JS 异常 ===');
  eq(errors.length, 0, errors.length ? errors.join(' | ') : '各尺寸下均无未捕获异常');
  console.log(`\n===== PASS ${pass} / FAIL ${fail} =====`);
  ws.close();
  chrome.kill();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error('测试脚本异常:', e); process.exit(1); });
