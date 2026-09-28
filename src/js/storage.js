/* storage.js —— localStorage 持久化、默认状态、版本迁移 */
var KG = window.KG || (window.KG = {});

(function () {
  'use strict';

  var U = KG.Utils;
  var M = KG.Model;

  var KEY = 'kaogong_dashboard';
  var VERSION = 1;

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

  function defaultState(withSeed) {
    return {
      version: VERSION,
      settings: defaultSettings(),
      targets: defaultTargets(),
      timePlan: defaultTimePlan(),
      records: withSeed === false ? [] : clone(KG.Seed.records),
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
    // 标准用时：缺失的模块/子模块用默认值补齐，已有的值原样保留（用户可自行修改）
    state.timePlan = M.normalizeTimePlan(state.timePlan);
    if (!Array.isArray(state.records)) state.records = [];
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
    state.records.forEach(function (rec) { M.normalizeRecord(rec); });
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
