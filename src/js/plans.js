/* plans.js —— 每日计划的领域逻辑：循环补齐、分组、学习时长统计 */
var KG = window.KG || (window.KG = {});

(function () {
  'use strict';

  var U = KG.Utils;
  var M = KG.Model;

  /* ==================== 循环补齐 ====================
   * 惰性补齐：不预先铺满未来。每次打开页面，把每条规则从起始日到
   * 「今天」与「本周日」中较晚的那个之间、还缺的实例补出来。
   * 历史不会凭空消失（关掉一周再打开会把那一周补上），未来只铺到本周日。
   */

  var MAX_SPAN_DAYS = 1000;   // 单条规则最多补这么多天，防病态数据撑爆 localStorage

  function materialize(state, today) {
    var todayStr = U.toDateString(today || U.today());
    if (!todayStr) return 0;
    var horizon = M.weekEndOf(todayStr) || todayStr;
    if (horizon < todayStr) horizon = todayStr;

    var floor = M.addDays(horizon, -(MAX_SPAN_DAYS - 1));
    var rules = state.planRules || [];
    var plans = state.plans || [];
    var created = 0;

    // 每个规则已有的实例日期，避免重复补
    var existingByRule = {};
    plans.forEach(function (p) {
      if (!p.ruleId) return;
      (existingByRule[p.ruleId] = existingByRule[p.ruleId] || {})[p.date] = true;
    });

    rules.forEach(function (rule) {
      var start = U.toDateString(rule.startDate);
      if (!start) return;
      var until = rule.until ? U.toDateString(rule.until) : horizon;
      if (!until) until = horizon;
      if (until > horizon) until = horizon;
      if (floor > start) start = floor;
      if (until < start) return;                       // 已结束或尚未开始
      if (rule.kind === 'week' && rule.freq === 'daily') return;  // 周计划不做每日循环

      var seen = existingByRule[rule.id] || {};
      var step = rule.freq === 'weekly' ? 7 : 1;
      for (var d = start; d <= until; d = M.addDays(d, step)) {
        if (!d || seen[d]) continue;
        plans.push(M.instanceFromRule(rule, d));
        seen[d] = true;
        created++;
      }
    });

    state.plans = plans;
    return created;
  }

  /* ==================== 分组（今天置顶 + 本周 + 往后/历史） ==================== */

  function sortByDate(kind) {
    return function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1;
    };
  }

  /**
   * 把计划分成 今天 / 本周其余 / 往后或历史 三组。
   * 今天的排最前；「本周其余」排今天之后；其余按日期归入第三组。
   */
  function group(state, today) {
    var todayStr = U.toDateString(today || U.today());
    var weekStart = M.weekStartOf(todayStr);
    var weekEnd = M.weekEndOf(todayStr);

    var plans = (state.plans || []).slice();
    var todayPlans = plans.filter(function (p) { return p.date === todayStr; }).sort(sortByDate());
    var weekPlans = plans.filter(function (p) {
      return p.date !== todayStr && p.date >= weekStart && p.date <= weekEnd;
    }).sort(sortByDate());
    var otherPlans = plans.filter(function (p) {
      return !(p.date >= weekStart && p.date <= weekEnd);
    }).sort(sortByDate());

    var weekRules = (state.planRules || []).filter(function (r) {
      // 只有「周计划」的循环规则才在本周出卡片；日计划的循环展开成天，不单独出规则卡
      if (r.kind !== 'week') return false;
      // 挂在本周：起始日 <= 本周日，且未在本周之前就结束
      var s = U.toDateString(r.startDate);
      var e = r.until ? U.toDateString(r.until) : null;
      if (!s) return false;
      if (s > weekEnd) return false;                // 还没开始
      if (e && e < weekStart) return false;         // 已结束
      return true;
    });

    return {
      today: todayStr,
      weekStart: weekStart,
      weekEnd: weekEnd,
      todayPlans: todayPlans,
      weekPlans: weekPlans,
      otherPlans: otherPlans,
      weekRules: weekRules,
      total: plans.length
    };
  }

  /** 某天（或某段日期）内的计划完成情况 */
  function completionOf(plans) {
    var total = plans.length;
    var done = plans.filter(function (p) { return !!p.done; }).length;
    var planMinutes = null, doneMinutes = null;
    plans.forEach(function (p) {
      var m = U.toNumber(p.minutes);
      if (m === null) return;
      planMinutes = (planMinutes || 0) + m;
      if (p.done) doneMinutes = (doneMinutes || 0) + m;
    });
    return {
      total: total,
      done: done,
      rate: total ? U.round((done / total) * 100, 1) : null,
      planMinutes: planMinutes === null ? null : U.round(planMinutes, 2),
      doneMinutes: U.round(doneMinutes || 0, 2)
    };
  }

  /* ==================== 学习时长统计 ==================== */

  /** 某一天的会话 */
  function sessionsOf(state, dateStr) {
    return (state.sessions || [])
      .filter(function (s) { return s.date === dateStr; })
      .sort(function (a, b) {
        var x = a.startAt || '', y = b.startAt || '';
        return x < y ? -1 : x > y ? 1 : 0;
      });
  }

  function sumSeconds(list) {
    var total = 0;
    list.forEach(function (s) { total += U.toNumber(s.seconds) || 0; });
    return Math.round(total);
  }

  /**
   * 汇总某段日期区间（含端点）的学习时长。
   * 平均每天 = 总时长 ÷ 有记录的天数（不是自然日总数）——避免"没学的那天"把均值稀释。
   */
  function rangeSummary(state, fromStr, toStr) {
    var list = (state.sessions || []).filter(function (s) {
      return s.date >= fromStr && s.date <= toStr;
    });
    var byDay = {};
    list.forEach(function (s) {
      byDay[s.date] = (byDay[s.date] || 0) + (U.toNumber(s.seconds) || 0);
    });
    var days = Object.keys(byDay);
    var total = sumSeconds(list);
    return {
      seconds: total,
      count: list.length,
      activeDays: days.length,
      avgPerActiveDay: days.length ? Math.round(total / days.length) : 0,
      byDay: byDay
    };
  }

  /** 今日 / 本周 / 本月 汇总 */
  function overview(state, today) {
    var todayStr = U.toDateString(today || U.today());
    var weekStart = M.weekStartOf(todayStr) || todayStr;
    var weekEnd = M.weekEndOf(todayStr) || todayStr;
    var monthStart = todayStr.slice(0, 8) + '01';
    var monthEnd = M.addDays(nextMonthStart(todayStr), -1);   // 本月最后一天

    return {
      today: rangeSummary(state, todayStr, todayStr),
      week: rangeSummary(state, weekStart, weekEnd),
      month: rangeSummary(state, monthStart, monthEnd),
      todayStr: todayStr,
      weekStart: weekStart,
      weekEnd: weekEnd,
      monthStart: monthStart,
      monthEnd: monthEnd
    };
  }

  function nextMonthStart(dateStr) {
    var y = +dateStr.slice(0, 4);
    var m = +dateStr.slice(5, 7);
    if (m === 12) return (y + 1) + '-01-01';
    return y + '-' + U.pad2(m + 1) + '-01';
  }

  /** 某天按科目 / 按计划标签汇总（饼图用） */
  function distribution(state, dateStr, byWhat) {
    var list = sessionsOf(state, dateStr);
    var buckets = {};
    list.forEach(function (s) {
      var key = byWhat === 'category'
        ? (s.category || '未归类')
        : (s.label || '未命名');
      buckets[key] = (buckets[key] || 0) + (U.toNumber(s.seconds) || 0);
    });
    var total = 0;
    Object.keys(buckets).forEach(function (k) { total += buckets[k]; });
    return Object.keys(buckets)
      .map(function (k) {
        return {
          name: k,
          seconds: Math.round(buckets[k]),
          percent: total ? U.round((buckets[k] / total) * 100, 1) : 0
        };
      })
      .sort(function (a, b) { return b.seconds - a.seconds; });
  }

  /** 某个计划累计的实际学习时长（按 planId 关联的会话合计） */
  function studiedSecondsOf(state, planId) {
    if (!planId) return 0;
    return sumSeconds((state.sessions || []).filter(function (s) { return s.planId === planId; }));
  }

  /**
   * 改了循环规则后，把「今天及以后」的实例同步成新模板。
   * 历史实例保留原样；子项按位置继承原来的完成状态，避免把已勾的进度抹掉。
   */
  function applyRuleToFuture(state, rule, todayStr) {
    var t = U.toDateString(todayStr || U.today());
    var changed = 0;
    (state.plans || []).forEach(function (p) {
      if (p.ruleId !== rule.id || p.date < t) return;
      p.kind = rule.kind;
      p.title = rule.title;
      p.category = rule.category;
      p.contentMode = rule.contentMode;
      p.content = rule.content;
      p.minutes = U.toNumber(rule.minutes);
      p.items = (rule.items || []).map(function (it, i) {
        var old = (p.items || [])[i] || null;
        return {
          id: (old && old.id) || U.uuid(),
          text: it.text,
          minutes: U.toNumber(it.minutes),
          done: old ? !!old.done : false
        };
      });
      M.normalizePlan(p);
      p.updatedAt = new Date().toISOString();
      changed++;
    });
    return changed;
  }

  /** 删除某条规则未来（今天及以后）的实例，历史保留 */
  function removeFutureInstances(state, ruleId, todayStr) {
    var t = U.toDateString(todayStr || U.today());
    var before = (state.plans || []).length;
    state.plans = (state.plans || []).filter(function (p) {
      return !(p.ruleId === ruleId && p.date >= t);
    });
    return before - state.plans.length;
  }

  /** 某条循环规则在指定周内的完成情况（周计划卡片上显示「日计划 2/5 完成」） */
  function ruleCompletion(state, rule, weekStart, weekEnd) {
    var list = (state.plans || []).filter(function (p) {
      return p.ruleId === rule.id && p.date >= weekStart && p.date <= weekEnd;
    });
    return completionOf(list);
  }

  KG.Plans = {
    materialize: materialize,
    group: group,
    completionOf: completionOf,
    ruleCompletion: ruleCompletion,
    applyRuleToFuture: applyRuleToFuture,
    removeFutureInstances: removeFutureInstances,
    sessionsOf: sessionsOf,
    sumSeconds: sumSeconds,
    rangeSummary: rangeSummary,
    overview: overview,
    distribution: distribution,
    studiedSecondsOf: studiedSecondsOf,
    nextMonthStart: nextMonthStart
  };
})();
