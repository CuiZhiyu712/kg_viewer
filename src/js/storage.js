/* storage.js —— localStorage 持久化、默认状态、版本迁移 */
var KG = window.KG || (window.KG = {});

(function () {
  'use strict';

  var U = KG.Utils;
  var M = KG.Model;

  var KEY = 'kaogong_dashboard';
  var VERSION = 4;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function defaultSettings() {
    return {
      defeatTarget: M.DEFAULT_SETTINGS.defeatTarget,
      defeatWarning: M.DEFAULT_SETTINGS.defeatWarning,
      scoreTarget: M.DEFAULT_SETTINGS.scoreTarget,
      scoreWarning: M.DEFAULT_SETTINGS.scoreWarning
    };
  }

  function defaultTargets() { return clone(M.DEFAULT_TARGETS); }

  function defaultTimePlan() { return M.normalizeTimePlan(null); }

  /** 标准用时按模版独立：{ default: {...}, <tplId>: {...} }。
   *  缺失模版的 timePlan 在 fillDefaults 里按各自模版补齐。 */
  function defaultTimePlans() {
    return { default: defaultTimePlan() };
  }

  function defaultState(withSeed) {
    return {
      version: VERSION,
      settings: defaultSettings(),
      targets: defaultTargets(),
      targetsByTemplate: { default: defaultTargets() },
      timePlan: defaultTimePlan(),
      timePlans: defaultTimePlans(),
      records: withSeed === false ? [] : clone(KG.Seed.records),
      templates: [clone(M.DEFAULT_TEMPLATE)],
      currentTemplateId: 'default',
      moduleLibrary: clone(M.MODULE_LIBRARY),
      plans: [],          // 计划实例（含循环展开出来的每一天）
      planRules: [],      // 循环规则
      sessions: [],       // 学习计时记录
      timer: null,        // 运行中的计时器（运行时状态，也存下来以便刷新后恢复）
      updatedAt: new Date().toISOString()
    };
  }

  function storageAvailable() {
    try {
      var k = '__kg_probe__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  var available = storageAvailable();

  /** 补齐 settings / targets 缺失的键，兼容旧数据 */
  function fillDefaults(state) {
    var d = defaultState(false);
    state.settings = state.settings || {};
    Object.keys(d.settings).forEach(function (k) {
      state.settings[k] = state.settings[k] === undefined || state.settings[k] === null
        ? d.settings[k] : U.toNumber(state.settings[k]);
    });
    state.targets = state.targets || {};
    Object.keys(d.targets).forEach(function (key) {
      var t = state.targets[key] || {};
      state.targets[key] = {
        target: U.toNumber(t.target) === null ? d.targets[key].target : U.toNumber(t.target),
        warning: U.toNumber(t.warning) === null ? d.targets[key].warning : U.toNumber(t.warning)
      };
    });
    // 阶段目标按模版独立：v4 起新增字段 targetsByTemplate；旧数据补齐
    if (!state.targetsByTemplate || typeof state.targetsByTemplate !== 'object') {
      state.targetsByTemplate = { default: state.targets || defaultTargets() };
    } else if (!state.targetsByTemplate.default) {
      state.targetsByTemplate.default = state.targets || defaultTargets();
    }
    state.templates.forEach(function (tpl) {
      if (!state.targetsByTemplate[tpl.id]) {
        state.targetsByTemplate[tpl.id] = clone(M.DEFAULT_TARGETS);
      }
    });
    // 标准用时：缺失的模块/子模块用默认值补齐，已有的值原样保留（用户可自行修改）
    state.timePlan = M.normalizeTimePlan(state.timePlan);
    // v3 起：标准用时按模版独立。把旧 timePlan 迁到 timePlans.default；其它模版首次见到时按各自模版补默认
    if (!state.timePlans || typeof state.timePlans !== 'object') state.timePlans = {};
    if (state.timePlan && !state.timePlans.default) state.timePlans.default = state.timePlan;
    state.templates.forEach(function (tpl) {
      if (!state.timePlans[tpl.id]) {
        state.timePlans[tpl.id] = M.normalizeTimePlan(null, tpl);
      } else {
        state.timePlans[tpl.id] = M.normalizeTimePlan(state.timePlans[tpl.id], tpl);
      }
    });
    if (!Array.isArray(state.records)) state.records = [];
    // 番茄钟设置
    state.settings.pomo = M.normalizePomo(state.settings.pomo);
    // 学习计时记录
    if (!Array.isArray(state.sessions)) state.sessions = [];
    state.sessions.forEach(function (s) { M.normalizeSession(s); });
    if (state.timer && typeof state.timer !== 'object') state.timer = null;
    // 计划：补齐两个数组并规整每条记录（派生值算好写回）
    if (!Array.isArray(state.plans)) state.plans = [];
    if (!Array.isArray(state.planRules)) state.planRules = [];
    state.plans.forEach(function (p) { M.normalizePlan(p); });
    state.planRules.forEach(function (r) {
      if (!r.id) r.id = U.uuid();
      r.items = (r.items || []).map(function (it) {
        return { id: it.id || U.uuid(), text: it.text || '', minutes: U.toNumber(it.minutes), done: false };
      });
      r.freq = r.freq === 'weekly' ? 'weekly' : 'daily';
      r.kind = r.kind === 'week' ? 'week' : 'day';
      r.contentMode = r.contentMode === 'list' ? 'list' : 'text';
    });
    // 套卷模版：v2 起新增字段，旧数据补齐
    if (!Array.isArray(state.templates) || !state.templates.length) {
      state.templates = [clone(M.DEFAULT_TEMPLATE)];
    } else {
      state.templates = state.templates.map(function (t) { return M.normalizeTemplate(t); });
      // 保证默认模版始终存在且唯一
      var hasDefault = state.templates.some(function (t) { return t.id === 'default'; });
      if (!hasDefault) state.templates.unshift(clone(M.DEFAULT_TEMPLATE));
    }
    if (!state.currentTemplateId || !state.templates.some(function (t) { return t.id === state.currentTemplateId; })) {
      state.currentTemplateId = 'default';
    }
    if (!Array.isArray(state.moduleLibrary)) state.moduleLibrary = clone(M.MODULE_LIBRARY);
    // 给已有 records 补 templateId（旧数据缺失视为默认模版）
    if (Array.isArray(state.records)) {
      state.records.forEach(function (r) {
        if (!r.templateId) r.templateId = 'default';
      });
    }
    return state;
  }

  /** 版本迁移入口：后续结构变化时在此按 version 逐级升级 */
  function migrate(state) {
    if (!state || typeof state !== 'object') return defaultState(true);
    var v = U.toNumber(state.version);
    if (v === null) v = 0;

    if (v < 1) {
      // v0（无版本号）-> v1：补齐 settings / targets / records
      state = fillDefaults(state);
      state.version = 1;
      v = 1;
    }

    if (v < 2) {
      // v1 -> v2：套卷模版字段
      if (!Array.isArray(state.templates)) state.templates = [clone(M.DEFAULT_TEMPLATE)];
      if (!state.currentTemplateId) state.currentTemplateId = 'default';
      if (!Array.isArray(state.moduleLibrary)) state.moduleLibrary = clone(M.MODULE_LIBRARY);
      if (Array.isArray(state.records)) {
        state.records.forEach(function (r) { if (!r.templateId) r.templateId = 'default'; });
      }
      state.version = 2;
      v = 2;
    }

    if (v < 3) {
      // v2 -> v3：标准用时按模版独立。原 state.timePlan 整体迁到 timePlans.default；
      // 其它模版在 fillDefaults 里按各自 modules 补默认（不在此处猜结构）
      state.timePlans = { default: state.timePlan || M.normalizeTimePlan(null) };
      state.version = 3;
      v = 3;
    }

    if (v < 4) {
      // v3 -> v4：阶段目标按模版独立。原 state.targets 整体迁到 targetsByTemplate.default；
      // 其它模版在 fillDefaults 里按各自 modules 补默认
      state.targetsByTemplate = { default: state.targets || M.DEFAULT_TARGETS };
      state.version = 4;
      v = 4;
    }

    state.version = VERSION;
    return fillDefaults(state);
  }

  function load() {
    if (!available) return defaultState(true);
    var raw = null;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) return defaultState(true);          // 首次打开：写入内置的 Excel 数据
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    if (!parsed) return defaultState(true);
    var state = migrate(parsed);
    state.records.forEach(function (rec) {
      var tpl = M.findTemplate(state.templates, rec.templateId);
      M.normalizeRecord(rec, tpl);
    });
    return state;
  }

  function save(state) {
    state.version = VERSION;
    state.updatedAt = new Date().toISOString();
    if (!available) return false;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clear() {
    if (!available) return false;
    try { window.localStorage.removeItem(KEY); return true; } catch (e) { return false; }
  }

  KG.Store = {
    KEY: KEY,
    VERSION: VERSION,
    defaultSettings: defaultSettings,
    defaultTargets: defaultTargets,
    defaultTimePlan: defaultTimePlan,
    defaultState: defaultState,
    migrate: migrate,
    load: load,
    save: save,
    clear: clear,
    isAvailable: function () { return available; }
  };
})();
