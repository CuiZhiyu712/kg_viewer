/* app.js —— 应用装配：状态、事件、导入导出、备份恢复 */
var KG = window.KG || (window.KG = {});

(function () {
  'use strict';

  var U = KG.Utils;
  var M = KG.Model;
  var S = KG.Stats;
  var Store = KG.Store;
  var UI = KG.UI;

  var state = {
    version: Store.VERSION,
    settings: Store.defaultSettings(),
    targets: Store.defaultTargets(),
    timePlan: Store.defaultTimePlan(),
    records: [],
    updatedAt: '',
    activeTab: 'records',
    filter: { keyword: '', dateFrom: '', dateTo: '', sortKey: 'date', sortDir: 'desc' },
    chartFilter: { score: 'all', module: 'all', time: 'total', statsModule: 'all', timeAnalysis: 'total' },
    libs: { xlsx: false, echarts: false }
  };

  var PANEL_IDS = {
    records: 'panel-records',
    stats: 'panel-stats',
    trend: 'panel-trend',
    time: 'panel-time'
  };

  function activePanelId() {
    return PANEL_IDS[state.activeTab] || 'panel-records';
  }

  function persist() {
    var ok = Store.save(state);
    if (!ok) {
      UI.toast('数据无法写入浏览器本地存储，本次修改在刷新后会丢失（可能处于隐私模式或禁用了本地存储）。', 'error', 6000);
    }
    syncToFile();     // 已绑定数据文件夹时顺带落盘
    return ok;
  }

  /* ==================== 数据文件夹 ==================== */

  var FS = KG.FileStore;
  var lastFsError = '';

  /** 每次数据变更后自动写入数据文件（未绑定或未授权时静默跳过） */
  function syncToFile() {
    if (!FS || !FS.isSupported()) return;
    var s = FS.status();
    if (!s.bound || s.permission !== 'granted') return;
    FS.write(state).then(function (r) {
      if (!r.ok && r.error && r.error !== lastFsError) {
        lastFsError = r.error;
        UI.toast('写入数据文件失败：' + r.error, 'error', 6000);
      }
    });
  }

  /** 用文件内容替换浏览器本地数据 */
  function applyFilePayload(payload, fileName) {
    var merged = Store.migrate({
      version: payload.version,
      settings: payload.settings,
      targets: payload.targets,
      records: payload.records
    });
    merged.records.forEach(function (r) {
      if (!r.id) r.id = U.uuid();
      M.normalizeRecord(r);
    });
    state.settings = merged.settings;
    state.targets = merged.targets;
    state.timePlan = merged.timePlan;
    state.records = merged.records;
    persist();
    renderAll();
    UI.toast('已从 ' + fileName + ' 读取 ' + state.records.length + ' 条记录', 'success', 4000);
  }

  function fsBind() {
    return FS.bind(state).then(function (r) {
      if (r.cancelled) { UI.toast('已取消选择文件夹', 'info'); return; }
      if (!r.ok) { UI.toast(r.error || '绑定失败', 'error', 6000); return; }
      UI.toast('已绑定「' + FS.status().dirName + '」，数据已写入 ' + FS.FILE_NAME, 'success', 4500);
    });
  }

  /** 若已授权但本地未持有权限，先请求一次（需要用户手势） */
  function fsEnsurePermission() {
    var s = FS.status();
    if (s.permission === 'granted') return Promise.resolve(true);
    return FS.requestPermission().then(function (p) {
      if (p === 'granted') { UI.renderStorageStatus(FS.status()); return true; }
      UI.toast('未获得目录读写权限，无法写入。', 'error');
      return false;
    });
  }

  function fsWrite() {
    fsEnsurePermission().then(function (ok) {
      if (!ok) return;
      FS.write(state).then(function (r) {
        if (r.ok) UI.toast('已写入 ' + FS.FILE_NAME, 'success');
        else UI.toast('写入失败：' + (r.error || '未知原因'), 'error', 6000);
      });
    });
  }

  function fsRead() {
    fsEnsurePermission().then(function (ok) {
      if (!ok) return;
      FS.readPayload().then(function (res) {
        if (!res) { UI.toast('目录下没有找到 ' + FS.FILE_NAME + '，可先点「立即写入」生成。', 'warn', 5000); return; }
        if (!res.payload || !Array.isArray(res.payload.records)) {
          UI.toast('数据文件格式不正确（缺少 records 数组），已中止。', 'error', 6000);
          return;
        }
        UI.confirmDialog({
          title: '确认用文件数据覆盖浏览器本地数据？',
          html: '<p>当前浏览器本地有 <b>' + state.records.length + '</b> 条记录，' +
            '文件里有 <b>' + res.payload.records.length + '</b> 条记录。</p>' +
            '<p>覆盖后浏览器本地数据将被文件内容替换。</p>',
          confirmText: '确认覆盖',
          danger: true
        }).then(function (yes) {
          if (yes) applyFilePayload(res.payload, FS.FILE_NAME);
        });
      }).catch(function (e) {
        UI.toast('读取失败：' + (e && e.message || e), 'error', 6000);
      });
    });
  }

  function fsUnbind() {
    UI.confirmDialog({
      title: '解绑数据文件夹？',
      html: '<p>解绑后不再自动写入 <code>' + U.escapeHtml(FS.FILE_NAME) + '</code>，磁盘上已有的文件不会被删除。</p>' +
        '<p>数据仍保留在浏览器本地存储中。</p>',
      confirmText: '解绑',
      cancelText: '取消'
    }).then(function (yes) {
      if (!yes) return;
      FS.unbind().then(function () { UI.toast('已解绑数据文件夹', 'success'); });
    });
  }

  /**
   * 启动时比对数据文件与本地数据：内容一致就什么都不做；
   * 文件不存在就写入本地；不一致则弹窗让用户决定，绝不静默覆盖。
   */
  function fsCheckOnStartup() {
    var s = FS.status();
    if (!s.bound || s.permission !== 'granted') return;

    FS.readPayload().then(function (res) {
      if (!res) {                       // 文件还没生成
        FS.write(state).then(function (r) {
          if (r.ok) UI.toast('已创建数据文件 ' + FS.FILE_NAME, 'success', 4000);
        });
        return;
      }
      if (res.signature === FS.localSignature(state)) return;   // 内容一致，无需处理

      UI.openDivergenceDialog({
        fileCount: Array.isArray(res.payload.records) ? res.payload.records.length : 0,
        fileTime: res.payload.exportedAt ? String(res.payload.exportedAt).slice(0, 19).replace('T', ' ') : '未知',
        localCount: state.records.length,
        localTime: state.updatedAt ? String(state.updatedAt).slice(0, 19).replace('T', ' ') : '未知'
      }).then(function (choice) {
        if (choice === 'file') applyFilePayload(res.payload, FS.FILE_NAME);
        else if (choice === 'local') FS.write(state).then(function () { UI.toast('已用本地数据覆盖文件', 'success'); });
      });
    }).catch(function (e) {
      UI.toast('读取数据文件失败：' + (e && e.message || e), 'error', 6000);
    });
  }

  /* ==================== 渲染 ==================== */

  function renderAll() {
    UI.renderOverview(state);
    UI.renderSettings(state);
    UI.renderRecordsTable(state);
    UI.renderStatsTable(state);
    UI.renderTimeAnalysis(state);
    UI.renderChartSwitches(state);
    renderCharts();
    updateToolbarState();
  }

  function renderCharts() {
    // 四个面板都过一遍：可见面板立即绘制，隐藏面板只记录 dirty + 切换占位，
    // 等切到该面板（容器有尺寸）时再补绘，避免 ECharts 在 0 尺寸容器上画出空白。
    ['panel-records', 'panel-stats', 'panel-trend', 'panel-time'].forEach(function (pid) {
      KG.Charts.renderPanel(pid, state.records, state);
    });
  }

  /* ==================== 顶部工具栏状态 ==================== */

  function updateToolbarState() {
    var hasData = state.records.length > 0;
    var btnExport = document.getElementById('btn-export');
    var btnBackup = document.getElementById('btn-backup');
    var btnClear = document.getElementById('btn-clear');
    btnExport.disabled = !hasData || !state.libs.xlsx;
    btnBackup.disabled = !hasData;
    btnClear.disabled = !hasData;

    var banner = document.getElementById('lib-banner');
    var msgs = [];
    if (!Store.isAvailable()) {
      msgs.push('浏览器本地存储不可用：数据无法持久化，刷新后会恢复为初始数据。请改用普通窗口（非隐私模式）打开。');
    }
    if (!state.libs.xlsx && state.libs.echarts) {
      msgs.push('SheetJS 加载失败（可能离线）：「导入 XLSX / 导出 XLSX」暂不可用，其余功能正常。联网后刷新页面即可恢复。');
    } else if (state.libs.xlsx && !state.libs.echarts) {
      msgs.push('ECharts 加载失败（可能离线）：趋势图暂不可用，其余功能正常。联网后刷新页面即可恢复。');
    } else if (!state.libs.xlsx && !state.libs.echarts && state.libs.loaded) {
      msgs.push('第三方库全部加载失败（可能离线）：Excel 导入导出与趋势图暂不可用，浏览、增删改、统计功能正常。联网后刷新页面即可恢复。');
    }
    if (msgs.length) {
      banner.hidden = false;
      banner.innerHTML = msgs.map(function (m) { return '<span>' + U.escapeHtml(m) + '</span>'; }).join('');
    } else {
      banner.hidden = true;
      banner.innerHTML = '';
    }
  }

  /* ==================== Tab ==================== */

  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('#tabs .tab').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === tab);
    });
    document.querySelectorAll('.panel').forEach(function (p) {
      p.classList.toggle('is-active', p.id === 'panel-' + tab);
    });
    // 面板刚显示出来，此时容器才有尺寸，补绘该面板的图表
    requestAnimationFrame(function () {
      KG.Charts.renderPanel(activePanelId(), state.records, state);
      KG.Charts.resizeAll();
    });
  }

  /* ==================== 记录 CRUD ==================== */

  function addRecord() {
    UI.openRecordForm(state, null, false, function (rec) {
      state.records.push(rec);
      persist();
      renderAll();
      UI.toast('已新增：' + (rec.paperName || '未命名') + '（' + (rec.date || '无日期') + '）', 'success');
      return true;
    });
  }

  function editRecord(record) {
    var idx = state.records.findIndex(function (r) { return r.id === record.id; });
    if (idx < 0) { UI.toast('未找到该记录，可能已被删除', 'error'); return; }
    var origin = state.records[idx];
    UI.openRecordForm(state, origin, true, function (rec) {
      rec.id = origin.id;                     // ID 必须保持不变
      rec.createdAt = origin.createdAt;
      rec.updatedAt = new Date().toISOString();
      state.records[idx] = rec;
      persist();
      renderAll();
      UI.toast('已保存修改：' + (rec.paperName || '未命名') + '（' + (rec.date || '无日期') + '）', 'success');
      return true;
    });
  }

  function deleteRecord(record) {
    UI.confirmDialog({
      title: '确认删除',
      danger: true,
      html:
        '<p>确定删除？</p>' +
        '<table class="detail-table detail-kv"><tbody>' +
          '<tr><th>日期</th><td>' + U.escapeHtml(record.date || '—') + '</td></tr>' +
          '<tr><th>试卷</th><td>' + U.escapeHtml(record.paperName || '—') + '</td></tr>' +
          '<tr><th>分数</th><td class="num">' + U.fmtNum(record.score, 1) + '</td></tr>' +
        '</tbody></table>',
      confirmText: '确认删除',
      cancelText: '取消'
    }).then(function (ok) {
      if (!ok) return;
      state.records = state.records.filter(function (r) { return r.id !== record.id; });
      persist();
      renderAll();
      UI.toast('已删除：' + (record.paperName || '未命名'), 'success');
    });
  }

  /* ==================== 目标设置 ==================== */

  function saveSettings() {
    var s = UI.readSettingsForm();
    var problems = [];
    if (s.defeatTarget === null || s.defeatTarget < 0 || s.defeatTarget > 100) problems.push('击败比目标需在 0~100 之间');
    if (s.defeatWarning === null || s.defeatWarning < 0 || s.defeatWarning > 100) problems.push('击败比黄色下限需在 0~100 之间');
    if (s.scoreTarget === null || s.scoreTarget < 0) problems.push('分数目标需为不小于 0 的数字');
    if (s.scoreWarning === null || s.scoreWarning < 0) problems.push('分数黄色下限需为不小于 0 的数字');
    if (problems.length) { UI.toast(problems[0], 'error', 4000); return; }

    state.settings = s;
    persist();
    renderAll();
    UI.toast('目标设置已保存', 'success');
  }

  /* ==================== 导入 XLSX ==================== */

  function pickXlsx() {
    if (!state.libs.xlsx) { UI.toast('SheetJS 未加载，无法导入。请联网后刷新页面重试。', 'error'); return; }
    var input = document.getElementById('file-xlsx');
    input.value = '';
    input.click();
  }

  function onXlsxPicked(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    if (!/\.xlsx?$/i.test(file.name)) {
      UI.toast('请选择 .xlsx 文件', 'error');
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { UI.toast('文件读取失败', 'error'); };
    reader.onload = function () {
      var result;
      try {
        var wb = KG.Import.readWorkbook(new Uint8Array(reader.result));
        result = KG.Import.recordsFromWorkbook(wb);
      } catch (e) {
        UI.toast(e && e.message ? e.message : 'Excel 解析失败', 'error', 6000);
        return;
      }
      importRecords(result, file.name);
    };
    reader.readAsArrayBuffer(file);
  }

  /** 把已解析的导入结果合并进本地数据（含逐条去重询问） */
  function importRecords(result, filename) {
    var incoming = result.records;

    // 同一批文件内部的重复也要消掉
    var seen = {};
    incoming = incoming.filter(function (r) {
      var k = KG.Import.dedupeKey(r);
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });

    var indexByKey = {};
    state.records.forEach(function (r, i) { indexByKey[KG.Import.dedupeKey(r)] = i; });

    var duplicates = incoming.filter(function (r) { return indexByKey[KG.Import.dedupeKey(r)] !== undefined; });
    var added = 0, overwritten = 0, skipped = 0;
    var notices = KG.Import.collectDataNotices(incoming);

    function applyOne(rec, mode) {
      var key = KG.Import.dedupeKey(rec);
      var idx = indexByKey[key];
      if (idx === undefined) {
        state.records.push(rec);
        indexByKey[key] = state.records.length - 1;
        added++;
        return;
      }
      if (mode === 'overwrite') {
        rec.id = state.records[idx].id;             // 覆盖时沿用原 ID
        rec.createdAt = state.records[idx].createdAt;
        state.records[idx] = rec;
        overwritten++;
      } else {
        skipped++;
      }
    }

    function finish() {
      persist();
      renderAll();
      var parts = ['新增 ' + added + ' 条'];
      if (overwritten) parts.push('覆盖 ' + overwritten + ' 条');
      if (skipped) parts.push('跳过 ' + skipped + ' 条');
      UI.toast('导入完成（' + filename + '）：' + parts.join('，') +
        (result.warnings.length ? '；有 ' + result.warnings.length + ' 处字段为空已按空值导入' : ''), 'success', 5000);
      if (notices.length) showDataNotices(notices);
    }

    if (!duplicates.length) {
      incoming.forEach(function (r) { applyOne(r, 'skip'); });   // 无重复，全部新增
      finish();
      return;
    }

    // 逐条询问：跳过 / 覆盖 / 全部跳过 / 全部覆盖
    var queue = duplicates.slice();
    var pendingNonDup = incoming.filter(function (r) { return indexByKey[KG.Import.dedupeKey(r)] === undefined; });
    pendingNonDup.forEach(function (r) { applyOne(r, 'skip'); });

    (function askNext() {
      if (!queue.length) { finish(); return; }
      var rec = queue[0];
      UI.openDedupeDialog({ record: rec, index: duplicates.length - queue.length + 1, total: duplicates.length })
        .then(function (choice) {
          if (choice === 'skip-all') {
            skipped += queue.length;
            queue = [];
            askNext();
            return;
          }
          if (choice === 'overwrite-all') {
            queue.forEach(function (r) { applyOne(r, 'overwrite'); });
            queue = [];
            askNext();
            return;
          }
          applyOne(rec, choice === 'overwrite' ? 'overwrite' : 'skip');
          queue.shift();
          askNext();
        });
    })();
  }

  function showDataNotices(notices) {
    var html = notices.slice(0, 6).map(function (n) {
      return '<div class="notice notice-warn"><div class="notice-title">' + U.escapeHtml(n.record) + '</div>' +
        '<ul>' + n.diffs.map(function (d) { return '<li>' + U.escapeHtml(d) + '</li>'; }).join('') + '</ul></div>';
    }).join('');
    var more = notices.length > 6 ? '<p class="modal-hint">…… 以及另外 ' + (notices.length - 6) + ' 条记录存在类似情况。</p>' : '';
    UI.openModal({
      title: '导入数据存在不自洽（已按原值保留）',
      size: 'modal-md',
      body: '<p>以下记录在原始 Excel 中就存在「合计与模块之和不等」或「总计与子模块之和不等」，导入时按原值保留，未做静默改写：</p>' +
        html + more +
        '<p class="modal-hint">在本页编辑并保存这些记录时，整套卷汇总会按六大模块自动重算。</p>',
      footer: '<button type="button" class="btn btn-primary" data-act="ok">我知道了</button>',
      onMount: function (a) {
        a.root.querySelector('[data-act="ok"]').addEventListener('click', a.close);
      }
    });
  }

  /* ==================== 导出 XLSX ==================== */

  function exportXlsx() {
    if (!state.libs.xlsx) { UI.toast('SheetJS 未加载，无法导出。请联网后刷新页面重试。', 'error'); return; }
    if (!state.records.length) { UI.toast('没有可导出的记录', 'error'); return; }
    try {
      KG.Export.exportXlsx(state.records, '套卷复盘.xlsx');
      UI.toast('已导出 套卷复盘.xlsx（' + state.records.length + ' 套）', 'success');
    } catch (e) {
      UI.toast('导出失败：' + (e && e.message ? e.message : '未知错误'), 'error', 5000);
    }
  }

  /* ==================== JSON 备份 / 恢复 ==================== */

  function backupJson() {
    var payload = {
      app: '考公练习追踪看板',
      version: Store.VERSION,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      targets: state.targets,
      timePlan: state.timePlan,
      records: state.records
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    U.downloadBlob(blob, '考公练习追踪看板_' + U.today() + '.json');
    UI.toast('备份已导出：考公练习追踪看板_' + U.today() + '.json（' + state.records.length + ' 条）', 'success');
  }

  function pickJson() {
    var input = document.getElementById('file-json');
    input.value = '';
    input.click();
  }

  function onJsonPicked(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { UI.toast('文件读取失败', 'error'); };
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (e) { UI.toast('不是有效的 JSON 文件', 'error'); return; }
      if (!data || !Array.isArray(data.records)) { UI.toast('备份文件格式不正确：缺少 records 数组', 'error'); return; }

      UI.confirmDialog({
        title: '确认恢复备份',
        html:
          '<p>当前已有 <b>' + state.records.length + '</b> 条记录。</p>' +
          '<p>该备份包含 <b>' + data.records.length + '</b> 条记录' +
            (data.exportedAt ? '（导出于 ' + U.escapeHtml(String(data.exportedAt).slice(0, 19).replace('T', ' ')) + '）' : '') + '。</p>' +
          '<p>恢复备份后将<b>覆盖</b>当前本地数据。</p>',
        confirmText: '确认恢复',
        cancelText: '取消'
      }).then(function (ok) {
        if (!ok) return;
        var merged = Store.migrate({
          version: data.version,
          settings: data.settings,
          targets: data.targets,
          timePlan: data.timePlan,
          records: data.records
        });
        merged.records.forEach(function (r) {
          if (!r.id) r.id = U.uuid();
          M.normalizeRecord(r);
        });
        state.settings = merged.settings;
        state.targets = merged.targets;
        state.timePlan = merged.timePlan;
        state.records = merged.records;
        persist();
        renderAll();
        UI.toast('已从备份恢复 ' + state.records.length + ' 条记录', 'success', 4000);
      });
    };
    reader.readAsText(file, 'utf-8');
  }

  /* ==================== 清空 ==================== */

  function clearRecords() {
    UI.openClearDialog(state.records.length).then(function (ok) {
      if (!ok) return;
      state.records = [];
      persist();
      renderAll();
      UI.toast('已清空全部套卷记录', 'success');
    });
  }

  /* ==================== 图表筛选 ==================== */

  function setChartFilter(which, key) {
    state.chartFilter[which] = key;
    KG.Charts.renderPanel(activePanelId(), state.records, state);
  }

  /* ==================== 事件绑定 ==================== */

  function bindEvents() {
    document.getElementById('btn-add').addEventListener('click', addRecord);
    document.getElementById('btn-import').addEventListener('click', pickXlsx);
    document.getElementById('btn-export').addEventListener('click', exportXlsx);
    document.getElementById('btn-backup').addEventListener('click', backupJson);
    document.getElementById('btn-restore').addEventListener('click', pickJson);
    document.getElementById('btn-clear').addEventListener('click', clearRecords);
    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-edit-targets').addEventListener('click', function () {
      UI.openTargetsForm(state, function (targets) {
        state.targets = targets;
        persist();
        renderAll();
        UI.toast('阶段目标已保存', 'success');
      });
    });
    document.getElementById('btn-edit-timeplan').addEventListener('click', function () {
      UI.openTimePlanForm(state, function (timePlan) {
        state.timePlan = timePlan;
        persist();
        renderAll();
        UI.toast('标准用时已保存', 'success');
      });
    });

    document.getElementById('file-xlsx').addEventListener('change', onXlsxPicked);
    document.getElementById('file-json').addEventListener('change', onJsonPicked);

    // 数据文件夹
    if (FS) {
      document.getElementById('btn-fs-bind').addEventListener('click', fsBind);
      document.getElementById('btn-fs-write').addEventListener('click', fsWrite);
      document.getElementById('btn-fs-read').addEventListener('click', fsRead);
      document.getElementById('btn-fs-unbind').addEventListener('click', fsUnbind);
      FS.onChange(function (s) { UI.renderStorageStatus(s); });
    }

    document.querySelectorAll('#tabs .tab').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-tab')); });
    });

    // 筛选 / 排序
    var kw = document.getElementById('filter-keyword');
    kw.addEventListener('input', function () {
      state.filter.keyword = kw.value;
      UI.renderRecordsTable(state);
    });
    ['filter-date-from', 'filter-date-to'].forEach(function (id, i) {
      document.getElementById(id).addEventListener('change', function () {
        if (i === 0) state.filter.dateFrom = this.value; else state.filter.dateTo = this.value;
        UI.renderRecordsTable(state);
      });
    });
    document.getElementById('sort-key').addEventListener('change', function () {
      state.filter.sortKey = this.value;
      UI.renderRecordsTable(state);
    });
    document.getElementById('sort-dir').addEventListener('change', function () {
      state.filter.sortDir = this.value;
      UI.renderRecordsTable(state);
    });
    document.getElementById('btn-filter-reset').addEventListener('click', function () {
      state.filter = { keyword: '', dateFrom: '', dateTo: '', sortKey: 'date', sortDir: 'desc' };
      document.getElementById('filter-keyword').value = '';
      document.getElementById('filter-date-from').value = '';
      document.getElementById('filter-date-to').value = '';
      document.getElementById('sort-key').value = 'date';
      document.getElementById('sort-dir').value = 'desc';
      UI.renderRecordsTable(state);
    });

    // 表格行操作（事件委托）
    document.getElementById('records-table').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var tr = btn.closest('tr');
      var id = tr && tr.getAttribute('data-id');
      var rec = state.records.find(function (r) { return r.id === id; });
      if (!rec) return;
      var act = btn.getAttribute('data-act');
      if (act === 'view') UI.openDetail(rec, state);
      else if (act === 'edit') editRecord(rec);
      else if (act === 'delete') deleteRecord(rec);
    });

    // 空状态区域内的按钮
    document.getElementById('records-empty').addEventListener('click', function (e) {
      if (e.target.closest('[data-act="add"]')) addRecord();
    });

    window.addEventListener('resize', function () {
      clearTimeout(window.__kgResizeTimer);
      window.__kgResizeTimer = setTimeout(function () { KG.Charts.resizeAll(); }, 160);
    });
  }

  /* ==================== 启动 ==================== */

  function init() {
    state.records = [];
    var loaded = Store.load();
    state.version = loaded.version;
    state.settings = loaded.settings;
    state.targets = loaded.targets;
    state.timePlan = loaded.timePlan;
    state.records = loaded.records;
    state.updatedAt = loaded.updatedAt;

    bindEvents();
    renderAll();

    var hadStored = false;
    try { hadStored = !!window.localStorage.getItem(Store.KEY); } catch (e) { hadStored = false; }
    if (!hadStored) {
      persist();   // 首次打开：把内置的 Excel 初始数据落盘
      UI.toast('已载入内置的初始数据（第29季 2026-09-19）。导入你自己的 XLSX 即可继续追加。', 'info', 5200);
    }

    KG.Charts.renderPanel(activePanelId(), state.records, state);

    window.KGLoadLibs().then(function (r) {
      state.libs = { xlsx: r.xlsx, echarts: r.echarts, loaded: true };
      updateToolbarState();
      renderCharts();
      if (r.xlsx && r.echarts) {
        // 库就绪后重绘当前面板的图表
        KG.Charts.renderPanel(activePanelId(), state.records, state);
      }
    });

    // 数据文件夹：恢复上次绑定的目录，再比对文件与本地是否一致
    if (FS) {
      UI.renderStorageStatus(FS.status());
      FS.init().then(function () {
        UI.renderStorageStatus(FS.status());
        fsCheckOnStartup();
      });
    }
  }

  KG.App = {
    state: state,
    init: init,
    renderAll: renderAll,
    importRecords: importRecords,
    editRecord: editRecord,
    setChartFilter: setChartFilter,
    switchTab: switchTab
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
