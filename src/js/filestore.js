/* filestore.js —— 把数据落到 ./data/kaogong_data.json
 *
 * 浏览器在 file:// 下没有文件系统权限：fetch/XHR 读同目录文件会被拦截，
 * OPFS 也会抛 SecurityError。唯一正规通道是 File System Access API：
 * 用户手动点一次「绑定数据文件夹」授权某个目录，之后页面就能自动读写该目录。
 *
 * 因此职责划分是：
 *   localStorage  = 工作副本（即时、全浏览器可用、离线可用）
 *   数据文件夹     = 落盘真身（用户可见的 JSON，可用其它工具处理）
 * 两者内容不一致时绝不静默覆盖，一律弹窗让用户决定。
 *
 * 局限（已知且无法绕过）：
 *   - 仅 Chromium 系（Chrome / Edge）支持，其余浏览器此卡片显示为不可用
 *   - 首次必须手点一次授权；浏览器重启后可能需要重新授权
 *   - 出于隐私，浏览器不暴露完整路径，只能拿到文件夹名
 */
var KG = window.KG || (window.KG = {});

(function () {
  'use strict';

  var DB_NAME = 'kaogong_fs';
  var DB_VERSION = 1;
  var STORE = 'handles';
  var HANDLE_KEY = 'dataDir';
  var FILE_NAME = 'kaogong_data.json';
  var APP_NAME = '考公练习追踪看板';

  var st = {
    supported: typeof window.showDirectoryPicker === 'function',
    // 目录授权要求安全上下文：file:// 和 https:// 都算，纯 http（非 localhost）不算。
    // 浏览器在这种情况下干脆不提供 showDirectoryPicker，需据此给出准确的提示。
    secure: window.isSecureContext !== false,
    handle: null,
    permission: 'unknown',      // granted | prompt | denied | unknown
    lastWriteAt: null,
    lastError: '',              // 真正的操作失败（绑定 / 写入 / 读取）
    persistWarning: '',         // 句柄存不下或读不回：不影响本次会话，只是刷新后要重新授权
    lastAction: ''
  };
  var listeners = [];

  function status() {
    return {
      supported: st.supported,
      secure: st.secure,
      bound: !!st.handle,
      dirName: st.handle ? st.handle.name : '',
      permission: st.permission,
      fileName: FILE_NAME,
      lastWriteAt: st.lastWriteAt,
      lastError: st.lastError,
      persistWarning: st.persistWarning,
      lastAction: st.lastAction
    };
  }

  function notify() { listeners.forEach(function (fn) { try { fn(status()); } catch (e) {} }); }
  function onChange(fn) { listeners.push(fn); }

  /* ---------------- IndexedDB：持久化目录句柄 ---------------- */

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB 不可用'));
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB 打开失败')); };
    });
  }

  function idb(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var req = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { resolve(req ? req.result : undefined); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('事务中断')); };
      });
    });
  }

  /* ---------------- 数据载荷与签名 ---------------- */

  /** 写入磁盘的内容（与「数据备份」的 JSON 结构一致） */
  function payloadOf(appState, withStamp) {
    var p = {
      app: APP_NAME,
      version: appState.version,
      settings: appState.settings,
      targets: appState.targets,
      timePlan: appState.timePlan,
      records: appState.records
    };
    if (withStamp) p.exportedAt = new Date().toISOString();
    return p;
  }

  /** 用于内容比对：排除每次写入都会变的 exportedAt */
  function signature(payload) {
    if (!payload || typeof payload !== 'object') return '';
    return JSON.stringify({
      version: payload.version === undefined ? null : payload.version,
      settings: payload.settings || null,
      targets: payload.targets || null,
      timePlan: payload.timePlan || null,
      records: payload.records || null
    });
  }

  /* ---------------- 读写 ---------------- */

  async function writeFileText(text) {
    var fh = await st.handle.getFileHandle(FILE_NAME, { create: true });
    var w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }

  /** 文件不存在返回 null；其它错误抛出 */
  async function readFileText() {
    try {
      var fh = await st.handle.getFileHandle(FILE_NAME);
      var file = await fh.getFile();
      return await file.text();
    } catch (e) {
      if (e && e.name === 'NotFoundError') return null;
      throw e;
    }
  }

  async function currentPermission(interactive) {
    if (!st.handle) return 'unknown';
    try {
      var opts = { mode: 'readwrite' };
      var q = await st.handle.queryPermission(opts);
      if (q === 'granted') return 'granted';
      if (!interactive) return q;
      return await st.handle.requestPermission(opts);   // 需要用户手势
    } catch (e) {
      return 'unknown';
    }
  }

  /* ---------------- 对外操作 ---------------- */

  /** 启动时尝试恢复已绑定的目录（不弹授权，只查权限） */
  async function init() {
    if (!st.supported) { notify(); return status(); }
    try {
      var handle = await idb('readonly', function (s) { return s.get(HANDLE_KEY); });
      if (handle) {
        st.handle = handle;
        st.permission = await currentPermission(false);
      }
    } catch (e) {
      // 不是操作失败，只是记不住句柄：本次会话仍可正常绑定使用
      st.persistWarning = '浏览器未能提供本地数据库（' + (e && e.name || 'IndexedDB') +
        '），本次会话可正常使用，但刷新页面后需要重新授权一次。';
    }
    notify();
    return status();
  }

  /** 用户点击 → 选择目录 → 记住句柄 → 立刻写入一次 */
  async function bind(appState) {
    st.lastError = '';
    st.persistWarning = '';
    if (!st.supported) {
      st.lastError = '当前浏览器不支持目录授权（仅 Chrome / Edge 支持）。';
      notify();
      return { ok: false, error: st.lastError };
    }
    var handle;
    try {
      handle = await window.showDirectoryPicker({ id: 'kaogong-data', mode: 'readwrite', startIn: 'documents' });
    } catch (e) {
      // 用户自己取消不算错误，不弹报错
      if (e && e.name === 'AbortError') {
        st.lastAction = '已取消选择';
        notify();
        return { ok: false, cancelled: true };
      }
      st.lastError = '目录授权失败：' + (e && e.name ? e.name : '') + ' ' + (e && e.message || '');
      notify();
      return { ok: false, error: st.lastError };
    }

    st.handle = handle;
    st.permission = await currentPermission(true);
    if (st.permission !== 'granted') {
      st.lastError = '未获得读写权限（当前：' + st.permission + '）。';
      notify();
      return { ok: false, error: st.lastError };
    }

    try {
      await idb('readwrite', function (s) { return s.put(handle, HANDLE_KEY); });
      st.persistWarning = '';
    } catch (e) {
      // 句柄存不下不影响本次使用，只是刷新后要重新授权
      st.persistWarning = '目录句柄未能保存（' + (e && e.name || 'IndexedDB 不可用') +
        '），本次会话可正常自动写入，但刷新页面后需要重新授权一次。';
    }

    var res = await write(appState);
    st.lastAction = res.ok ? '已绑定并写入' : '已绑定，但写入失败';
    notify();
    return res;
  }

  /** 写入当前数据（每次改动后自动调用） */
  async function write(appState) {
    if (!st.handle || st.permission !== 'granted') return { ok: false, skipped: true };
    try {
      var text = JSON.stringify(payloadOf(appState, true), null, 2);
      await writeFileText(text);
      st.lastWriteAt = new Date().toISOString();
      st.lastError = '';
      notify();
      return { ok: true };
    } catch (e) {
      st.lastError = '写入失败：' + (e && e.name ? e.name + ' ' : '') + (e && e.message || '');
      notify();
      return { ok: false, error: st.lastError };
    }
  }

  /** 读取文件内容，返回 { payload, text, signature }；文件不存在返回 null */
  async function readPayload() {
    if (!st.handle || st.permission !== 'granted') return null;
    var text = await readFileText();
    if (text === null) return null;
    var payload = JSON.parse(text);          // 解析失败由调用方捕获
    return { payload: payload, text: text, signature: signature(payload) };
  }

  /** 供启动时比对用 */
  function localSignature(appState) { return signature(payloadOf(appState, false)); }

  async function requestPermissionInteractive() {
    if (!st.handle) return 'unknown';
    st.permission = await currentPermission(true);
    notify();
    return st.permission;
  }

  async function unbind() {
    st.handle = null;
    st.permission = 'unknown';
    st.lastWriteAt = null;
    st.lastAction = '已解绑';
    try { await idb('readwrite', function (s) { return s.delete(HANDLE_KEY); }); } catch (e) {}
    notify();
  }

  KG.FileStore = {
    FILE_NAME: FILE_NAME,
    payloadOf: payloadOf,
    signature: signature,
    localSignature: localSignature,
    isSupported: function () { return st.supported; },
    status: status,
    onChange: onChange,
    init: init,
    bind: bind,
    write: write,
    readPayload: readPayload,
    requestPermission: requestPermissionInteractive,
    unbind: unbind
  };
})();
