/* timer.js —— 学习计时引擎（秒表 / 番茄钟）
 *
 * 设计要点：
 *   - 只存「绝对时间戳 + 已累计毫秒」，不存自增计数。所以关掉浏览器再回来，
 *     计时照样在走（你不在电脑前的那段时间也算），刷新不丢。
 *   - 不依赖 setInterval 的正确性：每次 tick 都按时间戳重算，掉帧/卡顿不会漂移。
 *   - 休息时间不计入学习时长（番茄模式只累计专注阶段）。
 *   - 所有函数接受 now 参数（默认 Date.now），方便测试注入假时钟。
 */
var KG = window.KG || (window.KG = {});

(function () {
  'use strict';

  var U = KG.Utils;
  var M = KG.Model;

  /* ---------------- 构造 ---------------- */

  /**
   * 开始一次计时。
   * opts: { mode:'stopwatch'|'pomodoro', planId, label, category, pomo }
   */
  function create(opts, now) {
    var t = now === undefined ? Date.now() : now;
    return {
      active: true,
      mode: opts.mode === 'pomodoro' ? 'pomodoro' : 'stopwatch',
      planId: opts.planId || null,
      label: opts.label || '',
      category: opts.category || '',
      phase: 'focus',        // 仅番茄模式：focus | break
      pomodoros: 0,          // 本次已完成的专注轮数
      studyMs: 0,            // 已累计的学习时间（秒表=全部运行时间；番茄=只算专注）
      phaseMs: 0,            // 当前阶段已累计（仅番茄模式用；暂停时保存）
      segmentStart: t,       // 当前这一段开始的时刻；null = 暂停中
      startedAt: t,          // 整体开始时刻
      pausedMs: 0,
      pomo: M.normalizePomo(opts.pomo),
      lastNotify: null       // 供界面做一次性提示
    };
  }

  /* ---------------- 读数 ---------------- */

  function running(t) { return !!(t && t.active && t.segmentStart !== null); }

  /** 当前这一段的毫秒数（暂停中为 0） */
  function segmentMs(t, now) {
    if (!running(t)) return 0;
    var n = (now === undefined ? Date.now() : now);
    return Math.max(0, n - t.segmentStart);
  }

  /** 当前阶段已进行的毫秒数（番茄模式判断是否该换阶段） */
  function phaseElapsedMs(t, now) {
    if (!t || !t.active) return 0;
    return (t.phaseMs || 0) + segmentMs(t, now);
  }

  /** 至今为止的学习时长（毫秒）。番茄模式下进行中的专注段也算进去。 */
  function studyMs(t, now) {
    if (!t || !t.active) return 0;
    var base = t.studyMs || 0;
    if (t.mode === 'pomodoro') {
      return base + (t.phase === 'focus' ? segmentMs(t, now) : 0);
    }
    return base + segmentMs(t, now);
  }

  function studySeconds(t, now) { return Math.floor(studyMs(t, now) / 1000); }

  /** 当前阶段的剩余秒数（秒表模式返回 0） */
  function phaseRemainSeconds(t, now) {
    if (!t || !t.active || t.mode !== 'pomodoro') return 0;
    var target = phaseTargetMs(t);
    return Math.max(0, Math.ceil((target - phaseElapsedMs(t, now)) / 1000));
  }

  function phaseTargetMs(t) {
    var p = M.normalizePomo(t.pomo);
    if (t.phase === 'break') {
      var isLong = p.longEvery > 0 && t.pomodoros > 0 && (t.pomodoros % p.longEvery === 0);
      return (isLong ? p.longBreakMin : p.breakMin) * 60000;
    }
    return p.focusMin * 60000;
  }

  /* ---------------- 操作 ---------------- */

  function pause(t, now) {
    if (!running(t)) return t;
    var n = now === undefined ? Date.now() : now;
    var seg = Math.max(0, n - t.segmentStart);
    if (t.mode === 'pomodoro') t.phaseMs = (t.phaseMs || 0) + seg;
    else t.studyMs = (t.studyMs || 0) + seg;
    t.segmentStart = null;
    return t;
  }

  function resume(t, now) {
    if (!t || !t.active || t.segmentStart !== null) return t;
    t.segmentStart = now === undefined ? Date.now() : now;
    return t;
  }

  function togglePause(t, now) {
    return running(t) ? pause(t, now) : resume(t, now);
  }

  /**
   * 推进番茄轮次。每次 tick / 每次恢复页面时调用。
   * 返回本次新完成的阶段通知（'focus-done' / 'break-done'），无则 null。
   * 一次调用最多推进 maxHops 次，避免长时间未打开时死循环。
   */
  function advance(t, now, maxHops) {
    if (!t || !t.active || t.mode !== 'pomodoro' || !running(t)) return null;
    var n = now === undefined ? Date.now() : now;
    var hops = maxHops === undefined ? 200 : maxHops;
    var firstDone = null;

    while (hops-- > 0) {
      var target = phaseTargetMs(t);
      var elapsed = phaseElapsedMs(t, n);
      if (elapsed < target) break;

      // 新阶段要从「上一阶段本该结束的时刻」接续，不能从 now 开始——
      // 否则页面关了一小时后回来，中间那段时长会被凭空丢掉（少算学习时间）。
      var boundary = t.segmentStart + (target - (t.phaseMs || 0));

      if (t.phase === 'focus') {
        // 精确按目标时长计入，避免 tick 抖动把学习时长算多
        t.studyMs = (t.studyMs || 0) + target;
        t.pomodoros = (t.pomodoros || 0) + 1;
        t.phase = 'break';
        if (!firstDone) firstDone = 'focus-done';
      } else {
        t.phase = 'focus';
        if (!firstDone) firstDone = 'break-done';
      }
      t.phaseMs = 0;
      t.segmentStart = boundary;
    }
    if (firstDone) t.lastNotify = firstDone;
    return firstDone;
  }

  /**
   * 结束计时，返回一条学习记录（session）。没有有效学习时长时返回 null。
   */
  function finish(t, now) {
    if (!t || !t.active) return null;
    var n = now === undefined ? Date.now() : now;
    var totalMs = studyMs(t, n);
    var seconds = Math.floor(totalMs / 1000);
    var endedAt = new Date(n);

    var s = M.blankSession();
    s.planId = t.planId || null;
    s.label = t.label || '';
    s.category = t.category || '';
    s.startAt = new Date(t.startedAt).toISOString();
    s.endAt = endedAt.toISOString();
    s.seconds = seconds;
    s.date = U.toDateString(new Date(t.startedAt));   // 按开始时刻归属
    s.pomodoros = t.mode === 'pomodoro' ? (t.pomodoros || 0) : 0;
    return seconds > 0 ? M.normalizeSession(s) : null;
  }

  /** 失控检测：结束前用于提示（超过阈值就弹确认） */
  function isRunaway(t, now, thresholdMs) {
    var limit = thresholdMs === undefined ? 6 * 3600 * 1000 : thresholdMs;
    return studyMs(t, now) > limit;
  }

  /* ---------------- 提示音 / 标题闪动 ---------------- */

  var audioCtx = null;

  /** 必须在用户手势里调用一次，否则浏览器禁止后面自动播放 */
  function primeAudio() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
    } catch (e) { /* 忽略 */ }
  }

  /** 用 Web Audio 合成提示音，避免外挂音频文件（保持单文件、零外部请求） */
  function beep(times, freq) {
    try {
      primeAudio();
      if (!audioCtx) return;
      var ctx = audioCtx;
      var count = times || 2;
      var f = freq || 880;
      var t0 = ctx.currentTime + 0.02;
      for (var i = 0; i < count; i++) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        var at = t0 + i * 0.36;
        osc.type = 'sine';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.32);
      }
    } catch (e) { /* 忽略：可能被自动播放策略拦下 */ }
  }

  var titleTimer = null;
  var originalTitle = null;

  /** 标题闪动提示（切到别的标签页时也能看到） */
  function flashTitle(text) {
    try {
      if (originalTitle === null) originalTitle = document.title;
      if (titleTimer) clearInterval(titleTimer);
      var on = false;
      var left = 8;
      titleTimer = setInterval(function () {
        document.title = on ? originalTitle : (text || '⏰ 时间到');
        on = !on;
        if (--left <= 0) {
          clearInterval(titleTimer);
          titleTimer = null;
          document.title = originalTitle;
        }
      }, 700);
    } catch (e) { /* 忽略 */ }
  }

  KG.Timer = {
    create: create,
    running: running,
    pause: pause,
    resume: resume,
    togglePause: togglePause,
    studyMs: studyMs,
    studySeconds: studySeconds,
    phaseElapsedMs: phaseElapsedMs,
    phaseTargetMs: phaseTargetMs,
    phaseRemainSeconds: phaseRemainSeconds,
    advance: advance,
    finish: finish,
    isRunaway: isRunaway,
    primeAudio: primeAudio,
    beep: beep,
    flashTitle: flashTitle
  };
})();
