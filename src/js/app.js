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
    timeFocusId: '',   // 用时分析里选中的套卷；空字符串 = 跟随最近一次
    plans: [],
    planRules: [],
    sessions: [],
    timer: null,
    planFilter: 'week',      // week | today | all
    planOtherOpen: false,
    timerDist: 'category',   // category | plan
    timerMode: 'stopwatch',
    timerCategory: '',
    filter: { keyword: '', dateFrom: '', dateTo: '', sortKey: 'date', sortDir: 'desc' },
    chartFilter: { score: 'all', module: 'all', time: 'total', statsModule: 'all', timeAnalysis: 'total' },
    libs: { xlsx: false, echarts: false }
  };

  var PANEL_IDS = {
    records: 'panel-records',
    stats: 'panel-stats',
    trend: 'panel-trend',
    time: 'panel-time',
    plans: 'panel-plans',
    timer: 'panel-timer'
  };

  var ALL_PANELS = ['panel-records', 'panel-stats', 'panel-trend', 'panel-time', 'panel-plans', 'panel-timer'];

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
    state.plans = merged.plans;
    state.planRules = merged.planRules;
    state.sessions = merged.sessions;
    state.timer = null;
    materializePlans();
    persist();
    renderAll();
    UI.toast('已从 ' + fileName + ' 读取 ' + state.records.length + ' 条记录、' +
      state.plans.length + ' 条计划、' + state.sessions.length + ' 条计时记录', 'success', 4500);
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
    UI.renderPlans(state);
    UI.renderTimer(state);
    UI.renderChartSwitches(state);
    renderCharts();
    updateToolbarState();
  }

  function renderCharts() {
    // 各面板都过一遍：可见面板立即绘制，隐藏面板只记录 dirty + 切换占位，
    // 等切到该面板（容器有尺寸）时再补绘，避免 ECharts 在 0 尺寸容器上画出空白。
    ALL_PANELS.forEach(function (pid) {
      KG.Charts.renderPanel(pid, state.records, state);
    });
  }

  /* ==================== 顶部工具栏状态 ==================== */

  /**
   * 把页头实际高度写进 --header-h，供吸顶的 Tab 栏定位。
   * 页头高度不是常数：换了字体、窄到工具栏换行、用户缩放，都会变。
   */
  function syncHeaderHeight() {
    var header = document.querySelector('.app-header');
    if (!header) return;
    // 页头不吸顶时（窄屏媒体查询把它改成 static）就不该留偏移量
    var sticky = window.getComputedStyle(header).position === 'sticky';
    var h = sticky ? Math.round(header.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--header-h', h + 'px');
  }

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
      msgs.push('浏览器本地存储不可用，数据无法保存。常见原因：用了隐私/无痕窗口；浏览器禁用了站点数据；' +
        '或者用 Safari 直接打开了本地文件（Safari 不允许本地页面保存数据）。' +
        '请改用 Chrome / Edge 打开，或通过网址（http/https）访问。');
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
      if (tab === 'plans') UI.renderPlans(state);
      if (tab === 'timer') UI.renderTimer(state);
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
      records: state.records,
      plans: state.plans,
      planRules: state.planRules,
      sessions: state.sessions
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
          records: data.records,
          plans: data.plans || [],
          planRules: data.planRules || [],
          sessions: data.sessions || []
        });
        merged.records.forEach(function (r) {
          if (!r.id) r.id = U.uuid();
          M.normalizeRecord(r);
        });
        state.settings = merged.settings;
        state.targets = merged.targets;
        state.timePlan = merged.timePlan;
        state.records = merged.records;
        state.plans = merged.plans;
        state.planRules = merged.planRules;
        state.sessions = merged.sessions;
        state.timer = null;               // 运行中的计时不跟着备份走
        materializePlans();
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

  /* ==================== 每日计划 ==================== */

  function findPlan(id) {
    return state.plans.filter(function (p) { return p.id === id; })[0] || null;
  }
  function findRule(id) {
    return state.planRules.filter(function (r) { return r.id === id; })[0] || null;
  }

  /** 补齐循环实例并落盘（有新增才写） */
  function materializePlans() {
    var created = KG.Plans.materialize(state, U.today());
    return created;
  }

  function setPlanFilter(key) {
    state.planFilter = key || 'week';
    UI.renderPlans(state);
  }

  function addPlan() {
    UI.openPlanForm(state, null, false, function (out) {
      var out2 = out.plan;
      if (out.repeat && out.repeat !== 'none') {
        // 勾了重复：建一条规则，让补齐逻辑去铺实例
        var rule = M.blankPlanRule({
          freq: out.repeat,
          startDate: out2.date,
          until: out.untilDate || null,     // 截止日期（可空 = 一直重复）
          kind: out2.kind,
          title: out2.title,
          category: out2.category,
          contentMode: out2.contentMode,
          content: out2.content,
          items: out2.items,
          minutes: out2.minutes
        });
        state.planRules.push(rule);
        materializePlans();
        persist(); renderAll();
        UI.toast('已新增循环计划：' + (rule.title || '未命名') + '（' + (rule.freq === 'daily' ? '每日' : '每周') + '重复）', 'success');
        return;
      }
      out2.ruleId = null;
      state.plans.push(out2);
      persist(); renderAll();
      UI.toast('已新增计划：' + (out2.title || '未命名') + '（' + out2.date + '）', 'success');
    });
  }

  function editPlan(plan) {
    if (plan.ruleId) {
      var rule = findRule(plan.ruleId);
      if (!rule) { UI.toast('这条计划所属的循环规则已不存在，将按普通计划编辑', 'warn'); }
      else {
        UI.openPlanScopeDialog('edit', plan.title).then(function (scope) {
          if (!scope) return;
          if (scope === 'once') doEditPlanOnce(plan);
          else doEditPlanRule(rule);
        });
        return;
      }
    }
    doEditPlanOnce(plan);
  }

  function doEditPlanOnce(plan) {
    UI.openPlanForm(state, plan, false, function (out) {
      var idx = state.plans.indexOf(plan);
      if (idx < 0) return;
      var updated = out.plan;
      updated.id = plan.id;
      updated.ruleId = plan.ruleId || null;
      updated.createdAt = plan.createdAt;
      state.plans[idx] = updated;
      persist(); renderAll();
      UI.toast('已保存：' + (updated.title || '未命名'), 'success');
    });
  }

  function doEditPlanRule(rule) {
    UI.openPlanForm(state, rule, true, function (out) {
      var r = out.rule;
      var idx = state.planRules.indexOf(rule);
      if (idx < 0) return;
      r.id = rule.id;
      r.createdAt = rule.createdAt;
      state.planRules[idx] = r;
      var n = KG.Plans.applyRuleToFuture(state, r);
      materializePlans();
      persist(); renderAll();
      UI.toast('已更新循环计划，同步了 ' + n + ' 个未来实例（历史保留）', 'success');
    });
  }

  function deletePlan(plan) {
    if (plan.ruleId && findRule(plan.ruleId)) {
      UI.openPlanScopeDialog('delete', plan.title).then(function (scope) {
        if (!scope) return;
        if (scope === 'once') {
          removePlanById(plan.id);
          persist(); renderAll();
          UI.toast('已删除这一次（循环保留）', 'success');
        } else {
          var ruleId = plan.ruleId;
          state.planRules = state.planRules.filter(function (r) { return r.id !== ruleId; });
          var n = KG.Plans.removeFutureInstances(state, ruleId, U.today());
          persist(); renderAll();
          UI.toast('已删除整个循环（清掉 ' + n + ' 个未来实例，历史保留）', 'success');
        }
      });
      return;
    }
    UI.confirmDialog({
      title: '确认删除',
      danger: true,
      html: '<p>确定删除这条计划？</p>' +
        '<table class="detail-table detail-kv"><tbody>' +
          '<tr><th>日期</th><td>' + U.escapeHtml(plan.date || '—') + '</td></tr>' +
          '<tr><th>标题</th><td>' + U.escapeHtml(plan.title || '—') + '</td></tr>' +
        '</tbody></table>',
      confirmText: '确认删除'
    }).then(function (ok) {
      if (!ok) return;
      removePlanById(plan.id);
      persist(); renderAll();
      UI.toast('已删除计划', 'success');
    });
  }

  function removePlanById(id) {
    state.plans = state.plans.filter(function (p) { return p.id !== id; });
    if (state.timer && state.timer.planId === id) {
      // 删掉的计划正在计时：保留计时，只是不再是"某条计划的"
      state.timer.planId = null;
      persist();
    }
  }

  function deleteRule(rule) {
    UI.confirmDialog({
      title: '停止这个循环计划？',
      danger: true,
      html: '<p>「' + U.escapeHtml(rule.title || '未命名') + '」是一个' +
        (rule.freq === 'daily' ? '每日' : '每周') + '重复的计划。</p>' +
        '<p>停止后会删除该规则和<b>未来</b>已生成的实例；<b>历史实例保留</b>，已完成的学习记录也不受影响。</p>',
      confirmText: '停止并删除未来的实例'
    }).then(function (ok) {
      if (!ok) return;
      state.planRules = state.planRules.filter(function (r) { return r.id !== rule.id; });
      var n = KG.Plans.removeFutureInstances(state, rule.id, U.today());
      persist(); renderAll();
      UI.toast('已停止循环，清掉 ' + n + ' 个未来实例', 'success');
    });
  }

  function togglePlanDone(plan, force) {
    if (plan.contentMode === 'list') {
      var target = force === undefined ? !plan.done : force;
      plan.items.forEach(function (it) { it.done = target; });
    } else {
      plan.done = force === undefined ? !plan.done : force;
    }
    M.normalizePlan(plan);
    plan.updatedAt = new Date().toISOString();
    persist();
    UI.renderPlans(state);
  }

  function togglePlanItem(plan, itemId) {
    (plan.items || []).forEach(function (it) {
      if (it.id === itemId) it.done = !it.done;
    });
    M.normalizePlan(plan);
    plan.updatedAt = new Date().toISOString();
    persist();
    UI.renderPlans(state);
  }

  /* ==================== 学习计时 ==================== */

  var tickHandle = null;

  function startTimer(opts) {
    if (state.timer && state.timer.active) {
      UI.toast('已经有一个计时在进行中，先结束它再开新的', 'warn');
      return;
    }
    KG.Timer.primeAudio();                     // 必须在用户手势里初始化，否则之后没声音
    state.timer = KG.Timer.create({
      mode: opts.mode || state.timerMode || 'stopwatch',
      planId: opts.planId || null,
      label: opts.label || '',
      category: opts.category || '',
      pomo: state.settings.pomo
    });
    persist();
    ensureTick();
    renderAll();
    UI.toast('开始计时：' + (state.timer.label || '自由学习'), 'success');
  }

  function startTimerFromForm() {
    var sel = document.getElementById('timer-plan-select');
    var planId = sel ? sel.value : '';
    var plan = planId ? findPlan(planId) : null;
    var labelEl = document.getElementById('timer-label');
    var catEl = document.getElementById('timer-category');
    var modeEl = document.getElementById('timer-mode');

    state.timerMode = modeEl ? modeEl.value : 'stopwatch';
    state.timerCategory = catEl ? catEl.value : '';

    startTimer({
      mode: state.timerMode,
      planId: plan ? plan.id : null,
      label: (labelEl && labelEl.value.trim()) || (plan ? plan.title : '') || '自由学习',
      category: (catEl && catEl.value) || (plan ? plan.category : '') || ''
    });
  }

  function toggleTimerPause() {
    if (!state.timer || !state.timer.active) return;
    KG.Timer.togglePause(state.timer);
    persist();
    UI.renderTimer(state);
    UI.tickTimerDisplay(state);
  }

  function stopTimer() {
    if (!state.timer || !state.timer.active) return;
    var t = state.timer;
    var seconds = Math.floor(KG.Timer.studyMs(t) / 1000);
    if (seconds <= 0) {
      state.timer = null;
      persist(); ensureTick(); renderAll();
      UI.toast('这次没有产生学习时长，已取消', 'info');
      return;
    }
    var runaway = KG.Timer.isRunaway(t);
    var finish = function () {
      var s = KG.Timer.finish(t, Date.now());
      state.timer = null;
      if (s) state.sessions.push(s);
      persist(); ensureTick(); renderAll();
      if (s) {
        UI.toast('已记录 ' + M.fmtDuration(s.seconds) + '：' + (s.label || '自由学习'), 'success', 4500);
      } else {
        UI.toast('已结束计时（时长不足 1 秒，未记录）', 'info');
      }
    };
    if (runaway) {
      UI.confirmDialog({
        title: '计时时间异常长',
        html: '<p>这次计时已累计 <b>' + U.escapeHtml(M.fmtDuration(seconds)) + '</b>，超过 6 小时。</p>' +
          '<p>通常是忘记结束了。要照实计入，还是丢弃这次？</p>',
        confirmText: '照实计入',
        cancelText: '丢弃这次'
      }).then(function (ok) {
        if (ok) finish();
        else {
          state.timer = null;
          persist(); ensureTick(); renderAll();
          UI.toast('已丢弃这次计时', 'info');
        }
      });
      return;
    }
    finish();
  }

  function ensureTick() {
    var active = !!(state.timer && state.timer.active);
    if (active && !tickHandle) tickHandle = setInterval(onTick, 1000);
    if (!active && tickHandle) { clearInterval(tickHandle); tickHandle = null; }
  }

  function onTick() {
    var t = state.timer;
    if (!t || !t.active) { ensureTick(); return; }
    var done = KG.Timer.advance(t);          // 番茄模式：到点换阶段
    if (done) {
      KG.Timer.beep(done === 'focus-done' ? 2 : 1, done === 'focus-done' ? 880 : 640);
      KG.Timer.flashTitle(done === 'focus-done' ? '⏰ 专注结束，休息一下' : '⏰ 休息结束，继续专注');
      UI.toast(done === 'focus-done' ? '专注结束，休息一下 ☕' : '休息结束，继续专注 💪',
        done === 'focus-done' ? 'success' : 'info', 6000);
      persist();
      renderAll();
    }
    UI.tickTimerDisplay(state);
  }

  function deleteSession(id) {
    state.sessions = state.sessions.filter(function (s) { return s.id !== id; });
    persist(); renderAll();
    UI.toast('已删除这条计时记录', 'success');
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

    // 用时分析：切换要对比的套卷
    document.getElementById('time-focus').addEventListener('change', function () {
      state.timeFocusId = this.value || '';
      renderAll();
    });

    /* ---- 每日计划 ---- */
    document.getElementById('btn-add-plan').addEventListener('click', addPlan);
    document.getElementById('btn-plan-other-toggle').addEventListener('click', function () {
      state.planOtherOpen = !state.planOtherOpen;
      // 「往后/历史」只有选「全部」时才显示；这里点展开就自动切到全部
      if (state.planOtherOpen) state.planFilter = 'all';
      document.getElementById('plan-other-body').hidden = !state.planOtherOpen;
      this.textContent = state.planOtherOpen ? '收起' : '展开';
      UI.renderPlans(state);
    });

    // 计划卡片上的操作（事件委托）
    ['plan-today', 'plan-week', 'plan-other', 'plan-rules'].forEach(function (boxId) {
      var box = document.getElementById(boxId);
      box.addEventListener('change', function (e) {
        var t = e.target;
        if (!t || t.getAttribute('data-act') !== 'toggle') return;
        var card = t.closest('[data-id]');
        var plan = card && findPlan(card.getAttribute('data-id'));
        if (plan) togglePlanDone(plan, t.checked);
      });
      box.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;

        var itemBox = t.closest('[data-act="item-toggle"]');
        if (itemBox) {
          var card2 = itemBox.closest('[data-id]');
          var plan2 = card2 && findPlan(card2.getAttribute('data-id'));
          if (plan2) togglePlanItem(plan2, itemBox.getAttribute('data-item'));
          return;
        }

        var ruleBtn = t.closest('[data-act="rule-edit"],[data-act="rule-delete"]');
        if (ruleBtn) {
          var ruleCard = ruleBtn.closest('[data-rule-id]');
          var rule = ruleCard && findRule(ruleCard.getAttribute('data-rule-id'));
          if (!rule) return;
          if (ruleBtn.getAttribute('data-act') === 'rule-edit') doEditPlanRule(rule);
          else deleteRule(rule);
          return;
        }

        var btn = t.closest('[data-act]');
        if (!btn) return;
        var card3 = btn.closest('[data-id]');
        var plan3 = card3 && findPlan(card3.getAttribute('data-id'));
        if (!plan3) return;
        var act = btn.getAttribute('data-act');
        if (act === 'edit') editPlan(plan3);
        else if (act === 'delete') deletePlan(plan3);
        else if (act === 'start') {
          startTimer({
            mode: state.timerMode || 'stopwatch',
            planId: plan3.id,
            label: plan3.title || '未命名计划',
            category: plan3.category || ''
          });
        }
      });
    });

    /* ---- 学习计时 ---- */
    document.getElementById('btn-timer-start').addEventListener('click', startTimerFromForm);
    document.getElementById('btn-timer-pause').addEventListener('click', toggleTimerPause);
    document.getElementById('btn-timer-stop').addEventListener('click', stopTimer);
    document.getElementById('btn-bar-pause').addEventListener('click', toggleTimerPause);
    document.getElementById('btn-bar-stop').addEventListener('click', stopTimer);

    document.getElementById('timer-plan-select').addEventListener('change', function () {
      var plan = this.value ? findPlan(this.value) : null;
      var labelEl = document.getElementById('timer-label');
      var catEl = document.getElementById('timer-category');
      if (plan) {
        if (labelEl && !labelEl.value.trim()) labelEl.value = plan.title || '';
        if (catEl && plan.category) catEl.value = plan.category;
      }
    });
    document.getElementById('timer-mode').addEventListener('change', function () {
      state.timerMode = this.value;
    });
    document.getElementById('btn-pomo-config').addEventListener('click', function () {
      UI.openPomoConfigForm(state, function (pomo) {
        state.settings.pomo = pomo;
        if (state.timer && state.timer.active) state.timer.pomo = pomo;
        persist(); renderAll();
        UI.toast('番茄设置已保存（专注 ' + pomo.focusMin + ' 分 / 休息 ' + pomo.breakMin + ' 分）', 'success');
      });
    });
    document.getElementById('session-table').addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-act="session-del"]');
      if (!btn) return;
      var tr = btn.closest('[data-id]');
      if (!tr) return;
      var id = tr.getAttribute('data-id');
      UI.confirmDialog({
        title: '删除这条计时记录？',
        danger: true,
        message: '删除后今日/本周/本月的学习时长统计会相应减少。',
        confirmText: '确认删除'
      }).then(function (ok) { if (ok) deleteSession(id); });
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
      window.__kgResizeTimer = setTimeout(function () {
        syncHeaderHeight();
        KG.Charts.resizeAll();
      }, 160);
    });

    // 页头高度变化（工具栏换行、字号变化）时同步吸顶偏移
    if (typeof ResizeObserver === 'function') {
      try {
        new ResizeObserver(syncHeaderHeight).observe(document.querySelector('.app-header'));
      } catch (e) { /* 忽略 */ }
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(syncHeaderHeight).catch(function () {});
    }
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
    state.plans = loaded.plans || [];
    state.planRules = loaded.planRules || [];
    state.sessions = loaded.sessions || [];
    state.timer = loaded.timer || null;
    state.updatedAt = loaded.updatedAt;

    bindEvents();
    syncHeaderHeight();

    // 补齐循环实例（可能因为好几天没打开而缺）；有新增就落盘
    var created = materializePlans();
    ensureTick();

    renderAll();
    if (created) persist();

    var hadStored = false;
    try { hadStored = !!window.localStorage.getItem(Store.KEY); } catch (e) { hadStored = false; }
    if (!hadStored) {
      persist();   // 首次打开：把内置的示例数据落盘
      UI.toast('已载入示例数据（第29季 2026-09-19），可直接删除或改成你自己的。', 'info', 5200);
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
