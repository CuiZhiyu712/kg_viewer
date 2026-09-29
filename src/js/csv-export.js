/* csv-export.js —— 平表 CSV 导出（一行 = 一套卷）
 *
 * 用途：Excel 模板是「5 行一块」的纵向结构，导入多维表格 / 数据库类工具会变成
 * 一堆垃圾；这里拍平成一行一记录，可直接导入飞书多维表格或 Excel。
 * 缺失值输出空字符串（不写「无」「—」，否则会被当成文本）。
 */
var KG = window.KG || (window.KG = {});

(function () {
  'use strict';

  var U = KG.Utils;
  var M = KG.Model;

  function numOrBlank(v) {
    var n = U.toNumber(v);
    return n === null ? '' : n;
  }

  /** RFC4180：含逗号/引号/换行的字段要加引号，内部引号翻倍 */
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /**
   * 列顺序：基础信息 → 每个模块（5 列）→ 该模块的子模块（4 列）→ 整套卷汇总
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

  /** records -> 平表 CSV 文本（带 UTF-8 BOM，Excel / 飞书才不会中文乱码） */
  function recordsToFlatCsv(records) {
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

  function exportFlatCsv(records, filename) {
    var blob = new Blob([recordsToFlatCsv(records)], { type: 'text/csv;charset=utf-8' });
    U.downloadBlob(blob, filename || ('考公套卷-平表-' + U.today() + '.csv'));
  }

  KG.CsvExport = {
    recordsToFlatCsv: recordsToFlatCsv,
    exportFlatCsv: exportFlatCsv
  };
})();
