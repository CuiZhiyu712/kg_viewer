/* 飞书版验收：真实 Chrome 打开，验证增量功能 + 平表 CSV 导出
 * 重点：CSV 必须能被标准解析器解回来（含引号转义），且数值逐项正确。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/* 飞书相关功能（平表 CSV 导出、WebView 适配）现在已并入 src/，
   所以这里验证的就是唯一的那个构建产物。 */
const APP = path.join(__dirname, '..', '考公练习追踪看板.html');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9399;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function eq(a, b, label) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++;
  else { fail++; console.log(`  FAIL ${label}\n       actual   = ${x}\n       expected = ${y}`); }
}
const ok = (c, label) => eq(!!c, true, label);

/** 极简 RFC4180 解析器：用来证明导出的 CSV 能被标准方式读回来 */
function parseCsv(text) {
  if (text[0] === '﻿') text = text.slice(1);
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r') { /* 忽略，交给 \n 收行 */ }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

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

(async function main() {
  if (!fs.existsSync(APP)) throw new Error('找不到飞书版产物，请先运行 python feishu/build_feishu.py');
  const downDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-fs-dl-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-fs-prof-'));
  const fileUrl = 'file:///' + APP.replace(/\\/g, '/');

  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1600,1000',
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    // 同一个页面连续两次下载会被 Chrome 默认拦截，测试里要放开
    '--allow-multiple-downloads',
    `--user-data-dir=${profile}`, fileUrl,
  ], { stdio: 'ignore' });

  const target = await findTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const c = cdp(ws);
  const errors = [], requests = [], logs = [];
  c.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(m.params.args.map((a) => a.value || '').join(' '));
    }
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  });
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.send('Network.enable');
  await c.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downDir });
  await sleep(5000);

  const ev = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails
      ? { ERROR: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text }
      : r.result.value;
  };

  const waitForCsv = async (pred, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const f = fs.readdirSync(downDir).filter((n) => n.endsWith('.csv'));
      if (f.length && (!pred || pred(f))) return f.sort()[f.length - 1];
      await sleep(300);
    }
    return null;
  };

  console.log('=== 飞书相关功能是否都在 ===');
  const st = await ev(`(() => {
    const vp = document.querySelector('meta[name="viewport"]');
    // 安全区域适配已并入基础样式表（不再靠运行时注入）
    const css = [...document.styleSheets].map((s) => {
      try { return [...s.cssRules].map((r) => r.cssText).join('\\n'); } catch (e) { return ''; }
    }).join('\\n');
    return {
      title: document.title,
      hasCsvBtn: !!document.getElementById('btn-export-csv'),
      csvBtnText: document.getElementById('btn-export-csv') ? document.getElementById('btn-export-csv').textContent.trim() : '',
      safeAreaInCss: css.indexOf('safe-area-inset-top') >= 0,
      overscrollInCss: css.indexOf('overscroll-behavior') >= 0,
      viewport: vp ? vp.getAttribute('content') : '',
      rows: document.querySelectorAll('#records-table tbody tr').length,
      tabs: document.querySelectorAll('#tabs .tab').length,
      csvDisabled: document.getElementById('btn-export-csv').disabled
    };
  })()`);
  console.log('  ' + JSON.stringify(st));
  eq(st.hasCsvBtn, true, '有「导出 CSV」按钮');
  eq(st.csvBtnText, '导出 CSV', '按钮文案');
  eq(st.safeAreaInCss, true, '样式表里有安全区域适配（刘海屏/底部横条）');
  eq(st.overscrollInCss, true, '样式表里禁止了下拉回弹');
  eq(st.viewport.indexOf('viewport-fit=cover') >= 0, true, 'viewport 已加 viewport-fit=cover');
  eq(st.rows, 1, '记录正常渲染');
  ok(st.tabs >= 4, '页签都在（' + st.tabs + ' 个）');
  eq(st.csvDisabled, false, '有记录时「导出 CSV」可用');

  console.log('\n=== 导出平表 CSV ===');
  await ev(`document.getElementById('btn-export-csv').click()`);
  const f1 = await waitForCsv();
  ok(f1, 'CSV 已下载：' + f1);
  const raw = fs.readFileSync(path.join(downDir, f1), 'utf8');
  eq(raw.charCodeAt(0), 0xFEFF, '带 UTF-8 BOM（Excel / 飞书中文不乱码）');
  ok(raw.indexOf('\r\n') > 0, '使用 CRLF 换行（RFC4180）');

  const table = parseCsv(raw);
  const head = table[0];
  const row = table[1];
  const col = (name) => head.indexOf(name);
  console.log('  列数:', head.length, '| 数据行数:', table.length - 1);
  eq(table.length - 1, 1, '一条记录 -> 一行');
  eq(head[0], '日期', '首列是日期');
  eq(head.slice(0, 5), ['日期', '试卷', '分数', '平均分', '击败比(%)'], '基础信息列');
  ok(head.indexOf('逻辑填空正确率(%)') >= 0, '含言语理解子模块列');
  ok(head.indexOf('逻辑判断用时(分钟)') >= 0, '含判断推理子模块列');
  eq(head.slice(-4), ['总题数', '总正确数', '总正确率(%)', '总用时(分钟)'], '末尾是整套卷汇总');

  const get = (name) => row[col(name)];
  eq(get('日期'), '2026-09-19', '日期');
  eq(get('试卷'), '第29季', '试卷');
  eq(get('分数'), '58.5', '分数');
  eq(get('平均分'), '57.3', '平均分');
  eq(get('击败比(%)'), '59.4', '击败比（源表 0.594 已归一化为 59.4）');
  eq(get('政治理论题数'), '20', '政治理论题数');
  eq(get('政治理论正确数'), '6', '政治理论正确数');
  eq(get('政治理论正确率(%)'), '30', '政治理论正确率（自动算）');
  eq(get('政治理论平均正确率(%)'), '70', '政治理论平均正确率（记录里填的值）');
  eq(get('政治理论用时(分钟)'), '11', '政治理论用时');
  eq(get('常识用时(分钟)'), '', '常识缺用时 -> 空字符串（不是「无」）');
  eq(get('逻辑填空题数'), '15', '子模块题数');
  eq(get('逻辑填空用时(分钟)'), '17', '子模块用时');
  eq(get('类比推理正确率(%)'), '100', '类比推理 5/5 -> 100');
  eq(get('总题数'), '130', '总题数');
  eq(get('总正确数'), '76', '总正确数（保留源表合计 76，非模块之和 81）');
  eq(get('总正确率(%)'), '58.46', '总正确率');
  eq(get('总用时(分钟)'), '176', '总用时');

  console.log('\n=== 转义：试卷名里带逗号和引号 ===');
  await ev(`document.getElementById('btn-add').click()`);
  await sleep(1200);
  await ev(`(() => {
    const set = (sel, v) => { const el = document.querySelector(sel); el.value = v;
      el.dispatchEvent(new Event('input', {bubbles:true})); };
    set('#modal-root [data-field="date"]', '2026-10-20');
    set('#modal-root [data-field="paperName"]', '第33季, "特别"场');
    set('#modal-root [data-field="score"]', '66');
    set('#modal-root [data-field="averageScore"]', '60');
    set('#modal-root [data-field="defeatRate"]', '75');
    set('#modal-root .mod-block[data-module="political"] [data-field="questions"]', '20');
    set('#modal-root .mod-block[data-module="political"] [data-field="correct"]', '10');
    return true;
  })()`);
  await sleep(500);
  await ev(`document.querySelector('#modal-root [data-act="save"]').click()`);
  await sleep(900);

  // 先确认记录真的存进去了：区分「保存失败」和「下载被拦」两种可能
  const afterAdd = await ev(`(() => {
    const s = JSON.parse(localStorage.getItem('kaogong_dashboard'));
    return { stored: s ? s.records.length : -1,
             paper: s ? s.records.map(r => r.paperName) : [] };
  })()`);
  console.log('  新增后:', JSON.stringify(afterAdd));
  eq(afterAdd.stored, 2, '新增记录已写入 localStorage');
  eq(afterAdd.paper[1], '第33季, "特别"场', '带逗号与引号的试卷名原样保存');

  // 清掉上一次的下载文件，确保读到的是这一次的
  fs.readdirSync(downDir).filter((n) => n.endsWith('.csv')).forEach((n) => fs.unlinkSync(path.join(downDir, n)));
  await ev(`document.getElementById('btn-export-csv').click()`);
  const f2 = await waitForCsv(null, 8000);
  ok(f2, '第二次导出下载到文件：' + f2);
  const t2 = parseCsv(fs.readFileSync(path.join(downDir, f2), 'utf8'));
  eq(t2.length - 1, 2, '两条记录 -> 两行');
  const names = t2.slice(1).map((r) => r[t2[0].indexOf('试卷')]);
  // 按日期升序排列
  eq(names, ['第29季', '第33季, "特别"场'], '含逗号与引号的试卷名被正确转义并解析回来');
  const sortedDates = t2.slice(1).map((r) => r[0]);
  eq(sortedDates, ['2026-09-19', '2026-10-20'], '按日期升序输出');

  console.log('\n=== 水印与版权声明 ===');
  const brand = await ev(`(() => {
    const wm = document.querySelector('.brand-watermark');
    const ft = document.querySelector('.app-footer');
    const cs = wm ? getComputedStyle(wm) : null;
    return {
      wmText: wm ? wm.textContent.replace(/\\s+/g, ' ').trim() : '',
      wmFixed: cs ? cs.position : '',
      wmPointer: cs ? cs.pointerEvents : '',
      wmZ: cs ? parseInt(cs.zIndex, 10) : null,
      footerOwner: ft ? ft.querySelector('.app-footer-owner').textContent.trim() : '',
      footerTerms: ft ? ft.querySelector('.app-footer-terms').textContent.replace(/\\s+/g, ' ').trim() : '',
      hasBannerClaim: document.documentElement.outerHTML.indexOf('© 2026 CZY') >= 0
    };
  })()`);
  console.log('  ' + JSON.stringify(brand, null, 1));
  ok(brand.wmText.indexOf('CZY') >= 0, '右下角水印含 CZY');
  ok(brand.wmText.indexOf('禁止转售') >= 0, '水印写明禁止转售');
  eq(brand.wmFixed, 'fixed', '水印固定在右下角');
  eq(brand.wmPointer, 'none', '水印不挡点击');
  ok(brand.wmZ < 1200, '水印层级低于计时条（z=' + brand.wmZ + '）');
  ok(brand.footerOwner.indexOf('CZY') >= 0, '页脚有版权归属：' + brand.footerOwner);
  ok(brand.footerTerms.indexOf('未经作者授权') >= 0, '页脚写明「未经作者授权」（保留授权口子）');
  eq(brand.footerTerms.indexOf('免费'), -1, '声明里不提「免费」（要卖时不该白纸黑字写免费）');
  eq(brand.wmText.indexOf('免费'), -1, '水印里也不提免费');
  eq(brand.hasBannerClaim, true, '文件头注释里也有版权声明');

  console.log('\n=== 水印与计时条不重叠 ===');
  await ev(`(() => {
    document.getElementById('btn-timer-start').click();
    return true;
  })()`);
  await sleep(1000);
  const wmOverlap = await ev(`(() => {
    window.scrollTo(0, document.body.scrollHeight);
    const wm = document.querySelector('.brand-watermark').getBoundingClientRect();
    const bar = document.getElementById('timer-bar').getBoundingClientRect();
    return {
      wmBottom: Math.round(wm.bottom), barTop: Math.round(bar.top),
      overlaps: wm.bottom > bar.top && wm.top < bar.bottom && wm.right > bar.left && wm.left < bar.right,
      bodyClass: document.body.classList.contains('has-timer-bar')
    };
  })()`);
  console.log('  ' + JSON.stringify(wmOverlap));
  eq(wmOverlap.bodyClass, true, '计时中 body 带 has-timer-bar');
  eq(wmOverlap.overlaps, false, '计时条与水印不重叠');

  // 右下角三层（水印 / 计时条 / 提示条）必须互不遮挡
  await ev(`(KG.UI.toast('重叠检测用提示条', 'info', 8000))`);
  await sleep(400);
  const stackCheck = await ev(`(() => {
    const rect = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect() : null; };
    const hit = (a, b) => !!(a && b) && a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;
    const wm = rect('.brand-watermark'), bar = rect('#timer-bar'), ts = rect('.toast-root .toast');
    return {
      hasToast: !!ts,
      toastVsWm: hit(ts, wm), toastVsBar: hit(ts, bar), barVsWm: hit(bar, wm),
      toastBottom: ts ? Math.round(ts.bottom) : null,
      wmTop: wm ? Math.round(wm.top) : null
    };
  })()`);
  console.log('  ' + JSON.stringify(stackCheck));
  eq(stackCheck.hasToast, true, '提示条已出现（用于重叠检测）');
  eq(stackCheck.toastVsWm, false, '提示条不盖水印');
  eq(stackCheck.toastVsBar, false, '提示条不盖计时条');
  eq(stackCheck.barVsWm, false, '计时条不盖水印');
  await ev(`(() => { document.getElementById('btn-bar-stop').click(); return true; })()`);
  await sleep(600);
  // 关掉确认弹窗（若有）
  await ev(`(() => { const b = document.querySelector('#modal-root [data-act="ok"]'); if (b) b.click(); return true; })()`);
  await sleep(400);

  console.log('\n=== 无记录时按钮置灰 ===');
  await ev(`(() => {
    const raw = JSON.parse(localStorage.getItem('kaogong_dashboard'));
    raw.records = [];
    localStorage.setItem('kaogong_dashboard', JSON.stringify(raw));
    location.reload();
    return true;
  })()`);
  await sleep(5000);
  const emptyState = await ev(`({
    csvDisabled: document.getElementById('btn-export-csv').disabled,
    xlsxDisabled: document.getElementById('btn-export').disabled
  })`);
  eq(emptyState.csvDisabled, true, '没有记录时「导出 CSV」置灰');
  eq(emptyState.xlsxDisabled, true, '没有记录时「导出 XLSX」也置灰');

  console.log('\n=== 环境 ===');
  const external = requests.filter((u) => !/^(file|data|blob):/.test(u));
  eq(external, [], '零外部请求');
  eq(errors, [], errors.length ? errors.join(' | ') : '无未捕获异常');

  console.log(`\n===== PASS ${pass} / FAIL ${fail} =====`);
  ws.close(); chrome.kill();
  [downDir, profile].forEach((t) => { try { fs.rmSync(t, { recursive: true, force: true }); } catch (e) {} });
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error('测试脚本异常:', e); process.exit(1); });
