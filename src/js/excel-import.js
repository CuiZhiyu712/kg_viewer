/* excel-import.js —— Sheet1 → records
 *
 * 核心函数 parseSheet1ToRecords(sheet)：见 KG.Import.recordsFromSheet
 *
 * 只解析第一个 Sheet（workbook.SheetNames[0]），其余 Sheet 一律忽略。
 *
 * Sheet1 是纵向块结构，不能把每一行当成一条记录：
 *   第 n+0 行  总题数      （列 F 为行标签）
 *   第 n+1 行  正确题数    ← 同时承载 日期/试卷/分数/平均分/击败比
 *   第 n+2 行  正确率
 *   第 n+3 行  平均正确率  （历史统计，本项目仅原样保留，不参与计算）
 *   第 n+4 行  用时
 * 一套套卷占一个 5 行数据块，块的数量动态识别（不写死只有 1 套）。
 */
var KG = window.KG || (window.KG = {});

(function () {
  'use strict';

  var U = KG.Utils;
  var M = KG.Model;
  var C = M.SHEET_COLS;

  /* ---------------- 单元格读取 ---------------- */

  function cellRaw(sheet, colLetter, a1Row) {
    var c = sheet[colLetter + a1Row];
    if (!c) return null;
    var v = c.v;
    if (v === undefined || v === null) return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    return v;
  }

  function labelKeyOf(text) {
    if (typeof text !== 'string') return null;
    var s = text.trim();
    for (var i = 0; i < M.ROW_ORDER.length; i++) {
      var k = M.ROW_ORDER[i];
      if (M.ROW_LABELS[k] === s) return k;
    }
    return null;
  }

  function rangeOf(sheet) {
    if (sheet['!ref']) return window.XLSX.utils.decode_range(sheet['!ref']);
    // 兜底：没有 !ref 时自己扫一遍
    var maxR = 0, maxC = 0;
    Object.keys(sheet).forEach(function (addr) {
      if (addr[0] === '!') return;
      var d = window.XLSX.utils.decode_cell(addr);
      if (d.r > maxR) maxR = d.r;
      if (d.c > maxC) maxC = d.c;
    });
    return { s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } };
  }

  /* ---------------- 数据块识别 ---------------- */

  /** 按列 F 的行标签把工作表切成若干 5 行数据块 */
  function findBlocks(sheet) {
    var range = rangeOf(sheet);
    var labelRows = [];
    for (var r = range.s.r; r <= range.e.r; r++) {
      var a1Row = r + 1;
      var key = labelKeyOf(cellRaw(sheet, C.label, a1Row));
      if (key) labelRows.push({ row: a1Row, key: key });
    }

    var blocks = [];
    var cur = null;
    labelRows.forEach(function (lr) {
      // 遇到「总题数」或行号不连续，开一个新块
      if (lr.key === 'questions' || !cur || (lr.row - cur.endRow) > 1) {
        cur = { start: lr.row, endRow: lr.row, rows: {} };
        blocks.push(cur);
      }
      cur.rows[lr.key] = lr.row;
      if (lr.row > cur.endRow) cur.endRow = lr.row;
    });

    // 兜底：完全没有行标签列（列 F 为空）时，按「日期所在行前一行=总题数」推断固定 5 行块
    if (!blocks.length) {
      for (var r2 = range.s.r; r2 <= range.e.r; r2++) {
        var a1 = r2 + 1;
        if (U.toDateString(cellRaw(sheet, C.date, a1))) {
          var b = { start: a1 - 1, endRow: a1 + 3, rows: {}, inferred: true };
          M.ROW_ORDER.forEach(function (k, idx) { b.rows[k] = b.start + idx; });
          blocks.push(b);
          r2 += 4;
        }
      }
    }
    return blocks;
  }

  /* ---------------- 单块 → 记录 ---------------- */

  function readBlock(sheet, block, warnings) {
    var rows = block.rows;
    var dataRow = rows.correct;                       // 正确题数行承载日期等基本信息
    if (!dataRow) dataRow = block.start + 1;

    var dateStr = U.toDateString(cellRaw(sheet, C.date, dataRow));
    var paperVal = cellRaw(sheet, C.paperName, dataRow);
    var paperName = paperVal === null ? '' : String(paperVal).trim();

    // 模板骨架（空行 / 只有标签没有数据）直接忽略
    if (!dateStr && !paperName) return null;

    if (!dateStr) warnings.push('第 ' + dataRow + ' 行的日期为空，已按空日期导入。');
    if (!paperName) warnings.push('第 ' + dataRow + ' 行的试卷名称为空，已按空名称导入。');

    function rowVal(labelKey, colLetter) {
      var row = rows[labelKey];
      if (!row) return null;
      return cellRaw(sheet, colLetter, row);
    }

    var rec = {
      id: U.uuid(),
      date: dateStr,
      paperName: paperName,
      score: U.toNumber(cellRaw(sheet, C.score, dataRow)),
      averageScore: U.toNumber(cellRaw(sheet, C.averageScore, dataRow)),
      defeatRate: U.toPercent(cellRaw(sheet, C.defeatRate, dataRow)),
      total: {
        questions: U.toCount(rowVal('questions', C.total)),
        correct: U.toCount(rowVal('correct', C.total)),
        time: U.toNumber(rowVal('time', C.total)),
        accuracy: null
      },
      modules: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    M.MODULES.forEach(function (def) {
      var key = def.key;
      var m = M.emptyModule(key);
      var subs = M.SUBMODULES[key];

      if (subs) {
        // 分组模块：子模块是数据来源，总计列先读进来作为「子模块全空」时的兜底
        var gCol = M.GROUP_TOTAL_COL[key];
        m.questions = U.toCount(rowVal('questions', gCol));
        m.correct = U.toCount(rowVal('correct', gCol));
        m.time = U.toNumber(rowVal('time', gCol));
        m.avgAccuracy = U.toPercent(rowVal('avgAccuracy', gCol));
        subs.forEach(function (s) {
          var col = M.SUB_COL[s.key];
          m.subModules[s.key] = {
            name: s.name,
            questions: U.toCount(rowVal('questions', col)),
            correct: U.toCount(rowVal('correct', col)),
            accuracy: null,
            avgAccuracy: U.toPercent(rowVal('avgAccuracy', col)),
            time: U.toNumber(rowVal('time', col))
          };
        });
      } else {
        var col2 = M.MODULE_COL[key];
        m.questions = U.toCount(rowVal('questions', col2));
        m.correct = U.toCount(rowVal('correct', col2));
        m.time = U.toNumber(rowVal('time', col2));
        m.avgAccuracy = U.toPercent(rowVal('avgAccuracy', col2));
      }
      rec.modules[key] = m;
    });

    rec.raw = snapshotRaw(sheet, block);
    return M.normalizeRecord(rec);
  }

  /** 逐格快照该数据块的原始值（日期列除外，导出时由 date 字段重新生成） */
  function snapshotRaw(sheet, block) {
    var range = rangeOf(sheet);
    var raw = {};
    var has = false;
    M.ROW_ORDER.forEach(function (k) {
      var row = block.rows[k];
      if (!row) return;
      var o = {};
      for (var c = range.s.c; c <= range.e.c; c++) {
        var colLetter = window.XLSX.utils.encode_col(c);
        if (colLetter === C.date) continue;
        var v = cellRaw(sheet, colLetter, row);
        if (v === null) continue;
        if (v instanceof Date) v = U.ymd(v);
        o[colLetter] = v;
        has = true;
      }
      if (Object.keys(o).length) raw[M.ROW_LABELS[k]] = o;
    });
    return has ? raw : null;
  }

  /* ---------------- 对外接口 ---------------- */

  /**
   * 刻意不用 cellDates:true：它会把日期单元格转成带时区/浮点误差的 Date 对象
   * （46284 -> 2026-09-18T15:59:17Z），导致日期整体差一天。
   * 保持数字序列号，由 Utils.serialToDateString 用 UTC 整数运算换算。
   */
  function readWorkbook(arrayBuffer) {
    return window.XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
  }

  function firstSheet(workbook) {
    if (!workbook || !workbook.SheetNames || !workbook.SheetNames.length) return null;
    // 严格只取第一个 Sheet，第二及以后一律不读
    return workbook.Sheets[workbook.SheetNames[0]];
  }

  /** Sheet1 → records。失败时抛出带中文提示的 Error。 */
  function recordsFromSheet(sheet) {
    if (!sheet) throw new Error('Excel 文件为空');
    var warnings = [];
    var blocks = findBlocks(sheet);
    if (!blocks.length) {
      throw new Error('无法识别该 Excel 的 Sheet1 结构。请确认使用的是“套卷复盘”模板。');
    }
    var records = [];
    var skipped = 0;
    blocks.forEach(function (b) {
      var rec = readBlock(sheet, b, warnings);
      if (rec) records.push(rec); else skipped++;
    });
    if (!records.length) {
      throw new Error('无法识别该 Excel 的 Sheet1 结构。请确认使用的是“套卷复盘”模板。');
    }
    return { records: records, warnings: warnings, skipped: skipped, blocks: blocks.length };
  }

  /** 整本工作簿 → records（只读第一个 Sheet） */
  function recordsFromWorkbook(workbook) {
    return recordsFromSheet(firstSheet(workbook));
  }

  /** 去重键：日期 + 试卷名称 */
  function dedupeKey(rec) {
    return (rec.date || '') + ' ' + U.normPaper(rec.paperName);
  }

  /** 分组模块在源表中的总计值与子模块之和是否不一致（用于导入提示） */
  function collectDataNotices(records) {
    var notices = [];
    records.forEach(function (rec) {
      var label = (rec.date || '(无日期)') + ' ' + (rec.paperName || '(无试卷名)');
      var diffs = M.totalMismatch(rec).map(function (d) { return '整套卷汇总：' + d; });
      M.MODULES.forEach(function (def) {
        if (!M.SUBMODULES[def.key]) return;
        M.groupMismatch(rec, def.key).forEach(function (d) {
          diffs.push(def.name + '：' + d);
        });
      });
      if (diffs.length) notices.push({ record: label, diffs: diffs });
    });
    return notices;
  }

  KG.Import = {
    readWorkbook: readWorkbook,
    firstSheet: firstSheet,
    recordsFromSheet: recordsFromSheet,
    recordsFromWorkbook: recordsFromWorkbook,
    dedupeKey: dedupeKey,
    collectDataNotices: collectDataNotices,
    findBlocks: findBlocks
  };
})();
