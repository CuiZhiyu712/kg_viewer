/* 飞书版增量代码 —— 运行时叠加在原版之上，不修改 src/ 里的任何文件。
 *
 * 加了三样东西：
 *   1. 「导出 CSV」按钮：把记录拍平成「一行 = 一套卷」的平表，
 *      可直接导入飞书多维表格（原版的 xlsx 是 5 行一块的纵向结构，导不进去）
 *   2. 飞书 WebView 适配：安全区域、禁止下拉回弹、撑满高度
 *   3. 标题标注为「飞书版」，便于确认加载的是哪一份
 */
(function () {
  'use strict';

  var KG = window.KG;
  if (!KG || !KG.Model || !KG.Utils) return;

  var U = KG.Utils;
  var M = KG.Model;

  /* ==================== 平表 CSV ==================== */

  function numOrBlank(v) {
    var n = U.toNumber(v);
    return n === null ? '' : n;
  }

  /** RFC4180：含逗号/引号/换行的字段加引号，内部引号翻倍 */
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /**
   * 列定义：基础信息 → 每个模块（5 列）→ 该模块的子模块（4 列）→ 整套卷汇总
   * 缺失值一律空字符串，不能写「无」「—」，否则多维表格会当成文本。
   */
  function flatColumnDefs() {
    var defs = [];
    function add(label, fn) { defs.push({ label: label, val: fn }); }

    add('日期', function (r) { return r.date || ''; });
    add('试卷', function (r) { return r.paperName || ''; });
    add('分数', function (r) { return numOrBlank(r.score); });
    add('平均分', function (r) { return numOrBlank(r.averageScore); });
    add('击败比(%)', function (r) { return numOrBlank(r.defeatRate); });

    M.MODULES.forEach(function (mod) {
      var k = mod.key;
      function m(r) { return (r.modules && r.modules[k]) || {}; }

      add(mod.name + '题数', function (r) { return numOrBlank(m(r).questions); });
      add(mod.name + '正确数', function (r) { return numOrBlank(m(r).correct); });
      add(mod.name + '正确率(%)', function (r) {
        return numOrBlank(U.calcAccuracy(m(r).questions, m(r).correct));
      });
      add(mod.name + '平均正确率(%)', function (r) { return numOrBlank(m(r).avgAccuracy); });
      add(mod.name + '用时(分钟)', function (r) { return numOrBlank(m(r).time); });

      var subs = M.SUBMODULES[k];
      if (!subs) return;
      subs.forEach(function (s) {
        function sm(r) {
          var mm = m(r);
          return (mm.subModules && mm.subModules[s.key]) || {};
        }
        add(s.name + '题数', function (r) { return numOrBlank(sm(r).questions); });
        add(s.name + '正确数', function (r) { return numOrBlank(sm(r).correct); });
        add(s.name + '正确率(%)', function (r) {
          return numOrBlank(U.calcAccuracy(sm(r).questions, sm(r).correct));
        });
        add(s.name + '用时(分钟)', function (r) { return numOrBlank(sm(r).time); });
      });
    });

    add('总题数', function (r) { return numOrBlank(r.total ? r.total.questions : null); });
    add('总正确数', function (r) { return numOrBlank(r.total ? r.total.correct : null); });
    add('总正确率(%)', function (r) { return numOrBlank(r.total ? r.total.accuracy : null); });
    add('总用时(分钟)', function (r) { return numOrBlank(r.total ? r.total.time : null); });

    return defs;
  }

  /** 带 UTF-8 BOM：否则 Excel / 飞书导入时中文会乱码 */
  function buildCsv(records) {
    var defs = flatColumnDefs();
    var lines = [defs.map(function (d) { return csvCell(d.label); }).join(',')];
    var list = KG.Stats ? KG.Stats.sortedAsc(records) : records.slice();

    list.forEach(function (r) {
      lines.push(defs.map(function (d) {
        var v = '';
        try { v = d.val(r); } catch (e) { v = ''; }
        return csvCell(v);
      }).join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  function exportCsv() {
    var state = KG.App && KG.App.state;
    var records = (state && state.records) || [];
    if (!records.length) {
      KG.UI.toast('还没有记录，先新增或导入套卷后再导出。', 'warn');
      return;
    }
    var csv = buildCsv(records);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    U.downloadBlob(blob, '考公套卷-平表-' + U.today() + '.csv');
    KG.UI.toast('已导出平表 CSV（' + records.length + ' 条）。可直接导入飞书多维表格。', 'success', 4500);
  }

  /* ==================== 飞书 WebView 适配 ==================== */

  /* 立刻注入样式：app.js 在 DOMContentLoaded 里会量页头高度算 Tab 吸顶偏移，
     样式必须在那之前生效，否则会按旧的页头高度算错。 */
  function injectStyles() {
    var vp = document.querySelector('meta[name="viewport"]');
    if (vp) vp.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');

    var css = [
      '/* 飞书版注入 */',
      'html, body { height: 100%; }',
      'body { overscroll-behavior: none; -webkit-text-size-adjust: 100%; }',
      '.app-header { padding-top: env(safe-area-inset-top); }',
      '.app-main { padding-bottom: calc(56px + env(safe-area-inset-bottom)); }',
      '.modal-backdrop { padding-top: calc(36px + env(safe-area-inset-top)); }'
    ].join('\n');
    var style = document.createElement('style');
    style.setAttribute('data-role', 'feishu-overlay');
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  /* ==================== 界面 ==================== */

  function injectButton() {
    var ref = document.getElementById('btn-export');
    if (!ref || document.getElementById('btn-export-csv')) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.id = 'btn-export-csv';
    btn.textContent = '导出 CSV';
    btn.title = '导出「一行 = 一套卷」的平表 CSV，可直接导入飞书多维表格或 Excel';
    btn.addEventListener('click', exportCsv);
    ref.insertAdjacentElement('afterend', btn);
  }

  function init() {
    document.title = '考公练习追踪看板 · 飞书版';
    injectButton();
    console.log('[飞书版] 增量已加载：平表 CSV 导出 + WebView 适配');
  }

  injectStyles();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
