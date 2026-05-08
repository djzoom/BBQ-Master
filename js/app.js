/**
 * Smoker Dynamics — plan-mode timeline workbench.
 *
 * Source of truth: view.events — a sorted list of planned events.
 * Anything that mutates events (dock click / drag / chip removal /
 * preset reset / horizon change) calls replayCook(), which:
 *   1. Creates a fresh sim state from preset.inputs
 *   2. Replays events in time order, stepping the physics each minute
 *   3. Returns samples + final state, which the UI renders
 */
(function () {
  'use strict';

  var C = window.SmokerSim.constants;
  var Sim = window.SmokerSim.simulator;
  var Presets = window.SmokerSim.presets;
  var FM = window.SmokerSim.fireModel;
  var Stall = window.SmokerSim.stallModel;

  var LANES = ['Fire', 'Smoke', 'Wrap', 'Handling'];
  var EVENT_DEFS = [
    { id: 'refuel-1',    label: '+1 Coal',   lane: 'Fire',     tone: 'fire' },
    { id: 'refuel-4',    label: '+4 Coal',   lane: 'Fire',     tone: 'fire' },
    { id: 'refuel-8',    label: '+8 Preheat',lane: 'Fire',     tone: 'fire' },
    { id: 'refuel-12',   label: '+12 Preheat',lane: 'Fire',    tone: 'fire' },
    { id: 'coal-minus',  label: '−1 Coal',   lane: 'Fire',     tone: 'fire-minus' },
    { id: 'wood',        label: '🌲 Sawdust',lane: 'Smoke',    tone: 'smoke' },
    { id: 'paper',       label: 'Paper',     lane: 'Wrap',     tone: 'wrap' },
    { id: 'foil',        label: 'Foil',      lane: 'Wrap',     tone: 'wrap' },
    { id: 'bare',        label: 'Bare',      lane: 'Wrap',     tone: 'wrap' },
    { id: 'spritz',      label: '💧 Spritz',  lane: 'Handling', tone: 'water' },
    { id: 'tallow',      label: '🧈 Tallow',  lane: 'Handling', tone: 'water' },
    { id: 'lid',         label: 'Lid 30s',   lane: 'Handling', tone: 'handling' },
    { id: 'damper-up',   label: 'Damper +10',lane: 'Fire',     tone: 'fire' },
    { id: 'damper-down', label: 'Damper -10',lane: 'Fire',     tone: 'fire' },
    { id: 'pull',        label: 'Pull',      lane: 'Handling', tone: 'finish' },
    { id: 'slice',       label: 'Slice',     lane: 'Handling', tone: 'finish' },
    { id: 'undo',        label: '↶ Undo',    lane: 'Handling', tone: 'undo' },
    { id: 'clear',       label: '⌫ Clear all', lane: 'Handling', tone: 'undo' }
  ];

  var view = {
    presetId: 'texas',
    preset: null,
    sim: null,
    events: [],
    cursorMin: 0,
    horizonMin: 720,
    overrides: {
      tAmbF: 70, weightLb: 12, tPitInitF: 70, tMeatInitF: 40,
      tStartMin: 5 * 60 + 30
    },
    samples: [],
    timelineChart: null,
    scoreChart: null,
    replayPending: false,
    history: [],
    lang: (function () { try { return localStorage.getItem('smoker.lang') || 'zh'; } catch (e) { return 'zh'; } })()
  };

  var PHASES = {
    startup: { cls: 'phase-startup', icon: '⚫', zh: '待引火',     en: 'Awaiting ignition' },
    light:   { cls: 'phase-light',   icon: '🔥', zh: '引火中',     en: 'Lighting fire' },
    stable:  { cls: 'phase-stable',  icon: '🔵', zh: '稳态烟熏',   en: 'Smoke stable' },
    bark:    { cls: 'phase-bark',    icon: '🟤', zh: '树皮形成',   en: 'Bark forming' },
    stall:   { cls: 'phase-stall',   icon: '🟡', zh: 'Stall 停滞', en: 'Stall plateau' },
    push:    { cls: 'phase-push',    icon: '🔥', zh: '推过 stall', en: 'Push past stall' },
    finish:  { cls: 'phase-finish',  icon: '🟢', zh: '可出炉',     en: 'Probe-tender' },
    rest:    { cls: 'phase-rest',    icon: '⚪', zh: '静置中',     en: 'Resting' }
  };

  function detectPhase(s) {
    if (!s) return 'startup';
    if (s.phase === 'rest' || s.phase === 'slice') return 'rest';
    var n = s.T.length - 1;
    var coreF = C.cToF(s.T[n]);
    var pitF  = C.cToF(s.tPitC);
    var coalsActive = s.coals && s.coals.length > 0;
    if ((s.C || 0) >= 0.85 || coreF >= 200) return 'finish';
    if (s.wrapState && s.wrapState !== 'none') return 'push';
    if (coreF >= 148 && coreF <= 175) return 'stall';
    if (!coalsActive) return 'startup';
    if (pitF < 200) return 'light';
    if (coreF >= 100) return 'bark';
    return 'stable';
  }

  function aiSuggestion(s, phaseId) {
    var lang = view.lang;
    if (!s) return { verdict: '', why: '', confidence: '' };
    var n = s.T.length - 1;
    var coreF = Math.round(C.cToF(s.T[n]));
    var pitF  = Math.round(C.cToF(s.tPitC));
    var msgs = {
      startup: {
        zh: { v: '点 +8 预热启动炉子。', w: '8 块备长炭在桶式炉里峰值约 240°F，足够低温慢烤。空炉热惯性需要 30-40 分钟才稳态。', c: '初始' },
        en: { v: 'Light +8 to preheat.', w: '8 binchotan pieces peak around 240°F in a drum smoker. Empty pit needs ~30-40 min to stabilize.', c: 'Pre-cook' }
      },
      light: {
        zh: { v: '等炉温到 230-260°F 再上肉。', w: '当前 pit ' + pitF + '°F，正在升温。冷肉下锅会拉低 30-40°F。', c: '引火期' },
        en: { v: 'Wait until pit hits 230-260°F before adding meat.', w: 'Pit at ' + pitF + '°F, climbing. Cold meat will pull pit down 30-40°F when added.', c: 'Lighting' }
      },
      stable: {
        zh: { v: '炉子稳了，可以放肉。烟木现在塞进去最好。', w: 'Pit ' + pitF + '°F 在烟稳区。Smoke ring 在表面 < 60°C 的前 90 分钟最容易吸收。', c: '稳态' },
        en: { v: 'Pit is stable. Add meat now and load smoke wood.', w: 'Pit at ' + pitF + '°F in the clean-smoke band. Smoke ring forms best while surface < 60°C in the first 90 min.', c: 'Stable' }
      },
      bark: {
        zh: { v: '盯紧 meat 温度，stall 即将到来。', w: 'Meat 现在 ' + coreF + '°F，到 148°F 会开始 stall plateau。趁现在让烟入味、树皮成形。', c: '树皮期' },
        en: { v: 'Bark is forming. Watch for stall starting around 148°F.', w: 'Meat at ' + coreF + '°F. Wet-bulb evap will plateau the temp soon — let smoke and crust build now.', c: 'Bark phase' }
      },
      stall: {
        zh: { v: '建议包届夫纸推过 stall。', w: 'Meat 卡在 ' + coreF + '°F，蒸发吸热占主导。包纸早约 2 小时完成，bark 略软（−8 分），juicy +6 分。', c: '建议' },
        en: { v: 'Wrap in butcher paper to push through the stall.', w: 'Meat plateaued at ' + coreF + '°F. Evap is winning. Wrapping cuts ~2 h off finish; bark softens slightly.', c: 'Stall action' }
      },
      push: {
        zh: { v: '继续等到 200-205°F 探针滑入。', w: 'Meat 现在 ' + coreF + '°F，再升 ' + Math.max(0, 203 - coreF) + '°F 就能 probe-tender。约 1-2 小时。', c: '冲温期' },
        en: { v: 'Hold steady until 200-205°F and probe-tender.', w: 'Meat at ' + coreF + '°F, ~' + Math.max(0, 203 - coreF) + '°F to go. About 1-2 h.', c: 'Push phase' }
      },
      finish: {
        zh: { v: '出炉，铝箔包静置 1 小时。', w: 'Collagen 已转化 ' + Math.round((s.C || 0) * 100) + '%，meat ' + coreF + '°F。静置让肉汁回流。', c: '出炉' },
        en: { v: 'Pull and rest in foil for 1 h.', w: 'Collagen ' + Math.round((s.C || 0) * 100) + '% converted, meat ' + coreF + '°F. Rest lets juices redistribute.', c: 'Done' }
      },
      rest: {
        zh: { v: '静置中，等到吃饭时间切片。', w: '保温箱 60-71°C，每多 15 分钟肉汁多保留约 3%。', c: '静置' },
        en: { v: 'Resting. Slice at serving time.', w: 'Hold at 60-71°C. Each extra 15 min retains ~3% more juice.', c: 'Resting' }
      }
    };
    var pick = (msgs[phaseId] && msgs[phaseId][lang]) || msgs.startup.zh;
    return { verdict: pick.v, why: pick.w, confidence: pick.c };
  }

  function computeETA() {
    for (var i = 0; i < view.samples.length; i++) {
      if (view.samples[i].tender >= 99) return view.samples[i].x;
    }
    return null;
  }

  function setLang(l) {
    view.lang = l;
    try { localStorage.setItem('smoker.lang', l); } catch (e) {}
    var btn = $('lang-toggle');
    if (btn) btn.textContent = l === 'zh' ? 'EN' : '中';
    document.documentElement.setAttribute('lang', l === 'zh' ? 'zh-CN' : 'en');
    rerender(false);
  }
  function bindLangToggle() {
    var btn = $('lang-toggle');
    if (!btn) return;
    btn.textContent = view.lang === 'zh' ? 'EN' : '中';
    btn.addEventListener('click', function () { setLang(view.lang === 'zh' ? 'en' : 'zh'); });
  }

  function $(id) { return document.getElementById(id); }
  function css(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function formatClock(min) {
    if (min < 0) min = 0;
    var h = Math.floor(min / 60);
    var m = Math.round(min % 60);
    return h + ':' + (m < 10 ? '0' + m : m);
  }
  function formatF(c) { return Math.round(C.cToF(c)) + 'F'; }

  function defaultEventsForPreset(p) { return []; }

  function replayCook() {
    if (!view.preset) return null;
    var inputs = Object.assign({}, view.preset.inputs, {
      tAmbF: view.overrides.tAmbF, weightLb: view.overrides.weightLb,
      tPitInitF: view.overrides.tPitInitF, tInitF: view.overrides.tMeatInitF
    });
    var fresh = Sim.create(inputs);
    fresh.damperPct = view.preset.policy.damperPct;
    view.sim = fresh;
    view.samples = [];
    view.events.sort(function (a, b) { return a.t - b.t; });
    pushSample(true);
    var evIdx = 0;
    var sorted = view.events;
    var horizon = view.horizonMin;
    while (fresh.tSimMin < horizon && fresh.phase !== 'slice') {
      while (evIdx < sorted.length && sorted[evIdx].t <= fresh.tSimMin + 0.5) {
        applyEventToSim(fresh, sorted[evIdx]);
        evIdx++;
      }
      Sim.step(fresh, 60);
      pushSample(false);
    }
    fresh.eventLog = view.events.slice();
    return fresh;
  }

  function pushSample(force) {
    if (!view.sim) return;
    var last = view.samples[view.samples.length - 1];
    if (!force && last && view.sim.tSimMin - last.x < 1) return;
    var n = view.sim.T.length - 1;
    var d = scoreFromState(view.sim);
    view.samples.push({
      x: view.sim.tSimMin,
      pit: C.cToF(view.sim.tPitC),
      meat: C.cToF(view.sim.T[n]),
      done: d.doneness, tender: d.tender, juicy: d.juicy,
      bark: d.bark, smoke: d.smoke
    });
  }

  function applyEventToSim(state, e) {
    switch (e.kind) {
      case 'ignite':  Sim.ignite(state, e.n || 12); break;
      case 'refuel':  Sim.refuel(state, e.n || 4); break;
      case 'wood':    Sim.addWood(state, e.mass || 0.15, e.species || 'post_oak'); break;
      case 'wrap':    Sim.wrap(state, e.type || 'butcher_paper'); break;
      case 'spritz':  Sim.spritz(state, e.volume || 30); break;
      case 'tallow':  Sim.tallow(state, e.volume || 30); break;
      case 'lid':     Sim.openLid(state, e.seconds || 30); break;
      case 'damper':  Sim.damper(state, e.pct); break;
      case 'pull':    Sim.pull(state); break;
      case 'slice':   Sim.slice(state, view.preset.policy.restMethod); break;
    }
  }

  function rerender(reset) { replayCook(); syncCharts(reset === true); updateUI(); }
  function rerenderThrottled() {
    if (view.replayPending) return;
    view.replayPending = true;
    requestAnimationFrame(function () {
      view.replayPending = false;
      replayCook(); syncCharts(false); updateUI();
    });
  }
  function setCursor(t) { view.cursorMin = clamp(t, 0, view.horizonMin); syncCharts(false); updateUI(); }

  function pushHistory() {
    view.history.push(view.events.map(function (e) { return Object.assign({}, e); }));
    if (view.history.length > 100) view.history.shift();
  }

  function applyEvent(id) {
    if (id === 'undo') {
      if (!view.history.length) { toast('Nothing to undo'); return; }
      view.events = view.history.pop();
      toast('Undid last change'); rerender(false); return;
    }
    if (id === 'clear') {
      if (!view.events.length) { toast('Already empty'); return; }
      pushHistory();
      var n = view.events.length;
      view.events = [];
      toast('Cleared ' + n + ' event' + (n === 1 ? '' : 's'));
      rerender(false); return;
    }
    pushHistory();
    var t = view.cursorMin;
    switch (id) {
      case 'ignite':       addCoalEvent(t, 'ignite', 12); break;
      case 'refuel-1':     addCoalEvent(t, 'refuel', 1); break;
      case 'refuel-4':     addCoalEvent(t, 'refuel', 4); break;
      case 'refuel-8':     addCoalEvent(t, 'refuel', 8); break;
      case 'refuel-12':    addCoalEvent(t, 'refuel', 12); break;
      case 'coal-minus':
        if (!peelOneCoalAt(t)) { view.history.pop(); toast('No coals to remove at cursor'); return; }
        break;
      case 'wood':         view.events.push({ t: t, kind: 'wood', mass: 0.15, species: 'post_oak' }); break;
      case 'paper':        view.events.push({ t: t, kind: 'wrap', type: 'butcher_paper' }); break;
      case 'foil':         view.events.push({ t: t, kind: 'wrap', type: 'aluminum_foil' }); break;
      case 'bare':         view.events.push({ t: t, kind: 'wrap', type: 'none' }); break;
      case 'spritz':       view.events.push({ t: t, kind: 'spritz', volume: 30 }); break;
      case 'tallow':       view.events.push({ t: t, kind: 'tallow', volume: 30 }); break;
      case 'lid':          view.events.push({ t: t, kind: 'lid', seconds: 30 }); break;
      case 'damper-up':    view.events.push({ t: t, kind: 'damper', pct: lastDamperBefore(t) + 10 }); break;
      case 'damper-down':  view.events.push({ t: t, kind: 'damper', pct: lastDamperBefore(t) - 10 }); break;
      case 'pull':         view.events.push({ t: t, kind: 'pull' }); break;
      case 'slice':        view.events.push({ t: t, kind: 'slice' }); break;
    }
    rerender(false);
  }

  function addCoalEvent(t, kind, n) {
    for (var i = 0; i < view.events.length; i++) {
      var e = view.events[i];
      if ((e.kind === 'refuel' || (kind === 'refuel' && e.kind === 'ignite' && e.t > 0))
          && Math.abs(e.t - t) < 1.0) { e.n += n; return; }
    }
    view.events.push({ t: t, kind: kind, n: n });
  }

  function peelOneCoalAt(t) {
    for (var i = view.events.length - 1; i >= 0; i--) {
      var e = view.events[i];
      if ((e.kind === 'refuel' || e.kind === 'ignite') && e.t <= t + 0.5) {
        e.n -= 1;
        if (e.n <= 0) view.events.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  function lastDamperBefore(t) {
    var v = view.preset.policy.damperPct || 60;
    for (var i = 0; i < view.events.length; i++) {
      if (view.events[i].kind === 'damper' && view.events[i].t < t) v = view.events[i].pct;
    }
    return v;
  }

  function removeEventByIndex(idx) {
    if (idx < 0 || idx >= view.events.length) return;
    pushHistory();
    var e = view.events[idx];
    view.events.splice(idx, 1);
    toast('Removed ' + describeEvent(e) + ' @ ' + formatClock(e.t));
    rerender(false);
  }

  function describeEvent(e) {
    if (e.kind === 'refuel') return '+' + e.n + ' coal';
    if (e.kind === 'ignite') return 'ignite ' + e.n;
    if (e.kind === 'wrap')   return wrapLabelFor(e.type);
    if (e.kind === 'damper') return 'damper ' + e.pct + '%';
    return e.kind;
  }

  function toast(msg) {
    var el = $('app-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'app-toast'; el.className = 'app-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._hideT);
    el._hideT = setTimeout(function () { el.classList.remove('show'); }, 1600);
  }

  function scoreFromState(s) {
    if (!s) return { doneness: 0, tender: 0, juicy: 100, bark: 0, smoke: 0 };
    var n = s.T.length - 1;
    var coreF = C.cToF(s.T[n]);
    var water = s.wRetained != null ? s.wRetained : s.w;
    var smokeGood = s.smoke ? s.smoke.good : 0;
    var smokeBad  = s.smoke ? s.smoke.bad  : 0;
    var wrapped = s.wrapState && s.wrapState !== 'none';
    var tender = clamp(((s.C || 0) / 0.85) * 100, 0, 100);
    var juicy  = clamp((water / 0.75) * 100, 0, 100);
    var doneness = clamp(100 - Math.abs(coreF - 203) * 2.5, 0, 100);
    var smoke = clamp(smokeGood * 60 - smokeBad * 35, 0, 100);
    var bark = clamp((s.crust || 0) * 90 + smokeGood * 15, 0, 100);
    return { doneness: doneness, tender: tender, juicy: juicy, bark: bark, smoke: smoke };
  }

  function scoreCook() {
    var s = view.sim;
    var d = scoreFromState(s);
    var arr = [d.doneness, d.tender, d.juicy, d.bark, d.smoke];
    var overall = arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
    return {
      labels: ['Done', 'Tender', 'Juicy', 'Bark', 'Smoke'],
      scores: arr.map(function (v) { return Math.round(v); }),
      overall: Math.round(overall)
    };
  }

  function physicsReadouts() {
    var s = view.sim;
    if (!s) return { collagen: 0, water: 100, stall: 0, qFireW: 0 };
    var qFireW = FM ? FM.qFire(s.coals, view.cursorMin, s.damperPct) : 0;
    var n = s.T.length - 1;
    var coreF = C.cToF(s.T[n]);
    var thicknessIn = s.halfThickM ? (2 * s.halfThickM / 0.0254) : 3;
    var pStall = Stall ? Stall.stallProbability(coreF, s.humidityPct || 50,
        s.windMph || 2, thicknessIn, recentSlope()) : 0;
    var w = s.wRetained != null ? s.wRetained : s.w;
    return {
      collagen: Math.round((s.C || 0) * 100),
      water: Math.round(w * 100),
      stall: Math.round(pStall * 100),
      qFireW: Math.round(qFireW)
    };
  }

  function recentSlope() {
    var s = view.samples;
    if (s.length < 2) return 0;
    var last = s[s.length - 1];
    var first = last;
    for (var i = s.length - 2; i >= 0; i--) {
      if (s[i].x <= last.x - 5) { first = s[i]; break; }
      first = s[i];
    }
    var dt = last.x - first.x;
    if (dt <= 0.1) return 0;
    return (last.meat - first.meat) / dt;
  }

  function wrapLabel(s) {
    var ws = (s && s.wrapState) || 'none';
    if (ws === 'butcher_paper') return 'Paper';
    if (ws === 'aluminum_foil') return 'Foil';
    if (ws === 'foil_boat') return 'Boat';
    return 'Bare';
  }
  function wrapLabelFor(type) {
    if (type === 'butcher_paper') return 'Paper';
    if (type === 'aluminum_foil') return 'Foil';
    if (type === 'foil_boat') return 'Boat';
    return 'Bare';
  }

  function updateUI() {
    if (!view.sim) return;
    var clock = formatClockOfDay(view.overrides.tStartMin + view.cursorMin);
    if ($('metric-clock')) $('metric-clock').textContent = clock;
    if ($('metric-phase')) $('metric-phase').textContent = '+' + formatClock(view.cursorMin);
    var atCursor = sampleAtTime(view.cursorMin);
    if ($('metric-pit')) $('metric-pit').textContent = Math.round(atCursor.pit);
    if ($('metric-meat')) $('metric-meat').textContent = Math.round(atCursor.meat);
    if ($('metric-damper')) $('metric-damper').textContent = view.sim.damperPct + '%';
    if ($('metric-wrap')) $('metric-wrap').textContent = wrapLabel(view.sim);
    if ($('score-overall')) $('score-overall').textContent = scoreCook().overall;
    var p = physicsReadouts();
    if ($('metric-collagen')) $('metric-collagen').textContent = p.collagen;
    if ($('metric-water'))    $('metric-water').textContent    = p.water;
    if ($('metric-stall'))    $('metric-stall').textContent    = p.stall;
    if ($('metric-fire'))     $('metric-fire').textContent     = p.qFireW;

    var phaseId = detectPhase(view.sim);
    var P = PHASES[phaseId];
    var pill = $('phase-pill');
    if (pill && P) {
      pill.className = 'phase-pill ' + P.cls;
      pill.textContent = P.icon + ' ' + (view.lang === 'zh' ? P.zh : P.en);
    }

    var ai = aiSuggestion(view.sim, phaseId);
    if ($('ai-verdict'))    $('ai-verdict').textContent    = ai.verdict;
    if ($('ai-why'))        $('ai-why').textContent        = ai.why;
    if ($('ai-confidence')) $('ai-confidence').textContent = ai.confidence;

    var etaMin = computeETA();
    var etaEl = $('metric-eta');
    var etaRangeEl = $('metric-eta-range');
    if (etaEl) {
      if (etaMin != null) {
        etaEl.textContent = formatClockOfDay(view.overrides.tStartMin + etaMin);
        if (etaRangeEl) etaRangeEl.textContent = '+' + formatClock(etaMin);
      } else {
        etaEl.textContent = '—';
        if (etaRangeEl) etaRangeEl.textContent = view.lang === 'zh' ? '需要更多火' : 'need more fuel';
      }
    }

    renderEventLanes();
  }

  function sampleAtTime(t) {
    if (!view.samples.length) return { pit: 70, meat: 40 };
    if (t <= view.samples[0].x) return view.samples[0];
    for (var i = 0; i < view.samples.length - 1; i++) {
      if (view.samples[i].x <= t && view.samples[i + 1].x >= t) {
        var a = view.samples[i], b = view.samples[i + 1];
        var f = (t - a.x) / (b.x - a.x || 1);
        return { pit: a.pit + (b.pit - a.pit) * f, meat: a.meat + (b.meat - a.meat) * f };
      }
    }
    return view.samples[view.samples.length - 1];
  }

  function makeTimelineChart() {
    if (!window.Chart) return null;
    var canvas = $('chart-timeline');
    var DIM_COLORS = { done: '#16A34A', tender: '#B85B2D', juicy: '#2A8AC5', bark: '#6B4F32', smoke: '#7E57C2' };
    return new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { datasets: [
        { label: 'Pit',  yAxisID: 'y', data: [], borderColor: '#E8763A', backgroundColor: 'rgba(232,118,58,0.10)', borderWidth: 3, pointRadius: 0, tension: 0.25 },
        { label: 'Meat', yAxisID: 'y', data: [], borderColor: '#F5F0E6', backgroundColor: 'rgba(245,240,230,0.10)', borderWidth: 3, pointRadius: 0, tension: 0.25, fill: true },
        { label: 'Done',   yAxisID: 'y2', data: [], borderColor: DIM_COLORS.done,   borderWidth: 1.5, pointRadius: 0, tension: 0.2, borderDash: [2, 3] },
        { label: 'Tender', yAxisID: 'y2', data: [], borderColor: DIM_COLORS.tender, borderWidth: 1.5, pointRadius: 0, tension: 0.2, borderDash: [2, 3] },
        { label: 'Juicy',  yAxisID: 'y2', data: [], borderColor: DIM_COLORS.juicy,  borderWidth: 1.5, pointRadius: 0, tension: 0.2, borderDash: [2, 3] },
        { label: 'Bark',   yAxisID: 'y2', data: [], borderColor: DIM_COLORS.bark,   borderWidth: 1.5, pointRadius: 0, tension: 0.2, borderDash: [2, 3] },
        { label: 'Smoke',  yAxisID: 'y2', data: [], borderColor: DIM_COLORS.smoke,  borderWidth: 1.5, pointRadius: 0, tension: 0.2, borderDash: [2, 3] }
      ]},
      options: {
        animation: false, parsing: false, responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { align: 'start', labels: { boxWidth: 10, color: '#8B8478', font: { size: 11 } } },
          tooltip: { callbacks: {
            title: function (items) { var v = items[0].parsed.x; return formatClockOfDay(view.overrides.tStartMin + v) + '  (+' + formatClock(v) + ')'; },
            label: function (ctx) { return ctx.dataset.label + ' ' + Math.round(ctx.parsed.y) + 'F'; }
          } },
          annotation: { annotations: {} }
        },
        scales: {
          x: { type: 'linear', min: 0, max: 720,
               grid: { color: 'rgba(245,240,230,0.06)' },
               ticks: { color: '#8B8478', maxTicksLimit: 9,
                 callback: function (v) { return [formatClockOfDay(view.overrides.tStartMin + v), '+' + formatClock(v)]; } } },
          y: { position: 'left', min: 30, max: 330,
               grid: { color: 'rgba(245,240,230,0.06)' },
               ticks: { color: '#8B8478', callback: function (v) { return v + 'F'; } } },
          y2: { position: 'right', min: 0, max: 100,
                grid: { drawOnChartArea: false },
                ticks: { color: '#8B8478', callback: function (v) { return v; }, stepSize: 25 } }
        }
      }
    });
  }

  function makeScoreChart() {
    if (!window.Chart) return null;
    var canvas = $('chart-score');
    return new Chart(canvas.getContext('2d'), {
      type: 'radar',
      data: { labels: ['Done', 'Tender', 'Juicy', 'Bark', 'Smoke'],
              datasets: [{ data: [0,0,100,0,0],
                           borderColor: '#E8763A',
                           backgroundColor: 'rgba(232,118,58,0.18)',
                           borderWidth: 2, pointRadius: 2 }] },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { r: { min: 0, max: 100, ticks: { display: false, stepSize: 25 },
                       angleLines: { color: 'rgba(245,240,230,0.08)' },
                       grid: { color: 'rgba(245,240,230,0.08)' },
                       pointLabels: { color: '#8B8478', font: { size: 11 } } } }
      }
    });
  }

  function eventAnnotationStyle(kind) {
    if (kind === 'ignite' || kind === 'refuel') return { color: '#E8763A', symbol: '🔥' };
    if (kind === 'wood')                        return { color: '#8B6F47', symbol: '🌲' };
    if (kind === 'wrap')                        return { color: '#5A7A93', symbol: '📦' };
    if (kind === 'spritz')                      return { color: '#5A7A93', symbol: '💧' };
    if (kind === 'tallow')                      return { color: '#D9A349', symbol: '🧈' };
    if (kind === 'lid')                         return { color: '#8B8478', symbol: '↕' };
    if (kind === 'damper')                      return { color: '#4A4640', symbol: '◎' };
    if (kind === 'pull' || kind === 'slice')    return { color: '#7B9B5C', symbol: '✓' };
    return { color: '#8B8478', symbol: '·' };
  }

  function buildEventAnnotations(events) {
    var ann = {};
    events.forEach(function (e, i) {
      var sty = eventAnnotationStyle(e.kind);
      var labelText;
      if (e.kind === 'refuel')      labelText = '+' + e.n;
      else if (e.kind === 'ignite') labelText = sty.symbol + e.n;
      else                          labelText = sty.symbol;
      ann['ev-' + i] = {
        type: 'line', scaleID: 'x', value: e.t,
        borderColor: sty.color, borderWidth: 1.25, borderDash: [3, 4],
        drawTime: 'beforeDatasetsDraw',
        label: { display: true, content: labelText, position: 'start',
                 backgroundColor: sty.color, color: '#fff',
                 font: { size: 9, weight: '700' }, padding: { top: 1, bottom: 1, left: 4, right: 4 },
                 borderRadius: 2, yAdjust: -4 }
      };
    });
    var cursorLabel = '▼ ' + formatClockOfDay(view.overrides.tStartMin + view.cursorMin)
                    + ' (+' + formatClock(view.cursorMin) + ')';
    ann['cursor'] = {
      type: 'line', scaleID: 'x', value: view.cursorMin,
      borderColor: '#E8763A', borderWidth: 2, drawTime: 'afterDatasetsDraw',
      label: { display: true, content: cursorLabel, position: 'end',
               backgroundColor: '#E8763A', color: '#fff',
               font: { size: 10, weight: '700' }, padding: 3, borderRadius: 2 }
    };
    return ann;
  }

  function syncCharts(reset) {
    if (view.timelineChart) {
      var ds = view.timelineChart.data.datasets;
      ds[0].data = view.samples.map(function (p) { return { x: p.x, y: p.pit }; });
      ds[1].data = view.samples.map(function (p) { return { x: p.x, y: p.meat }; });
      ds[2].data = view.samples.map(function (p) { return { x: p.x, y: p.done }; });
      ds[3].data = view.samples.map(function (p) { return { x: p.x, y: p.tender }; });
      ds[4].data = view.samples.map(function (p) { return { x: p.x, y: p.juicy }; });
      ds[5].data = view.samples.map(function (p) { return { x: p.x, y: p.bark }; });
      ds[6].data = view.samples.map(function (p) { return { x: p.x, y: p.smoke }; });
      view.timelineChart.options.scales.x.max = view.horizonMin;
      var annPlugin = view.timelineChart.options.plugins.annotation;
      if (annPlugin) annPlugin.annotations = buildEventAnnotations(view.events);
      view.timelineChart.update(reset ? undefined : 'none');
    }
    if (view.scoreChart && view.sim) {
      var score = scoreCook();
      view.scoreChart.data.labels = score.labels;
      view.scoreChart.data.datasets[0].data = score.scores;
      view.scoreChart.update(reset ? undefined : 'none');
    }
    syncLaneAlignment();
    requestAnimationFrame(syncLaneAlignment);
  }

  function syncLaneAlignment() {
    var c = view.timelineChart;
    if (!c || !c.chartArea) return;
    var lanes = $('event-lanes');
    if (!lanes) return;
    var canvasRect = c.canvas.getBoundingClientRect();
    var lanesRect  = lanes.getBoundingClientRect();
    if (!canvasRect.width || !lanesRect.width) return;
    var plotLeftVp  = canvasRect.left + c.chartArea.left;
    var plotRightVp = canvasRect.left + c.chartArea.right;
    var leftOffset = Math.round(plotLeftVp - lanesRect.left);
    var rightGap   = Math.round(lanesRect.right - plotRightVp);
    lanes.style.setProperty('--lane-label-w', leftOffset + 'px');
    lanes.style.setProperty('--track-right', rightGap + 'px');
  }

  function eventLane(kind) {
    if (kind === 'ignite' || kind === 'refuel' || kind === 'damper') return 'Fire';
    if (kind === 'wood') return 'Smoke';
    if (kind === 'wrap') return 'Wrap';
    return 'Handling';
  }
  function eventLabel(e) {
    if (e.kind === 'ignite') return 'Light ' + e.n;
    if (e.kind === 'refuel') return '+' + e.n + ' Coal';
    if (e.kind === 'wood') return '🌲 Sawdust';
    if (e.kind === 'wrap') return wrapLabelFor(e.type);
    if (e.kind === 'spritz') return '💧 Spritz';
    if (e.kind === 'tallow') return '🧈 Tallow';
    if (e.kind === 'lid') return 'Lid';
    if (e.kind === 'damper') return e.pct + '%';
    if (e.kind === 'pull') return 'Pull';
    if (e.kind === 'slice') return 'Slice';
    return e.kind;
  }

  function renderEventLanes() {
    var root = $('event-lanes');
    if (!root) return;
    var horizon = view.horizonMin;
    var cursorPct = clamp((view.cursorMin / horizon) * 100, 0, 100);
    var html = LANES.map(function (lane) {
      var chips = view.events.map(function (e, idx) {
        if (eventLane(e.kind) !== lane) return '';
        var left = clamp((e.t / horizon) * 100, 0, 100);
        var label = eventLabel(e);
        return '<button type="button" class="event-chip event-' + eventLane(e.kind).toLowerCase()
          + '" style="left:' + left + '%" data-idx="' + idx + '" '
          + 'title="' + label + ' @ ' + formatClock(e.t) + '">'
          + label + '</button>';
      }).join('');
      return '<div class="event-row" data-lane="' + lane + '">'
        + '<span class="lane-label">' + lane + '</span>'
        + '<div class="lane-track" data-track="1"><span class="lane-cursor" style="left:' + cursorPct + '%"></span>'
        + chips + '</div></div>';
    }).join('');
    root.innerHTML = html;
    Array.prototype.forEach.call(root.querySelectorAll('[data-track]'), bindLaneTrack);
    Array.prototype.forEach.call(root.querySelectorAll('.event-chip[data-idx]'), bindChip);
  }

  function bindLaneTrack(track) {
    track.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.event-chip')) return;
      var rect = track.getBoundingClientRect();
      var pct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      setCursor(pct * view.horizonMin);
    });
  }

  function bindChip(chip) {
    var dragging = false, moved = false, startX = 0, startT = 0;
    var idx = parseInt(chip.dataset.idx, 10);
    var trackRect = null;
    chip.addEventListener('pointerdown', function (e) {
      e.preventDefault(); e.stopPropagation();
      dragging = true; moved = false;
      startX = e.clientX;
      startT = view.events[idx].t;
      trackRect = chip.parentElement.getBoundingClientRect();
      pushHistory();
      try { chip.setPointerCapture(e.pointerId); } catch (_) {}
    });
    chip.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      if (!moved) return;
      var ratio = view.horizonMin / trackRect.width;
      var newT = clamp(startT + dx * ratio, 0, view.horizonMin);
      view.events[idx].t = newT;
      rerenderThrottled();
    });
    chip.addEventListener('pointerup', function (e) {
      if (!dragging) return;
      dragging = false;
      try { chip.releasePointerCapture(e.pointerId); } catch (_) {}
      if (moved) { rerender(false); }
      else { view.history.pop(); removeEventByIndex(idx); }
    });
    chip.addEventListener('pointercancel', function () { dragging = false; });
  }

  function renderEventDock() {
    var dock = $('event-dock');
    dock.innerHTML = EVENT_DEFS.map(function (ev) {
      return '<button class="event-btn tone-' + ev.tone + '" type="button" data-event="' + ev.id + '">' + ev.label + '</button>';
    }).join('');
    dock.querySelectorAll('[data-event]').forEach(function (btn) {
      btn.addEventListener('click', function () { applyEvent(btn.dataset.event); });
    });
    // Primary dock buttons (.dock-btn outside event-dock) also need wiring
    document.querySelectorAll('.dock-btn[data-event]').forEach(function (btn) {
      btn.addEventListener('click', function () { applyEvent(btn.dataset.event); });
    });
  }

  function populatePresetSelect() {
    var select = $('in-preset');
    select.value = view.presetId;
    select.addEventListener('change', function () { view.presetId = select.value; resetToPresetDefaults(); });
  }
  function populateHorizonSelect() {
    var select = $('in-horizon');
    if (!select) return;
    select.value = String(view.horizonMin);
    select.addEventListener('change', function () {
      view.horizonMin = parseInt(select.value, 10) || 720;
      rerender(true);
    });
  }

  function applyLadder(startMin, endMin, periodMin, count) {
    if (periodMin < 5)  { toast('Period too short'); return; }
    if (count < 1)      { toast('Count must be ≥ 1'); return; }
    if (endMin <= startMin) { toast('End must be > start'); return; }
    var horizon = view.horizonMin;
    endMin = Math.min(endMin, horizon - 5);
    pushHistory();
    var added = 0;
    for (var t = startMin; t <= endMin; t += periodMin) { addCoalEvent(t, 'refuel', count); added++; }
    toast('Ladder: +' + count + ' coal × ' + added + ' (every ' + periodMin + ' min)');
    rerender(false);
  }

  function bindLadderControls() {
    var start = $('in-ladder-start'), end = $('in-ladder-end');
    var period = $('in-ladder-period'), count = $('in-ladder-count');
    var btn = $('btn-ladder');
    if (!period || !count || !btn) return;
    btn.addEventListener('click', function () {
      var s = start ? parseInt(start.value, 10) : 0;
      var e = end   ? parseInt(end.value, 10)   : view.horizonMin;
      var p = parseInt(period.value, 10);
      var c = parseInt(count.value, 10);
      applyLadder(s, e, p, c);
    });
    [start, end, period, count].forEach(function (el) {
      if (el) el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); btn.click(); } });
    });
  }

  function bindOverrideInputs() {
    function bindNumber(id, key, lo, hi) {
      var el = $(id);
      if (!el) return;
      el.value = view.overrides[key];
      el.addEventListener('change', function () {
        var v = parseFloat(el.value);
        if (isFinite(v)) { view.overrides[key] = clamp(v, lo, hi); el.value = view.overrides[key]; rerender(true); }
      });
    }
    bindNumber('in-ambient',   'tAmbF',     20, 110);
    bindNumber('in-weight',    'weightLb',   2,  20);
    bindNumber('in-pit-init',  'tPitInitF', 20, 300);
    bindNumber('in-meat-init', 'tMeatInitF',20, 120);
    var st = $('in-start-time');
    if (st) {
      st.value = formatStartTime(view.overrides.tStartMin);
      st.addEventListener('change', function () {
        var parts = st.value.split(':');
        if (parts.length === 2) {
          view.overrides.tStartMin = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
          rerender(true);
        }
      });
    }
  }

  function formatStartTime(m) { var h = Math.floor(m / 60) % 24; var mm = m % 60; return (h<10?'0'+h:h) + ':' + (mm<10?'0'+mm:mm); }
  function formatClockOfDay(m) { var d = ((m % 1440) + 1440) % 1440; var h = Math.floor(d / 60); var mm = Math.round(d % 60); return h + ':' + (mm < 10 ? '0' + mm : mm); }

  function resetToPresetDefaults() {
    view.preset = Presets.get(view.presetId);
    view.overrides.weightLb   = view.preset.inputs.weightLb;
    view.overrides.tAmbF      = view.preset.inputs.tAmbF;
    view.overrides.tPitInitF  = view.preset.inputs.tAmbF;
    view.overrides.tMeatInitF = view.preset.inputs.tInitF != null ? view.preset.inputs.tInitF : 40;
    var amb = $('in-ambient');   if (amb) amb.value   = view.overrides.tAmbF;
    var wt  = $('in-weight');    if (wt)  wt.value    = view.overrides.weightLb;
    var pi  = $('in-pit-init');  if (pi)  pi.value    = view.overrides.tPitInitF;
    var mi  = $('in-meat-init'); if (mi)  mi.value    = view.overrides.tMeatInitF;
    var st  = $('in-start-time');if (st)  st.value    = formatStartTime(view.overrides.tStartMin);
    view.events = defaultEventsForPreset(view.preset);
    view.cursorMin = 0;
    rerender(true);
  }

  function applyTheme(mode) {
    if (mode === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      $('theme-icon').textContent = '☀';
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      $('theme-icon').textContent = '☾';
    }
    try { localStorage.setItem('smoker.theme.v2', mode); } catch (e) {}
  }
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('smoker.theme.v2'); } catch (e) {}
    if (saved) applyTheme(saved);
    else applyTheme('dark');
    $('btn-theme').addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      applyTheme(current === 'dark' ? 'light' : 'dark');
      syncCharts(true);
    });
  }

  function bindControls() {
    $('btn-reset').addEventListener('click', resetToPresetDefaults);
    document.addEventListener('keydown', function (e) {
      if (e.target && /input|select|textarea|button/i.test(e.target.tagName)) return;
      if (e.key === 'r' || e.key === 'R') resetToPresetDefaults();
      if (e.key === 'z' || e.key === 'Z') applyEvent('undo');
      if (e.key === 'ArrowLeft')  setCursor(view.cursorMin - 15);
      if (e.key === 'ArrowRight') setCursor(view.cursorMin + 15);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    bindLangToggle();
    populatePresetSelect();
    populateHorizonSelect();
    bindOverrideInputs();
    bindLadderControls();
    renderEventDock();
    bindControls();
    view.timelineChart = makeTimelineChart();
    view.scoreChart = makeScoreChart();
    resetToPresetDefaults();
    window.addEventListener('resize', syncLaneAlignment);
  });
})();
