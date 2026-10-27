/* excel-export.js —— records → Sheet1
 *
 * 核心函数 recordsToSheet1(records)：还原原始 Sheet1 的纵向块结构
 *   表头 2 行（一级/二级模块标题）+ 每套 5 行数据块（总题数/正确题数/正确率/平均正确率/用时）
 *
 * 取值优先级：
 *   1. record.raw —— 导入时的逐格快照，保证「未编辑过的记录」导出后与原始文件一致
 *      （含源表自身的脏数据 50%%、「无」、以及合计 76 与模块之和 81 这类不一致）
 *   2. 字段派生值 —— 表单新建/编辑过的记录（保存时会清掉 raw）走这条路，
 *      此时整套卷汇总按六大模块自动求和，数据自洽。
 */
var KG = window.KG || (window.KG = {});

(function () {
  'use strict';

  var U = KG.Utils;
  var M = KG.Model;
  var C = M.SHEET_COLS;

  var LABEL_COL = C.label;      // F
  var PCT_FMT = '0.00%';
  var DATE_FMT = 'yyyy/m/d';
  var INFO_COLS = ['A', 'B', 'C', 'D', 'E'];   // 只写在「正确题数」行

  function colIndex(letter) { return window.XLSX.utils.decode_col(letter); }

  /** 各 行标签 × 列位 的「字段派生值」 */
  function derivedValue(rec, labelKey, colLetter) {
    var mod, sub;

    function simpleOf(key) {
      var m = rec.modules[key];
      if (!m) return null;
      if (labelKey === 'questions') return m.questions;
      if (labelKey === 'correct') return m.correct;
      if (labelKey === 'accuracy') return m.accuracy === null ? null : m.accuracy / 100;
      if (labelKey === 'avgAccuracy') return m.avgAccuracy === null ? null : m.avgAccuracy / 100;
      if (labelKey === 'time') return m.time;
      return null;
    }

    // 基本信息的五列
    if (colLetter === C.date) return U.dateStringToSerial(rec.date);
    if (colLetter === C.paperName) return rec.paperName || '';
    if (colLetter === C.score) return rec.score;
    if (colLetter === C.averageScore) return rec.averageScore;
    if (colLetter === C.defeatRate) {
      return rec.defeatRate === null || rec.defeatRate === undefined ? null : rec.defeatRate / 100;
    }

    // 合计列
    if (colLetter === C.total) {
      if (labelKey === 'questions') return rec.total.questions;
      if (labelKey === 'correct') return rec.total.correct;
      if (labelKey === 'time') return rec.total.time;
      return null;
    }

    // 单列模块
    Object.keys(M.MODULE_COL).forEach(function (key) {
      if (M.MODULE_COL[key] === colLetter) mod = simpleOf(key);
    });
    if (mod !== undefined) return mod;

    // 分组模块的「总计」列
    Object.keys(M.GROUP_TOTAL_COL).forEach(function (key) {
      if (M.GROUP_TOTAL_COL[key] === colLetter) mod = simpleOf(key);
    });
    if (mod !== undefined) return mod;

    // 分组模块的子模块列
    Object.keys(M.SUB_COL).forEach(function (subKey) {
      if (M.SUB_COL[subKey] !== colLetter) return;
      var owner = null;
      M.MODULES.forEach(function (def) {
        if (M.SUBMODULES[def.key] && M.SUBMODULES[def.key].some(function (s) { return s.key === subKey; })) {
          owner = def.key;
        }
      });
      if (!owner) { sub = null; return; }
      var sm = rec.modules[owner].subModules[subKey];
      if (labelKey === 'questions') sub = sm.questions;
      else if (labelKey === 'correct') sub = sm.correct;
      else if (labelKey === 'accuracy') sub = sm.accuracy === null ? null : sm.accuracy / 100;
      else if (labelKey === 'avgAccuracy') sub = sm.avgAccuracy === null ? null : sm.avgAccuracy / 100;
      else if (labelKey === 'time') sub = sm.time;
      else sub = null;
    });
    if (sub !== undefined) return sub;

    return null;
  }

  function recordsToSheet1(records) {
    var XLSX = window.XLSX;

    /* ---- 表头两行 ---- */
    var row1 = new Array(20).fill(null);
    row1[colIndex('A')] = '日期';
    row1[colIndex('B')] = '试卷';
    row1[colIndex('C')] = '分数';
    row1[colIndex('D')] = '平均分';
    row1[colIndex('E')] = '击败比';
    row1[colIndex('F')] = '模块';
    row1[colIndex('G')] = '合计';
    row1[colIndex('H')] = '政治理论';
    row1[colIndex('I')] = '常识';
    row1[colIndex('J')] = '言语理解';
    row1[colIndex('N')] = '数量';
    row1[colIndex('O')] = '判断推理';
    row1[colIndex('T')] = '资料分析';

    var row2 = new Array(20).fill(null);
    row2[colIndex('J')] = '逻辑填空';
    row2[colIndex('K')] = '片段阅读';
    row2[colIndex('L')] = '语句表达';
    row2[colIndex('M')] = '总计';
    row2[colIndex('O')] = '图形推理';
    row2[colIndex('P')] = '定义判断';
    row2[colIndex('Q')] = '类比推理';
    row2[colIndex('R')] = '逻辑判断';
    row2[colIndex('S')] = '总计';

    var aoa = [row1, row2];

    /* ---- 每套卷 5 行数据块 ---- */
    var pctCells = [];    // 需要套百分比格式的单元格
    var dateCells = [];   // 需要套日期格式的单元格

    records.forEach(function (rec) {
      var raw = rec.raw || null;
      var blockStart = aoa.length;                 // 0-based 行下标

      M.ROW_ORDER.forEach(function (labelKey, offset) {
        var label = M.ROW_LABELS[labelKey];
        var arr = new Array(20).fill(null);
        arr[colIndex(LABEL_COL)] = label;

        for (var letterIdx = 0; letterIdx < 20; letterIdx++) {
          var letter = XLSX.utils.encode_col(letterIdx);
          if (letter === LABEL_COL) continue;

          var v = null;
          if (letter === C.date) {
            // 日期永远由 date 字段重建为真日期序列号（原表 A 列竖跨合并，值在数据行）
            if (labelKey === 'correct') {
              v = U.dateStringToSerial(rec.date);
              if (v !== null) dateCells.push({ r: blockStart + offset, c: letterIdx });
            }
          } else if (INFO_COLS.indexOf(letter) >= 0 && labelKey !== 'correct') {
            v = null;   // 试卷/分数/平均分/击败比只写在「正确题数」行，与原表一致
          } else if (raw && raw[label] && Object.prototype.hasOwnProperty.call(raw[label], letter)) {
            v = raw[label][letter];                  // 1. 原样还原导入快照
          } else {
            v = derivedValue(rec, labelKey, letter); // 2. 字段派生
          }
          if (v === undefined) v = null;
          arr[letterIdx] = v;

          // 百分比语义的列：套上百分比格式，保证导出文件在 Excel 里显示正确
          var isPct = (letter === C.defeatRate && labelKey === 'correct') ||
                      ((labelKey === 'accuracy' || labelKey === 'avgAccuracy') &&
                        letterIdx >= colIndex('H'));
          if (isPct && typeof v === 'number') {
            pctCells.push({ r: blockStart + offset, c: letterIdx });
          }
        }
        aoa.push(arr);
      });
    });

    var ws = XLSX.utils.aoa_to_sheet(aoa);

    /* ---- 单元格格式 ---- */
    pctCells.forEach(function (p) {
      var addr = XLSX.utils.encode_cell({ r: p.r, c: p.c });
      if (ws[addr]) ws[addr].z = PCT_FMT;
    });
    dateCells.forEach(function (p) {
      var addr = XLSX.utils.encode_cell({ r: p.r, c: p.c });
      if (ws[addr]) ws[addr].z = DATE_FMT;
    });

    /* ---- 合并单元格：还原原表结构 ---- */
    var merges = [];
    ['A', 'B', 'C', 'D', 'E'].forEach(function (L) {
      merges.push({ s: { r: 0, c: colIndex(L) }, e: { r: 2, c: colIndex(L) } });   // 表头竖跨 3 行
    });
    ['F', 'G', 'H', 'I', 'N', 'T'].forEach(function (L) {
      merges.push({ s: { r: 0, c: colIndex(L) }, e: { r: 1, c: colIndex(L) } });   // 表头竖跨 2 行
    });
    merges.push({ s: { r: 0, c: colIndex('J') }, e: { r: 0, c: colIndex('M') } }); // 言语理解
    merges.push({ s: { r: 0, c: colIndex('O') }, e: { r: 0, c: colIndex('S') } }); // 判断推理

    for (var i = 0; i < records.length; i++) {
      var s = 2 + i * 5;
      // 原表为 A4:A7：基本信息从「正确题数」行（数据行）起竖跨 4 行，
      // 值必须落在合并区左上角，否则 Excel 打开时显示为空。
      ['A', 'B', 'C', 'D', 'E'].forEach(function (L) {
        merges.push({ s: { r: s + 1, c: colIndex(L) }, e: { r: s + 4, c: colIndex(L) } });
      });
    }
    ws['!merges'] = merges;

    /* ---- 列宽 ---- */
    var widths = { A: 12, B: 12, C: 8, D: 8, E: 9, F: 10, G: 8 };
    ws['!cols'] = [];
    for (var c2 = 0; c2 < 20; c2++) {
      var L2 = XLSX.utils.encode_col(c2);
      ws['!cols'].push({ wch: widths[L2] || 9 });
    }

    return ws;
  }

  /** records + 表头 → 完整工作簿（只含一个 Sheet「粉笔模考」） */
  function recordsToWorkbook(records, sheetName) {
    var XLSX = window.XLSX;
    var wb = XLSX.utils.book_new();
    var ws = recordsToSheet1(records);
    XLSX.utils.book_append_sheet(wb, ws, sheetName || '粉笔模考');
    return wb;
  }

  function exportXlsx(records, filename) {
    var wb = recordsToWorkbook(records);
    window.XLSX.writeFile(wb, filename || '套卷复盘.xlsx', { bookType: 'xlsx' });
  }

  /* ---------------- 自定义模版导出（多 sheet 简化表） ----------------
   * 默认模版走 Sheet1（上面那套）；自定义模版走简化表：
   *   行 1: 大模块名（跨子模块列合并；无子模块时占 1 列）
   *   行 2: 子模块名（无子模块时写大模块名）
   *   之后每套卷 5 行块：总题数 / 正确题数 / 正确率 / 平均正确率 / 用时
   *   前 5 列固定为 日期/试卷/分数/平均分/击败比，第 6 列起为模块列
   */
  function templateSheetFor(template, records) {
    var XLSX = window.XLSX;
    var mods = template.modules || [];
    // 列布局：A 日期 B 试卷 C 分数 D 平均分 E 击败比；F 起为模块列
    var colOffset = 5;
    // 计算每个模块占多少列、子模块起始列
    var layout = [];
    var cursor = colOffset;
    mods.forEach(function (mod) {
      var span = mod.hasSub ? (mod.subModules || []).length : 1;
      layout.push({ mod: mod, startCol: cursor, span: span });
      cursor += span;
    });
    var totalCols = cursor;

    var row1 = new Array(totalCols).fill(null);
    row1[0] = '日期'; row1[1] = '试卷'; row1[2] = '分数'; row1[3] = '平均分'; row1[4] = '击败比';
    var row2 = new Array(totalCols).fill(null);
    var merges = [];
    // A~E 跨 5 行块合并（与 Sheet1 一致），第 0~4 列在写数据时只在「正确题数」行赋值
    for (var i = 0; i < records.length; i++) {
      var s = 2 + i * 5;
      for (var L = 0; L < 5; L++) {
        merges.push({ s: { r: s, c: L }, e: { r: s + 3, c: L } });
      }
    }
    layout.forEach(function (item) {
      var mod = item.mod;
      if (mod.hasSub) {
        row1[item.startCol] = mod.name;
        // 跨子模块列合并（一行内的横向合并）
        if (item.span > 1) {
          merges.push({ s: { r: 0, c: item.startCol }, e: { r: 0, c: item.startCol + item.span - 1 } });
        }
        (mod.subModules || []).forEach(function (s, idx) {
          row2[item.startCol + idx] = s.name;
        });
      } else {
        // 无子模块：第 1 行写大模块名（与第 2 行合并）
        row1[item.startCol] = mod.name;
        row2[item.startCol] = mod.name;
        merges.push({ s: { r: 0, c: item.startCol }, e: { r: 1, c: item.startCol } });
      }
    });

    var ws = {};
    var R = 0;
    function setCell(r, c, v, fmt) {
      if (v === null || v === undefined) return;
      var addr = XLSX.utils.encode_cell({ r: r, c: c });
      var cell;
      if (typeof v === 'number') cell = { t: 'n', v: v };
      else cell = { t: 's', v: String(v) };
      if (fmt) cell.z = fmt;
      ws[addr] = cell;
    }
    for (var c1 = 0; c1 < totalCols; c1++) {
      setCell(0, c1, row1[c1]);
      setCell(1, c1, row2[c1]);
    }

    // 每套卷 5 行块
    var DATA_ROWS = ['总题数', '正确题数', '正确率', '平均正确率', '用时'];
    records.forEach(function (rec, idx) {
      var baseR = 2 + idx * 5;
      // 基本信息写在「正确题数」行（baseR + 1）
      setCell(baseR + 1, 0, U.dateStringToSerial(rec.date), DATE_FMT);
      setCell(baseR + 1, 1, rec.paperName || '');
      setCell(baseR + 1, 2, rec.score);
      setCell(baseR + 1, 3, rec.averageScore);
      setCell(baseR + 1, 4, rec.defeatRate === null ? null : rec.defeatRate / 100, PCT_FMT);

      // 行标签写在 F... 但这里 F 是模块列了。把行标签塞进第 0 列（日期列）的其它行
      // 简化表设计：行标签独立写成一列（用最后一列做标签），避免占日期列。
      // 这里改用第 totalCols 列作为标签列（追加在末尾）
      // —— 但为了不破坏 5 行块结构，干脆不写行标签，靠行序约定（1=总题数 2=正确题数 ...）
      // 这与 Sheet1 的「F 列写行标签」不同，但简洁。
      layout.forEach(function (item) {
        var mod = item.mod;
        var modData = (rec.modules && rec.modules[mod.key]) || {};
        if (mod.hasSub) {
          (mod.subModules || []).forEach(function (s, idx) {
            var sm = (modData.subModules && modData.subModules[s.key]) || {};
            var col = item.startCol + idx;
            setCell(baseR + 0, col, sm.questions);
            setCell(baseR + 1, col, sm.correct);
            setCell(baseR + 2, col, sm.accuracy === null ? null : sm.accuracy / 100, PCT_FMT);
            setCell(baseR + 3, col, sm.avgAccuracy === null ? null : sm.avgAccuracy / 100, PCT_FMT);
            setCell(baseR + 4, col, sm.time);
          });
        } else {
          var col = item.startCol;
          setCell(baseR + 0, col, modData.questions);
          setCell(baseR + 1, col, modData.correct);
          setCell(baseR + 2, col, modData.accuracy === null ? null : modData.accuracy / 100, PCT_FMT);
          setCell(baseR + 3, col, modData.avgAccuracy === null ? null : modData.avgAccuracy / 100, PCT_FMT);
          setCell(baseR + 4, col, modData.time);
        }
      });
    });

    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 1 + records.length * 5, c: totalCols - 1 } });
    ws['!merges'] = merges;
    ws['!cols'] = [];
    for (var cc = 0; cc < totalCols; cc++) {
      var letter = XLSX.utils.encode_col(cc);
      ws['!cols'].push({ wch: (cc < 5 ? [12, 14, 8, 8, 9][cc] : 9) });
    }
    return ws;
  }

  /** 把所有自定义模版的 records 各自导出成一个 sheet */
  function exportCustomTemplates(templates, allRecords, filename) {
    var XLSX = window.XLSX;
    var wb = XLSX.utils.book_new();
    var any = false;
    (templates || []).forEach(function (tpl) {
      if (tpl.isDefault) return;
      var recs = allRecords.filter(function (r) { return (r.templateId || 'default') === tpl.id; });
      if (!recs.length) return;
      var ws = templateSheetFor(tpl, recs);
      var sheetName = (tpl.name || '自定义模版').slice(0, 28);
      // 防止重名
      var unique = sheetName, n = 2;
      while (wb.SheetNames.indexOf(unique) >= 0) { unique = sheetName.slice(0, 25) + '_' + (n++); }
      XLSX.utils.book_append_sheet(wb, ws, unique);
      any = true;
    });
    if (!any) return false;
    window.XLSX.writeFile(wb, filename || '自定义模版套卷.xlsx', { bookType: 'xlsx' });
    return true;
  }

  KG.Export = {
    recordsToSheet1: recordsToSheet1,
    recordsToWorkbook: recordsToWorkbook,
    exportXlsx: exportXlsx,
    templateSheetFor: templateSheetFor,
    exportCustomTemplates: exportCustomTemplates
  };
})();
