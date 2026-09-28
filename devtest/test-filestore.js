/* 「绑定数据文件夹」功能测试
 *
 * jsdom 没有 showDirectoryPicker，也没有 IndexedDB，所以这里：
 *   - 注入一个内存假目录句柄，完整验证 序列化/签名/写入/读取/覆盖/解绑 逻辑
 *   - 顺带验证「IndexedDB 不可用时」的降级路径（句柄存不下也不能崩）
 * 真实的目录授权 + 句柄持久化只能在 Chrome 里由人点一次，见 test-browser.js 与 README。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const XLSX = require('xlsx');

const HTML_PATH = path.join(__dirname, '..', '考公练习追踪看板.html');
const html = require('./load-html')().html;

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => {
  const m = String(e.message || e);
  if (/Could not parse CSS/i.test(m)) return;
  if (/Not implemented: navigation/i.test(m)) return;
  errors.push('jsdomError: ' + m);
});
vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));

let pass = 0, fail = 0;
function eq(a, b, label) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++;
  else { fail++; console.log(`  FAIL ${label}\n       actual   = ${x}\n       expected = ${y}`); }
}
const ok = (c, label) => eq(!!c, true, label);

/* ---- 内存假目录 ---- */
function makeFakeDir(name) {
  const files = new Map();
  const dir = {
    name,
    _perm: 'granted',
    async queryPermission() { return this._perm; },
    async requestPermission() { this._perm = 'granted'; return 'granted'; },
    async getFileHandle(fname, opts) {
      if (!files.has(fname)) {
        if (!opts || !opts.create) {
          const e = new Error("A requested file or directory could not be found");
          e.name = 'NotFoundError';
          throw e;
        }
        files.set(fname, '');
      }
      return {
        name: fname,
        async createWritable() {
          let buf = '';
          return {
            async write(t) { buf = t; },
            async close() { files.set(fname, buf); },
          };
        },
        async getFile() { return { async text() { return files.get(fname); } }; },
      };
    },
  };
  return { dir, files };
}

const fake = makeFakeDir('data');
let pickerCalls = 0;
let pickerShouldAbort = false;

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole: vc,
  beforeParse(win) {
    win.XLSX = XLSX;
    win.echarts = { init: () => ({ setOption() {}, resize() {}, dispose() {} }) };
    win.__blobs = [];
    win.URL.createObjectURL = (b) => { win.__blobs.push(b); return 'blob:stub'; };
    win.URL.revokeObjectURL = () => {};
    // 必须在脚本执行前挂上，FileStore 是在加载时就探测支持的
    win.showDirectoryPicker = async () => {
      pickerCalls++;
      if (pickerShouldAbort) { const e = new Error('user aborted'); e.name = 'AbortError'; throw e; }
      return fake.dir;
    };
  },
});

const win = dom.window;
const doc = win.document;
const KG = win.KG;
const $ = (s, r) => (r || doc).querySelector(s);
const $$ = (s, r) => Array.from((r || doc).querySelectorAll(s));
const text = (s) => ($(s) ? $(s).textContent.trim() : '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const setInput = (el, v) => {
  el.value = String(v);
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
};
const readFile = () => JSON.parse(fake.files.get('kaogong_data.json'));

