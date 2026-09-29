/* ui.js —— 渲染与交互：主表、统计表、表单、详情、对话框、提示条 */
var KG = window.KG || (window.KG = {});

(function () {
  'use strict';

  var U = KG.Utils;
  var M = KG.Model;
  var S = KG.Stats;
  var esc = U.escapeHtml;

  /* ==================== 提示条 ==================== */

  function toast(message, type, ms) {
    var root = document.getElementById('toast-root');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.innerHTML = '<span class="toast-msg">' + esc(message) + '</span>';
    root.appendChild(el);
    setTimeout(function () { el.classList.add('is-out'); }, (ms || 3000));
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, (ms || 3000) + 320);
  }

  /* ==================== 弹窗 ==================== */

  var activeModal = null;

  function closeModal() {
    if (!activeModal) return;
    var node = activeModal;
    activeModal = null;
    node.classList.remove('is-in');
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 180);
  }

  /** 立即清掉所有弹窗节点（含正在做淡出动画的残留），保证同一时刻只有一个弹窗 */
  function purgeModals() {
    activeModal = null;
    var root = document.getElementById('modal-root');
    if (!root) return;
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  /**
   * 打开弹窗
   * opts: { title, body, footer, size, onMount(rootEl, api) }
   */
  function openModal(opts) {
    closeModal();
    purgeModals();
    var root = document.getElementById('modal-root');
    var wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML =
      '<div class="modal ' + (opts.size || 'modal-md') + '" role="dialog" aria-modal="true">' +
        '<div class="modal-head">' +
          '<h3 class="modal-title">' + esc(opts.title || '') + '</h3>' +
          '<button type="button" class="modal-close" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' + (opts.body || '') + '</div>' +
        (opts.footer ? '<div class="modal-foot">' + opts.footer + '</div>' : '') +
      '</div>';
    root.appendChild(wrap);
    activeModal = wrap;

    function onKey(e) {
      if (e.key === 'Escape') { closeModal(); }
    }
    document.addEventListener('keydown', onKey);

    var api = {
      root: wrap,
      body: wrap.querySelector('.modal-body'),
      close: function () {
        document.removeEventListener('keydown', onKey);
        closeModal();
      }
    };

    wrap.querySelector('.modal-close').addEventListener('click', api.close);
    wrap.addEventListener('mousedown', function (e) {
      if (e.target === wrap) api.close();     // 点击遮罩关闭
    });

    requestAnimationFrame(function () { wrap.classList.add('is-in'); });
    if (opts.onMount) opts.onMount(api);
    return api;
  }

  /** 确认对话框（Promise<boolean>） */
  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      var decided = false;
      var api = openModal({
        title: opts.title || '请确认',
        size: opts.size || 'modal-sm',
        body: '<div class="confirm-body">' + (opts.html || '<p>' + esc(opts.message || '') + '</p>') + '</div>',
        footer:
          '<button type="button" class="btn" data-act="cancel">' + esc(opts.cancelText || '取消') + '</button>' +
          '<button type="button" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-act="ok">' +
            esc(opts.confirmText || '确认') + '</button>',
        onMount: function (a) {
          a.root.querySelector('[data-act="cancel"]').addEventListener('click', function () {
            decided = true; a.close(); resolve(false);
          });
          a.root.querySelector('[data-act="ok"]').addEventListener('click', function () {
            decided = true; a.close(); resolve(true);
          });
        }
      });
      // 关闭（Esc / 遮罩）视为取消
      var timer = setInterval(function () {
        if (!document.body.contains(api.root)) {
          clearInterval(timer);
          if (!decided) resolve(false);
        }
      }, 120);
    });
  }

  /* ==================== 状态着色 ==================== */

  function pctHtml(value, target, warning) {
    var st = U.statusOf(value, target, warning);
    var cls = st.key === 'ok' ? 'pct-ok' : st.key === 'warn' ? 'pct-warn' : st.key === 'bad' ? 'pct-bad' : 'pct-none';
    return '<span class="pct ' + cls + '">' + U.fmtPct(value) + '</span>';
  }

  function statusBadge(value, target, warning) {
    var st = U.statusOf(value, target, warning);
    return '<span class="badge badge-' + st.key + '">' + esc(st.text) + '</span>';
  }

  /* ==================== 模块一：概览卡片 ==================== */

  function renderOverview(state) {
    var o = S.overview(state.records);
    var cards = [
      { label: '套卷总数', value: String(o.count), sub: '套' },
      { label: '平均分', value: o.avgScore === null ? '—' : U.fmtNum(o.avgScore, 1), sub: '分' },
      { label: '平均击败比', value: U.fmtPct(o.avgDefeatRate), sub: '' },
      { label: '最近一次分数', value: o.latestScore === null ? '—' : U.fmtNum(o.latestScore, 1), sub: o.latestPaper ? (o.latestPaper + ' · ' + o.latestDate) : '' }
    ];
    U.setHtml(document.getElementById('overview-cards'), cards.map(function (c) {
      var isUnit = c.sub && c.sub.length <= 2;
      return '<div class="stat-card">' +
        '<div class="stat-label">' + esc(c.label) + '</div>' +
        '<div class="stat-line">' +
          '<span class="stat-value">' + esc(c.value) + '</span>' +
          (isUnit ? '<span class="stat-unit">' + esc(c.sub) + '</span>' : '') +
        '</div>' +
        (!isUnit && c.sub ? '<div class="stat-sub">' + esc(c.sub) + '</div>' : '') +
      '</div>';
    }).join(''));

    var deltas = S.deltas(state.records);
    U.setHtml(document.getElementById('overview-deltas'), deltas.map(function (d) {
      var hasDelta = d.delta !== null;
      var up = hasDelta && d.delta > 0;
      var flat = hasDelta && d.delta === 0;
      var cls = !hasDelta ? 'delta-none' : flat ? 'delta-flat' : up ? 'delta-up' : 'delta-down';
      var arrow = !hasDelta || flat ? (flat ? '→' : '—') : (up ? '↑' : '↓');
      var deltaText = !hasDelta ? '无可比数据' : (flat ? '持平' : Math.abs(d.delta));
      return '<div class="delta-card">' +
        '<div class="delta-label">最近一次 ' + esc(d.label) + '</div>' +
        '<div class="delta-value">' + esc(U.fmtNum(d.current, d.digits)) + (d.label === '击败比' && d.current !== null ? '%' : '') + '</div>' +
        '<div class="delta-diff ' + cls + '">' + arrow + ' ' + esc(String(deltaText)) + '</div>' +
      '</div>';
    }).join(''));
  }

  /* ==================== 模块一：设置 ==================== */

  function renderSettings(state) {
    var s = state.settings;
    document.getElementById('set-defeat-target').value = s.defeatTarget;
    document.getElementById('set-defeat-warning').value = s.defeatWarning;
    document.getElementById('set-score-target').value = s.scoreTarget;
    document.getElementById('set-score-warning').value = s.scoreWarning;
  }

  function readSettingsForm() {
    return {
      defeatTarget: U.toNumber(document.getElementById('set-defeat-target').value),
      defeatWarning: U.toNumber(document.getElementById('set-defeat-warning').value),
      scoreTarget: U.toNumber(document.getElementById('set-score-target').value),
      scoreWarning: U.toNumber(document.getElementById('set-score-warning').value)
    };
  }

  /* ==================== 模块一：主表 ==================== */

  function filterRecords(state) {
    var f = state.filter;
    var kw = (f.keyword || '').trim().toLowerCase();
    var list = state.records.filter(function (r) {
      if (kw && String(r.paperName || '').toLowerCase().indexOf(kw) < 0) return false;
      if (f.dateFrom && (!r.date || r.date < f.dateFrom)) return false;
      if (f.dateTo && (!r.date || r.date > f.dateTo)) return false;
      return true;
    });

    var key = f.sortKey;
    var dir = f.sortDir === 'asc' ? 1 : -1;
    list.sort(function (a, b) {
      var av, bv;
      if (key === 'date') {
        av = U.dateValue(a.date); bv = U.dateValue(b.date);
        if (isNaN(av)) av = -Infinity;
        if (isNaN(bv)) bv = -Infinity;
      } else {
        av = U.toNumber(a[key]); bv = U.toNumber(b[key]);
        if (av === null) av = -Infinity;
        if (bv === null) bv = -Infinity;
      }
      if (av !== bv) return (av - bv) * dir;
      return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1;
    });
    return list;
  }

  function renderRecordsTable(state) {
    var list = filterRecords(state);
    var table = document.getElementById('records-table');
    var thead = table.querySelector('thead');
    var tbody = table.querySelector('tbody');
    var empty = document.getElementById('records-empty');

    var cols = ['日期', '试卷', '分数', '平均分', '击败比'];
    var moduleCols = M.MODULES.map(function (d) { return d.name; });
    var headHtml = '<tr>' +
      cols.map(function (c, i) {
        var num = i >= 2 ? ' class="num"' : '';
        return '<th' + num + '>' + esc(c) + '</th>';
      }).join('') +
      moduleCols.map(function (c) { return '<th class="num">' + esc(c) + '</th>'; }).join('') +
      '<th class="num">总用时</th><th class="ops">操作</th></tr>';
    thead.innerHTML = headHtml;

    U.setHtml(document.getElementById('records-count'),
      '共 ' + state.records.length + ' 条' + (list.length !== state.records.length ? '（筛选后 ' + list.length + ' 条）' : ''));

    if (!list.length) {
      tbody.innerHTML = '';
      empty.hidden = false;
      empty.innerHTML = state.records.length
        ? '<p>没有符合筛选条件的记录。</p>'
        : '<p>还没有套卷记录。点击左上角「+ 新增一套套卷记录」，或「导入 XLSX」从表格导入。</p>';
      return;
    }
    empty.hidden = true;

    function num(v, digits) { return v === null || v === undefined ? '—' : U.fmtNum(v, digits); }

    tbody.innerHTML = list.map(function (r) {
      var cells = M.MODULES.map(function (def) {
        var t = state.targets[def.key] || M.DEFAULT_TARGETS[def.key];
        return '<td class="num">' + pctHtml(M.moduleAccuracy(r, def.key), t.target, t.warning) + '</td>';
      }).join('');

      return '<tr data-id="' + esc(r.id) + '">' +
        '<td>' + esc(r.date || '—') + '</td>' +
        '<td class="paper-name" title="' + esc(r.paperName) + '">' + esc(r.paperName || '—') + '</td>' +
        '<td class="num">' + num(r.score, 1) + '</td>' +
        '<td class="num">' + num(r.averageScore, 1) + '</td>' +
        '<td class="num">' + pctHtml(r.defeatRate, state.settings.defeatTarget, state.settings.defeatWarning) + '</td>' +
        cells +
        '<td class="num">' + (r.total && r.total.time !== null ? U.fmtNum(r.total.time, 1) : '—') + '</td>' +
        '<td class="ops">' +
          '<button type="button" class="btn btn-xs" data-act="view">查看</button>' +
          '<button type="button" class="btn btn-xs" data-act="edit">编辑</button>' +
          '<button type="button" class="btn btn-xs btn-danger-ghost" data-act="delete">删除</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  /* ==================== 模块二：统计表 ==================== */

  function renderStatsTable(state) {
    var stats = S.moduleStats(state.records, state.targets);
    var table = document.getElementById('stats-table');
    var empty = document.getElementById('stats-empty');

    table.querySelector('thead').innerHTML =
      '<tr><th>模块</th><th class="num">题数</th><th class="num">最近一次</th>' +
      '<th class="num">平均正确率</th><th class="num">记录平均正确率</th><th class="num">最高正确率</th>' +
      '<th class="num">阶段目标</th><th class="num">黄色下限</th><th class="center">状态</th></tr>';

    U.setHtml(document.getElementById('stats-hint'),
      state.records.length ? '基于 ' + state.records.length + ' 套记录动态计算' : '');

    if (!state.records.length) {
      table.querySelector('tbody').innerHTML = '';
      empty.hidden = false;
      empty.innerHTML = '<p>暂无数据，先添加或导入套卷记录。</p>';
      return;
    }
    empty.hidden = true;

    table.querySelector('tbody').innerHTML = stats.map(function (s) {
      return '<tr>' +
        '<td class="module-name">' + esc(s.name) + '</td>' +
        '<td class="num">' + (s.questions === null ? '—' : U.fmtNum(s.questions, 0)) + '</td>' +
        '<td class="num">' + U.fmtPct(s.latest) + '</td>' +
        '<td class="num">' + U.fmtPct(s.avg) + '</td>' +
        '<td class="num">' + U.fmtPct(s.recordAvgAccuracy) + '</td>' +
        '<td class="num">' + U.fmtPct(s.max) + '</td>' +
        '<td class="num">' + U.fmtPct(s.target) + '</td>' +
        '<td class="num">' + U.fmtPct(s.warning) + '</td>' +
        '<td class="center">' + statusBadge(s.latest, s.target, s.warning) + '</td>' +
      '</tr>';
    }).join('');
  }

  /* ==================== 图表开关按钮 ==================== */

  function chartSwitch(containerId, items, activeKey, onPick) {
    var box = document.getElementById(containerId);
    if (!box) return;
    box.innerHTML = items.map(function (it) {
      return '<button type="button" class="chip' + (it.key === activeKey ? ' is-active' : '') +
        '" data-key="' + esc(it.key) + '">' + esc(it.label) + '</button>';
    }).join('');
    box.querySelectorAll('.chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        box.querySelectorAll('.chip').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        onPick(btn.getAttribute('data-key'));
      });
    });
  }

  function renderChartSwitches(state) {
    var moduleItems = [{ key: 'all', label: '全部' }].concat(M.MODULES.map(function (d) {
      return { key: d.key, label: d.name };
    }));
    chartSwitch('trend-score-switch', [
      { key: 'all', label: '全部' },
      { key: 'defeat', label: '击败比' },
      { key: 'score', label: '分数' }
    ], state.chartFilter.score, function (k) { KG.App.setChartFilter('score', k); });

    chartSwitch('trend-module-switch', moduleItems, state.chartFilter.module, function (k) {
      KG.App.setChartFilter('module', k);
    });

    chartSwitch('trend-time-switch', [{ key: 'total', label: '总用时' }].concat(M.MODULES.map(function (d) {
      return { key: d.key, label: d.name };
    })), state.chartFilter.time, function (k) { KG.App.setChartFilter('time', k); });

    chartSwitch('stats-module-switch', moduleItems, state.chartFilter.statsModule, function (k) {
      KG.App.setChartFilter('statsModule', k);
    });

    chartSwitch('time-analysis-switch', [{ key: 'total', label: '总用时' }].concat(M.MODULES.map(function (d) {
      return { key: d.key, label: d.name };
    })), state.chartFilter.timeAnalysis, function (k) { KG.App.setChartFilter('timeAnalysis', k); });
  }

  /* ==================== 套卷表单（新增 / 编辑） ==================== */

  function moduleRowHtml(def, mod) {
    return '<div class="mod-block" data-module="' + def.key + '">' +
      '<div class="mod-head">' + esc(def.name) + '</div>' +
      '<div class="mod-grid">' +
        '<label class="field"><span class="field-label">总题数</span>' +
          '<input type="number" class="input" min="0" step="1" data-field="questions" value="' + (mod.questions === null || mod.questions === undefined ? '' : mod.questions) + '"></label>' +
        '<label class="field"><span class="field-label">正确题数</span>' +
          '<input type="number" class="input" min="0" step="1" data-field="correct" value="' + (mod.correct === null || mod.correct === undefined ? '' : mod.correct) + '"></label>' +
        '<label class="field"><span class="field-label">正确率（自动）</span>' +
          '<span class="calc" data-calc="accuracy">—</span></label>' +
        '<label class="field"><span class="field-label">平均正确率</span>' +
          '<input type="text" class="input" inputmode="decimal" placeholder="数字或“无”" data-field="avgAccuracy" value="' + (mod.avgAccuracy === null || mod.avgAccuracy === undefined ? '' : mod.avgAccuracy) + '"></label>' +
        '<label class="field"><span class="field-label">用时（分钟）</span>' +
          '<input type="number" class="input" min="0" step="1" data-field="time" value="' + (mod.time === null || mod.time === undefined ? '' : mod.time) + '"></label>' +
      '</div>' +
      '<div class="field-error" data-error="' + def.key + '"></div>' +
    '</div>';
  }

  function groupModuleHtml(def, mod) {
    var subs = M.SUBMODULES[def.key];
    var rows = subs.map(function (s) {
      var sm = mod.subModules[s.key] || {};
      return '<tr data-sub="' + s.key + '">' +
        '<td class="sub-name">' + esc(s.name) + '</td>' +
        '<td><input type="number" class="input input-sm" min="0" step="1" data-field="questions" value="' + (sm.questions === null || sm.questions === undefined ? '' : sm.questions) + '"></td>' +
        '<td><input type="number" class="input input-sm" min="0" step="1" data-field="correct" value="' + (sm.correct === null || sm.correct === undefined ? '' : sm.correct) + '"></td>' +
        '<td class="calc-cell" data-calc="accuracy">—</td>' +
        '<td><input type="text" class="input input-sm" inputmode="decimal" placeholder="数字或“无”" data-field="avgAccuracy" value="' + (sm.avgAccuracy === null || sm.avgAccuracy === undefined ? '' : sm.avgAccuracy) + '"></td>' +
        '<td><input type="number" class="input input-sm" min="0" step="1" data-field="time" value="' + (sm.time === null || sm.time === undefined ? '' : sm.time) + '"></td>' +
      '</tr>';
    }).join('');

    return '<div class="mod-block" data-module="' + def.key + '">' +
      '<div class="mod-head">' + esc(def.name) + '</div>' +
      '<table class="form-table"><thead><tr>' +
        '<th>子模块</th><th>总题数</th><th>正确题数</th><th>正确率（自动）</th><th>平均正确率</th><th>用时（分钟）</th>' +
      '</tr></thead><tbody>' +
        rows +
        '<tr class="total-row">' +
          '<td class="sub-name">总计</td>' +
          '<td class="calc-cell" data-total="questions">—</td>' +
          '<td class="calc-cell" data-total="correct">—</td>' +
          '<td class="calc-cell" data-total="accuracy">—</td>' +
          '<td><input type="text" class="input input-sm" inputmode="decimal" placeholder="数字或“无”" data-field="avgAccuracy" value="' + (mod.avgAccuracy === null || mod.avgAccuracy === undefined ? '' : mod.avgAccuracy) + '"></td>' +
          '<td class="calc-cell" data-total="time">—</td>' +
        '</tr>' +
      '</tbody></table>' +
      '<div class="field-error" data-error="' + def.key + '"></div>' +
    '</div>';
  }

  function recordFormHtml(record) {
    var info = '<div class="mod-block">' +
      '<div class="mod-head">基本信息</div>' +
      '<div class="mod-grid mod-grid-info">' +
        '<label class="field"><span class="field-label">日期 <em class="req">*</em></span>' +
          '<input type="date" class="input" data-field="date" value="' + esc(record.date || '') + '"></label>' +
        '<label class="field"><span class="field-label">试卷 <em class="req">*</em></span>' +
          '<input type="text" class="input" data-field="paperName" placeholder="如 第30季" value="' + esc(record.paperName || '') + '"></label>' +
        '<label class="field"><span class="field-label">分数 <em class="req">*</em></span>' +
          '<input type="number" class="input" min="0" step="0.1" data-field="score" value="' + (record.score === null || record.score === undefined ? '' : record.score) + '"></label>' +
        '<label class="field"><span class="field-label">平均分 <em class="req">*</em></span>' +
          '<input type="number" class="input" min="0" step="0.1" data-field="averageScore" value="' + (record.averageScore === null || record.averageScore === undefined ? '' : record.averageScore) + '"></label>' +
        '<label class="field"><span class="field-label">击败比 % <em class="req">*</em></span>' +
          '<input type="number" class="input" min="0" max="100" step="0.1" data-field="defeatRate" value="' + (record.defeatRate === null || record.defeatRate === undefined ? '' : record.defeatRate) + '"></label>' +
      '</div>' +
      '<div class="field-error" data-error="info"></div>' +
    '</div>';

    var blocks = M.MODULES.map(function (def) {
      var mod = record.modules[def.key] || M.emptyModule(def.key);
      return M.SUBMODULES[def.key] ? groupModuleHtml(def, mod) : moduleRowHtml(def, mod);
    }).join('');

    var summary = '<div class="mod-block summary-block">' +
      '<div class="mod-head">整套卷汇总（自动计算）</div>' +
      '<div class="summary-grid">' +
        '<div class="summary-item"><span>总题数</span><b data-sum="questions">—</b></div>' +
        '<div class="summary-item"><span>总正确题数</span><b data-sum="correct">—</b></div>' +
        '<div class="summary-item"><span>总正确率</span><b data-sum="accuracy">—</b></div>' +
        '<div class="summary-item"><span>总用时</span><b data-sum="time">—</b></div>' +
      '</div>' +
      '<div class="summary-note" data-sum-note hidden></div>' +
    '</div>';

    return info + blocks + summary;
  }

  /** 从表单读取一条记录 */
  function readFormRecord(api, base) {
    function val(scope, field) {
      var el = scope.querySelector('[data-field="' + field + '"]');
      return el ? el.value : '';
    }
    function numVal(scope, field) { return U.toNumber(val(scope, field)); }
    function pctVal(scope, field) { return U.toPercent(val(scope, field)); }

    // base 为 null 表示新增，此时以空白记录为底
    var rec = base ? JSON.parse(JSON.stringify(base)) : M.blankRecord();
    rec.date = (val(api.root, 'date') || '').trim();
    rec.paperName = (val(api.root, 'paperName') || '').trim();
    rec.score = numVal(api.root, 'score');
    rec.averageScore = numVal(api.root, 'averageScore');
    rec.defeatRate = pctVal(api.root, 'defeatRate');

    var infoBlock = api.root.querySelector('.mod-block');
    M.MODULES.forEach(function (def) {
      var block = api.root.querySelector('.mod-block[data-module="' + def.key + '"]');
      var mod = rec.modules[def.key] || M.emptyModule(def.key);

      if (M.SUBMODULES[def.key]) {
        mod.subModules = mod.subModules || {};
        M.SUBMODULES[def.key].forEach(function (s) {
          var tr = block.querySelector('tr[data-sub="' + s.key + '"]');
          mod.subModules[s.key] = {
            name: s.name,
            questions: numVal(tr, 'questions'),
            correct: numVal(tr, 'correct'),
            accuracy: null,
            avgAccuracy: pctVal(tr, 'avgAccuracy'),
            time: numVal(tr, 'time')
          };
        });
        var totalRow = block.querySelector('tr.total-row');
        mod.avgAccuracy = pctVal(totalRow, 'avgAccuracy');
        mod.questions = null;
        mod.correct = null;
        mod.time = null;
        mod.accuracy = null;
      } else {
        mod.name = def.name;
        mod.questions = numVal(block, 'questions');
        mod.correct = numVal(block, 'correct');
        mod.avgAccuracy = pctVal(block, 'avgAccuracy');
        mod.time = numVal(block, 'time');
        mod.accuracy = null;
      }
      rec.modules[def.key] = mod;
    });

    // 表单保存后整套卷汇总按模块重算，原始 Excel 快照失效
    rec.total = { questions: null, correct: null, accuracy: null, time: null };
    rec.raw = null;
    if (infoBlock) { /* 占位，保持结构清晰 */ }
    return rec;
  }

  /** 表单实时回算 */
  function refreshFormCalcs(api, base) {
    function val(scope, field) {
      var el = scope.querySelector('[data-field="' + field + '"]');
      return el ? el.value : '';
    }
    function num(scope, field) { return U.toNumber(val(scope, field)); }
    function setText(el, text) { if (el) el.textContent = text; }

    M.MODULES.forEach(function (def) {
      var block = api.root.querySelector('.mod-block[data-module="' + def.key + '"]');
      if (!block) return;
      if (M.SUBMODULES[def.key]) {
        var sumQ = 0, sumC = 0, sumT = 0, anyQ = false, anyC = false, anyT = false;
        M.SUBMODULES[def.key].forEach(function (s) {
          var tr = block.querySelector('tr[data-sub="' + s.key + '"]');
          var q = num(tr, 'questions'), c = num(tr, 'correct'), t = num(tr, 'time');
          setText(tr.querySelector('[data-calc="accuracy"]'), U.fmtPct(U.calcAccuracy(q, c)));
          if (q !== null) { sumQ += q; anyQ = true; }
          if (c !== null) { sumC += c; anyC = true; }
          if (t !== null) { sumT += t; anyT = true; }
        });
        var tq = anyQ ? U.round(sumQ, 2) : null;
        var tc = anyC ? U.round(sumC, 2) : null;
        var tt = anyT ? U.round(sumT, 2) : null;
        var totalRow = block.querySelector('tr.total-row');
        setText(totalRow.querySelector('[data-total="questions"]'), tq === null ? '—' : U.fmtNum(tq, 0));
        setText(totalRow.querySelector('[data-total="correct"]'), tc === null ? '—' : U.fmtNum(tc, 0));
        setText(totalRow.querySelector('[data-total="accuracy"]'), U.fmtPct(U.calcAccuracy(tq, tc)));
        setText(totalRow.querySelector('[data-total="time"]'), tt === null ? '—' : U.fmtNum(tt, 1));
      } else {
        var q2 = num(block, 'questions'), c2 = num(block, 'correct');
        setText(block.querySelector('[data-calc="accuracy"]'), U.fmtPct(U.calcAccuracy(q2, c2)));
      }
    });

    // 整套卷汇总
    var rec = readFormRecord(api, base);
    M.normalizeRecord(rec);
    var sum = rec.total;
    setText(api.root.querySelector('[data-sum="questions"]'), sum.questions === null ? '—' : U.fmtNum(sum.questions, 0));
    setText(api.root.querySelector('[data-sum="correct"]'), sum.correct === null ? '—' : U.fmtNum(sum.correct, 0));
    setText(api.root.querySelector('[data-sum="accuracy"]'), U.fmtPct(sum.accuracy));
    setText(api.root.querySelector('[data-sum="time"]'), sum.time === null ? '—' : U.fmtNum(sum.time, 1));

    // 编辑导入记录时提示汇总将发生变化
    var note = api.root.querySelector('[data-sum-note]');
    if (note) {
      var diffs = [];
      if (base && base.raw) {
        var raw = base.raw;
        var origQ = raw['总题数'] ? U.toNumber(raw['总题数'].G) : null;
        var origC = raw['正确题数'] ? U.toNumber(raw['正确题数'].G) : null;
        var origT = raw['用时'] ? U.toNumber(raw['用时'].G) : null;
        if (origQ !== null && sum.questions !== null && origQ !== sum.questions) diffs.push('总题数 ' + origQ + ' → ' + sum.questions);
        if (origC !== null && sum.correct !== null && origC !== sum.correct) diffs.push('总正确题数 ' + origC + ' → ' + sum.correct);
        if (origT !== null && sum.time !== null && origT !== sum.time) diffs.push('总用时 ' + origT + ' → ' + sum.time);
      }
      if (diffs.length) {
        note.hidden = false;
        note.textContent = '注意：该记录来自 Excel 导入，保存后将按六大模块自动重算整套卷汇总（' + diffs.join('，') +
          '），导出的 Excel 会以重算后的自洽数据为准。';
      } else {
        note.hidden = true;
        note.textContent = '';
      }
    }
    return rec;
  }

  /** 校验范围严格限定在当前弹窗根节点内，避免读到正在淡出的旧弹窗残留节点 */
  function validateForm(rec, rootEl) {
    var errors = [];
    var scopeRoot = rootEl || document;
    function err(target, msg) { errors.push({ target: target, msg: msg }); }

    if (!rec.date) err('info', '请填写日期');
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) err('info', '日期格式应为 YYYY-MM-DD');
    if (!rec.paperName) err('info', '请填写试卷名称');
    if (rec.score === null || rec.score < 0) err('info', '分数需为不小于 0 的数字');
    if (rec.averageScore === null || rec.averageScore < 0) err('info', '平均分需为不小于 0 的数字');
    if (rec.defeatRate === null || rec.defeatRate < 0 || rec.defeatRate > 100) err('info', '击败比需在 0~100 之间');

    function checkRange(scope, label) {
      var q = U.toNumber(scope.querySelector('[data-field="questions"]') ? scope.querySelector('[data-field="questions"]').value : null);
      var c = U.toNumber(scope.querySelector('[data-field="correct"]') ? scope.querySelector('[data-field="correct"]').value : null);
      var t = U.toNumber(scope.querySelector('[data-field="time"]') ? scope.querySelector('[data-field="time"]').value : null);
      if (q !== null && q < 0) err(label, '总题数不能为负');
      if (c !== null && c < 0) err(label, '正确题数不能为负');
      if (t !== null && t < 0) err(label, '用时不能为负');
      if (q !== null && c !== null && c > q) err(label, '正确题数不能大于总题数');
    }

    M.MODULES.forEach(function (def) {
      var block = scopeRoot.querySelector('.mod-block[data-module="' + def.key + '"]');
      if (!block) return;
      if (M.SUBMODULES[def.key]) {
        M.SUBMODULES[def.key].forEach(function (s) {
          var tr = block.querySelector('tr[data-sub="' + s.key + '"]');
          if (tr) checkRange(tr, def.key);
        });
      } else {
        checkRange(block, def.key);
      }
    });
    return errors;
  }

  function showFormErrors(api, errors) {
    api.root.querySelectorAll('.field-error').forEach(function (el) { el.textContent = ''; });
    errors.forEach(function (e) {
      var box = api.root.querySelector('[data-error="' + e.target + '"]');
      if (box && !box.textContent) box.textContent = e.msg;
    });
    if (errors.length) {
      api.root.querySelectorAll('.mod-block').forEach(function (b) { b.classList.remove('has-error'); });
      errors.forEach(function (e) {
        var block = api.root.querySelector('.mod-block[data-module="' + e.target + '"]');
        if (block) block.classList.add('has-error');
      });
      var first = api.root.querySelector('[data-error="' + errors[0].target + '"]');
      if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  /** 打开新增/编辑表单；onSubmit(record) 返回 true 表示成功（弹窗关闭） */
  function openRecordForm(state, base, isEdit, onSubmit) {
    var record = base ? JSON.parse(JSON.stringify(base)) : M.blankRecord();

    // 新增时沿用最近一套的「总题数」做默认值（题量通常固定），减少重复输入。
    // 刻意不沿用「平均正确率」——那是每次单独查阅的统计值，沿用旧值容易被误当成新数据存下来。
    if (!isEdit && state.records.length) {
      var last = S.latest(state.records);
      M.MODULES.forEach(function (def) {
        var lm = last.modules[def.key];
        var nm = record.modules[def.key];
        if (!lm) return;
        nm.questions = lm.questions;
        if (M.SUBMODULES[def.key]) {
          M.SUBMODULES[def.key].forEach(function (s) {
            var ls = lm.subModules ? lm.subModules[s.key] : null;
            if (ls) nm.subModules[s.key].questions = ls.questions;
          });
        }
      });
    }

    var api = openModal({
      title: isEdit ? '编辑套卷记录' : '新增一套套卷记录',
      size: 'modal-lg',
      body: recordFormHtml(record),
      footer:
        '<span class="modal-foot-hint">正确率由「正确题数 ÷ 总题数」自动计算，不可手填；平均正确率可填数字或「无」。</span>' +
        '<button type="button" class="btn" data-act="cancel">取消</button>' +
        '<button type="button" class="btn btn-primary" data-act="save">' + (isEdit ? '保存修改' : '保存') + '</button>',
      onMount: function (a) {
        function refresh() { refreshFormCalcs(a, base); }
        a.body.addEventListener('input', refresh);
        a.body.addEventListener('change', refresh);
        refresh();

        a.root.querySelector('[data-act="cancel"]').addEventListener('click', a.close);
        a.root.querySelector('[data-act="save"]').addEventListener('click', function () {
          var rec = readFormRecord(a, base);
          var errors = validateForm(rec, a.root);
          if (errors.length) {
            showFormErrors(a, errors);
            toast('请先修正表单中标红的 ' + errors.length + ' 处问题', 'error');
            return;
          }
          M.normalizeRecord(rec);
          if (onSubmit(rec) !== false) a.close();
        });
      }
    });
    return api;
  }

  /* ==================== 详情 ==================== */

  function detailModuleHtml(def, mod, settings) {
    var t = settings || {};
    var target = t.target, warning = t.warning;
    var rows = '<tr><th>总题数</th><td class="num">' + (mod.questions === null ? '—' : U.fmtNum(mod.questions, 0)) + '</td>' +
      '<th>正确题数</th><td class="num">' + (mod.correct === null ? '—' : U.fmtNum(mod.correct, 0)) + '</td></tr>' +
      '<tr><th>正确率</th><td class="num">' + U.fmtPct(U.calcAccuracy(mod.questions, mod.correct)) + '</td>' +
      '<th>平均正确率</th><td class="num">' + U.fmtPct(mod.avgAccuracy) + '</td></tr>' +
      '<tr><th>用时</th><td class="num" colspan="3">' + U.fmtTime(mod.time) + '</td></tr>';

    var subHtml = '';
    if (M.SUBMODULES[def.key]) {
      var subRows = M.SUBMODULES[def.key].map(function (s) {
        var sm = mod.subModules[s.key] || {};
        return '<tr><td class="sub-name">' + esc(s.name) + '</td>' +
          '<td class="num">' + (sm.questions === null || sm.questions === undefined ? '—' : U.fmtNum(sm.questions, 0)) + '</td>' +
          '<td class="num">' + (sm.correct === null || sm.correct === undefined ? '—' : U.fmtNum(sm.correct, 0)) + '</td>' +
          '<td class="num">' + U.fmtPct(U.calcAccuracy(sm.questions, sm.correct)) + '</td>' +
          '<td class="num">' + U.fmtPct(sm.avgAccuracy) + '</td>' +
          '<td class="num">' + (sm.time === null || sm.time === undefined ? '—' : U.fmtNum(sm.time, 1)) + '</td></tr>';
      }).join('');
      subHtml = '<table class="detail-table"><thead><tr>' +
        '<th>子模块</th><th class="num">总题数</th><th class="num">正确题数</th><th class="num">正确率</th>' +
        '<th class="num">平均正确率</th><th class="num">用时</th></tr></thead><tbody>' + subRows +
        '<tr class="total-row"><td class="sub-name">总计</td>' +
        '<td class="num">' + (mod.questions === null ? '—' : U.fmtNum(mod.questions, 0)) + '</td>' +
        '<td class="num">' + (mod.correct === null ? '—' : U.fmtNum(mod.correct, 0)) + '</td>' +
        '<td class="num">' + U.fmtPct(U.calcAccuracy(mod.questions, mod.correct)) + '</td>' +
        '<td class="num">' + U.fmtPct(mod.avgAccuracy) + '</td>' +
        '<td class="num">' + (mod.time === null ? '—' : U.fmtNum(mod.time, 1)) + '</td></tr>' +
        '</tbody></table>';
    }

    return '<div class="detail-block">' +
      '<div class="mod-head">' + esc(def.name) + '</div>' +
      '<table class="detail-table detail-kv"><tbody>' + rows + '</tbody></table>' +
      subHtml +
    '</div>';
  }

  function openDetail(record, state) {
    var rec = record;
    var totalHtml =
      '<div class="detail-block">' +
        '<div class="mod-head">基本信息</div>' +
        '<table class="detail-table detail-kv"><tbody>' +
          '<tr><th>日期</th><td>' + esc(rec.date || '—') + '</td><th>试卷</th><td>' + esc(rec.paperName || '—') + '</td></tr>' +
          '<tr><th>分数</th><td class="num">' + U.fmtNum(rec.score, 1) + '</td><th>平均分</th><td class="num">' + U.fmtNum(rec.averageScore, 1) + '</td></tr>' +
          '<tr><th>击败比</th><td class="num">' + U.fmtPct(rec.defeatRate) + '</td><th></th><td></td></tr>' +
        '</tbody></table>' +
      '</div>' +
      '<div class="detail-block">' +
        '<div class="mod-head">整套卷汇总</div>' +
        '<table class="detail-table detail-kv"><tbody>' +
          '<tr><th>总题数</th><td class="num">' + (rec.total.questions === null ? '—' : U.fmtNum(rec.total.questions, 0)) + '</td>' +
          '<th>总正确题数</th><td class="num">' + (rec.total.correct === null ? '—' : U.fmtNum(rec.total.correct, 0)) + '</td></tr>' +
          '<tr><th>总正确率</th><td class="num">' + U.fmtPct(rec.total.accuracy) + '</td>' +
          '<th>总用时</th><td class="num">' + U.fmtTime(rec.total.time) + '</td></tr>' +
        '</tbody></table>' +
        mismatchHtml(rec) +
      '</div>';

    var modulesHtml = M.MODULES.map(function (def) {
      var t = state.targets[def.key] || M.DEFAULT_TARGETS[def.key];
      return detailModuleHtml(def, rec.modules[def.key] || M.emptyModule(def.key), t);
    }).join('');

    var meta = '<div class="detail-meta">记录 ID：' + esc(rec.id) +
      (rec.createdAt ? ' · 创建于 ' + esc(String(rec.createdAt).slice(0, 19).replace('T', ' ')) : '') +
      '</div>';

    openModal({
      title: '套卷详情 · ' + (rec.paperName || '(无试卷名)'),
      size: 'modal-lg',
      body: meta + totalHtml + modulesHtml,
      footer:
        '<button type="button" class="btn" data-act="close">关闭</button>' +
        '<button type="button" class="btn btn-primary" data-act="edit">编辑</button>',
      onMount: function (a) {
        a.root.querySelector('[data-act="close"]').addEventListener('click', a.close);
        a.root.querySelector('[data-act="edit"]').addEventListener('click', function () {
          a.close();
          KG.App.editRecord(rec);
        });
      }
    });
  }

  /** 源表自身的数据不一致（合计 ≠ 模块之和 等），必须明示而不是静默改写 */
  function mismatchHtml(rec) {
    var diffs = M.totalMismatch(rec);
    M.MODULES.forEach(function (def) {
      if (!M.SUBMODULES[def.key]) return;
      M.groupMismatch(rec, def.key).forEach(function (d) { diffs.push(def.name + '：' + d); });
    });
    if (!diffs.length) return '';
    return '<div class="notice notice-warn">' +
      '<div class="notice-title">原始数据存在不自洽，已按原值保留</div>' +
      '<ul>' + diffs.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' +
      '<div class="notice-foot">导出 Excel 时会原样还原；若在本页编辑并保存该记录，整套卷汇总将按六大模块自动重算。</div>' +
    '</div>';
  }

  /* ==================== 阶段目标编辑 ==================== */

  function openTargetsForm(state, onSubmit) {
    var rows = M.MODULES.map(function (def) {
      var t = state.targets[def.key] || M.DEFAULT_TARGETS[def.key];
      return '<tr data-module="' + def.key + '">' +
        '<td class="sub-name">' + esc(def.name) + '</td>' +
        '<td><input type="number" class="input input-sm" min="0" max="100" step="0.1" data-field="target" value="' + t.target + '"></td>' +
        '<td><input type="number" class="input input-sm" min="0" max="100" step="0.1" data-field="warning" value="' + t.warning + '"></td>' +
      '</tr>';
    }).join('');

    openModal({
      title: '编辑各模块阶段目标',
      size: 'modal-md',
      body: '<p class="modal-hint">阶段目标与黄色下限用于判定每个模块的状态：最近一次正确率 ≥ 阶段目标为达标；介于黄色下限与阶段目标之间为还需努力；低于黄色下限为未达标。</p>' +
        '<table class="form-table"><thead><tr><th>模块</th><th>阶段目标 %</th><th>黄色下限 %</th></tr></thead><tbody>' + rows + '</tbody></table>',
      footer:
        '<button type="button" class="btn" data-act="cancel">取消</button>' +
        '<button type="button" class="btn btn-primary" data-act="save">保存目标</button>',
      onMount: function (a) {
        a.root.querySelector('[data-act="cancel"]').addEventListener('click', a.close);
        a.root.querySelector('[data-act="save"]').addEventListener('click', function () {
          var targets = {};
          var bad = null;
          M.MODULES.forEach(function (def) {
            var tr = a.root.querySelector('tr[data-module="' + def.key + '"]');
            var t = U.toNumber(tr.querySelector('[data-field="target"]').value);
            var w = U.toNumber(tr.querySelector('[data-field="warning"]').value);
            if (t === null || w === null || t < 0 || t > 100 || w < 0 || w > 100) {
              if (!bad) bad = def.name;
            }
            targets[def.key] = { target: t, warning: w };
          });
          if (bad) { toast('「' + bad + '」的目标或下限需在 0~100 之间', 'error'); return; }
          onSubmit(targets);
          a.close();
        });
      }
    });
  }

  /* ==================== 导入去重对话框 ==================== */

  /**
   * 逐条询问重复记录。
   * 返回 Promise<'skip'|'overwrite'|'skip-all'|'overwrite-all'>
   * 「跳过 / 覆盖」只作用于当前这条，「全部跳过 / 全部覆盖」作用于剩余全部。
   */
  function openDedupeDialog(info) {
    return new Promise(function (resolve) {
      var rec = info.record;
      var api = openModal({
        title: '发现重复记录（第 ' + info.index + ' / ' + info.total + ' 条）',
        size: 'modal-md',
        body: '<p>下面这条记录与现有数据的「日期 + 试卷」重复：</p>' +
          '<table class="detail-table detail-kv"><tbody>' +
            '<tr><th>日期</th><td>' + esc(rec.date || '(无日期)') + '</td>' +
            '<th>试卷</th><td>' + esc(rec.paperName || '(无试卷名)') + '</td></tr>' +
            '<tr><th>分数</th><td class="num">' + U.fmtNum(rec.score, 1) + '</td>' +
            '<th>击败比</th><td class="num">' + U.fmtPct(rec.defeatRate) + '</td></tr>' +
          '</tbody></table>' +
          '<p class="modal-hint">跳过：保留现有记录，丢弃本次导入的这条。覆盖：用导入的数据替换现有记录。' +
          (info.total > 1 ? '默认按「跳过」处理；选择「全部」将对剩余 ' + (info.total - info.index) + ' 条同样生效。' : '') +
          '</p>',
        footer:
          '<button type="button" class="btn" data-act="skip">跳过</button>' +
          '<button type="button" class="btn" data-act="overwrite">覆盖</button>' +
          (info.total > 1
            ? '<button type="button" class="btn" data-act="skip-all">全部跳过</button>' +
              '<button type="button" class="btn btn-primary" data-act="overwrite-all">全部覆盖</button>'
            : ''),
        onMount: function (a) {
          var acts = ['skip', 'overwrite', 'skip-all', 'overwrite-all'];
          acts.forEach(function (act) {
            var btn = a.root.querySelector('[data-act="' + act + '"]');
            if (!btn) return;
            btn.addEventListener('click', function () { a.close(); resolve(act); });
          });
        }
      });
      var timer = setInterval(function () {
        if (!document.body.contains(api.root)) {
          clearInterval(timer);
          resolve('skip');      // 关闭窗口默认跳过这条
        }
      }, 120);
    });
  }

  /* ==================== 模块四：用时分析 ==================== */

  var TIME_STATUS_CLASS = { over: 'badge-bad', under: 'badge-info', ontime: 'badge-ok', none: 'badge-none' };

  function timeStatusBadge(st) {
    return '<span class="badge ' + (TIME_STATUS_CLASS[st.key] || 'badge-none') + '">' + esc(st.text) + '</span>';
  }

  function fmtDiff(v) {
    if (v === null) return '—';
    if (v > 0) return '<span class="pct-bad">+' + U.fmtNum(v, 1) + '</span>';
    if (v < 0) return '<span class="pct-under">' + U.fmtNum(v, 1) + '</span>';
    return '<span class="pct-none">0</span>';
  }

  /** 对比套卷下拉：默认跟随最近一次，也可锁定某一次做分析 */
  function renderTimeFocusSelect(state, o) {
    var sel = document.getElementById('time-focus');
    if (!sel) return;

    var opts = ['<option value="">最近一次（自动跟随）</option>'];
    // 倒序：最新的排在最前，方便挑最近几次
    for (var i = o.allRecords.length - 1; i >= 0; i--) {
      var r = o.allRecords[i];
      var label = (r.date || '无日期') + ' · ' + (r.paperName || '未命名');
      if (i === o.allRecords.length - 1) label += '（最近）';
      opts.push('<option value="' + esc(r.id) + '">' + esc(label) + '</option>');
    }
    sel.innerHTML = opts.join('');

    // 选中的记录可能已被删除：此时统计层已回退到最近一次，下拉也要跟着显示"最近一次"
    sel.value = o.focus.isLatest ? '' : o.focus.id;
    if (sel.selectedIndex < 0) sel.value = '';
    sel.disabled = !state.records.length;
  }

  function renderTimeAnalysis(state) {
    var o = S.timeOverview(state.records, state.timePlan, state.timeFocusId);

    renderTimeFocusSelect(state, o);

    var focus = o.focus;
    U.setHtml(document.getElementById('time-hint'),
      state.records.length
        ? '第 ' + focus.index + '/' + focus.total + ' 套 · ' + (focus.paperName || '未命名') +
          '（' + (focus.date || '—') + '）' + (focus.isLatest ? ' · 最近一次' : '')
        : '');

    /* 概览卡片 */
    var cards = [
      {
        label: '标准用时合计',
        value: o.planTotal === null ? '—' : U.fmtNum(o.planTotal, 0),
        sub: '分钟',
        cls: ''
      },
      {
        label: '该套总用时',
        value: o.focusTotal === null ? '—' : U.fmtNum(o.focusTotal, 0),
        sub: '分钟',
        cls: ''
      },
      {
        label: '达成率（实际 / 标准）',
        value: o.achievement === null ? '—' : U.fmtNum(o.achievement, 1),
        sub: '%',
        cls: o.achievement === null ? '' : (o.achievement > 100 ? 'is-bad' : 'is-ok')
      },
      {
        label: o.overage === null || o.overage <= 0 ? '用时差值' : '超时',
        value: o.overage === null ? '—' : U.fmtNum(Math.abs(o.overage), 0),
        sub: o.overage === null ? '' : (o.overage > 0 ? '分钟（超时）' : o.overage < 0 ? '分钟（富余）' : '分钟（正好）'),
        cls: o.overage === null ? '' : (o.overage > 0 ? 'is-bad' : 'is-ok')
      }
    ];
    U.setHtml(document.getElementById('time-cards'), cards.map(function (c) {
      var isUnit = c.sub && c.sub.length <= 2;
      return '<div class="stat-card">' +
        '<div class="stat-label">' + esc(c.label) + '</div>' +
        '<div class="stat-line">' +
          '<span class="stat-value ' + (c.cls || '') + '">' + esc(c.value) + '</span>' +
          (isUnit ? '<span class="stat-unit">' + esc(c.sub) + '</span>' : '') +
        '</div>' +
        (!isUnit && c.sub ? '<div class="stat-sub">' + esc(c.sub) + '</div>' : '') +
      '</div>';
    }).join(''));

    /* 超时排行 */
    var rankBox = document.getElementById('time-ranking');
    if (!state.records.length) {
      rankBox.innerHTML = '<div class="hint">暂无数据。</div>';
    } else if (!o.ranking.length) {
      rankBox.innerHTML = '<div class="hint">还没有可比较的模块（需要先设标准用时，且有实际用时）。</div>';
    } else {
      var over = o.ranking.filter(function (r) { return r.diff > 0; });
      var show = (over.length ? over : o.ranking).slice(0, 5);
      rankBox.innerHTML = '<ul class="rank-list">' + show.map(function (r, i) {
        return '<li class="rank-item rank-' + (r.diff > 0 ? 'over' : 'under') + '">' +
          '<span class="rank-idx">' + (i + 1) + '</span>' +
          '<span class="rank-name">' + esc(r.name) + '</span>' +
          '<span class="rank-val">' + (r.diff > 0 ? '+' : '') + U.fmtNum(r.diff, 1) + ' 分钟</span>' +
          '<span class="rank-detail">（实际 ' + U.fmtNum(r.latest, 1) + ' / 标准 ' + U.fmtNum(r.plan, 1) + '）</span>' +
        '</li>';
      }).join('') + '</ul>' +
      (over.length ? '' : '<div class="hint" style="margin-top:6px">没有超时的模块，下面是富余最多的几个。</div>');
    }

    /* 计划与子模块之和不一致的提示 */
    var note = document.getElementById('time-plan-note');
    var mism = [];
    M.MODULES.forEach(function (def) {
      M.timePlanMismatch(state.timePlan, def.key).forEach(function (d) {
        mism.push(def.name + '：' + d);
      });
    });
    if (mism.length) {
      note.hidden = false;
      note.innerHTML = '<div class="notice-title">标准用时存在不自洽（按原值保留）</div><ul>' +
        mism.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>';
    } else {
      note.hidden = true;
      note.innerHTML = '';
    }

    /* 对比表 */
    var table = document.getElementById('time-table');
    var empty = document.getElementById('time-empty');
    table.querySelector('thead').innerHTML =
      '<tr><th>模块 / 子模块</th><th class="num">标准用时</th><th class="num">实际用时</th>' +
      '<th class="num">历史平均</th><th class="num">差值</th><th class="num">最大</th><th class="num">最小</th>' +
      '<th class="center">状态</th></tr>';

    if (!state.records.length) {
      table.querySelector('tbody').innerHTML = '';
      empty.hidden = false;
      empty.innerHTML = '<p>暂无数据，先添加或导入套卷记录。</p>';
      return;
    }
    empty.hidden = true;

    table.querySelector('tbody').innerHTML = o.rows.map(function (r) {
      var cls = r.level === 'sub' ? 'time-sub-row' : '';
      return '<tr class="' + cls + '">' +
        '<td class="time-name' + (r.level === 'sub' ? ' is-sub' : '') + '">' + esc(r.name) + '</td>' +
        '<td class="num">' + (r.plan === null ? '—' : U.fmtNum(r.plan, 1)) + '</td>' +
        '<td class="num">' + (r.latest === null ? '—' : U.fmtNum(r.latest, 1)) + '</td>' +
        '<td class="num">' + (r.avg === null ? '—' : U.fmtNum(r.avg, 1)) + '</td>' +
        '<td class="num">' + fmtDiff(r.diff) + '</td>' +
        '<td class="num">' + (r.max === null ? '—' : U.fmtNum(r.max, 1)) + '</td>' +
        '<td class="num">' + (r.min === null ? '—' : U.fmtNum(r.min, 1)) + '</td>' +
        '<td class="center">' + timeStatusBadge(r.status) + '</td>' +
      '</tr>';
    }).join('');
  }

  /* ==================== 标准用时编辑 ==================== */

  function openTimePlanForm(state, onSubmit) {
    var plan = M.normalizeTimePlan(state.timePlan);

    function rowHtml(key, name, level, value, parent) {
      return '<tr data-key="' + esc(key) + '" class="' + (level === 'sub' ? 'time-sub-row' : '') + '">' +
        '<td class="time-name' + (level === 'sub' ? ' is-sub' : '') + '">' + esc(name) + '</td>' +
        '<td><input type="number" class="input input-sm" min="0" step="0.5" data-field="plan" ' +
          'value="' + (value === null || value === undefined ? '' : value) + '"></td>' +
        '</tr>';
    }

    var rows = '';
    M.MODULES.forEach(function (def) {
      var p = plan[def.key];
      rows += rowHtml(def.key, def.name, 'module', p.plan);
      if (M.SUBMODULES[def.key]) {
        M.SUBMODULES[def.key].forEach(function (s) {
          rows += rowHtml(def.key + '.' + s.key, s.name, 'sub', p.subs ? p.subs[s.key] : null);
        });
      }
    });

    openModal({
      title: '编辑标准用时（分钟）',
      size: 'modal-md',
      body: '<p class="modal-hint">这里是每题型的计划用时，用于「模块四：用时分析」里的达成率、超时排行和趋势图上的标准线。' +
        '留空表示不设标准（该行状态显示「未设标准」，不参与排行）。模块与其子模块都可以单独修改。</p>' +
        '<table class="form-table timeplan-table"><thead><tr><th>模块 / 子模块</th><th>标准用时（分钟）</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
        '<div class="summary-grid" style="margin-top:12px">' +
          '<div class="summary-item"><span>六大模块标准用时合计</span><b data-plan-total>—</b></div>' +
        '</div>',
      footer:
        '<button type="button" class="btn" data-act="reset">恢复默认</button>' +
        '<button type="button" class="btn" data-act="cancel">取消</button>' +
        '<button type="button" class="btn btn-primary" data-act="save">保存标准用时</button>',
      onMount: function (a) {
        /** 表格每行都有，读出来就是完整结构；空输入框 => null（不设标准） */
        function readRows() {
          var out = {};
          a.root.querySelectorAll('tr[data-key]').forEach(function (tr) {
            var key = tr.getAttribute('data-key');
            var v = U.toNumber(tr.querySelector('[data-field="plan"]').value);
            if (v !== null && v < 0) v = 0;
            var parts = key.split('.');
            out[parts[0]] = out[parts[0]] || { plan: null, subs: null };
            if (parts.length === 1) {
              out[parts[0]].plan = v;
            } else {
              out[parts[0]].subs = out[parts[0]].subs || {};
              out[parts[0]].subs[parts[1]] = v;
            }
          });
          return out;
        }
        function refreshTotal() {
          var v = M.timePlanTotal(readRows());
          a.root.querySelector('[data-plan-total]').textContent = v === null ? '—' : U.fmtNum(v, 0) + ' 分钟';
        }
        a.body.addEventListener('input', refreshTotal);
        refreshTotal();

        a.root.querySelector('[data-act="cancel"]').addEventListener('click', a.close);
        a.root.querySelector('[data-act="reset"]').addEventListener('click', function () {
          var d = M.normalizeTimePlan(null);
          a.root.querySelectorAll('tr[data-key]').forEach(function (tr) {
            var key = tr.getAttribute('data-key');
            var v;
            if (key.indexOf('.') < 0) v = d[key] ? d[key].plan : null;
            else {
              var parts = key.split('.');
              v = d[parts[0]] && d[parts[0]].subs ? d[parts[0]].subs[parts[1]] : null;
            }
            tr.querySelector('[data-field="plan"]').value = (v === null || v === undefined) ? '' : v;
          });
          refreshTotal();
          toast('已恢复为默认标准用时，点「保存标准用时」生效', 'info');
        });
        a.root.querySelector('[data-act="save"]').addEventListener('click', function () {
          onSubmit(M.normalizeTimePlan(readRows()));
          a.close();
        });
      }
    });
  }

  /* ==================== 数据文件夹：状态渲染 ==================== */

  function fmtStamp(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return U.ymd(d) + ' ' + U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes()) + ':' + U.pad2(d.getSeconds());
  }

  function renderStorageStatus(s) {
    var status = document.getElementById('storage-status');
    var path = document.getElementById('storage-path');
    var note = document.getElementById('storage-note');
    var hint = document.getElementById('storage-hint');
    var btnBind = document.getElementById('btn-fs-bind');
    var btnWrite = document.getElementById('btn-fs-write');
    var btnRead = document.getElementById('btn-fs-read');
    var btnUnbind = document.getElementById('btn-fs-unbind');
    if (!status) return;

    var granted = s.bound && s.permission === 'granted';
    var lines = [];      // 引导语 + 提示 + 错误，始终并列显示，不互相覆盖
    var guidance;

    if (!s.supported) {
      // 两种原因要分开说：页面不是 https（浏览器不提供该 API） vs 浏览器本身不支持
      if (!s.secure) {
        status.innerHTML = '<span class="dot dot-off"></span>当前页面不是 https，浏览器禁用了目录授权';
        guidance = '出于安全策略，浏览器只在安全上下文（<b>https://</b> 或 <code>file://</code> / localhost）下' +
          '提供目录授权。用 https 打开本页面即可启用该功能。' +
          '在此之前，数据仍保存在浏览器本地存储中，可用「数据备份 / 数据恢复」手动导出 JSON。';
      } else {
        status.innerHTML = '<span class="dot dot-off"></span>当前浏览器不支持目录授权';
        guidance = '数据仍保存在浏览器本地存储中，可用「数据备份 / 数据恢复」手动导出 JSON。' +
          '若想让数据固定落在 <code>./data/</code>，请用 <b>Chrome 或 Edge</b> 打开本页面。';
      }
      path.textContent = '';
      hint.textContent = '';
      btnBind.disabled = true; btnWrite.disabled = true; btnRead.disabled = true; btnUnbind.disabled = true;
    } else {
      if (granted) {
        status.innerHTML = '<span class="dot dot-ok"></span>已绑定数据文件夹' +
          (s.lastAction ? '（' + esc(s.lastAction) + '）' : '');
        path.textContent = s.dirName + '\\' + s.fileName;
        guidance = '每次新增 / 编辑 / 删除 / 改目标设置后自动写入。最后写入：' + esc(fmtStamp(s.lastWriteAt));
        hint.textContent = '自动同步中';
      } else if (s.bound) {
        status.innerHTML = '<span class="dot dot-warn"></span>已绑定，但需要重新授权';
        path.textContent = s.dirName + '\\' + s.fileName;
        guidance = '浏览器重启后授权会失效。点「恢复访问」再确认一次即可继续自动写入。';
        hint.textContent = '待授权';
      } else {
        status.innerHTML = '<span class="dot dot-off"></span>未绑定数据文件夹（数据存在浏览器本地存储中）';
        path.textContent = '';
        guidance = '点「绑定数据文件夹」，在弹窗里选中项目下的 <b>data</b> 文件夹，' +
          '之后每次改动都会自动写入 <code>data\\' + esc(s.fileName) + '</code>。' +
          '数据会以可读的 JSON 形式落盘，方便备份、进 git 或用其它工具处理。';
        hint.textContent = '';
      }
      btnBind.textContent = (s.bound && !granted) ? '恢复访问' : '绑定数据文件夹';
      btnBind.disabled = granted;
      btnWrite.disabled = !granted;
      btnRead.disabled = !granted;
      btnUnbind.disabled = !s.bound;
    }

    lines.push(guidance);
    if (granted && s.dirName && s.dirName.toLowerCase() !== 'data') {
      lines.push('<span class="line-warn">注意：绑定的文件夹名为「' + esc(s.dirName) +
        '」，不是项目下的 data 文件夹。文件会写到 ' + esc(s.dirName) + '\\' + esc(s.fileName) +
        '；若要改用项目里的 data，请先解绑再重新绑定。</span>');
    }
    if (s.persistWarning) {
      lines.push('<span class="line-warn">' + esc(s.persistWarning) + '</span>');
    }
    if (s.lastError) {
      var extra = '';
      if (/user gesture/i.test(s.lastError)) {
        extra = '<br>这次点击被浏览器判定为「非真实用户操作」（脚本触发的点击不算）。请直接用手点这个按钮。';
      } else if (s.lastError.indexOf('SecurityError') >= 0) {
        extra = '<br>该浏览器在 file:// 下禁止了目录授权。可改用「数据备份」手动导出，或改从本地服务器打开页面（详见 README）。';
      }
      lines.push('<span class="line-err">' + esc(s.lastError) + extra + '</span>');
    }
    note.className = 'storage-note';
    note.innerHTML = lines.join('<br>');
  }

  /* ==================== 数据文件夹：内容不一致对话框 ==================== */

  /** 返回 Promise<'file'|'local'|'skip'> */
  function openDivergenceDialog(info) {
    return new Promise(function (resolve) {
      var api = openModal({
        title: '数据文件与浏览器本地数据不一致',
        size: 'modal-md',
        body: '<p>已绑定的数据文件内容与浏览器本地保存的数据不同，为避免丢数据，请你决定以哪一份为准：</p>' +
          '<div class="divergence-compare">' +
            '<div class="divergence-col"><h4>数据文件</h4>' +
              '<dl><dt>记录数</dt><dd>' + info.fileCount + ' 条</dd></dl>' +
              '<dl><dt>导出时间</dt><dd>' + esc(info.fileTime) + '</dd></dl>' +
            '</div>' +
            '<div class="divergence-col"><h4>浏览器本地</h4>' +
              '<dl><dt>记录数</dt><dd>' + info.localCount + ' 条</dd></dl>' +
              '<dl><dt>最后修改</dt><dd>' + esc(info.localTime) + '</dd></dl>' +
            '</div>' +
          '</div>' +
          '<p class="modal-hint">「用文件覆盖本地」会丢弃浏览器里的当前数据；「用本地覆盖文件」会覆盖磁盘上的 JSON。' +
          '选择「暂不处理」则本次不动任何一边，之后可用上方「立即写入 / 从文件读取」手动同步。</p>',
        footer:
          '<button type="button" class="btn" data-act="skip">暂不处理</button>' +
          '<button type="button" class="btn" data-act="file">用文件覆盖本地</button>' +
          '<button type="button" class="btn btn-primary" data-act="local">用本地覆盖文件</button>',
        onMount: function (a) {
          ['skip', 'file', 'local'].forEach(function (act) {
            a.root.querySelector('[data-act="' + act + '"]').addEventListener('click', function () {
              a.close();
              resolve(act);
            });
          });
        }
      });
      var timer = setInterval(function () {
        if (!document.body.contains(api.root)) { clearInterval(timer); resolve('skip'); }
      }, 150);
    });
  }

  /* ==================== 清空记录（需输入 DELETE） ==================== */

  function openClearDialog(count) {
    return new Promise(function (resolve) {
      var api = openModal({
        title: '确认清空全部套卷记录',
        size: 'modal-sm',
        body: '<div class="confirm-body">' +
          '<p><b>⚠️ 确认清空全部套卷记录？</b></p>' +
          '<p>当前记录：<b>' + count + '</b> 条</p>' +
          '<p>请输入 <code>DELETE</code> 以确认：</p>' +
          '<input type="text" class="input" id="clear-confirm-input" autocomplete="off" placeholder="DELETE">' +
          '<div class="field-error" data-error="clear"></div>' +
          '<p class="modal-hint">此操作不可撤销。建议先执行「数据备份」。</p>' +
        '</div>',
        footer:
          '<button type="button" class="btn" data-act="cancel">取消</button>' +
          '<button type="button" class="btn btn-danger" data-act="ok">确认清空</button>',
        onMount: function (a) {
          var input = a.root.querySelector('#clear-confirm-input');
          var errBox = a.root.querySelector('[data-error="clear"]');
          input.focus();
          a.root.querySelector('[data-act="cancel"]').addEventListener('click', function () { a.close(); resolve(false); });
          a.root.querySelector('[data-act="ok"]').addEventListener('click', function () {
            // 大小写不敏感（输入 delete 也接受），但必须是 DELETE 这个词
            if (input.value.trim().toUpperCase() !== 'DELETE') {
              errBox.textContent = '请输入 DELETE 以确认清空';
              input.classList.add('is-invalid');
              input.focus();
              return;
            }
            a.close();
            resolve(true);
          });
          input.addEventListener('keydown', function (e) { if (e.key === 'Enter') a.root.querySelector('[data-act="ok"]').click(); });
        }
      });
      var timer = setInterval(function () {
        if (!document.body.contains(api.root)) { clearInterval(timer); resolve(false); }
      }, 120);
    });
  }

  /* ==================== 导出 ==================== */

  KG.UI = {
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    confirmDialog: confirmDialog,
    pctHtml: pctHtml,
    statusBadge: statusBadge,
    renderOverview: renderOverview,
    renderSettings: renderSettings,
    readSettingsForm: readSettingsForm,
    renderRecordsTable: renderRecordsTable,
    filterRecords: filterRecords,
    renderStatsTable: renderStatsTable,
    renderTimeAnalysis: renderTimeAnalysis,
    openTimePlanForm: openTimePlanForm,
    renderChartSwitches: renderChartSwitches,
    openRecordForm: openRecordForm,
    openDetail: openDetail,
    openTargetsForm: openTargetsForm,
    openDedupeDialog: openDedupeDialog,
    openClearDialog: openClearDialog,
    renderStorageStatus: renderStorageStatus,
    openDivergenceDialog: openDivergenceDialog
  };
})();
