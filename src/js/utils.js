/* utils.js —— 通用工具：DOM、格式化、数值/百分比/日期归一化、UUID、下载 */
var KG = window.KG || (window.KG = {});

(function () {
  'use strict';

  var U = {};

  /* ---------------- DOM ---------------- */
  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };
  U.escapeHtml = function (s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  U.setHtml = function (node, html) { if (node) node.innerHTML = html; };

  /* ---------------- 数值归一化 ---------------- */

  // 空值 / 缺失值标记：无、None、-、/ 等一律视为 null
  var NULL_TOKENS = /^(无|无数据|暂无|空|none|null|nil|na|n\/a|nan|-|—|–|--|\/|·|\\|\?)+$/i;

  U.isNullToken = function (v) {
    if (v === null || v === undefined) return true;
    if (typeof v === 'string') {
      var s = v.trim();
      return s === '' || NULL_TOKENS.test(s.replace(/\s/g, ''));
    }
    return false;
  };

  /**
   * 把 Excel 里的「正确率 / 击败比」类数值统一成 0~100 的百分数值。
   *  - 0.594     -> 59.4
   *  - 1         -> 100
   *  - '50%%'    -> 50      （源表存在重复百分号的脏数据）
   *  - '50%'     -> 50
   *  - '无'      -> null
   *  - 57.15     -> 57.15
   */
  U.toPercent = function (v) {
    if (U.isNullToken(v)) return null;
    if (typeof v === 'number') {
      if (!isFinite(v)) return null;
      return v <= 1 ? U.round(v * 100, 4) : U.round(v, 4);
    }
    if (typeof v === 'string') {
      var raw = v.trim();
      var hasSign = /[%％]/.test(raw);
      var s = raw.replace(/[%％\s]/g, '');
      if (s === '') return null;
      var n = parseFloat(s);
      if (!isFinite(n)) return null;
      // 带百分号：数值本身就是百分点；不带百分号：按 Excel 小数习惯判断
      return hasSign ? U.round(n, 4) : (Math.abs(n) <= 1 ? U.round(n * 100, 4) : U.round(n, 4));
    }
    return null;
  };

  /** 普通数值：'无' 之类返回 null */
  U.toNumber = function (v) {
    if (U.isNullToken(v)) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var n = parseFloat(String(v).replace(/[%％\s,，]/g, ''));
    return isFinite(n) ? n : null;
  };

  /** 非负整数（题数、用时），缺失返回 null */
  U.toCount = function (v) {
    var n = U.toNumber(v);
    if (n === null) return null;
    if (n < 0) n = 0;
    return Math.round(n * 100) / 100;
  };

  U.round = function (n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return null;
    var f = Math.pow(10, digits === undefined ? 2 : digits);
    return Math.round(n * f) / f;
  };

  /** 正确率 = 正确题数 / 总题数 * 100；总题数为 0/空时返回 null（绝不产生 NaN / Infinity） */
  U.calcAccuracy = function (questions, correct) {
    var q = U.toNumber(questions);
    var c = U.toNumber(correct);
    if (q === null || c === null || q <= 0) return null;
    if (c < 0) c = 0;
    return U.round((c / q) * 100, 2);
  };

  /* ---------------- 日期归一化 ---------------- */

  U.pad2 = function (n) { return n < 10 ? '0' + n : String(n); };

  /** Date -> 'YYYY-MM-DD'（按本地时区取值，适用于手工构造的 Date） */
  U.ymd = function (d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate());
  };

  var EPOCH_UTC = Date.UTC(1899, 11, 30);   // Excel 序列号 0 对应的日期 UTC 毫秒
  var DAY_MS = 86400000;

  /**
   * Excel 序列号 -> 'YYYY-MM-DD'
   * 全程用 UTC 整数运算，不受本地时区影响。
   * （SheetJS 的 cellDates:true 会把 46284 变成 2026-09-18T15:59:17Z，
   *   本地取值后整体差一天，所以这里不使用 Date 对象解析。）
   */
  U.serialToDateString = function (n) {
    var num = U.toNumber(n);
    if (num === null) return '';
    var d = new Date(EPOCH_UTC + Math.round(num) * DAY_MS);
    return d.getUTCFullYear() + '-' + U.pad2(d.getUTCMonth() + 1) + '-' + U.pad2(d.getUTCDate());
  };

  /** 'YYYY-MM-DD' -> Excel 序列号（导出时写回真正的日期单元格用） */
  U.dateStringToSerial = function (s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s === null || s === undefined ? '' : s).trim());
    if (!m) return null;
    return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH_UTC) / DAY_MS);
  };

  /**
   * Excel 日期归一化为 'YYYY-MM-DD'。
   * 兼容 Date 对象、Excel 序列号、'2026/9/19'、'2026.9.19'、'2026-09-19 00:00:00'。
   */
  U.toDateString = function (v) {
    if (U.isNullToken(v)) return '';
    if (typeof v === 'number' && isFinite(v)) return U.serialToDateString(v);
    if (v instanceof Date) return U.ymd(v);
    var s = String(v).trim();
    var m = s.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
    if (m) return m[1] + '-' + U.pad2(parseInt(m[2], 10)) + '-' + U.pad2(parseInt(m[3], 10));
    var d = new Date(s);
    return isNaN(d.getTime()) ? '' : U.ymd(d);
  };

  /* ---------------- 展示格式化 ---------------- */

  /**
   * 去掉数字字符串末尾多余的 0，但绝不碰整数位。
   * 必须只在存在小数点时裁剪：直接对 '130' 用 /0+$/ 会得到 '13'。
   */
  U.trimNum = function (s) {
    if (s.indexOf('.') < 0) return s;
    return s.replace(/0+$/, '').replace(/\.$/, '');
  };

  /** 百分数展示：59.4 -> '59.4%'；100 -> '100%'；null -> '—' */
  U.fmtPct = function (v, digits) {
    var n = U.toNumber(v);
    if (n === null) return '—';
    var d = digits === undefined ? 2 : digits;
    return U.trimNum(U.round(n, d).toFixed(d)) + '%';
  };

  /** 数字展示：130 -> '130'（不被截成 13）；58.50 -> '58.5'；null -> '—' */
  U.fmtNum = function (v, digits) {
    var n = U.toNumber(v);
    if (n === null) return '—';
    var d = digits === undefined ? 1 : digits;
    return U.trimNum(U.round(n, d).toFixed(d));
  };

  U.fmtTime = function (v) {
    var n = U.toNumber(v);
    if (n === null) return '—';
    return U.fmtNum(n, 1) + ' 分钟';
  };

  /** 状态色：ok 达标 / warn 还需努力 / bad 未达标 / none 无数据 */
  U.statusOf = function (value, target, warning) {
    var v = U.toNumber(value);
    var t = U.toNumber(target);
    var w = U.toNumber(warning);
    if (v === null) return { key: 'none', text: '无数据' };
    if (t !== null && v >= t) return { key: 'ok', text: '达标' };
    if (w !== null && v >= w) return { key: 'warn', text: '还需努力' };
    if (t === null && w === null) return { key: 'none', text: '无数据' };
    return { key: 'bad', text: '未达标' };
  };

  /* ---------------- UUID ---------------- */

  /** 优先 crypto.randomUUID；file:// 或旧环境下退化到 RFC4122 v4 实现 */
  U.uuid = function () {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (e) { /* 忽略，走兜底 */ }
    var bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = [];
    for (var j = 0; j < 16; j++) hex.push((bytes[j] + 0x100).toString(16).slice(1));
    return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
      hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('');
  };

  /* ---------------- 文件下载 ---------------- */

  U.downloadBlob = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 300);
  };

  U.today = function () { return U.ymd(new Date()); };

  /** 'YYYY-MM-DD' -> 可比较的时间戳；空值排到最后由调用方处理 */
  U.dateValue = function (s) {
    if (!s) return NaN;
    var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  };

  /** 归一化试卷名称用于去重/搜索：去空格、全角转半角、去「第/季」等噪声之外保持原样 */
  U.normPaper = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .trim()
      .replace(/[\s　]+/g, '')
      .toLowerCase();
  };

  KG.Utils = U;
})();