(async function run() {
  await wait(300);
  const FS = KG.FileStore;

  console.log('--- 初始状态 ---');
  eq(FS.isSupported(), true, '探测到目录授权能力（已注入 stub）');
  eq(FS.status().bound, false, '初始未绑定');
  ok(text('#storage-status').indexOf('未绑定') >= 0, '界面显示未绑定');
  ok(text('#storage-note').indexOf('data') >= 0, '提示里说明了要选 data 文件夹');
  eq($('#btn-fs-write').disabled, true, '未绑定时「立即写入」置灰');
  eq($('#btn-fs-read').disabled, true, '未绑定时「从文件读取」置灰');
  eq($('#btn-fs-unbind').disabled, true, '未绑定时「解绑」置灰');
  eq($('#btn-fs-bind').disabled, false, '「绑定数据文件夹」可用');
  eq(text('#btn-fs-bind'), '绑定数据文件夹', '按钮文案');
  eq(FS.status().lastError, '', '初始无错误（IndexedDB 缺失只算提示，不算错误）');
  ok(text('#storage-note').indexOf('data') >= 0, 'IndexedDB 缺失时引导语仍在，没有被错误信息盖掉');
  ok(FS.status().persistWarning.length > 0, '把句柄存不下的情况降级为提示');
  ok(text('#storage-note').indexOf('刷新页面后需要重新授权') >= 0, '提示里说清了后果');

  console.log('--- 用户取消选择，不应报错 ---');
  pickerShouldAbort = true;
  $('#btn-fs-bind').click();
  await wait(200);
  pickerShouldAbort = false;
  eq(FS.status().bound, false, '取消后仍未绑定');
  eq(FS.status().lastError, '', '取消不产生错误信息（不是失败）');
  eq(FS.status().lastAction, '已取消选择', '记录为「已取消选择」');
  eq(errors.length, 0, '取消路径无 JS 报错' + (errors.length ? ' -> ' + errors.join(' | ') : ''));

  console.log('--- 绑定 ---');
  $('#btn-fs-bind').click();
  await wait(300);
  eq(pickerCalls, 2, '触发了系统目录选择框');
  eq(FS.status().bound, true, '绑定成功');
  eq(FS.status().dirName, 'data', '记住了目录名（浏览器不暴露完整路径）');
  eq(FS.status().permission, 'granted', '权限已授予');
  eq(fake.files.has('kaogong_data.json'), true, '目标文件已创建');
  const f1 = readFile();
  eq(f1.app, '考公练习追踪看板', '文件带应用标识');
  eq(f1.version, 1, '文件带 version');
  eq(f1.records.length, 1, '文件里有 1 条记录');
  eq(f1.records[0].paperName, '第29季', '记录内容正确');
  eq(f1.records[0].date, '2026-09-19', '日期正确');
  ok(f1.exportedAt && f1.exportedAt.length > 10, '文件带导出时间');
  eq(FS.status().lastError, '', '绑定后无错误（IndexedDB 不可用的降级提示单独记录）');
  console.log('   （jsdom 无 IndexedDB，预期提示：' + (FS.status().lastError || '无') + '）');
  ok(FS.status().lastWriteAt !== null, '记录了最后写入时间');

  console.log('--- 界面状态 ---');
  ok(text('#storage-status').indexOf('已绑定') >= 0, '显示已绑定');
  eq(text('#storage-path'), 'data\\kaogong_data.json', '显示目录\\文件名');
  ok(text('#storage-note').indexOf('自动写入') >= 0 || text('#storage-note').indexOf('最后写入') >= 0, '显示自动同步说明');
  eq($('#btn-fs-write').disabled, false, '「立即写入」可用');
  eq($('#btn-fs-read').disabled, false, '「从文件读取」可用');
  eq($('#btn-fs-unbind').disabled, false, '「解绑」可用');
  eq($('#btn-fs-bind').disabled, true, '已授权时绑定按钮置灰');

  console.log('--- 改动后自动落盘 ---');
  const before = readFile().settings.defeatTarget;
  setInput($('#set-defeat-target'), '88');
  $('#btn-save-settings').click();
  await wait(300);
  const after = readFile();
  eq(before, 95, '写入前文件里的目标是 95');
  eq(after.settings.defeatTarget, 88, '改目标设置后文件自动同步为 88');
  eq(after.records.length, 1, '自动同步没有动记录');

  console.log('--- 新增记录后自动落盘 ---');
  $('#btn-add').click();
  await wait(250);
  setInput($('#modal-root [data-field="date"]'), '2026-10-05');
  setInput($('#modal-root [data-field="paperName"]'), '第31季');
  setInput($('#modal-root [data-field="score"]'), '80');
  setInput($('#modal-root [data-field="averageScore"]'), '70');
  setInput($('#modal-root [data-field="defeatRate"]'), '90');
  let blk = $('#modal-root .mod-block[data-module="political"]');
  setInput($('[data-field="questions"]', blk), 20);
  setInput($('[data-field="correct"]', blk), 16);
  $('#modal-root [data-act="save"]').click();
  await wait(300);
  eq(readFile().records.length, 2, '新增后文件自动变成 2 条');
  eq(readFile().records.map((r) => r.paperName), ['第29季', '第31季'], '文件里的记录顺序与内容');

  console.log('--- 删除记录后自动落盘 ---');
  const row = $$('#records-table tbody tr').find((tr) => tr.children[1].textContent.trim() === '第31季');
  row.querySelector('[data-act="delete"]').click();
  await wait(250);
  $('#modal-root [data-act="ok"]').click();
  await wait(300);
  eq(readFile().records.length, 1, '删除后文件自动回到 1 条');

  console.log('--- 从文件读取（覆盖本地） ---');
  // 外部把文件改成 3 条（模拟手工编辑或换了机器）
  const ext = JSON.parse(JSON.stringify(readFile()));
  ext.records = [ext.records[0], Object.assign({}, ext.records[0], { id: 'x2', paperName: '外部A', date: '2026-11-01' }),
    Object.assign({}, ext.records[0], { id: 'x3', paperName: '外部B', date: '2026-11-02' })];
  fake.files.set('kaogong_data.json', JSON.stringify(ext));
  $('#btn-fs-read').click();
  await wait(250);
  ok($('#modal-root .modal'), '读取前弹出确认框');
  ok($('#modal-root .modal-body').textContent.indexOf('当前浏览器本地有 1 条记录') >= 0, '确认框显示本地记录数');
  const beforeRead = JSON.parse(win.localStorage.getItem('kaogong_dashboard')).records.length;
  $('#modal-root [data-act="ok"]').click();
  await wait(350);
  eq(beforeRead, 1, '确认前本地未变');
  const ls = JSON.parse(win.localStorage.getItem('kaogong_dashboard'));
  eq(ls.records.length, 3, '覆盖后本地变成 3 条');
  eq(ls.records.map((r) => r.paperName), ['第29季', '外部A', '外部B'], '覆盖后内容来自文件');
  eq($$('#records-table tbody tr').length, 3, '主表刷新为 3 行');
  eq(errors.length, 0, '读取覆盖路径无 JS 报错' + (errors.length ? ' -> ' + errors.join(' | ') : ''));

  console.log('--- 文件不存在时的读取 ---');
  fake.files.delete('kaogong_data.json');
  $('#btn-fs-read').click();
  await wait(250);
  ok(!$('#modal-root .modal'), '文件不存在时不弹确认框');
  eq(errors.length, 0, '无 JS 报错' + (errors.length ? ' -> ' + errors.join(' | ') : ''));
  $('#btn-fs-write').click();
  await wait(250);
  eq(fake.files.has('kaogong_data.json'), true, '「立即写入」把文件重新生成');

  console.log('--- 签名比对（判断文件与本地是否一致） ---');
  const sigFile = KG.FileStore.signature(JSON.parse(fake.files.get('kaogong_data.json')));
  const sigLocal = KG.FileStore.localSignature(KG.App.state);
  eq(sigFile === sigLocal, true, '写完后文件与本地签名一致（启动时不会误报不一致）');
  const bumped = JSON.parse(fake.files.get('kaogong_data.json'));
  bumped.exportedAt = '2020-01-01T00:00:00.000Z';       // 只改时间戳
  eq(KG.FileStore.signature(bumped) === sigLocal, true, '仅 exportedAt 不同不算不一致');
  bumped.records = bumped.records.slice(0, 1);
  eq(KG.FileStore.signature(bumped) === sigLocal, false, '记录数变化会被判定为不一致');

  console.log('--- 绑定的不是 data 文件夹时要提醒 ---');
  fake.dir.name = 'Documents';
  $('#btn-fs-unbind').click();
  await wait(250);
  $('#modal-root [data-act="ok"]').click();
  await wait(300);
  $('#btn-fs-bind').click();
  await wait(300);
  eq(FS.status().dirName, 'Documents', '记下了选的文件夹名');
  ok(text('#storage-note').indexOf('不是项目下的 data 文件夹') >= 0, '选错文件夹时给出提醒');
  fake.dir.name = 'data';
  $('#btn-fs-unbind').click();
  await wait(250);
  $('#modal-root [data-act="ok"]').click();
  await wait(300);
  $('#btn-fs-bind').click();
  await wait(300);
  ok(text('#storage-note').indexOf('不是项目下的 data 文件夹') < 0, '选对文件夹后提醒消失');

  console.log('--- 解绑 ---');
  $('#btn-fs-unbind').click();
  await wait(250);
  $('#modal-root [data-act="ok"]').click();
  await wait(300);
  eq(FS.status().bound, false, '已解绑');
  eq(fake.files.has('kaogong_data.json'), true, '解绑不删除磁盘上的文件');
  ok(text('#storage-status').indexOf('未绑定') >= 0, '界面回到未绑定');

  console.log('--- IndexedDB 不可用时的降级 ---');
  eq(typeof win.indexedDB, 'undefined', 'jsdom 环境确实没有 IndexedDB');
  eq(FS.status().lastError.indexOf('句柄未能保存') >= 0 || FS.status().lastError === '', true,
    '句柄存不下时给出提示且不影响本次会话使用');

  console.log(`\n===== PASS ${pass} / FAIL ${fail} =====`);
  if (errors.length) console.log('捕获到的 JS 报错:\n' + errors.join('\n'));
  dom.window.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error('测试脚本异常:', e); process.exit(1); });
