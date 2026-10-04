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

  /* 表头「言语理解 / 判断推理」点击后，在列右侧展开各套卷子模块正确率小窗；
     同一时刻只开一列，小窗的行与主表数据行一一对齐 */
  var openSubCol = null;

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
    var headHtml = '<tr>' +
      cols.map(function (c, i) {
        var num = i >= 2 ? ' class="num"' : '';
        return '<th' + num + '>' + esc(c) + '</th>';
      }).join('') +
      M.MODULES.map(function (def) {
        if (!M.SUBMODULES[def.key]) return '<th class="num">' + esc(def.name) + '</th>';
        var open = openSubCol === def.key;
        return '<th class="num sub-th' + (open ? ' is-open' : '') + '" data-col="' + esc(def.key) + '">' +
          '<button type="button" class="sub-th-toggle" data-act="sub-col" data-key="' + esc(def.key) + '"' +
          ' aria-expanded="' + (open ? 'true' : 'false') + '" title="点击查看各套卷的子模块正确率">' +
          esc(def.name) + '<span class="sub-caret" aria-hidden="true">▾</span></button></th>';
      }).join('') +
      '<th class="num">总用时</th><th class="ops">操作</th></tr>';
    thead.innerHTML = headHtml;

    U.setHtml(document.getElementById('records-count'),
      '共 ' + state.records.length + ' 条' + (list.length !== state.records.length ? '（筛选后 ' + list.length + ' 条）' : ''));

    renderSubPop(state, list);   // 放在空列表分支之前：筛到空时要顺手把小窗也收掉

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

  /**
   * 子模块正确率小窗：贴在被点表头列的右侧，行与主表数据行一一对齐
   * （单元格规格复用 .data-table，行高与主表一致才能对齐），不标日期。
   * 着色沿用该列模块的阶段目标 / 黄色下限。
   */
  function renderSubPop(state, list) {
    var table = document.getElementById('records-table');
    if (!table) return;
    var scroll = table.closest('.table-scroll');
    if (!scroll) return;
    var old = scroll.querySelector('.sub-pop');
    if (old) old.parentNode.removeChild(old);
    if (!openSubCol) return;
    if (!list.length) { openSubCol = null; return; }   // 没有数据可展示就顺手复位，避免下次凭空冒出来

    var target = state.targets[openSubCol] || M.DEFAULT_TARGETS[openSubCol];
    var subs = M.SUBMODULES[openSubCol] || [];
    var headCells = subs.map(function (s) { return '<th class="num">' + esc(s.name) + '</th>'; }).join('');
    var rows = list.map(function (r) {
      var mod = (r.modules && r.modules[openSubCol]) || {};
      var sms = mod.subModules || {};
      var cells = subs.map(function (s) {
        var sm = sms[s.key] || {};
        return '<td class="num">' + pctHtml(U.calcAccuracy(sm.questions, sm.correct), target.target, target.warning) + '</td>';
      }).join('');
      return '<tr data-id="' + esc(r.id) + '">' + cells + '</tr>';
    }).join('');

    var el = document.createElement('div');
    el.className = 'sub-pop';
    el.innerHTML = '<table class="data-table sub-pop-table">' +
      '<thead><tr>' + headCells + '</tr></thead><tbody>' + rows + '</tbody></table>';
    scroll.appendChild(el);
    placeSubPop();
  }

  /** 让已打开的小窗重新贴合所点表头（窗口缩放、从别的页签切回来时需要） */
  function placeSubPop() {
    var table = document.getElementById('records-table');
    if (!table) return;
    var scroll = table.closest('.table-scroll');
    if (!scroll) return;
    var el = scroll.querySelector('.sub-pop');
    var th = openSubCol && table.querySelector('thead th[data-col="' + openSubCol + '"]');
    var head = table.querySelector('thead');
    if (!el || !th || !head) return;
    if (!th.getBoundingClientRect().width) return;   // 面板隐藏时量不到，等切回来再定位
    var base = scroll.getBoundingClientRect();
    var thr = th.getBoundingClientRect();
    var hr = head.getBoundingClientRect();
    el.style.left = (thr.right - base.left + scroll.scrollLeft) + 'px';
    el.style.top = (hr.top - base.top + scroll.scrollTop) + 'px';   // 名称行与主表表头同一行
    syncSubPopRows(table, el.querySelector('table'));
  }

  /* 主表行里「操作」列按钮比纯文字高，行高会多出几像素；
     把小窗每行的高度照抄主表对应行，保证逐行对齐不漂移 */
  function syncSubPopRows(mainTable, popTable) {
    var pairs = [[mainTable.querySelector('thead tr'), popTable.querySelector('thead tr')]];
    var mainRows = mainTable.querySelectorAll('tbody tr');
    var popRows = popTable.querySelectorAll('tbody tr');
    for (var i = 0; i < popRows.length && i < mainRows.length; i++) pairs.push([mainRows[i], popRows[i]]);
    pairs.forEach(function (pair) {
      if (!pair[0] || !pair[1]) return;
      pair[1].style.height = pair[0].getBoundingClientRect().height + 'px';
    });
  }

  /** 开 / 关某列的子模块小窗（再点同一表头即关闭） */
  function toggleSubPop(state, key) {
    openSubCol = openSubCol === key ? null : key;
    renderRecordsTable(state);
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

  /* ==================== 模块五：每日计划 ==================== */

  function fmtDay(dateStr, todayStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
    if (!m) return '—';
    var short = (+m[2]) + '月' + (+m[3]) + '日 ' + M.weekdayName(dateStr);
    if (dateStr === todayStr) return '今天 · ' + short;
    if (dateStr < todayStr) return short;
    return short;
  }

  function fmtMonthDay(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
    return m ? (+m[2]) + '月' + (+m[3]) + '日' : '—';
  }

  function planMetaHtml(plan, state, todayStr) {
    var parts = [];
    if (plan.kind === 'week') {
      parts.push('<span>' + esc(fmtMonthDay(M.weekStartOf(plan.date)) + ' – ' + fmtMonthDay(M.weekEndOf(plan.date))) + '</span>');
    } else {
      var cls = (!plan.done && plan.date < todayStr) ? ' class="overdue"' : '';
      parts.push('<span' + cls + '>' + esc(fmtDay(plan.date, todayStr)) + '</span>');
    }
    if (plan.minutes !== null) parts.push('计划 ' + U.fmtNum(plan.minutes, 0) + ' 分钟');
    var studied = KG.Plans.studiedSecondsOf(state, plan.id);
    if (studied > 0) {
      parts.push('<span class="actual">实际 ' + esc(M.fmtDuration(studied)) + '</span>');
    }
    var badges = [];
    if (plan.ruleId) {
      var rule = (state.planRules || []).filter(function (r) { return r.id === plan.ruleId; })[0];
      badges.push('<span class="plan-badge is-repeat">🔁 ' + esc(rule ? (rule.freq === 'daily' ? '每日' : '每周') : '循环') + '</span>');
    }
    if (plan.category) badges.push('<span class="plan-badge">' + esc(plan.category) + '</span>');
    if (!plan.done && plan.date < todayStr) badges.push('<span class="plan-badge is-overdue">已过期</span>');
    return '<div class="plan-meta">' + parts.join(' · ') + (badges.length ? ' ' + badges.join(' ') : '') + '</div>';
  }

  function planBodyHtml(plan) {
    if (plan.contentMode === 'list') {
      if (!plan.items.length) return '<div class="plan-content">（清单为空）</div>';
      var items = plan.items.map(function (it) {
        return '<label class="plan-item' + (it.done ? ' is-done' : '') + '">' +
          '<input type="checkbox" data-act="item-toggle" data-item="' + esc(it.id) + '"' + (it.done ? ' checked' : '') + '>' +
          '<span class="pi-text">' + esc(it.text || '（未命名）') + '</span>' +
          '<span class="pi-min">' + (it.minutes === null ? '—' : U.fmtNum(it.minutes, 0) + ' 分钟') + '</span>' +
        '</label>';
      }).join('');
      var done = plan.items.filter(function (it) { return it.done; }).length;
      var pct = Math.round((done / plan.items.length) * 100);
      return '<div class="plan-items">' + items + '</div>' +
        '<div class="plan-progress">' +
          '<span class="plan-progress-bar"><i style="width:' + pct + '%"></i></span>' +
          '<span class="plan-progress-text">' + done + '/' + plan.items.length + '</span>' +
        '</div>';
    }
    return plan.content
      ? '<div class="plan-content">' + esc(plan.content) + '</div>'
      : '';
  }

  function planActionsHtml(plan) {
    var running = KG.App && KG.App.state.timer && KG.App.state.timer.active && KG.App.state.timer.planId === plan.id;
    return '<div class="plan-actions">' +
      '<button type="button" class="btn btn-xs" data-act="start" title="开始计时">' + (running ? '计时中' : '▶ 开始') + '</button>' +
      '<button type="button" class="btn btn-xs" data-act="edit">编辑</button>' +
      '<button type="button" class="btn btn-xs btn-danger-ghost" data-act="delete">删除</button>' +
    '</div>';
  }

  function planCardHtml(plan, state, todayStr) {
    var cls = ['plan-card'];
    var overdue = !plan.done && plan.date < todayStr;
    if (plan.done) cls.push('is-done');
    if (overdue) cls.push('is-overdue');
    if (plan.kind === 'week') cls.push('is-week');
    if (state.timer && state.timer.active && state.timer.planId === plan.id) cls.push('is-running');

    return '<div class="' + cls.join(' ') + '" data-id="' + esc(plan.id) + '">' +
      '<input type="checkbox" class="plan-check" data-act="toggle"' + (plan.done ? ' checked' : '') + ' title="标记完成">' +
      '<div class="plan-main">' +
        '<div class="plan-head">' +
          '<div class="plan-title">' + esc(plan.title || '（未命名计划）') + '</div>' +
          planActionsHtml(plan) +
        '</div>' +
        planMetaHtml(plan, state, todayStr) +
        planBodyHtml(plan) +
      '</div>' +
    '</div>';
  }

  function ruleCardHtml(rule, state, g) {
    var comp = KG.Plans.ruleCompletion(state, rule, g.weekStart, g.weekEnd);
    if (!comp.total) return '';          // 本周还没有实例（比如规则是下周才开始的）
    var pct = comp.rate === null ? 0 : comp.rate;
    var cls = ['plan-card', 'is-week'];
    if (comp.done === comp.total) cls.push('is-done');

    var body = '';
    if (rule.contentMode === 'list' && rule.items.length) {
      body = '<div class="plan-content">' + esc(rule.items.map(function (it) { return it.text; }).filter(Boolean).join('、')) + '</div>';
    } else if (rule.content) {
      body = '<div class="plan-content">' + esc(rule.content) + '</div>';
    }

    return '<div class="' + cls.join(' ') + '" data-rule-id="' + esc(rule.id) + '">' +
      '<div class="plan-main">' +
        '<div class="plan-head">' +
          '<div class="plan-title">' + esc(rule.title || '（未命名计划）') + '</div>' +
          '<div class="plan-actions">' +
            '<button type="button" class="btn btn-xs" data-act="rule-edit">编辑</button>' +
            '<button type="button" class="btn btn-xs btn-danger-ghost" data-act="rule-delete">停止</button>' +
          '</div>' +
        '</div>' +
        '<div class="plan-meta">' +
          '<span class="plan-badge is-repeat">🔁 ' + (rule.freq === 'daily' ? '每日' : '每周') + '重复</span> ' +
          '本周期 ' + esc(fmtMonthDay(g.weekStart) + ' – ' + fmtMonthDay(g.weekEnd)) +
          (comp.planMinutes === null ? '' : ' · 计划 ' + U.fmtNum(comp.planMinutes, 0) + ' 分钟') +
        '</div>' +
        '<div class="plan-progress">' +
          '<span class="plan-progress-bar"><i style="width:' + pct + '%"></i></span>' +
          '<span class="plan-progress-text">' + comp.done + '/' + comp.total + ' 完成</span>' +
        '</div>' +
        body +
      '</div>' +
    '</div>';
  }

  /**
   * 「循环计划」管理卡：列出所有规则，让用户随时能改重复方式或停止循环。
   * 没有这个区，每日循环就只能从某一天的编辑/删除弹窗里绕进去，很难找。
   */
  function ruleManageCardHtml(rule, state) {
    var instances = (state.plans || []).filter(function (p) { return p.ruleId === rule.id; });
    var done = instances.filter(function (p) { return p.done; }).length;
    var start = U.toDateString(rule.startDate);
    var until = rule.until ? U.toDateString(rule.until) : '';
    var range = until ? (fmtMonthDay(start) + ' – ' + fmtMonthDay(until)) : (fmtMonthDay(start) + ' 起，一直重复');

    return '<div class="plan-card is-week" data-rule-id="' + esc(rule.id) + '">' +
      '<div class="plan-main">' +
        '<div class="plan-head">' +
          '<div class="plan-title">' + esc(rule.title || '（未命名计划）') + '</div>' +
          '<div class="plan-actions">' +
            '<button type="button" class="btn btn-xs" data-act="rule-edit">编辑</button>' +
            '<button type="button" class="btn btn-xs btn-danger-ghost" data-act="rule-delete">停止</button>' +
          '</div>' +
        '</div>' +
        '<div class="plan-meta">' +
          '<span class="plan-badge is-repeat">🔁 ' + (rule.freq === 'daily' ? '每日' : '每周') + '</span>' +
          (rule.category ? ' <span class="plan-badge">' + esc(rule.category) + '</span>' : '') +
          ' ' + esc(rule.kind === 'week' ? '周计划' : '日计划') + ' · ' + esc(range) +
          (rule.minutes === null ? '' : ' · 计划 ' + U.fmtNum(rule.minutes, 0) + ' 分钟') +
        '</div>' +
        '<div class="plan-progress">' +
          '<span class="plan-progress-text">已生成 ' + instances.length + ' 条，完成 ' + done + ' 条</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  var PLAN_FILTERS = [
    { key: 'today', label: '今天' },
    { key: 'week', label: '本周' },
    { key: 'all', label: '全部' }
  ];

  function renderPlans(state) {
    var todayStr = U.today();
    var g = KG.Plans.group(state, todayStr);

    // 概览卡片
    var todayComp = KG.Plans.completionOf(g.todayPlans);
    var weekAll = (state.plans || []).filter(function (p) { return p.date >= g.weekStart && p.date <= g.weekEnd; });
    var weekComp = KG.Plans.completionOf(weekAll);
    var overdue = (state.plans || []).filter(function (p) { return !p.done && p.date < todayStr; });

    var cards = [
      { label: '今天要完成', value: todayComp.total ? todayComp.done + '/' + todayComp.total : '0', sub: '项' },
      { label: '今日完成率', value: todayComp.rate === null ? '—' : U.fmtNum(todayComp.rate, 0), sub: '%' },
      { label: '本周完成率', value: weekComp.rate === null ? '—' : U.fmtNum(weekComp.rate, 0), sub: '%' },
      {
        label: '过期未完成',
        value: String(overdue.length),
        sub: '项',
        cls: overdue.length ? 'is-bad' : ''
      }
    ];
    U.setHtml(document.getElementById('plans-cards'), cards.map(function (c) {
      var isUnit = c.sub && c.sub.length <= 2;
      return '<div class="stat-card">' +
        '<div class="stat-label">' + esc(c.label) + '</div>' +
        '<div class="stat-line"><span class="stat-value ' + (c.cls || '') + '">' + esc(c.value) + '</span>' +
        (isUnit ? '<span class="stat-unit">' + esc(c.sub) + '</span>' : '') + '</div>' +
      '</div>';
    }).join(''));

    U.setHtml(document.getElementById('plans-hint'),
      (state.plans || []).length ? '共 ' + state.plans.length + ' 条计划' +
        ((state.planRules || []).length ? ' · ' + state.planRules.length + ' 条循环规则' : '') : '');

    // 筛选
    chartSwitch('plans-filter', PLAN_FILTERS, state.planFilter, function (k) {
      KG.App.setPlanFilter(k);
    });

    var showToday = state.planFilter !== 'week' || true;   // 今天始终显示
    var showWeek = state.planFilter !== 'today';
    var showOther = state.planFilter === 'all';

    // 今天
    document.getElementById('plan-today-card').hidden = !showToday;
    var todayBox = document.getElementById('plan-today');
    var todayEmpty = document.getElementById('plan-today-empty');
    U.setHtml(document.getElementById('plan-today-title'), '今天 · ' + fmtDay(todayStr, todayStr));
    if (g.todayPlans.length) {
      todayEmpty.hidden = true;
      todayBox.innerHTML = g.todayPlans.map(function (p) { return planCardHtml(p, state, todayStr); }).join('');
    } else {
      todayBox.innerHTML = '';
      todayEmpty.hidden = false;
      todayEmpty.innerHTML = '<p>今天还没有安排。点右上角「+ 新增计划」加一条，或在计划里勾「每日重复」让它自动出现。</p>';
    }

    // 本周
    document.getElementById('plan-week-card').hidden = !showWeek;
    var weekRuleHtml = g.weekRules.map(function (r) { return ruleCardHtml(r, state, g); }).join('');
    var weekCardHtml = g.weekPlans.map(function (p) { return planCardHtml(p, state, todayStr); }).join('');
    var weekBox = document.getElementById('plan-week');
    var weekEmpty = document.getElementById('plan-week-empty');
    U.setHtml(document.getElementById('plan-week-title'), '本周 · ' + fmtMonthDay(g.weekStart) + ' – ' + fmtMonthDay(g.weekEnd));
    U.setHtml(document.getElementById('plan-week-hint'), weekComp.total ? '完成 ' + weekComp.done + '/' + weekComp.total + ' 项' : '');
    if (weekRuleHtml || weekCardHtml) {
      weekEmpty.hidden = true;
      weekBox.innerHTML = weekRuleHtml + weekCardHtml;
    } else {
      weekBox.innerHTML = '';
      weekEmpty.hidden = false;
      weekEmpty.innerHTML = '<p>本周没有计划。</p>';
    }

    // 循环计划（管理入口，始终显示）
    var rulesCard = document.getElementById('plan-rules-card');
    var rules = state.planRules || [];
    rulesCard.hidden = !rules.length;
    if (rules.length) {
      U.setHtml(document.getElementById('plan-rules-hint'), rules.length + ' 条循环规则');
      document.getElementById('plan-rules').innerHTML = rules.map(function (r) {
        return ruleManageCardHtml(r, state);
      }).join('');
    }

    // 往后 / 历史
    document.getElementById('plan-other-card').hidden = !showOther;
    if (showOther) {
      var otherBox = document.getElementById('plan-other');
      var otherEmpty = document.getElementById('plan-other-empty');
      U.setHtml(document.getElementById('plan-other-hint'), g.otherPlans.length + ' 条');
      if (g.otherPlans.length) {
        otherEmpty.hidden = true;
        otherBox.innerHTML = g.otherPlans.map(function (p) { return planCardHtml(p, state, todayStr); }).join('');
      } else {
        otherBox.innerHTML = '';
        otherEmpty.hidden = false;
        otherEmpty.innerHTML = '<p>没有本周之外的计划。</p>';
      }
    }
  }

  /* ---------------- 计划表单 ---------------- */

  function categoryOptionsHtml(selected, allowEmpty) {
    var opts = allowEmpty ? ['<option value="">（未指定）</option>'] : [];
    M.PLAN_CATEGORIES.forEach(function (c) {
      opts.push('<option value="' + esc(c) + '"' + (c === selected ? ' selected' : '') + '>' + esc(c) + '</option>');
    });
    if (selected && M.PLAN_CATEGORIES.indexOf(selected) < 0) {
      opts.push('<option value="' + esc(selected) + '" selected>' + esc(selected) + '</option>');
    }
    return opts.join('');
  }

  function planItemRowHtml(it) {
    return '<div class="plan-item-row" data-item-row>' +
      '<input type="text" class="input input-sm" data-field="item-text" placeholder="学什么" value="' + esc(it.text || '') + '">' +
      '<input type="number" class="input input-sm" min="0" step="5" data-field="item-minutes" placeholder="分钟" value="' +
        (it.minutes === null || it.minutes === undefined ? '' : it.minutes) + '">' +
      '<button type="button" class="btn btn-xs btn-danger-ghost" data-act="item-del" title="删除这一项">×</button>' +
    '</div>';
  }

  function planFormHtml(plan, isRule) {
    var repeat = 'none';
    var until = '';
    if (isRule) {
      repeat = plan.freq;
      until = plan.until || '';
    }
    var isWeek = plan.kind === 'week';

    var repeatOpts = [
      '<option value="none"' + (repeat === 'none' ? ' selected' : '') + '>不重复</option>',
      '<option value="daily"' + (repeat === 'daily' ? ' selected' : '') + (isWeek ? ' disabled' : '') + '>每日重复</option>',
      '<option value="weekly"' + (repeat === 'weekly' ? ' selected' : '') + '>每周重复（与起始日期同一个星期几）</option>'
    ].join('');

    return '' +
      '<div class="mod-block">' +
        '<div class="mod-head">基本信息</div>' +
        '<div class="mod-grid">' +
          '<label class="field"><span class="field-label">类型</span>' +
            '<select class="input" data-field="kind"' + (isRule ? ' disabled' : '') + '>' +
              '<option value="day"' + (isWeek ? '' : ' selected') + '>日计划</option>' +
              '<option value="week"' + (isWeek ? ' selected' : '') + '>周计划</option>' +
            '</select></label>' +
          '<label class="field"><span class="field-label">日期 <em class="req">*</em></span>' +
            '<input type="date" class="input" data-field="date" value="' + esc(plan.date || U.today()) + '"></label>' +
          '<label class="field"><span class="field-label">标题 <em class="req">*</em></span>' +
            '<input type="text" class="input" data-field="title" placeholder="如 行测第30季套卷" value="' + esc(plan.title || '') + '"></label>' +
          '<label class="field"><span class="field-label">科目</span>' +
            '<select class="input" data-field="category">' + categoryOptionsHtml(plan.category || '', true) + '</select></label>' +
        '</div>' +
        '<div class="field-error" data-error="info"></div>' +
      '</div>' +

      '<div class="mod-block">' +
        '<div class="mod-head">学习内容</div>' +
        '<div class="chart-switch" id="plan-mode-switch">' +
          '<button type="button" class="chip' + (plan.contentMode !== 'list' ? ' is-active' : '') + '" data-mode="text">文本文形式</button>' +
          '<button type="button" class="chip' + (plan.contentMode === 'list' ? ' is-active' : '') + '" data-mode="list">清单形式（可逐条勾）</button>' +
        '</div>' +
        '<div data-mode-pane="text"' + (plan.contentMode === 'list' ? ' hidden' : '') + '>' +
          '<label class="field"><span class="field-label">具体学习内容</span>' +
            '<textarea class="input" rows="3" data-field="content" placeholder="可换行写多条，如：做题 + 逐题复盘错因">' + esc(plan.content || '') + '</textarea></label>' +
          '<label class="field" style="max-width:220px;margin-top:10px"><span class="field-label">学习时长（分钟）</span>' +
            '<input type="number" class="input" min="0" step="5" data-field="minutes" value="' +
              (plan.minutes === null || plan.minutes === undefined ? '' : plan.minutes) + '"></label>' +
        '</div>' +
        '<div data-mode-pane="list"' + (plan.contentMode === 'list' ? '' : ' hidden') + '>' +
          '<div class="plan-items-edit" data-items-box>' +
            (plan.items && plan.items.length ? plan.items.map(planItemRowHtml).join('') : '') +
          '</div>' +
          '<div class="plan-items-foot">' +
            '<button type="button" class="btn btn-xs" data-act="item-add">+ 添加一项</button>' +
            '<span class="hint">合计 <b data-items-total>—</b> 分钟（自动汇总）</span>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="mod-block" data-block="repeat">' +
        '<div class="mod-head">重复</div>' +
        '<div class="mod-grid">' +
          '<label class="field"><span class="field-label">重复方式</span>' +
            '<select class="input" data-field="repeat">' + repeatOpts + '</select></label>' +
          '<label class="field"><span class="field-label">截止日期（可选）</span>' +
            '<input type="date" class="input" data-field="until" value="' + esc(until) + '"></label>' +
        '</div>' +
        '<p class="modal-hint">选择重复后，系统会自动把实例铺到「今天」和「本周日」中较晚的那天；' +
        '之后每次打开页面自动补齐。已勾选过的历史实例不会被覆盖。</p>' +
      '</div>';
  }

  /** 从表单读出计划或规则 */
  function readPlanForm(api, base, isRule) {
    function val(f) { var el = api.root.querySelector('[data-field="' + f + '"]'); return el ? el.value : ''; }
    function num(f) { return U.toNumber(val(f)); }

    var kind = api.root.querySelector('[data-field="kind"]').value === 'week' ? 'week' : 'day';
    var date = U.toDateString(val('date'));
    var repeat = val('repeat');
    // 周计划按周一归一，循环与不循环统一，卡片上也好算
    if (kind === 'week' && date) date = M.weekStartOf(date);

    var mode = api.root.querySelector('#plan-mode-switch .chip.is-active');
    var contentMode = mode && mode.getAttribute('data-mode') === 'list' ? 'list' : 'text';

    var items = [];
    if (contentMode === 'list') {
      Array.prototype.slice.call(api.root.querySelectorAll('[data-items-box] [data-item-row]')).forEach(function (row) {
        var text = row.querySelector('[data-field="item-text"]').value.trim();
        var min = U.toNumber(row.querySelector('[data-field="item-minutes"]').value);
        if (!text && min === null) return;      // 整行空着就忽略
        items.push({ id: U.uuid(), text: text, minutes: min, done: false });
      });
    }

    var now = new Date().toISOString();
    var untilDate = U.toDateString(val('until')) || null;

    if (isRule) {
      var rule = base && base.id ? base : M.blankPlanRule({});
      rule.freq = repeat === 'weekly' ? 'weekly' : 'daily';
      rule.startDate = date;
      rule.until = untilDate;
      if (repeat === 'none') rule.until = untilDate || date;   // 不重复 = 只生成当天
      rule.kind = kind;
      rule.title = val('title').trim();
      rule.category = val('category');
      rule.contentMode = contentMode;
      rule.content = val('content');
      rule.items = items;
      rule.minutes = num('minutes');
      return { rule: rule, repeat: repeat, untilDate: untilDate, kind: kind };
    }

    var plan = base && base.id ? base : M.blankPlan(kind, date);
    plan.kind = kind;
    if (plan.kind === 'week') plan.date = M.weekStartOf(date) || date;
    else plan.date = date;
    plan.title = val('title').trim();
    plan.category = val('category');
    plan.contentMode = contentMode;
    plan.content = val('content');
    plan.items = items;
    plan.minutes = num('minutes');
    plan.updatedAt = now;
    return { plan: M.normalizePlan(plan), repeat: repeat, untilDate: untilDate, kind: kind };
  }

  function refreshPlanForm(api) {
    var paneText = api.root.querySelector('[data-mode-pane="text"]');
    var paneList = api.root.querySelector('[data-mode-pane="list"]');
    var active = api.root.querySelector('#plan-mode-switch .chip.is-active');
    var isList = active && active.getAttribute('data-mode') === 'list';
    if (paneText) paneText.hidden = isList;
    if (paneList) paneList.hidden = !isList;

    var box = api.root.querySelector('[data-items-box]');
    var total = 0, has = false;
    if (box) {
      Array.prototype.slice.call(box.querySelectorAll('[data-item-row]')).forEach(function (row) {
        var m = U.toNumber(row.querySelector('[data-field="item-minutes"]').value);
        if (m !== null) { total += m; has = true; }
      });
    }
    var el = api.root.querySelector('[data-items-total]');
    if (el) el.textContent = has ? U.fmtNum(total, 0) : '—';
  }

  /**
   * 打开计划表单。
   * isRule=true 时编辑的是循环规则本身（模板）。
   */
  function openPlanForm(state, base, isRule, onSave) {
    var model0 = base && base.id ? base : (isRule ? M.blankPlanRule({}) : M.blankPlan('day', U.today()));
    var api = openModal({
      title: isRule ? '编辑循环计划' : (base && base.id ? '编辑计划' : '新增计划'),
      size: 'modal-md',
      body: planFormHtml(model0, isRule),
      footer:
        '<button type="button" class="btn" data-act="cancel">取消</button>' +
        '<button type="button" class="btn btn-primary" data-act="save">保存</button>',
      onMount: function (a) {
        // 编辑循环展开出来的某一天时，重复方式归规则管——这里只改这一次，不让他改重复
        if (!isRule && base && base.ruleId) {
          var block = a.root.querySelector('[data-block="repeat"]');
          if (block) {
            block.innerHTML = '<div class="mod-head">重复</div>' +
              '<p class="modal-hint">这条计划来自一个循环计划。这里只修改这一次；' +
              '要改重复方式或影响未来的实例，请在卡片上选「编辑 → 改整个循环」。</p>';
          }
        }

        a.body.addEventListener('input', function () { refreshPlanForm(a); });
        a.body.addEventListener('change', function () { refreshPlanForm(a); });

        a.root.querySelectorAll('#plan-mode-switch .chip').forEach(function (chip) {
          chip.addEventListener('click', function () {
            a.root.querySelectorAll('#plan-mode-switch .chip').forEach(function (c) { c.classList.remove('is-active'); });
            chip.classList.add('is-active');
            refreshPlanForm(a);
          });
        });
        a.root.querySelector('[data-act="item-add"]').addEventListener('click', function () {
          var box = a.root.querySelector('[data-items-box]');
          var div = document.createElement('div');
          div.innerHTML = planItemRowHtml(M.blankPlanItem());
          box.appendChild(div.firstChild);
          refreshPlanForm(a);
        });
        a.body.addEventListener('click', function (e) {
          var del = e.target.closest && e.target.closest('[data-act="item-del"]');
          if (del) {
            var row = del.closest('[data-item-row]');
            if (row) row.parentNode.removeChild(row);
            refreshPlanForm(a);
          }
        });
        a.root.querySelector('[data-field="kind"]').addEventListener('change', function () {
          var dailyOpt = a.root.querySelector('[data-field="repeat"] option[value="daily"]');
          var isWeek = this.value === 'week';
          if (dailyOpt) dailyOpt.disabled = isWeek;
          if (isWeek && a.root.querySelector('[data-field="repeat"]').value === 'daily') {
            a.root.querySelector('[data-field="repeat"]').value = 'none';
          }
        });
        refreshPlanForm(a);

        a.root.querySelector('[data-act="cancel"]').addEventListener('click', a.close);
        a.root.querySelector('[data-act="save"]').addEventListener('click', function () {
          var out = readPlanForm(a, model0, isRule);
          var target = isRule ? out.rule : out.plan;
          // 注意：规则存的是 startDate，计划存的是 date，别查错字段
          var dateValue = isRule ? target.startDate : target.date;
          if (!dateValue) { toast('请选择日期', 'error'); return; }
          if (!target.title) { toast('请填写标题', 'error'); return; }
          if (target.contentMode === 'list' && !target.items.length) {
            toast('清单形式至少要填一项内容', 'error');
            return;
          }
          if (isRule && out.repeat === 'none' && !U.toDateString(a.root.querySelector('[data-field="until"]').value)) {
            toast('选择了不重复，请填截止日期或改用「新增计划」建普通计划', 'error');
            return;
          }
          onSave(out, a);
          a.close();
        });
      }
    });
    return api;
  }

  /** 编辑/删除循环实例时的作用域询问 */
  function openPlanScopeDialog(action, title) {
    return new Promise(function (resolve) {
      var isDelete = action === 'delete';
      var api = openModal({
        title: isDelete ? '删除循环计划' : '编辑循环计划',
        size: 'modal-sm',
        body: '<p>「' + esc(title || '这条计划') + '」属于一个循环计划。</p>' +
          '<p class="modal-hint">' + (isDelete
            ? '只删这一次：保留循环，未来的实例照常生成。删除整个循环：连同未来已生成的实例一起删掉，历史保留。'
            : '只改这一次：只影响当天这条。改整个循环：修改规则模板，未来已生成的实例一起更新，历史保留。') + '</p>',
        footer:
          '<button type="button" class="btn" data-act="cancel">取消</button>' +
          '<button type="button" class="btn" data-act="once">' + (isDelete ? '只删这一次' : '只改这一次') + '</button>' +
          '<button type="button" class="btn btn-primary" data-act="series">' + (isDelete ? '删除整个循环' : '改整个循环') + '</button>',
        onMount: function (a) {
          ['once', 'series'].forEach(function (k) {
            a.root.querySelector('[data-act="' + k + '"]').addEventListener('click', function () {
              a.close(); resolve(k);
            });
          });
        }
      });
      var timer = setInterval(function () {
        if (!document.body.contains(api.root)) { clearInterval(timer); resolve(null); }
      }, 150);
    });
  }

  /* ==================== 模块六：学习计时 ==================== */

  /**
   * 计时可以挂到哪些计划上：**只限今天**。
   *   - 日计划：日期就是今天
   *   - 周计划：它的日期存的是周一，所以按「落在本周范围内」算（它确实是今天生效的计划）
   * 避免把计时挂到昨天/明天的计划上，让那张卡片的「实际用时」跨天串味。
   */
  function timerSelectablePlans(state) {
    var todayStr = U.today();
    var weekStart = M.weekStartOf(todayStr);
    var weekEnd = M.weekEndOf(todayStr);
    return (state.plans || []).filter(function (p) {
      if (p.date === todayStr) return true;
      if (p.kind === 'week' && p.date >= weekStart && p.date <= weekEnd) return true;
      return false;
    }).sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'week' ? 1 : -1;   // 日计划排前面（更常计时）
      return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1;
    });
  }

  function timerStartAreaHtml(state) {
    var opts = ['<option value="">（不选，自由计时）</option>'];
    timerSelectablePlans(state).forEach(function (p) {
      var label = (p.kind === 'week' ? '[周计划] ' : '') + (p.title || '未命名');
      opts.push('<option value="' + esc(p.id) + '">' + esc(label) + '</option>');
    });
    return opts.join('');
  }

  function renderTimer(state) {
    var t = state.timer;
    var active = !!(t && t.active);

    document.getElementById('timer-start-area').hidden = active;
    document.getElementById('timer-running-area').hidden = !active;

    var selectable = timerSelectablePlans(state);
    U.setHtml(document.getElementById('timer-mode-hint'),
      selectable.length
        ? '可选计划：只列今天的（' + selectable.length + ' 个）'
        : '今天没有计划，可自由计时（或先去模块五添加）');

    var sel = document.getElementById('timer-plan-select');
    if (sel) {
      sel.innerHTML = timerStartAreaHtml(state);
      // innerHTML 会把选中值重置成第一项，所以每次重绘都要把选择还原回去
      var want = state.timerPlanId || '';
      sel.value = want;
      if (sel.value !== want) {
        // 原选择已不在可选范围（例如跨天了），退回「自由计时」
        sel.value = '';
        state.timerPlanId = '';
      }
    }
    var cat = document.getElementById('timer-category');
    if (cat && !cat.options.length) cat.innerHTML = categoryOptionsHtml(state.timerCategory || '', true);

    var modeSel = document.getElementById('timer-mode');
    if (modeSel && state.timerMode) modeSel.value = state.timerMode;

    if (active) {
      var live = document.getElementById('timer-running-area');
      var isPomo = t.mode === 'pomodoro';
      live.querySelector('.timer-live').classList.toggle('is-paused', KG.Timer.running(t) === false);
      var meta = [];
      meta.push(t.label || '自由学习');
      if (t.category) meta.push(t.category);
      meta.push(isPomo ? '番茄钟' : '正计时');
      if (isPomo) meta.push('第 ' + ((t.pomodoros || 0) + 1) + ' 个番茄 · ' + (t.phase === 'focus' ? '专注中' : '休息中'));
      U.setHtml(document.getElementById('timer-live-meta'), esc(meta.join(' · ')));
      document.getElementById('btn-timer-pause').textContent = KG.Timer.running(t) ? '暂停' : '继续';
    }

    // 概览卡片
    var o = KG.Plans.overview(state, U.today());
    var cards = [
      { label: '今日学习', value: M.fmtDuration(o.today.seconds), sub: '' },
      { label: '本周学习', value: M.fmtDuration(o.week.seconds), sub: '' },
      { label: '本月学习', value: M.fmtDuration(o.month.seconds), sub: '' },
      {
        label: '平均每天（有记录 ' + o.month.activeDays + ' 天）',
        value: M.fmtDuration(o.month.avgPerActiveDay),
        sub: ''
      }
    ];
    U.setHtml(document.getElementById('timer-cards'), cards.map(function (c) {
      return '<div class="stat-card">' +
        '<div class="stat-label">' + esc(c.label) + '</div>' +
        '<div class="stat-line"><span class="stat-value">' + esc(c.value) + '</span></div>' +
      '</div>';
    }).join(''));

    U.setHtml(document.getElementById('timer-hint'),
      o.month.count ? '本月 ' + o.month.count + ' 次计时' : '');

    // 分布切换
    chartSwitch('timer-dist-switch', [
      { key: 'category', label: '按科目' },
      { key: 'plan', label: '按计划' }
    ], state.timerDist || 'category', function (k) { KG.App.setTimerDist(k); });

    // 当天时间线
    var list = KG.Plans.sessionsOf(state, U.today());
    var table = document.getElementById('session-table');
    table.querySelector('thead').innerHTML =
      '<tr><th>时间</th><th>学的是什么</th><th>科目</th><th class="num">时长</th><th class="num">番茄</th><th class="ops">操作</th></tr>';
    var empty = document.getElementById('session-empty');
    if (list.length) {
      empty.hidden = true;
      table.querySelector('tbody').innerHTML = list.map(function (s) {
        var t0 = s.startAt ? new Date(s.startAt) : null;
        var t1 = s.endAt ? new Date(s.endAt) : null;
        var hhmm = function (d) { return d ? U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes()) : '—'; };
        return '<tr data-id="' + esc(s.id) + '">' +
          '<td class="num">' + esc(hhmm(t0) + ' – ' + hhmm(t1)) + '</td>' +
          '<td>' + esc(s.label || '自由学习') + '</td>' +
          '<td>' + esc(s.category || '—') + '</td>' +
          '<td class="num">' + esc(M.fmtDuration(s.seconds)) + '</td>' +
          '<td class="num">' + (s.pomodoros ? s.pomodoros : '—') + '</td>' +
          '<td class="ops"><button type="button" class="btn btn-xs btn-danger-ghost" data-act="session-del">删除</button></td>' +
        '</tr>';
      }).join('');
    } else {
      table.querySelector('tbody').innerHTML = '';
      empty.hidden = false;
      empty.innerHTML = '<p>今天还没有计时记录。</p>';
    }
    U.setHtml(document.getElementById('timeline-title'),
      '当天时间线' + (list.length ? '（合计 ' + M.fmtDuration(KG.Plans.sumSeconds(list)) + '）' : ''));

    // 分布（饼图 + 图例）
    var byWhat = state.timerDist === 'plan' ? 'plan' : 'category';
    var dist = KG.Plans.distribution(state, U.today(), byWhat);
    U.setHtml(document.getElementById('dist-title'), byWhat === 'category' ? '今日时长分布（按科目）' : '今日时长分布（按计划）');
    var box = document.getElementById('chart-dist');
    var ph = document.getElementById('chart-dist-empty');
    if (dist.length) {
      box.hidden = false;
      ph.hidden = true;
      KG.Charts.renderDistribution('chart-dist', dist);
    } else {
      box.hidden = true;
      ph.hidden = false;
      KG.Charts.disposeChart('chart-dist');
    }
    var palette = ['#2563eb', '#0d9488', '#7c3aed', '#d97706', '#db2777', '#16a34a', '#0891b2', '#dc2626'];
    U.setHtml(document.getElementById('dist-legend'), dist.map(function (d, i) {
      return '<div class="pie-legend-item">' +
        '<span class="pie-legend-swatch" style="background:' + palette[i % palette.length] + '"></span>' +
        '<span class="pie-legend-name">' + esc(d.name) + '</span>' +
        '<span class="pie-legend-val">' + esc(M.fmtDuration(d.seconds)) + ' · ' + U.fmtNum(d.percent, 0) + '%</span>' +
      '</div>';
    }).join(''));

    renderTimerBar(state);
  }

  function renderTimerBar(state) {
    var bar = document.getElementById('timer-bar');
    if (!bar) return;
    var t = state.timer;
    if (!t || !t.active) {
      bar.hidden = true;
      // 计时条消失后把正文底部留白收回来
      document.body.classList.remove('has-timer-bar');
      return;
    }
    bar.hidden = false;
    // 计时条是 fixed 的，会盖住页面右下角（比如饼图图例）；
    // 给正文加底部留白，保证内容能滚到它上方
    document.body.classList.add('has-timer-bar');
    var isPomo = t.mode === 'pomodoro';
    bar.classList.toggle('is-paused', !KG.Timer.running(t));
    U.setHtml(document.getElementById('timer-bar-label'), esc(t.label || '自由学习'));
    U.setHtml(document.getElementById('timer-bar-phase'),
      isPomo ? '第 ' + ((t.pomodoros || 0) + 1) + ' 个 · ' + (t.phase === 'focus' ? '专注' : '休息') : '');
    document.getElementById('btn-bar-pause').textContent = KG.Timer.running(t) ? '暂停' : '继续';
  }

  /** 每秒刷新计时显示（不重绘整个界面，避免闪烁） */
  function tickTimerDisplay(state) {
    var t = state.timer;
    if (!t || !t.active) return;
    var clock, label;
    if (t.mode === 'pomodoro') {
      clock = M.fmtClock(KG.Timer.phaseRemainSeconds(t));
      label = t.phase === 'focus' ? '剩余专注' : '休息剩余';
    } else {
      clock = M.fmtClock(Math.floor(KG.Timer.studyMs(t) / 1000));
      label = '已学习';
    }
    var live = document.getElementById('timer-live-clock');
    if (live) live.textContent = clock;
    var barClock = document.getElementById('timer-bar-clock');
    if (barClock) barClock.textContent = clock;
    var phase = document.getElementById('timer-bar-phase');
    if (phase && t.mode === 'pomodoro') {
      phase.textContent = '第 ' + ((t.pomodoros || 0) + 1) + ' 个 · ' + (t.phase === 'focus' ? '专注' : '休息');
    }
    var meta = document.getElementById('timer-live-meta');
    if (meta) {
      var parts = [t.label || '自由学习'];
      if (t.category) parts.push(t.category);
      parts.push(t.mode === 'pomodoro' ? '番茄钟' : '正计时');
      parts.push(label + ' ' + clock);
      meta.textContent = parts.join(' · ');
    }
  }

  /* ---------------- 番茄设置 ---------------- */

  function openPomoConfigForm(state, onSubmit) {
    var p = M.normalizePomo(state.settings.pomo);
    openModal({
      title: '番茄钟设置',
      size: 'modal-sm',
      body: '<div class="mod-grid">' +
        '<label class="field"><span class="field-label">专注时长（分钟）</span>' +
          '<input type="number" class="input" min="1" step="1" data-field="focusMin" value="' + p.focusMin + '"></label>' +
        '<label class="field"><span class="field-label">短休息（分钟）</span>' +
          '<input type="number" class="input" min="1" step="1" data-field="breakMin" value="' + p.breakMin + '"></label>' +
        '<label class="field"><span class="field-label">长休息（分钟）</span>' +
          '<input type="number" class="input" min="1" step="1" data-field="longBreakMin" value="' + p.longBreakMin + '"></label>' +
        '<label class="field"><span class="field-label">几个番茄后长休息</span>' +
          '<input type="number" class="input" min="1" step="1" data-field="longEvery" value="' + p.longEvery + '"></label>' +
      '</div>' +
      '<p class="modal-hint">休息时间不计入学习时长，只有专注阶段算。' +
      '到点会响一声并把浏览器标题闪动提示（如果听不到，多半是浏览器禁止了自动播放，点一下页面再试）。</p>',
      footer:
        '<button type="button" class="btn" data-act="cancel">取消</button>' +
        '<button type="button" class="btn btn-primary" data-act="save">保存</button>',
      onMount: function (a) {
        a.root.querySelector('[data-act="cancel"]').addEventListener('click', a.close);
        a.root.querySelector('[data-act="save"]').addEventListener('click', function () {
          var out = {};
          ['focusMin', 'breakMin', 'longBreakMin', 'longEvery'].forEach(function (k) {
            out[k] = U.toNumber(a.root.querySelector('[data-field="' + k + '"]').value);
          });
          onSubmit(M.normalizePomo(out));
          a.close();
        });
      }
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
    toggleSubPop: toggleSubPop,
    placeSubPop: placeSubPop,
    filterRecords: filterRecords,
    renderStatsTable: renderStatsTable,
    renderTimeAnalysis: renderTimeAnalysis,
    openTimePlanForm: openTimePlanForm,
    renderPlans: renderPlans,
    openPlanForm: openPlanForm,
    openPlanScopeDialog: openPlanScopeDialog,
    renderTimer: renderTimer,
    timerSelectablePlans: timerSelectablePlans,
    renderTimerBar: renderTimerBar,
    tickTimerDisplay: tickTimerDisplay,
    openPomoConfigForm: openPomoConfigForm,
    categoryOptionsHtml: categoryOptionsHtml,
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
