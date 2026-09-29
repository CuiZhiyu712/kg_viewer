/* charts.js —— ECharts 趋势图（数据全部来自 records，无硬编码） */
var KG = window.KG || (window.KG = {});

(function () {
  'use strict';

  var U = KG.Utils;
  var M = KG.Model;
  var S = KG.Stats;

  var registry = {};     // id -> echarts 实例
  var dirty = {};        // id -> 需要在面板可见时重绘

  var PALETTE = {
    political:    '#2563eb',
    common:       '#0d9488',
    language:     '#7c3aed',
    quantity:     '#d97706',
    reasoning:    '#db2777',
    dataAnalysis: '#16a34a'
  };
  var COLOR_DEFEAT = '#2563eb';
  var COLOR_SCORE = '#f59e0b';
  var COLOR_TOTAL_TIME = '#2563eb';
  var COLOR_GRID = '#e5e7eb';
  var COLOR_TEXT = '#6b7280';

  function libReady() { return !!window.echarts; }

  /**
   * 图表容器是否处于可见面板中。
   * 直接判断所属 .panel 的 is-active 状态，比依赖 offsetParent 可靠
   * （隐藏容器尺寸为 0 时初始化 ECharts 会画出空白）。
   */
  function isVisible(el) {
    if (!el) return false;
    var panel = el.closest ? el.closest('.panel') : null;
    if (panel && !panel.classList.contains('is-active')) return false;
    return true;
  }

  function chartOf(id) {
    var el = document.getElementById(id);
    if (!el || !libReady()) return null;
    if (!registry[id]) registry[id] = window.echarts.init(el, null, { renderer: 'canvas' });
    return registry[id];
  }

  function apply(id, option) {
    var el = document.getElementById(id);
    if (!el) return false;
    if (!libReady()) { dirty[id] = true; return false; }
    if (!isVisible(el)) { dirty[id] = true; return false; }
    var c = chartOf(id);
    if (!c) return false;
    // 容器尺寸可能在隐藏期间变化，先校正再绘制
    c.resize();
    c.setOption(option, true);
    dirty[id] = false;
    return true;
  }

  function baseAxis(records, opts) {
    return {
      type: 'category',
      boundaryGap: false,
      data: records.map(function (r) { return r.date; }),
      axisLine: { lineStyle: { color: COLOR_GRID } },
      axisTick: { show: false },
      axisLabel: {
        color: COLOR_TEXT,
        hideOverlap: true,
        formatter: function (v) { return v ? String(v).slice(5) : ''; }
      }
    };
  }

  function baseGrid() {
    return { left: 12, right: 24, top: 40, bottom: 8, containLabel: true };
  }

  /**
   * 计算 y 轴上限，务必把目标线/黄色下限线包进来。
   * ECharts 会丢弃超出坐标轴范围的 markLine，若不抬高上限，
   * 目标线（如 95%）在数据只有 59% 时根本不显示。
   */
  function niceMax(values) {
    var nums = values.filter(function (v) { return typeof v === 'number' && isFinite(v); });
    if (!nums.length) return null;
    var m = Math.max.apply(null, nums);
    if (m <= 0) return 10;
    var padded = m * 1.08;
    var step = padded <= 10 ? 1 : 10;
    return Math.ceil(padded / step) * step;
  }

  function tooltipBase() {
    return {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,.97)',
      borderColor: COLOR_GRID,
      borderWidth: 1,
      padding: [10, 14],
      textStyle: { color: '#111827', fontSize: 13 },
      extraCssText: 'box-shadow:0 6px 20px rgba(0,0,0,.1);border-radius:10px;'
    };
  }

  function esc(s) { return U.escapeHtml(s); }

  /* ================= 击败比与分数趋势 ================= */

  function renderScore(records, settings, mode, ids) {
    var points = S.scoreSeries(records);
    var showDefeat = mode === 'all' || mode === 'defeat';
    var showScore = mode === 'all' || mode === 'score';

    // y 轴上限要覆盖数据点与目标线，否则目标线被裁掉
    var axisValues = [];
    points.forEach(function (p) {
      if (showDefeat) axisValues.push(p.defeatRate);
      if (showScore) axisValues.push(p.score);
    });
    if (showDefeat) axisValues.push(settings.defeatTarget, settings.defeatWarning);
    if (showScore) axisValues.push(settings.scoreTarget, settings.scoreWarning);
    var yMax = niceMax(axisValues);

    var series = [];
    var legend = [];

    if (showDefeat) {
      legend.push('击败比');
      series.push({
        name: '击败比',
        type: 'line',
        smooth: true,
        symbolSize: 8,
        connectNulls: true,
        itemStyle: { color: COLOR_DEFEAT },
        lineStyle: { width: 2.5 },
        data: points.map(function (p) { return p.defeatRate; }),
        markLine: {
          silent: true,
          symbol: 'none',
          label: { position: 'insideEndTop', formatter: '{b}' },
          lineStyle: { type: 'dashed' },
          data: [
            { yAxis: settings.defeatTarget, name: '击败比目标 ' + settings.defeatTarget + '%', lineStyle: { color: '#1d4ed8', width: 1.4 }, label: { color: '#1d4ed8' } },
            { yAxis: settings.defeatWarning, name: '击败比下限 ' + settings.defeatWarning + '%', lineStyle: { color: '#93c5fd', width: 1.4 }, label: { color: '#60a5fa' } }
          ]
        }
      });
    }
    if (showScore) {
      legend.push('分数');
      series.push({
        name: '分数',
        type: 'line',
        smooth: true,
        symbolSize: 8,
        connectNulls: true,
        itemStyle: { color: COLOR_SCORE },
        lineStyle: { width: 2.5 },
        data: points.map(function (p) { return p.score; }),
        markLine: {
          silent: true,
          symbol: 'none',
          label: { position: 'insideStartTop', formatter: '{b}' },
          lineStyle: { type: 'dashed' },
          data: [
            { yAxis: settings.scoreTarget, name: '分数目标 ' + settings.scoreTarget, lineStyle: { color: '#b45309', width: 1.4 }, label: { color: '#b45309' } },
            { yAxis: settings.scoreWarning, name: '分数下限 ' + settings.scoreWarning, lineStyle: { color: '#fcd34d', width: 1.4 }, label: { color: '#d97706' } }
          ]
        }
      });
    }

    return {
      color: [COLOR_DEFEAT, COLOR_SCORE],
      grid: baseGrid(),
      legend: legend.length > 1 ? { top: 4, right: 8, textStyle: { color: COLOR_TEXT } } : undefined,
      tooltip: Object.assign(tooltipBase(), {
        formatter: function (params) {
          if (!params || !params.length) return '';
          var p = points[params[0].dataIndex];
          if (!p) return '';
          var out = ['<b>' + esc(p.paperName || '(无试卷名)') + '</b>', '日期：' + esc(p.date || '—')];
          var body = [];
          if (showDefeat) body.push('击败比：' + U.fmtPct(p.defeatRate));
          if (showScore) body.push('分数：' + U.fmtNum(p.score, 1));
          if (body.length) out.push('', body.join('<br/>'));
          out.push('', '总正确率：' + U.fmtPct(p.totalAccuracy));
          return out.join('<br/>');
        }
      }),
      xAxis: baseAxis(points),
      yAxis: {
        type: 'value',
        name: '数值',
        min: 0,
        max: yMax,
        nameTextStyle: { color: COLOR_TEXT },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: COLOR_GRID, type: 'dashed' } },
        axisLabel: { color: COLOR_TEXT }
      },
      series: series
    };
  }

  /* ================= 模块正确率趋势 ================= */

  function renderModule(records, mode) {
    var points = S.moduleSeries(records).points;
    var keys = mode === 'all' ? M.MODULES.map(function (d) { return d.key; }) : [mode];

    var series = keys.map(function (key) {
      var def = M.moduleDef(key);
      return {
        name: def.name,
        type: 'line',
        smooth: true,
        symbolSize: 7,
        connectNulls: true,
        itemStyle: { color: PALETTE[key] },
        lineStyle: { width: 2.4 },
        data: points.map(function (p) { return p[key]; })
      };
    });

    return {
      color: keys.map(function (k) { return PALETTE[k]; }),
      grid: baseGrid(),
      legend: keys.length > 1
        ? { top: 4, right: 8, textStyle: { color: COLOR_TEXT } }
        : undefined,
      tooltip: Object.assign(tooltipBase(), {
        formatter: function (params) {
          if (!params || !params.length) return '';
          var p = points[params[0].dataIndex];
          if (!p) return '';
          var out = ['<b>' + esc(p.paperName || '(无试卷名)') + '</b>', '日期：' + esc(p.date || '—'), ''];
          params.forEach(function (it) {
            out.push(it.marker + it.seriesName + '：' + U.fmtPct(it.value));
          });
          return out.join('<br/>');
        }
      }),
      xAxis: baseAxis(points),
      yAxis: {
        type: 'value',
        name: '正确率',
        min: 0,
        max: 100,
        nameTextStyle: { color: COLOR_TEXT },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: COLOR_GRID, type: 'dashed' } },
        axisLabel: { color: COLOR_TEXT, formatter: '{value}%' }
      },
      series: series
    };
  }

  /* ================= 用时趋势 ================= */

  function renderTime(records, mode) {
    var points = S.timeSeries(records);

    var series = [];
    if (mode === 'total') {
      series.push({
        name: '总用时',
        type: 'line',
        smooth: true,
        symbolSize: 8,
        connectNulls: true,
        itemStyle: { color: COLOR_TOTAL_TIME },
        lineStyle: { width: 2.6 },
        areaStyle: { color: 'rgba(37,99,235,.10)' },
        data: points.map(function (p) { return p.totalTime; })
      });
    } else {
      var def = M.moduleDef(mode);
      series.push({
        name: def.name + '用时',
        type: 'line',
        smooth: true,
        symbolSize: 8,
        connectNulls: true,
        itemStyle: { color: PALETTE[mode] },
        lineStyle: { width: 2.6 },
        areaStyle: { color: 'rgba(37,99,235,.08)' },
        data: points.map(function (p) { return p[mode]; })
      });
    }

    var modeName = mode === 'total' ? '总用时' : (M.moduleDef(mode).name + '用时');

    return {
      grid: baseGrid(),
      tooltip: Object.assign(tooltipBase(), {
        formatter: function (params) {
          if (!params || !params.length) return '';
          var p = points[params[0].dataIndex];
          if (!p) return '';
          var out = ['<b>' + esc(p.paperName || '(无试卷名)') + '</b>', '日期：' + esc(p.date || '—'), ''];
          out.push(params[0].marker + modeName + '：' + U.fmtTime(params[0].value));
          return out.join('<br/>');
        }
      }),
      xAxis: baseAxis(points),
      yAxis: {
        type: 'value',
        name: '分钟',
        nameTextStyle: { color: COLOR_TEXT },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: COLOR_GRID, type: 'dashed' } },
        axisLabel: { color: COLOR_TEXT }
      },
      series: series
    };
  }

  /* ================= 用时分析：实际 vs 计划 ================= */

  function renderTimeAnalysis(records, timePlan, mode, focusId) {
    var points = S.timeSeries(records);
    var plan = M.normalizeTimePlan(timePlan);
    var focus = S.pickFocus ? S.pickFocus(S.sortedAsc(records), focusId) : null;

    var isTotal = mode === 'total';
    var seriesName, values, planValue, color;

    if (isTotal) {
      seriesName = '总用时';
      values = points.map(function (p) { return p.totalTime; });
      planValue = M.timePlanTotal(plan);
      color = COLOR_TOTAL_TIME;
    } else {
      var def = M.moduleDef(mode) || M.MODULES[0];
      seriesName = def.name + '用时';
      values = points.map(function (p) { return p[def.key]; });
      planValue = plan[def.key] ? plan[def.key].plan : null;
      color = PALETTE[def.key];
    }

    var axisValues = values.filter(function (v) { return typeof v === 'number'; });
    if (planValue !== null) axisValues.push(planValue);

    // 两条参考线：水平的是标准用时；竖直的是当前正在分析的那一套
    var markData = [];
    if (planValue !== null) {
      markData.push({
        yAxis: planValue,
        lineStyle: { type: 'dashed', color: '#dc2626', width: 1.6 },
        label: {
          position: 'insideEndTop',
          color: '#b91c1c',
          formatter: '计划 ' + planValue + ' 分钟'
        }
      });
    }
    if (focus && focus.date) {
      markData.push({
        // 分类轴上标日期：同一天有多套时只标第一套
        xAxis: focus.date,
        lineStyle: { type: 'solid', color: '#2563eb', width: 1.4, opacity: .55 },
        label: {
          position: 'insideStartTop',
          color: '#1d4ed8',
          formatter: '所分析'
        }
      });
    }

    return {
      grid: baseGrid(),
      tooltip: Object.assign(tooltipBase(), {
        formatter: function (params) {
          if (!params || !params.length) return '';
          var p = points[params[0].dataIndex];
          if (!p) return '';
          var actual = params[0].value;
          var out = ['<b>' + esc(p.paperName || '(无试卷名)') + '</b>', '日期：' + esc(p.date || '—'), ''];
          out.push(params[0].marker + seriesName + '：' + U.fmtTime(actual));
          if (planValue !== null) {
            out.push('计划用时：' + U.fmtTime(planValue));
            if (typeof actual === 'number') {
              var d = U.round(actual - planValue, 2);
              out.push('差值：' + (d > 0 ? '超时 +' : d < 0 ? '富余 ' : '') + U.fmtNum(d, 1) + ' 分钟');
            }
          }
          return out.join('<br/>');
        }
      }),
      xAxis: baseAxis(points),
      yAxis: {
        type: 'value',
        name: '分钟',
        min: 0,
        max: niceMax(axisValues),
        nameTextStyle: { color: COLOR_TEXT },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: COLOR_GRID, type: 'dashed' } },
        axisLabel: { color: COLOR_TEXT }
      },
      series: [{
        name: seriesName,
        type: 'line',
        smooth: true,
        symbolSize: 8,
        connectNulls: true,
        itemStyle: { color: color },
        lineStyle: { width: 2.6 },
        areaStyle: { color: 'rgba(37,99,235,.08)' },
        data: values,
        markLine: markData.length ? {
          silent: true,
          symbol: 'none',
          data: markData
        } : undefined
      }]
    };
  }

  /* ================= 今日学习时长分布（饼图） ================= */

  function renderDistribution(id, dist) {
    // 用秒做数值：百分比与页面上图例的算法完全一致（用分钟会因四舍五入对不上）
    var data = dist.map(function (d) {
      return { name: d.name, value: d.seconds };
    });
    var totalSec = data.reduce(function (a, b) { return a + b.value; }, 0);

    return {
      color: ['#2563eb', '#0d9488', '#7c3aed', '#d97706', '#db2777', '#16a34a', '#0891b2', '#dc2626'],
      tooltip: Object.assign(tooltipBase(), {
        trigger: 'item',
        formatter: function (p) {
          return '<b>' + esc(p.name) + '</b><br>' +
            M.fmtDuration(p.value) + '（' + p.percent + '%）';
        }
      }),
      legend: { show: false },                 // 用页面上的图例，样式更可控
      series: [{
        type: 'pie',
        radius: ['46%', '72%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        label: { show: true, formatter: '{d}%', color: COLOR_TEXT, fontSize: 12 },
        labelLine: { length: 8, length2: 8, lineStyle: { color: COLOR_GRID } },
        data: data,
        emphasis: {
          itemStyle: { shadowBlur: 12, shadowColor: 'rgba(16,24,40,.18)' },
          label: { fontSize: 14, fontWeight: 'bold' }
        }
      }],
      // 中心显示总时长
      graphic: totalSec > 0 ? [{
        type: 'text',
        left: 'center',
        top: 'middle',
        silent: true,
        style: {
          text: '合计\n' + M.fmtDuration(totalSec),
          textAlign: 'center',
          fill: COLOR_TEXT,
          fontSize: 12,
          lineHeight: 17
        }
      }] : []
    };
  }

  /** 单独销毁某个图表（容器被隐藏时用，避免残留旧图） */
  function disposeChart(id) {
    if (registry[id]) {
      try { registry[id].dispose(); } catch (e) { /* 忽略 */ }
      delete registry[id];
    }
  }

  /* ================= 对外 ================= */

  /**
   * 渲染某个面板下的所有图表；面板不可见时只标记 dirty，
   * 等切换到该面板时再绘制（避免隐藏容器尺寸为 0 导致图表空白）。
   */
  function renderPanel(panelId, records, state) {
    var ok = true;
    var isEmpty = !records.length;

    function toggle(id, show) {
      var box = document.getElementById(id);
      var ph = document.getElementById(id + '-empty');
      if (box) box.hidden = !show;
      if (ph) ph.hidden = show;
    }

    if (panelId === 'panel-trend') {
      toggle('chart-score', !isEmpty);
      toggle('chart-module', !isEmpty);
      toggle('chart-time', !isEmpty);
      if (isEmpty) return true;
      ok = apply('chart-score', renderScore(records, state.settings, state.chartFilter.score)) && ok;
      ok = apply('chart-module', renderModule(records, state.chartFilter.module)) && ok;
      ok = apply('chart-time', renderTime(records, state.chartFilter.time)) && ok;
    } else if (panelId === 'panel-stats') {
      toggle('chart-stats-module', !isEmpty);
      if (isEmpty) return true;
      ok = apply('chart-stats-module', renderModule(records, state.chartFilter.statsModule)) && ok;
    } else if (panelId === 'panel-time') {
      toggle('chart-time-analysis', !isEmpty);
      if (isEmpty) return true;
      ok = apply('chart-time-analysis',
        renderTimeAnalysis(records, state.timePlan, state.chartFilter.timeAnalysis, state.timeFocusId)) && ok;
    }
    return ok;
  }

  /** 面板可见后补画被推迟的图表 */
  function flushPanel(panelId, records, state) {
    return renderPanel(panelId, records, state);
  }

  function resizeAll() {
    Object.keys(registry).forEach(function (id) {
      try { registry[id].resize(); } catch (e) { /* 忽略 */ }
    });
  }

  function reset() {
    Object.keys(registry).forEach(function (id) {
      try { registry[id].dispose(); } catch (e) { /* 忽略 */ }
    });
    registry = {};
  }

  KG.Charts = {
    PALETTE: PALETTE,
    libReady: libReady,
    renderPanel: renderPanel,
    flushPanel: flushPanel,
    renderDistribution: function (id, dist) { return apply(id, renderDistribution(id, dist)); },
    disposeChart: disposeChart,
    resizeAll: resizeAll,
    reset: reset
  };
})();
