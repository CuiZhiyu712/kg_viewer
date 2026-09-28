/* model.js —— 业务常量、内部数据结构、派生值计算
 *
 * 业务模型只有一种「套卷」，不存在套卷类型。
 * 数据源头是 Excel Sheet1（粉笔模考）的纵向块结构：
 *   一级/二级模块标题行 → 总题数 → 正确题数(含日期/试卷/分数/平均分/击败比) → 正确率 → 平均正确率 → 用时
 * 其它 Sheet（花生套卷 / 超格套卷 / 国考真题）一律不读取。
 */
var KG = window.KG || (window.KG = {});

(function () {
  'use strict';

  var U = KG.Utils;

  /* ---------------- 六大模块（名称固定，不可修改） ---------------- */
  var MODULES = [
    { key: 'political',    name: '政治理论' },
    { key: 'common',       name: '常识' },
    { key: 'language',     name: '言语理解', grouped: true },
    { key: 'quantity',     name: '数量关系' },
    { key: 'reasoning',    name: '判断推理', grouped: true },
    { key: 'dataAnalysis', name: '资料分析' }
  ];

  var SUBMODULES = {
    language: [
      { key: 'logicalCloze', name: '逻辑填空' },
      { key: 'reading',      name: '片段阅读' },
      { key: 'sentence',     name: '语句表达' }
    ],
    reasoning: [
      { key: 'graphic',    name: '图形推理' },
      { key: 'definition', name: '定义判断' },
      { key: 'analogy',    name: '类比推理' },
      { key: 'logic',      name: '逻辑判断' }
    ]
  };

  /* ---------------- Sheet1 列位（A1 记法） ---------------- */
  var SHEET_COLS = {
    date: 'A', paperName: 'B', score: 'C', averageScore: 'D', defeatRate: 'E',
    label: 'F', total: 'G',
    political: 'H', common: 'I',
    logicalCloze: 'J', reading: 'K', sentence: 'L', languageTotal: 'M',
    quantity: 'N',
    graphic: 'O', definition: 'P', analogy: 'Q', logic: 'R', reasoningTotal: 'S',
    dataAnalysis: 'T'
  };

  /* 模块 -> 主列位；分组模块另有「总计」列 */
  var MODULE_COL = { political: 'H', common: 'I', quantity: 'N', dataAnalysis: 'T' };
  var GROUP_TOTAL_COL = { language: 'M', reasoning: 'S' };
  var SUB_COL = {
    logicalCloze: 'J', reading: 'K', sentence: 'L',
    graphic: 'O', definition: 'P', analogy: 'Q', logic: 'R'
  };

  /* 行标签 + 行序 */
  var ROW_LABELS = {
    questions: '总题数',
    correct: '正确题数',
    accuracy: '正确率',
    avgAccuracy: '平均正确率',
    time: '用时'
  };
  var ROW_ORDER = ['questions', 'correct', 'accuracy', 'avgAccuracy', 'time'];

  /* 模块默认阶段目标（与截图一致） */
  var DEFAULT_TARGETS = {
    political:    { target: 80,  warning: 60 },
    common:       { target: 60,  warning: 40 },
    language:     { target: 90,  warning: 80 },
    quantity:     { target: 80,  warning: 60 },
    reasoning:    { target: 90,  warning: 80 },
    dataAnalysis: { target: 100, warning: 90 }
  };

  var DEFAULT_SETTINGS = {
    defeatTarget: 95,
    defeatWarning: 85,
    scoreTarget: 85,
    scoreWarning: 70
  };

  /* 标准用时（分钟）。用户给出的计划：
     政治10 常识5 言语30 数量10 判断33(图形10+定义10+类比3+逻辑10) 资料25，合计 113。
     「一拖五」不单列，其用时计入逻辑判断，以保持 Excel Sheet1 列结构不变。 */
  var DEFAULT_TIME_PLAN = {
    political:    { plan: 10, subs: null },
    common:       { plan: 5,  subs: null },
    language:     { plan: 30, subs: { logicalCloze: null, reading: null, sentence: null } },
    quantity:     { plan: 10, subs: null },
    reasoning:    { plan: 33, subs: { graphic: 10, definition: 10, analogy: 3, logic: 10 } },
    dataAnalysis: { plan: 25, subs: null }
  };

  /** 生成一份完整的标准用时（缺失模块用默认值补齐） */
  function normalizeTimePlan(tp) {
    var out = {};
    MODULES.forEach(function (def) {
      var d = DEFAULT_TIME_PLAN[def.key] || { plan: null, subs: null };
      var v = (tp && tp[def.key]) || {};
      var subs = null;
      if (SUBMODULES[def.key]) {
        var ds = d.subs || {};
        subs = {};
        SUBMODULES[def.key].forEach(function (s) {
          var src = (v.subs && v.subs[s.key] !== undefined) ? v.subs[s.key] : ds[s.key];
          subs[s.key] = U.toNumber(src);
        });
      }
      // 只有「键缺失」才补默认值；显式 null 表示用户主动清空（不设标准），必须保留
      out[def.key] = {
        plan: v.plan === undefined ? U.toNumber(d.plan) : U.toNumber(v.plan),
        subs: subs
      };
    });
    return out;
  }

  /** 六大模块标准用时合计 */
  function timePlanTotal(tp) {
    var sum = 0, has = false;
    MODULES.forEach(function (def) {
      var p = tp && tp[def.key] ? U.toNumber(tp[def.key].plan) : null;
      if (p !== null) { sum += p; has = true; }
    });
    return has ? U.round(sum, 2) : null;
  }

  /** 分组模块的「模块标准用时」与其子模块之和是否不一致 */
  function timePlanMismatch(tp, key) {
    if (!SUBMODULES[key] || !tp || !tp[key]) return [];
    var m = U.toNumber(tp[key].plan);
    if (m === null) return [];
    var subs = tp[key].subs || {};
    var sum = 0, has = false;
    SUBMODULES[key].forEach(function (s) {
      var v = U.toNumber(subs[s.key]);
      if (v !== null) { sum += v; has = true; }
    });
    if (!has) return [];
    sum = U.round(sum, 2);
    if (Math.abs(sum - m) < 1e-6) return [];
    return ['计划用时：模块 ' + m + ' ≠ 子模块之和 ' + sum];
  }

  /* ---------------- 基础构造 ---------------- */

  function emptyBlock() {
    return { questions: null, correct: null, time: null };
  }

  function emptyModule(key) {
    var def = null;
    for (var i = 0; i < MODULES.length; i++) if (MODULES[i].key === key) def = MODULES[i];
    var m = {
      name: def ? def.name : key,
      questions: null,
      correct: null,
      accuracy: null,     // 自动计算：正确题数 / 总题数
      avgAccuracy: null,  // 用户填写（对应 Excel「平均正确率」行），允许「无」= null
      time: null
    };
    if (SUBMODULES[key]) {
      m.subModules = {};
      SUBMODULES[key].forEach(function (s) {
        m.subModules[s.key] = {
          name: s.name, questions: null, correct: null,
          accuracy: null, avgAccuracy: null, time: null
        };
      });
    }
    return m;
  }

  /** 新建一条空白记录（表单用） */
  function blankRecord() {
    var rec = {
      id: U.uuid(),
      date: U.today(),
      paperName: '',
      score: null,
      averageScore: null,
      defeatRate: null,
      total: { questions: null, correct: null, accuracy: null, time: null },
      modules: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    MODULES.forEach(function (def) { rec.modules[def.key] = emptyModule(def.key); });
    return rec;
  }

  /* ---------------- 派生值计算 ---------------- */

  /**
   * 重新计算一条记录的所有派生字段（正确率、分组总计、整套卷汇总）。
   * 保证 accuracy 永远能从 questions / correct 复算出来，不会出现 NaN / Infinity。
   * 注意：不改写 record.total（导入数据以 Excel「合计」列为准），仅计算 computedTotal。
   */
  function normalizeRecord(rec) {
    if (!rec || typeof rec !== 'object') return rec;
    rec.modules = rec.modules || {};
    rec.date = U.toDateString(rec.date);
    rec.score = U.toNumber(rec.score);
    rec.averageScore = U.toNumber(rec.averageScore);
    rec.defeatRate = U.toPercent(rec.defeatRate);

    MODULES.forEach(function (def) {
      var key = def.key;
      var m = rec.modules[key] || emptyModule(key);
      m.name = def.name;
      m.questions = U.toCount(m.questions);
      m.correct = U.toCount(m.correct);
      m.time = U.toNumber(m.time);
      m.avgAccuracy = U.toPercent(m.avgAccuracy);

      var subs = SUBMODULES[key];
      if (subs) {
        m.subModules = m.subModules || {};
        var anySubQuestions = false;
        subs.forEach(function (s) {
          var sm = m.subModules[s.key] || { name: s.name };
          sm.name = s.name;
          sm.questions = U.toCount(sm.questions);
          sm.correct = U.toCount(sm.correct);
          sm.time = U.toNumber(sm.time);
          sm.avgAccuracy = U.toPercent(sm.avgAccuracy);
          sm.accuracy = U.calcAccuracy(sm.questions, sm.correct);
          if (sm.questions !== null && sm.questions > 0) anySubQuestions = true;
          m.subModules[s.key] = sm;
        });
        // 子模块有数据时以子模块汇总为准；否则沿用已存的分组值
        if (anySubQuestions) {
          var sumQ = 0, sumC = 0, sumT = 0, hasC = false, hasT = false;
          subs.forEach(function (s) {
            var sm = m.subModules[s.key];
            sumQ += sm.questions || 0;
            if (sm.correct !== null) { sumC += sm.correct; hasC = true; }
            if (sm.time !== null) { sumT += sm.time; hasT = true; }
          });
          m.questions = U.round(sumQ, 2);
          if (hasC) m.correct = U.round(sumC, 2);
          if (hasT) m.time = U.round(sumT, 2);
        }
      }

      m.accuracy = U.calcAccuracy(m.questions, m.correct);
      rec.modules[key] = m;
    });

    rec.computedTotal = sumModules(rec);

    // 整套卷汇总：优先沿用导入值，缺失部分用模块汇总补齐
    var t = rec.total || {};
    t.questions = t.questions !== null && t.questions !== undefined ? U.toCount(t.questions) : rec.computedTotal.questions;
    t.correct = t.correct !== null && t.correct !== undefined ? U.toCount(t.correct) : rec.computedTotal.correct;
    t.time = t.time !== null && t.time !== undefined ? U.toNumber(t.time) : rec.computedTotal.time;
    t.accuracy = U.calcAccuracy(t.questions, t.correct);
    rec.total = t;

    return rec;
  }

  /** 六大模块汇总（用于校验导入数据的「合计」是否自洽） */
  function sumModules(rec) {
    var q = 0, c = 0, t = 0, hasQ = false, hasC = false, hasT = false;
    MODULES.forEach(function (def) {
      var m = rec.modules[def.key];
      if (!m) return;
      if (m.questions !== null) { q += m.questions; hasQ = true; }
      if (m.correct !== null) { c += m.correct; hasC = true; }
      if (m.time !== null) { t += m.time; hasT = true; }
    });
    var out = { questions: hasQ ? U.round(q, 2) : null, correct: hasC ? U.round(c, 2) : null, time: hasT ? U.round(t, 2) : null };
    out.accuracy = U.calcAccuracy(out.questions, out.correct);
    return out;
  }

  /** 整套卷汇总值与模块之和是否不一致（源表本身就存在这种不一致，需向用户明示） */
  function totalMismatch(rec) {
    var a = rec.total || {};
    var b = rec.computedTotal || sumModules(rec);
    var diffs = [];
    if (a.questions !== null && b.questions !== null && a.questions !== b.questions) {
      diffs.push('总题数 ' + a.questions + ' ≠ 模块之和 ' + b.questions);
    }
    if (a.correct !== null && b.correct !== null && a.correct !== b.correct) {
      diffs.push('正确题数 ' + a.correct + ' ≠ 模块之和 ' + b.correct);
    }
    if (a.time !== null && b.time !== null && a.time !== b.time) {
      diffs.push('总用时 ' + a.time + ' ≠ 模块之和 ' + b.time);
    }
    return diffs;
  }

  /** 分组模块（言语理解 / 判断推理）的总计列与子模块之和是否不一致 */
  function groupMismatch(rec, key) {
    if (!GROUP_TOTAL_COL[key]) return [];
    var raw = rec.raw;
    if (!raw) return [];
    var m = rec.modules[key];
    var subs = SUBMODULES[key] || [];
    var out = [];
    var pairs = [['questions', ROW_LABELS.questions], ['correct', ROW_LABELS.correct], ['time', ROW_LABELS.time]];
    pairs.forEach(function (p) {
      var label = p[1];
      var row = raw[label];
      if (!row) return;
      var excelVal = U.toNumber(row[GROUP_TOTAL_COL[key]]);
      if (excelVal === null) return;
      var mine = m[p[0]];
      if (mine !== null && Math.abs(excelVal - mine) > 1e-6) {
        out.push(label + '原表 ' + excelVal + ' ≠ 子模块之和 ' + mine);
      }
    });
    return out;
  }

  /** 取模块正确率（已计算，缺失返回 null） */
  function moduleAccuracy(rec, key) {
    var m = rec && rec.modules ? rec.modules[key] : null;
    if (!m) return null;
    return U.calcAccuracy(m.questions, m.correct);
  }

  /** 六大模块正确率列表：[{key,name,value}] */
  function moduleAccuracies(rec) {
    return MODULES.map(function (def) {
      return { key: def.key, name: def.name, value: moduleAccuracy(rec, def.key) };
    });
  }

  /** 记录里用户填写的「平均正确率」（允许 null，即「无」） */
  function moduleAvgAccuracy(rec, key) {
    var m = rec && rec.modules ? rec.modules[key] : null;
    if (!m) return null;
    return U.toPercent(m.avgAccuracy);
  }

  function moduleName(key) {
    for (var i = 0; i < MODULES.length; i++) if (MODULES[i].key === key) return MODULES[i].name;
    return key;
  }

  function moduleDef(key) {
    for (var i = 0; i < MODULES.length; i++) if (MODULES[i].key === key) return MODULES[i];
    return null;
  }

  KG.Model = {
    MODULES: MODULES,
    SUBMODULES: SUBMODULES,
    SHEET_COLS: SHEET_COLS,
    MODULE_COL: MODULE_COL,
    GROUP_TOTAL_COL: GROUP_TOTAL_COL,
    SUB_COL: SUB_COL,
    ROW_LABELS: ROW_LABELS,
    ROW_ORDER: ROW_ORDER,
    DEFAULT_TARGETS: DEFAULT_TARGETS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    DEFAULT_TIME_PLAN: DEFAULT_TIME_PLAN,
    normalizeTimePlan: normalizeTimePlan,
    timePlanTotal: timePlanTotal,
    timePlanMismatch: timePlanMismatch,
    emptyModule: emptyModule,
    blankRecord: blankRecord,
    normalizeRecord: normalizeRecord,
    sumModules: sumModules,
    totalMismatch: totalMismatch,
    groupMismatch: groupMismatch,
    moduleAccuracy: moduleAccuracy,
    moduleAccuracies: moduleAccuracies,
    moduleAvgAccuracy: moduleAvgAccuracy,
    moduleName: moduleName,
    moduleDef: moduleDef
  };
})();
