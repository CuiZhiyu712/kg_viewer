/* statistics.js —— 统计指标计算（全部由 records 动态推导，无任何硬编码数据） */
var KG = window.KG || (window.KG = {});

(function () {
  'use strict';

  var U = KG.Utils;
  var M = KG.Model;

  /** 按日期升序排序；日期缺失的排在最前；同日按创建时间兜底 */
  function sortedAsc(records) {
    return records.slice().sort(function (a, b) {
      var av = U.dateValue(a.date);
      var bv = U.dateValue(b.date);
      if (isNaN(av)) av = -Infinity;
      if (isNaN(bv)) bv = -Infinity;
      if (av !== bv) return av - bv;
      var ac = a.createdAt || '', bc = b.createdAt || '';
      if (ac !== bc) return ac < bc ? -1 : 1;
      return (a.id || '') < (b.id || '') ? -1 : 1;
    });
  }

  function mean(values) {
    var nums = values.filter(function (v) { return v !== null && v !== undefined && isFinite(v); });
    if (!nums.length) return null;
    var sum = 0;
    nums.forEach(function (v) { sum += v; });
    return U.round(sum / nums.length, 2);
  }

  function latest(records) {
    var s = sortedAsc(records);
    return s.length ? s[s.length - 1] : null;
  }

  function previous(records) {
    var s = sortedAsc(records);
    return s.length >= 2 ? s[s.length - 2] : null;
  }

  /** 顶部概览卡片（§50） */
  function overview(records) {
    var last = latest(records);
    return {
      count: records.length,
      avgScore: mean(records.map(function (r) { return r.score; })),
      avgDefeatRate: mean(records.map(function (r) { return r.defeatRate; })),
      latestScore: last ? last.score : null,
      latestDate: last ? last.date : '',
      latestPaper: last ? last.paperName : '',
      avgTotalAccuracy: mean(records.map(function (r) { return r.total ? r.total.accuracy : null; }))
    };
  }

  /** 最近一次 vs 上一次（§51），只给数值变化，不做主观评价 */
  function deltas(records) {
    var cur = latest(records);
    var prev = previous(records);
    function d(label, key, digits) {
      var c = cur ? key(cur) : null;
      var p = prev ? key(prev) : null;
      return {
        label: label,
        current: c,
        previous: p,
        delta: (c !== null && p !== null) ? U.round(c - p, 2) : null,
        digits: digits
      };
    }
    return [
      d('分数', function (r) { return U.toNumber(r.score); }, 1),
      d('击败比', function (r) { return U.toNumber(r.defeatRate); }, 1),
      d('总正确率', function (r) { return r.total ? r.total.accuracy : null; }, 2)
    ];
  }

  /**
   * 各模块统计（§40）
   * 题数     —— 最近一次记录的模块总题数（缺失时回溯到最近有值的记录）
   * 最近一次 —— 最新记录该模块的正确率
   * 平均正确率 —— 所有套卷该模块正确率的算术平均
   * 最高正确率 —— 所有套卷中的最大值
   * 记录平均正确率 —— 最新记录中用户填写的「平均正确率」（可为 null）
   */
  function moduleStats(records, targets) {
    var s = sortedAsc(records);
    var cur = s.length ? s[s.length - 1] : null;

    return M.MODULES.map(function (def) {
      var key = def.key;
      var accs = s.map(function (r) { return M.moduleAccuracy(r, key); })
                   .filter(function (v) { return v !== null; });

      var questions = null;
      var recAvg = null;
      for (var i = s.length - 1; i >= 0; i--) {
        var m = s[i].modules[key];
        if (!m) continue;
        if (questions === null && m.questions !== null && m.questions !== undefined) questions = m.questions;
        if (recAvg === null && m.avgAccuracy !== null && m.avgAccuracy !== undefined) recAvg = m.avgAccuracy;
      }

      var latestAcc = cur ? M.moduleAccuracy(cur, key) : null;
      var t = (targets && targets[key]) || M.DEFAULT_TARGETS[key];

      return {
        key: key,
        name: def.name,
        questions: questions,
        latest: latestAcc,
        latestDate: cur ? cur.date : '',
        latestPaper: cur ? cur.paperName : '',
        avg: mean(accs),
        max: accs.length ? Math.max.apply(null, accs) : null,
        recordAvgAccuracy: recAvg,
        target: U.toNumber(t.target),
        warning: U.toNumber(t.warning),
        status: U.statusOf(latestAcc, t.target, t.warning),
        sampleCount: accs.length
      };
    });
  }

  /** 击败比 / 分数趋势用的数据点 */
  function scoreSeries(records) {
    return sortedAsc(records).map(function (r) {
      return {
        id: r.id,
        date: r.date,
        paperName: r.paperName,
        score: U.toNumber(r.score),
        averageScore: U.toNumber(r.averageScore),
        defeatRate: U.toNumber(r.defeatRate),
        totalAccuracy: r.total ? r.total.accuracy : null
      };
    });
  }

  /** 模块正确率趋势用的数据点 */
  function moduleSeries(records) {
    var s = sortedAsc(records);
    return {
      points: s.map(function (r) {
        var row = { id: r.id, date: r.date, paperName: r.paperName };
        M.MODULES.forEach(function (def) {
          row[def.key] = M.moduleAccuracy(r, def.key);
        });
        return row;
      })
    };
  }

  /** 用时趋势用的数据点（总用时 + 六大模块用时） */
  function timeSeries(records) {
    var s = sortedAsc(records);
    return s.map(function (r) {
      var row = {
        id: r.id,
        date: r.date,
        paperName: r.paperName,
        totalTime: r.total ? r.total.time : null
      };
      M.MODULES.forEach(function (def) {
        var m = r.modules[def.key];
        row[def.key] = m ? m.time : null;
      });
      return row;
    });
  }

  /* ==================== 用时分析 ==================== */

  /**
   * 挑出「要分析哪一次」：给了 focusId 就用它，找不到（或没给）就退回最近一次。
   * 这样用户在用时分析里选了某套卷后，删掉它也不会让页面出错。
   */
  function pickFocus(sortedList, focusId) {
    if (!sortedList.length) return null;
    if (focusId) {
      for (var i = 0; i < sortedList.length; i++) {
        if (sortedList[i].id === focusId) return sortedList[i];
      }
    }
    return sortedList[sortedList.length - 1];
  }

  /** 选中记录在列表中的位置信息，供界面提示「是第几套 / 是不是最近一次」 */
  function focusInfo(sortedList, cur) {
    var latest = sortedList.length ? sortedList[sortedList.length - 1] : null;
    var idx = -1;
    for (var i = 0; i < sortedList.length; i++) if (sortedList[i] === cur) idx = i;
    return {
      id: cur ? cur.id : '',
      date: cur ? cur.date : '',
      paperName: cur ? cur.paperName : '',
      index: idx < 0 ? -1 : idx + 1,          // 第几套（按日期升序）
      total: sortedList.length,
      isLatest: !!cur && cur === latest
    };
  }

  /** 单个（子）模块的用时行：计划 / 最近一次 / 历史平均 / 差值 / 状态 */
  function buildTimeRow(opts) {
    var plan = U.toNumber(opts.plan);
    var actuals = opts.records.map(opts.getActual).filter(function (v) { return v !== null && v !== undefined; });
    var latest = opts.latestActual === undefined ? null : opts.latestActual;
    var diff = (latest !== null && plan !== null) ? U.round(latest - plan, 2) : null;

    var status = { key: 'none', text: '无数据' };
    if (latest === null) status = { key: 'none', text: '无数据' };
    else if (plan === null) status = { key: 'none', text: '未设标准' };
    else if (diff > 0) status = { key: 'over', text: '超时' };
    else if (diff < 0) status = { key: 'under', text: '富余' };
    else status = { key: 'ontime', text: '达标' };

    return {
      key: opts.key,
      name: opts.name,
      level: opts.level,
      parent: opts.parent || '',
      plan: plan,
      latest: latest,
      latestDate: opts.latestDate || '',
      latestPaper: opts.latestPaper || '',
      avg: mean(actuals),
      max: actuals.length ? Math.max.apply(null, actuals) : null,
      min: actuals.length ? Math.min.apply(null, actuals) : null,
      diff: diff,
      status: status,
      sampleCount: actuals.length
    };
  }

  /**
   * 用时分析表：模块行 + 分组模块的子模块行（顺序与界面一致）
   * focusId 指定「实际用时」看哪一次；不传则用最近一次。
   * 缺失值一律为 null，不产生 NaN。
   */
  function timeStats(records, timePlan, focusId) {
    var s = sortedAsc(records);
    var cur = pickFocus(s, focusId);
    var plan = M.normalizeTimePlan(timePlan);
    var rows = [];

    M.MODULES.forEach(function (def) {
      var m = cur && cur.modules[def.key] ? cur.modules[def.key] : null;
      rows.push(buildTimeRow({
        key: def.key,
        name: def.name,
        level: 'module',
        plan: plan[def.key].plan,
        latestActual: m ? m.time : null,
        latestDate: cur ? cur.date : '',
        latestPaper: cur ? cur.paperName : '',
        records: s,
        getActual: function (r) { var x = r.modules[def.key]; return x ? x.time : null; }
      }));

      var subs = M.SUBMODULES[def.key];
      if (!subs) return;
      subs.forEach(function (sub) {
        var sm = (m && m.subModules && m.subModules[sub.key]) ? m.subModules[sub.key] : null;
        rows.push(buildTimeRow({
          key: def.key + '.' + sub.key,
          name: sub.name,
          level: 'sub',
          parent: def.name,
          plan: plan[def.key].subs ? plan[def.key].subs[sub.key] : null,
          latestActual: sm ? sm.time : null,
          latestDate: cur ? cur.date : '',
          latestPaper: cur ? cur.paperName : '',
          records: s,
          getActual: function (r) {
            var x = r.modules[def.key];
            if (!x || !x.subModules || !x.subModules[sub.key]) return null;
            return x.subModules[sub.key].time;
          }
        }));
      });
    });

    return rows;
  }

  /** 总用时达成率 + 超时排行（同样跟随 focusId 选中的那一次） */
  function timeOverview(records, timePlan, focusId) {
    var planTotal = M.timePlanTotal(timePlan);
    var s = sortedAsc(records);
    var cur = pickFocus(s, focusId);
    var rows = timeStats(records, timePlan, focusId);
    var moduleRows = rows.filter(function (r) { return r.level === 'module'; });

    var focusTotal = cur && cur.total ? U.toNumber(cur.total.time) : null;
    var avgTotal = mean(s.map(function (r) { return r.total ? r.total.time : null; }));

    var overage = (focusTotal !== null && planTotal !== null) ? U.round(focusTotal - planTotal, 2) : null;
    var achievement = (focusTotal !== null && planTotal) ? U.round((focusTotal / planTotal) * 100, 1) : null;

    // 超时排行：只在已设标准且有实际数据的模块之间比较，按超时分钟降序
    var ranking = moduleRows
      .filter(function (r) { return r.diff !== null; })
      .sort(function (a, b) { return b.diff - a.diff; });

    return {
      planTotal: planTotal,
      focusTotal: focusTotal,
      focus: focusInfo(s, cur),
      avgTotal: avgTotal,
      overage: overage,
      achievement: achievement,
      ranking: ranking,
      rows: rows,
      allRecords: s
    };
  }

  KG.Stats = {
    timeStats: timeStats,
    timeOverview: timeOverview,
    pickFocus: pickFocus,
    sortedAsc: sortedAsc,
    latest: latest,
    previous: previous,
    mean: mean,
    overview: overview,
    deltas: deltas,
    moduleStats: moduleStats,
    scoreSeries: scoreSeries,
    moduleSeries: moduleSeries,
    timeSeries: timeSeries
  };
})();
