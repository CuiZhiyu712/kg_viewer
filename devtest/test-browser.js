/* 真实浏览器验证：headless Chrome 打开 file:// 下的构建产物
 * 1) 抓取控制台报错 / 未捕获异常
 * 2) 验证 localStorage 在 file:// 下是否真的可用（决定「双击即用、刷新不丢数据」）
 * 3) 截图各 Tab（1920x1080 / 1366x768）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP = path.join(__dirname, '..', '考公练习追踪看板.html');
const OUT_DIR = path.join(__dirname, 'shots');
const PORT = 9333;

const fileUrl = 'file:///' + APP.replace(/\\/g, '/');
fs.mkdirSync(OUT_DIR, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1920,1080',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  `--user-data-dir=${profile}`,
  fileUrl,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('Chrome 调试端口未就绪');
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      listeners.forEach((fn) => fn(msg));
    }
  });
  return {
    send(method, params) {
      return new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
      });
    },
    on(fn) { listeners.push(fn); },
  };
}

(async function main() {
  const target = await findTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  const client = cdp(ws);

  const consoleErrors = [];
  const exceptions = [];
  const netRequests = [];
  client.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      consoleErrors.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value || a.description || '').join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      exceptions.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    if (msg.method === 'Network.requestWillBeSent') {
      netRequests.push(msg.params.request.url);
    }
  });

  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.send('Network.enable');
  netRequests.length = 0;
  await client.send('Page.reload', { ignoreCache: false });
  await sleep(5000);   // 等库就绪 + 首次渲染

  const evaluate = async (expr) => {
    const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('evaluate 出错: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  console.log('=== 外部依赖检查（决定能否离线 / 免 CDN 部署） ===');
  const external = netRequests.filter((u) => !/^(file|data|blob):/.test(u));
  console.log('  本次加载的全部请求数:', netRequests.length);
  console.log('  其中外部（http/https）请求:', external.length ? external.join(', ') : '（无）');
  console.log('  => 零外部依赖:', external.length === 0 ? '成立，可离线运行' : '不成立，仍依赖 CDN');

  console.log('=== 环境自检（真实 file:// 环境） ===');
  const env = await evaluate(`(() => {
    let lsOk = false, lsErr = '';
    try {
      localStorage.setItem('__probe__','1'); localStorage.removeItem('__probe__'); lsOk = true;
    } catch (e) { lsErr = String(e); }
    return {
      url: location.href.slice(0, 40) + '...',
      protocol: location.protocol,
      localStorageAvailable: lsOk,
      localStorageError: lsErr,
      xlsxLoaded: !!window.XLSX,
      echartsLoaded: !!window.echarts,
      storedKey: !!localStorage.getItem('kaogong_dashboard'),
      bannerVisible: !document.getElementById('lib-banner').hidden,
      bannerText: document.getElementById('lib-banner').textContent.trim(),
      rowCount: document.querySelectorAll('#records-table tbody tr').length,
      statCards: document.querySelectorAll('#overview-cards .stat-card').length,
      statsRows: document.querySelectorAll('#stats-table tbody tr').length,
      canvases: document.querySelectorAll('canvas').length
    };
  })()`);
  console.log(JSON.stringify(env, null, 2));

  console.log('=== 主表状态着色核查 ===');
  const tint = await evaluate(`(() => {
    const heads = [...document.querySelectorAll('#records-table thead th')].map(t => t.textContent.trim());
    const tds = [...document.querySelectorAll('#records-table tbody tr td')];
    const out = [];
    document.querySelectorAll('#records-table tbody tr td .pct').forEach(el => {
      const td = el.closest('td');
      out.push(td.previousElementSibling ? td.previousElementSibling.textContent.trim() : '?');
    });
    const cells = [...document.querySelectorAll('#records-table tbody tr td .pct')].map(el => {
      const td = el.closest('td');
      const idx = [...td.parentNode.children].indexOf(td);
      return { col: heads[idx] || ('col' + idx), text: el.textContent.trim(), cls: el.className };
    });
    return cells;
  })()`);
  console.log(JSON.stringify(tint, null, 1));

  const shot = async (name, w, h) => {
    await client.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    const r = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
    console.log(`  截图 ${name} (${w}x${h})`);
  };

  console.log('=== 表头子模块小窗：与主表逐行对齐（真实布局） ===');
  // 先往 localStorage 塞两条克隆记录，才能验证多行对齐（测完恢复原状）
  const origPayload = await evaluate(`localStorage.getItem('kaogong_dashboard')`);
  const injected = await evaluate(`(() => {
    const st = JSON.parse(localStorage.getItem('kaogong_dashboard'));
    const seed = st.records[0];
    const mk = (id, date, name, bump) => {
      const r = JSON.parse(JSON.stringify(seed));
      r.id = id; r.date = date; r.paperName = name; r.raw = null;
      r.modules.language.subModules.logicalCloze.correct = bump;
      return r;
    };
    st.records.push(mk('t1', '2026-10-03', '测试第1套', 11), mk('t2', '2026-10-10', '测试第2套', 14));
    localStorage.setItem('kaogong_dashboard', JSON.stringify(st));
    return st.records.length;
  })()`);
  await client.send('Page.reload', {});
  await sleep(3000);
  console.log('  临时记录数:', injected);
  const measureSubPop = async (key) => evaluate(`(() => {
    document.querySelector('#records-table thead button[data-act="sub-col"][data-key="${key}"]').click();
    const scroll = document.querySelector('#records-table').closest('.table-scroll');
    const pop = scroll.querySelector('.sub-pop');
    if (!pop) return { ok: false, why: '未出现小窗' };
    pop.scrollIntoView({ block: 'center' });   // 让小窗整体进入视口，elementFromPoint 才有效
    const th = document.querySelector('#records-table thead th[data-col="${key}"]');
    const mainHead = document.querySelector('#records-table thead');
    const popHead = pop.querySelector('thead');
    const mainRows = [...document.querySelectorAll('#records-table tbody tr')];
    const popRows = [...pop.querySelectorAll('tbody tr')];
    const r1 = (el) => { const r = el.getBoundingClientRect(); return { t: Math.round(r.top * 100) / 100, b: Math.round(r.bottom * 100) / 100, l: Math.round(r.left * 100) / 100, r: Math.round(r.right * 100) / 100, h: Math.round(r.height * 10) / 10 }; };
    const pr = pop.getBoundingClientRect();
    const hit = document.elementFromPoint(pr.left + pr.width / 2, pr.top + pr.height / 2);
    return {
      ok: true,
      cols: [...pop.querySelectorAll('thead th')].map((t) => t.textContent.trim()),
      rows: popRows.length,
      mainRows: mainRows.length,
      headTopDiff: Math.round((r1(popHead).t - r1(mainHead).t) * 100) / 100,
      headHeight: [r1(mainHead).h, r1(popHead).h],
      rowTopDiffs: mainRows.map((tr, i) => (popRows[i] ? Math.round((r1(popRows[i]).t - r1(tr).t) * 100) / 100 : null)),
      rowHeights: mainRows.slice(0, 2).map((tr, i) => [r1(tr).h, popRows[i] ? r1(popRows[i]).h : null]),
      leftGap: Math.round((r1(pop).l - r1(th).r) * 100) / 100,
      topGap: Math.round((r1(pop).t - r1(mainHead).t) * 100) / 100,
      hit: hit ? (hit.className || hit.tagName) : null,
      hitIsPop: !!(hit && hit.closest('.sub-pop')),
      colors: [...pop.querySelectorAll('tbody tr:first-child td .pct')].map((el) => getComputedStyle(el).color)
    };
  })()`);
  const subLang = await measureSubPop('language');
  console.log('  言语理解: ' + JSON.stringify(subLang));
  const alignOK = subLang.ok && subLang.headTopDiff === 0 && subLang.topGap === 0 && subLang.leftGap === 0
    && subLang.rowTopDiffs.every((d) => d === 0) && subLang.hitIsPop && subLang.rows === subLang.mainRows;
  console.log('  => 小窗表头/数据行与主表逐行对齐、贴列右侧: ' + (alignOK ? '成立' : '不成立'));
  // 第一行 = 测试第2套 93.33/70/80 → 绿(达标) / 红(未达标) / 黄(还需努力)
  const OK = 'rgb(22, 163, 74)', WARN = 'rgb(217, 119, 6)', BAD = 'rgb(220, 38, 38)';
  const colorOK = JSON.stringify(subLang.colors) === JSON.stringify([OK, BAD, WARN]);
  console.log('  => 子模块着色（绿/红/黄，按言语理解目标 90/下限 80）: ' + (colorOK ? '成立' : '不成立 -> ' + JSON.stringify(subLang.colors)));
  await shot('1b-subpop-language-1920.png', 1920, 1080);
  const subRea = await measureSubPop('reasoning');   // 再点判断推理（切换），接着再点一次关闭
  console.log('  判断推理: ' + JSON.stringify({ cols: subRea.cols, rows: subRea.rows, rowTopDiffs: subRea.rowTopDiffs, leftGap: subRea.leftGap }));
  const reaOK = subRea.ok && subRea.rowTopDiffs.every((d) => d === 0) && subRea.leftGap === 0 && subRea.rows === 3;
  console.log('  => 判断推理（4 列 × 3 行）同样逐行对齐: ' + (reaOK ? '成立' : '不成立'));
  await shot('1c-subpop-reasoning-1920.png', 1920, 1080);
  await measureSubPop('reasoning');
  const closed = await evaluate(`!document.querySelector('#records-table').closest('.table-scroll').querySelector('.sub-pop')`);
  console.log('  => 再次点击表头后小窗关闭: ' + (closed ? '成立' : '不成立'));
  await evaluate(`localStorage.setItem('kaogong_dashboard', ${JSON.stringify(origPayload)})`);
  await client.send('Page.reload', {});
  await sleep(3000);
  console.log('  已恢复原始数据:', await evaluate(`document.querySelectorAll('#records-table tbody tr').length`) + ' 条');

  console.log('=== 截图 ===');
  await shot('1-records-1920.png', 1920, 1080);

  await evaluate(`document.querySelector('[data-tab="stats"]').click()`);
  await sleep(1200);
  const statsCheck = await evaluate(`({
    active: document.getElementById('panel-stats').classList.contains('is-active'),
    canvases: document.querySelectorAll('#panel-stats canvas').length
  })`);
  console.log('  统计分析面板:', JSON.stringify(statsCheck));
  await shot('2-stats-1920.png', 1920, 1080);

  await evaluate(`document.querySelector('[data-tab="trend"]').click()`);
  await sleep(1500);
  const trendCheck = await evaluate(`({
    active: document.getElementById('panel-trend').classList.contains('is-active'),
    canvases: document.querySelectorAll('#panel-trend canvas').length,
    chartsVisible: ['chart-score','chart-module','chart-time'].map(id => {
      const el = document.getElementById(id);
      return { id, hidden: el.hidden, w: el.offsetWidth, h: el.offsetHeight };
    })
  })`);
  console.log('  趋势分析面板:', JSON.stringify(trendCheck));
  await shot('3-trend-1920.png', 1920, 1080);

  console.log('=== 打开新增表单 + 1366 窄屏 ===');
  await evaluate(`document.getElementById('btn-add').click()`);
  await sleep(900);
  const formCheck = await evaluate(`({
    modalOpen: !!document.querySelector('#modal-root .modal'),
    title: document.querySelector('#modal-root .modal-title') ? document.querySelector('#modal-root .modal-title').textContent : '',
    blocks: document.querySelectorAll('#modal-root .mod-block').length,
    summaryQ: document.querySelector('[data-sum="questions"]') ? document.querySelector('[data-sum="questions"]').textContent : ''
  })`);
  console.log('  新增表单:', JSON.stringify(formCheck));

  console.log('=== 弹窗遮罩是否盖住页头/工具栏（防误点） ===');
  const overlay = await evaluate(`(() => {
    const z = (el) => el ? getComputedStyle(el).zIndex : null;
    const probe = (x, y) => { const el = document.elementFromPoint(x, y); return el ? (el.id || el.className || el.tagName) : null; };
    return {
      atBrand: probe(120, 30),
      atAddButton: probe(window.innerWidth / 2, 30),
      atClearButton: probe(window.innerWidth - 60, 30),
      backdropZ: z(document.querySelector('.modal-backdrop')),
      headerZ: z(document.querySelector('.app-header')),
      toolbarClickable: !document.getElementById('btn-clear').disabled
    };
  })()`);
  console.log('  ' + JSON.stringify(overlay));

  console.log('=== 趋势图 y 轴是否覆盖目标线 ===');
  await evaluate(`document.querySelector('[data-act="cancel"]').click()`);
  await sleep(400);
  await evaluate(`document.querySelector('[data-tab="trend"]').click()`);
  await sleep(1200);
  const axis = await evaluate(`(() => {
    const el = document.getElementById('chart-score');
    const inst = echarts.getInstanceByDom(el);
    const o = inst.getOption();
    return { yMax: o.yAxis[0].max, yMin: o.yAxis[0].min, markLines: o.series.map(s => (s.markLine && s.markLine.data || []).map(m => m.yAxis)) };
  })()`);
  console.log('  ' + JSON.stringify(axis));
  await shot('5-trend-axis-1920.png', 1920, 1080);

  console.log('=== 真实下载：导出 XLSX 并用 SheetJS 回读校验 ===');
  const downDir = path.join(os.tmpdir(), 'kg-downloads-' + Date.now());
  fs.mkdirSync(downDir, { recursive: true });
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downDir });
  await evaluate(`document.getElementById('btn-export').click()`);
  await sleep(3000);
  const files = fs.readdirSync(downDir).filter((f) => /\.xlsx$/i.test(f));
  console.log('  下载到:', JSON.stringify(files));
  if (files.length) {
    const XLSX = require('xlsx');
    // cellNF:true 才会解析数字格式，否则 .z 一律 undefined
    const wb = XLSX.readFile(path.join(downDir, files[0]), { cellDates: false, cellNF: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    console.log('  Sheet 名:', JSON.stringify(wb.SheetNames));
    console.log('  A1/天数标签:', ws.A1 && ws.A1.v, '/', ws.F3 && ws.F3.v, '/', ws.F4 && ws.F4.v);
    console.log('  A4(日期序列号):', ws.A4 && ws.A4.v, '格式:', ws.A4 && ws.A4.z, '| B4:', ws.B4 && ws.B4.v);
    console.log('  G4(合计正确数):', ws.G4 && ws.G4.v, '| E4(击败比):', ws.E4 && ws.E4.v, ws.E4 && ws.E4.z);
    console.log('  O5(源表脏数据):', ws.O5 && ws.O5.v, '| J6:', ws.J6 && ws.J6.v, '| M7:', ws.M7 && ws.M7.v);
    console.log('  !merges 数量:', ws['!merges'] ? ws['!merges'].length : 0);
    const vt = (addr) => (ws[addr] && ws[addr].v !== undefined ? ws[addr].v : null);
    const check = {
      sheetName: wb.SheetNames[0],
      headerOK: vt('A1') === '日期' && vt('J1') === '言语理解' && vt('M2') === '总计',
      dateRoundTrip: vt('A4') === 46284,
      rawPreserved: vt('O5') === '50%%' && vt('J6') === '无' && vt('M7') === 38,
      totalPreserved: vt('G4') === 76,
      dateFormat: ws.A4.z === 'yyyy/m/d',
      pctFormat: ws.E4.z === '0.00%' && ws.H5.z === '0.00%' && ws.H6.z === '0.00%'
    };
    console.log('  校验:', JSON.stringify(check));
    console.log('  => 导出文件结构/数据', Object.values(check).every((v) => v === true || v === '粉笔模考') ? '全部正确' : '存在问题');
  }
  try { fs.rmSync(downDir, { recursive: true, force: true }); } catch (e) {}

  console.log('=== 模块四：用时分析（真实 Chrome） ===');
  await evaluate(`document.querySelector('[data-tab="time"]').click()`);
  await sleep(1500);
  const timePanel = await evaluate(`(() => {
    const el = document.getElementById('chart-time-analysis');
    const inst = window.echarts.getInstanceByDom(el);
    const opt = inst ? inst.getOption() : null;
    return {
      active: document.getElementById('panel-time').classList.contains('is-active'),
      canvases: document.querySelectorAll('#panel-time canvas').length,
      chartSize: el.offsetWidth + 'x' + el.offsetHeight,
      seriesName: opt && opt.series[0] ? opt.series[0].name : null,
      planLine: opt && opt.series[0] && opt.series[0].markLine
        ? opt.series[0].markLine.data.map((m) => m.yAxis) : null,
      yMax: opt && opt.yAxis[0] ? opt.yAxis[0].max : null,
      cards: [...document.querySelectorAll('#time-cards .stat-card')].map((c) => c.textContent.replace(/\\s+/g, ' ').trim()),
      ranking: [...document.querySelectorAll('#time-ranking .rank-item')].map((li) => li.textContent.replace(/\\s+/g, ' ').trim()),
      tableRows: document.querySelectorAll('#time-table tbody tr').length,
      subRows: document.querySelectorAll('#time-table tbody tr.time-sub-row').length,
      firstRow: [...document.querySelectorAll('#time-table tbody tr')[3].children].map((td) => td.textContent.trim())
    };
  })()`);
  console.log('  ' + JSON.stringify(timePanel, null, 1));
  await shot('7-time-1920.png', 1920, 1080);

  console.log('=== 编辑标准用时弹窗 ===');
  await evaluate(`document.getElementById('btn-edit-timeplan').click()`);
  await sleep(900);
  const planModal = await evaluate(`(() => ({
    open: !!document.querySelector('#modal-root .modal'),
    title: document.querySelector('#modal-root .modal-title') ? document.querySelector('#modal-root .modal-title').textContent.trim() : '',
    rows: document.querySelectorAll('#modal-root tr[data-key]').length,
    total: document.querySelector('#modal-root [data-plan-total]') ? document.querySelector('#modal-root [data-plan-total]').textContent.trim() : '',
    political: document.querySelector('#modal-root tr[data-key="political"] [data-field="plan"]') ? document.querySelector('#modal-root tr[data-key="political"] [data-field="plan"]').value : null
  }))()`);
  console.log('  ' + JSON.stringify(planModal));
  await shot('8-timeplan-1366.png', 1366, 900);
  await evaluate(`document.querySelector('#modal-root [data-act="cancel"]').click()`);
  await sleep(400);

  console.log('=== 数据存储卡片（真实 Chrome） ===');
  const storageCard = await evaluate(`(() => {
    const b = document.getElementById('btn-fs-bind');
    return {
      supported: typeof window.showDirectoryPicker === 'function',
      statusText: document.getElementById('storage-status').textContent.trim(),
      note: document.getElementById('storage-note').textContent.trim().slice(0, 120),
      bindLabel: b.textContent.trim(),
      bindDisabled: b.disabled,
      writeDisabled: document.getElementById('btn-fs-write').disabled,
      persistWarningShown: document.getElementById('storage-note').textContent.indexOf('重新授权') >= 0
    };
  })()`);
  console.log('  ' + JSON.stringify(storageCard, null, 1));

  console.log('=== 用真实鼠标事件点「绑定数据文件夹」 ===');
  // 必须用 CDP 真实鼠标事件：JS 的 .click() 不算 user activation，Chrome 会拒绝弹选择框
  await evaluate(`document.querySelector('[data-tab="records"]').click()`);
  await sleep(700);
  await evaluate(`document.getElementById('btn-fs-bind').scrollIntoView({ block: 'center' })`);
  await sleep(400);
  const bindRect = await evaluate(`(() => { const r = document.getElementById('btn-fs-bind').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bindRect.x, y: bindRect.y, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bindRect.x, y: bindRect.y, button: 'left', clickCount: 1 });
  await sleep(2000);
  const afterBind = await evaluate(`({
    status: document.getElementById('storage-status').textContent.trim(),
    lastAction: KG.FileStore.status().lastAction,
    lastError: KG.FileStore.status().lastError,
    noteTail: document.getElementById('storage-note').textContent.trim().slice(-80)
  })`);
  console.log('  ' + JSON.stringify(afterBind, null, 1));
  const bindOk = afterBind.lastAction === '已取消选择' && afterBind.lastError === '';
  console.log('  => 真实点击下成功抵达系统选择框（无头环境随即自动关闭）：' + (bindOk ? '是' : '否'));
  await shot('6-storage-card-1366.png', 1366, 768);

  console.log('=== 无头环境下 IndexedDB 能否持久化目录句柄（真实 Chromium） ===');
  console.log('  ' + JSON.stringify(await evaluate(`(async () => {
    try {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('kaogong_fs', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('handles');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      const got = await new Promise((res) => {
        const g = db.transaction('handles','readonly').objectStore('handles').get('dataDir');
        g.onsuccess = () => res(g.result); g.onerror = () => res('ERR');
      });
      return { dbUsable: true, storedHandle: got === undefined ? '(空，因为选择框被自动关闭)' : '有' };
    } catch (e) { return { dbUsable: false, err: e.name + ' ' + e.message }; }
  })()`)));

  console.log('=== 刷新后数据是否仍在（持久化验证） ===');
  await client.send('Page.reload', {});
  await sleep(4500);
  const after = await evaluate(`({
    rowCount: document.querySelectorAll('#records-table tbody tr').length,
    paper: document.querySelector('#records-table tbody tr td:nth-child(2)') ? document.querySelector('#records-table tbody tr td:nth-child(2)').textContent : '',
    toastVisible: !!document.querySelector('.toast')
  })`);
  console.log('  刷新后:', JSON.stringify(after));

  console.log('\n=== 控制台报错 ===');
  console.log(consoleErrors.length ? consoleErrors.join('\n') : '（无）');
  console.log('=== 未捕获异常 ===');
  console.log(exceptions.length ? exceptions.join('\n') : '（无）');

  ws.close();
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch((e) => {
  console.error('浏览器验证失败:', e);
  try { chrome.kill(); } catch (_) {}
  process.exit(1);
});
