/**
 * Smoker Dynamics — plan-mode timeline workbench.
 *
 * Source of truth: view.events — a sorted list of planned events.
 * Anything that mutates events (dock click / drag / chip removal /
 * preset reset / horizon change) calls replayCook(), which:
 *   1. Creates a fresh sim state from preset.inputs
 *   2. Replays events in time order, stepping the physics each minute
 *   3. Returns samples + final state, which the UI renders
 *
 * There is no Run/Pause anymore — the chart shows the FULL predicted
 * cook from t=0 to horizon as soon as inputs change. Drag a chip to
 * reschedule; click a chip to remove; click an empty lane to set the
 * cursor where new dock-button events are dropped.
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
    { id: 'ignite',      label: 'Light 12',  lane: 'Fire',     tone: 'fire' },
    { id: 'refuel-1',    label: '+1 Coal',   lane: 'Fire',     tone: 'fire' },
    { id: 'refuel-4',    label: '+4 Coal',   lane: 'Fire',     tone: 'fire' },
    { id: 'coal-minus',  label: '−1 Coal',   lane: 'Fire',     tone: 'fire-minus' },
    { id: 'wood',        label: 'Wood',      lane: 'Smoke',    tone: 'smoke' },
    { id: 'paper',       label: 'Paper',     lane: 'Wrap',     tone: 'wrap' },
    { id: 'foil',        label: 'Foil',      lane: 'Wrap',     tone: 'wrap' },
    { id: 'bare',        label: 'Bare',      lane: 'Wrap',     tone: 'wrap' },
    { id: 'spritz',      label: 'Spritz',    lane: 'Handling', tone: 'water' },
    { id: 'lid',         label: 'Lid 30s',   lane: 'Handling', tone: 'handling' },
    { id: 'damper-up',   label: 'Damper +10',lane: 'Fire',     tone: 'fire' },
    { id: 'damper-down', label: 'Damper -10',lane: 'Fire',     tone: 'fire' },
    { id: 'pull',        label: 'Pull',      lane: 'Handling', tone: 'finish' },
    { id: 'slice',       label: 'Slice',     lane: 'Handling', tone: 'finish' },
    { id: 'undo',        label: '↶ Undo',    lane: 'Handling', tone: 'undo' }
  ];

  var view = {
    presetId: 'texas',
    preset: null,
    sim: null,                  // final replay state (read-only for UI)
    events: [],                 // planning list — sole source of truth
    cursorMin: 0,               // where dock buttons place new events
    horizonMin: 720,            // total cook timeline (selectable: 6/12/18/24h)
    samples: [],
    timelineChart: null,
    scoreChart: null,
    replayPending: false        // RAF coalescing flag for drag
  };

  // ───────────── Helpers ─────────────
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

  // ───────────── Default events from preset ─────────────
  function defaultEventsForPreset(p) {
    var ev = [];
    // Light at t=0
    ev.push({ t: 0, kind: 'ignite', n: p.policy.igniteN || 12 });
    // Wood chunks from policy
    if (p.policy.woodChunks) {
      p.policy.woodChunks.forEach(function (w) {
        ev.push({ t: w.tMin, kind: 'wood', mass: 0.15, species: w.species });
      });
    }
    // Two refuel events at sensible defaults
    ev.push({ t: 60,  kind: 'refuel', n: 4 });
    ev.push({ t: 150, kind: 'refuel', n: 4 });
    // Wrap (paper by default for low-and-slow) around 4h
    if (p.policy.wrapType && p.policy.wrapType !== 'none') {
      ev.push({ t: 240, kind: 'wrap', type: p.policy.wrapType });
    }
    return ev;
  }

  // ───────────── Replay engine ─────────────
  // Builds a fresh sim from preset inputs and replays view.events.
  // Returns the final state. Updates view.sim and view.samples.
  function replayCook() {
    if (!view.preset) return null;
    var inputs = view.preset.inputs;
    var fresh = Sim.create(inputs);
    fresh.damperPct = view.preset.policy.damperPct;
    view.sim = fresh;
    view.samples = [];

    // Sort events by time so replay is deterministic
    view.events.sort(function (a, b) { return a.t - b.t; });

    // Snapshot before any event fires
    pushSample(true);

    var evIdx = 0;
    var sorted = view.events;
    var horizon = view.horizonMin;

    while (fresh.tSimMin < horizon && fresh.phase !== 'slice') {
      // Apply any events whose time falls in this minute
      while (evIdx < sorted.length && sorted[evIdx].t <= fresh.tSimMin + 0.5) {
        applyEventToSim(fresh, sorted[evIdx]);
        evIdx++;
      }
      Sim.step(fresh, 60);
      pushSample(false);
    }
    // After replay, the sim's eventLog contains duplicated entries from
    // Sim.* calls. Replace with our planning list so chip rendering stays in sync.
    fresh.eventLog = view.events.slice();
    return fresh;
  }

  // Push (pit, meat) sample for the current sim time. Called by replay loop.
  function pushSample(force) {
    if (!view.sim) return;
    var last = view.samples[view.samples.length - 1];
    if (!force && last && view.sim.tSimMin - last.x < 1) return;
    var n = view.sim.T.length - 1;
    view.samples.push({
      x: view.sim.tSimMin,
      pit: C.cToF(view.sim.tPitC),
      meat: C.cToF(view.sim.T[n])
    });
  }

  // Replay an event into a sim state. Used internally by replayCook().
  function applyEventToSim(state, e) {
    switch (e.kind) {
      case 'ignite':  Sim.ignite(state, e.n || 12); break;
      case 'refuel':  Sim.refuel(state, e.n || 4); break;
      case 'wood':    Sim.addWood(state, e.mass || 0.15, e.species || 'post_oak'); break;
      case 'wrap':    Sim.wrap(state, e.type || 'butcher_paper'); break;
      case 'spritz':  Sim.spritz(state, e.volume || 30); break;
      case 'lid':     Sim.openLid(state, e.seconds || 30); break;
      case 'damper':  Sim.damper(state, e.pct); break;
      case 'pull':    Sim.pull(state); break;
      case 'slice':   Sim.slice(state, view.preset.policy.restMethod); break;
    }
  }

  // ───────────── Public mutations (all funnel through replay) ─────────────
  function rerender(reset) {
    replayCook();
    syncCharts(reset === true);
    updateUI();
  }

  // RAF-coalesced replay for live drag
  function rerenderThrottled() {
    if (view.replayPending) return;
    view.replayPending = true;
    requestAnimationFrame(function () {
      view.replayPending = false;
      replayCook();
      syncCharts(false);
      updateUI();
    });
  }

  function setCursor(t) {
    view.cursorMin = clamp(t, 0, view.horizonMin);
    syncCharts(false);
    updateUI();
  }

  function applyEvent(id) {
    var t = view.cursorMin;
    switch (id) {
      case 'ignite':       view.events.push({ t: t, kind: 'ignite', n: 12 }); break;
      case 'refuel-1':     view.events.push({ t: t, kind: 'refuel', n: 1 }); break;
      case 'refuel-4':     view.events.push({ t: t, kind: 'refuel', n: 4 }); break;
      case 'coal-minus':
        if (!peelOneCoalAt(t)) { toast('No coals to remove at cursor'); return; }
        break;
      case 'wood':         view.events.push({ t: t, kind: 'wood', mass: 0.15, species: 'post_oak' }); break;
      case 'paper':        view.events.push({ t: t, kind: 'wrap', type: 'butcher_paper' }); break;
      case 'foil':         view.events.push({ t: t, kind: 'wrap', type: 'aluminum_foil' }); break;
      case 'bare':         view.events.push({ t: t, kind: 'wrap', type: 'none' }); break;
      case 'spritz':       view.events.push({ t: t, kind: 'spritz', volume: 30 }); break;
      case 'lid':          view.events.push({ t: t, kind: 'lid', seconds: 30 }); break;
      case 'damper-up':    view.events.push({ t: t, kind: 'damper', pct: lastDamperBefore(t) + 10 }); break;
      case 'damper-down':  view.events.push({ t: t, kind: 'damper', pct: lastDamperBefore(t) - 10 }); break;
      case 'pull':         view.events.push({ t: t, kind: 'pull' }); break;
      case 'slice':        view.events.push({ t: t, kind: 'slice' }); break;
      case 'undo':
        if (!view.events.length) { toast('Nothing to undo'); return; }
        var last = view.events.pop();
        toast('Undid ' + describeEvent(last) + ' @ ' + formatClock(last.t));
        break;
    }
    rerender(false);
  }

  // Remove one coal from the most recent ignite/refuel that's still in the
  // future-or-present relative to the cursor (so peeling matches what the
  // user is looking at right now).
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

  // ───────────── Toast ─────────────
  function toast(msg) {
    var el = $('app-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'app-toast';
      el.className = 'app-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._hideT);
    el._hideT = setTimeout(function () { el.classList.remove('show'); }, 1600);
  }

  // ───────────── Scoring (radar) ─────────────
  // Each dimension cites the PHYSICS.md section it reflects.
  function scoreCook() {
    var s = view.sim;
    if (!s) return { labels: ['Done', 'Tender', 'Juicy', 'Bark', 'Smoke'], scores: [0,0,0,0,0], overall: 0 };
    var n = s.T.length - 1;
    var coreF = C.cToF(s.T[n]);
    var water = s.wRetained != null ? s.wRetained : s.w;
    var smokeGood = s.smoke ? s.smoke.good : 0;
    var smokeBad = s.smoke ? s.smoke.bad : 0;
    var wrapped = s.wrapState && s.wrapState !== 'none';

    var tender   = clamp(((s.C || 0) / 0.85) * 100, 0, 100);          // §4
    var juicy    = clamp(water * 100, 0, 100);                         // §3
    var doneness = clamp(100 - Math.abs(coreF - 203) * 2.5, 0, 100);   // §8.7
    var smoke    = clamp(15 + smokeGood * 60 - smokeBad * 35, 0, 100); // §5
    var barkTime = Math.min(s.tSimMin / 240, 1);
    var bark     = clamp(18 + barkTime * 42 + smokeGood * 18 - (wrapped ? 10 : 0), 0, 100);

    var scores = [doneness, tender, juicy, bark, smoke];
    var overall = scores.reduce(function (sum, v) { return sum + v; }, 0) / scores.length;
    return {
      labels: ['Done', 'Tender', 'Juicy', 'Bark', 'Smoke'],
      scores: scores.map(function (v) { return Math.round(v); }),
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
    $('metric-clock').textContent = formatClock(view.cursorMin) + ' ⏱';
    $('metric-phase').textContent = 'Cursor / 光标';
    // Find pit/meat at cursor by looking up the closest sample
    var atCursor = sampleAtTime(view.cursorMin);
    $('metric-pit').textContent = Math.round(atCursor.pit) + 'F';
    $('metric-meat').textContent = Math.round(atCursor.meat) + 'F';
    $('metric-damper').textContent = view.sim.damperPct + '%';
    $('metric-wrap').textContent = wrapLabel(view.sim);
    $('score-overall').textContent = scoreCook().overall;
    var p = physicsReadouts();
    if ($('metric-collagen')) $('metric-collagen').textContent = p.collagen + '%';
    if ($('metric-water'))    $('metric-water').textContent    = p.water + '%';
    if ($('metric-stall'))    $('metric-stall').textContent    = p.stall + '%';
    if ($('metric-fire'))     $('metric-fire').textContent     = p.qFireW + ' W';
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

  // ───────────── Charts ─────────────
  function makeTimelineChart() {
    if (!window.Chart) return null;
    var canvas = $('chart-timeline');
    return new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          { label: 'Pit',  data: [], borderColor: css('--pit-line', '#E5483D'),
            backgroundColor: 'rgba(229,72,61,0.10)', borderWidth: 3, pointRadius: 0, tension: 0.25 },
          { label: 'Meat', data: [], borderColor: css('--meat-line', '#0F8C8C'),
            backgroundColor: 'rgba(15,140,140,0.10)', borderWidth: 3, pointRadius: 0, tension: 0.25, fill: true }
        ]
      },
      options: {
        animation: false, parsing: false, responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { align: 'start', labels: { boxWidth: 10, color: css('--text-secondary', '#475569'), font: { size: 12 } } },
          tooltip: { callbacks: {
            title: function (items) { return formatClock(items[0].parsed.x); },
            label: function (ctx) { return ctx.dataset.label + ' ' + Math.round(ctx.parsed.y) + 'F'; }
          } },
          annotation: { annotations: {} }
        },
        scales: {
          x: { type: 'linear', min: 0, max: 720,
               grid: { color: css('--chart-grid', 'rgba(15,23,42,0.09)') },
               ticks: { color: css('--text-muted', '#94A3B8'),
                        callback: function (v) { return formatClock(v); }, maxTicksLimit: 9 } },
          y: { min: 30, max: 330,
               grid: { color: css('--chart-grid', 'rgba(15,23,42,0.09)') },
               ticks: { color: css('--text-muted', '#94A3B8'),
                        callback: function (v) { return v + 'F'; } } }
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
              datasets: [{ data: [0,0,0,0,0],
                           borderColor: css('--score-line', '#315CFF'),
                           backgroundColor: 'rgba(49,92,255,0.16)',
                           borderWidth: 2, pointRadius: 2 }] },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { r: { min: 0, max: 100, ticks: { display: false, stepSize: 25 },
                       angleLines: { color: css('--chart-grid', 'rgba(15,23,42,0.10)') },
                       grid: { color: css('--chart-grid', 'rgba(15,23,42,0.10)') },
                       pointLabels: { color: css('--text-secondary', '#475569'), font: { size: 11 } } } }
      }
    });
  }

  function eventAnnotationStyle(kind) {
    if (kind === 'ignite' || kind === 'refuel') return { color: '#E5483D', symbol: '🔥' };
    if (kind === 'wood')                        return { color: '#C57A2A', symbol: '🪵' };
    if (kind === 'wrap')                        return { color: '#6B7280', symbol: '📦' };
    if (kind === 'spritz')                      return { color: '#2A8AC5', symbol: '💧' };
    if (kind === 'lid')                         return { color: '#94A3B8', symbol: '↕' };
    if (kind === 'damper')                      return { color: '#475569', symbol: '◎' };
    if (kind === 'pull' || kind === 'slice')    return { color: '#16A34A', symbol: '✓' };
    return { color: '#94A3B8', symbol: '·' };
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
    // Cursor — vertical solid line, distinct color
    ann['cursor'] = {
      type: 'line', scaleID: 'x', value: view.cursorMin,
      borderColor: '#0F172A', borderWidth: 2,
      drawTime: 'afterDatasetsDraw',
      label: { display: true, content: '▼ ' + formatClock(view.cursorMin),
               position: 'end', backgroundColor: '#0F172A', color: '#fff',
               font: { size: 10, weight: '700' }, padding: 3, borderRadius: 2 }
    };
    return ann;
  }

  function syncCharts(reset) {
    if (view.timelineChart) {
      view.timelineChart.data.datasets[0].data = view.samples.map(function (p) { return { x: p.x, y: p.pit }; });
      view.timelineChart.data.datasets[1].data = view.samples.map(function (p) { return { x: p.x, y: p.meat }; });
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
  }

  // ───────────── Event lanes (chips) ─────────────
  function eventLane(kind) {
    if (kind === 'ignite' || kind === 'refuel' || kind === 'damper') return 'Fire';
    if (kind === 'wood') return 'Smoke';
    if (kind === 'wrap') return 'Wrap';
    return 'Handling';
  }

  function eventLabel(e) {
    if (e.kind === 'ignite') return 'Light ' + e.n;
    if (e.kind === 'refuel') return '+' + e.n + ' Coal';
    if (e.kind === 'wood') return 'Wood';
    if (e.kind === 'wrap') return wrapLabelFor(e.type);
    if (e.kind === 'spritz') return 'Spritz';
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
          + 'title="' + label + ' @ ' + formatClock(e.t) + '\nDrag to reschedule · Click to remove">'
          + label + '</button>';
      }).join('');
      return '<div class="event-row" data-lane="' + lane + '">'
        + '<span class="lane-label">' + lane + '</span>'
        + '<div class="lane-track" data-track="1"><span class="lane-cursor" style="left:' + cursorPct + '%"></span>'
        + chips + '</div></div>';
    }).join('');
    root.innerHTML = html;

    // Bind cursor placement on empty track click + chip drag/click
    Array.prototype.forEach.call(root.querySelectorAll('[data-track]'), bindLaneTrack);
    Array.prototype.forEach.call(root.querySelectorAll('.event-chip[data-idx]'), bindChip);
  }

  function bindLaneTrack(track) {
    track.addEventListener('pointerdown', function (e) {
      // Ignore clicks on chips — those have their own handlers
      if (e.target.closest('.event-chip')) return;
      var rect = track.getBoundingClientRect();
      var pct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      setCursor(pct * view.horizonMin);
    });
  }

  function bindChip(chip) {
    var dragging = false;
    var moved = false;
    var startX = 0;
    var startT = 0;
    var idx = parseInt(chip.dataset.idx, 10);
    var trackRect = null;

    chip.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dragging = true; moved = false;
      startX = e.clientX;
      startT = view.events[idx].t;
      trackRect = chip.parentElement.getBoundingClientRect();
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
      if (moved) {
        rerender(false);
      } else {
        // pure click → remove
        removeEventByIndex(idx);
      }
    });
    chip.addEventListener('pointercancel', function () { dragging = false; });
  }

  // ───────────── Dock ─────────────
  function renderEventDock() {
    var dock = $('event-dock');
    dock.innerHTML = EVENT_DEFS.map(function (ev) {
      return '<button class="event-btn tone-' + ev.tone + '" type="button" data-event="' + ev.id + '">' + ev.label + '</button>';
    }).join('');
    dock.querySelectorAll('[data-event]').forEach(function (btn) {
      btn.addEventListener('click', function () { applyEvent(btn.dataset.event); });
    });
  }

  function populatePresetSelect() {
    var select = $('in-preset');
    select.value = view.presetId;
    select.addEventListener('change', function () {
      view.presetId = select.value;
      resetToPresetDefaults();
    });
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

  function resetToPresetDefaults() {
    view.preset = Presets.get(view.presetId);
    view.events = defaultEventsForPreset(view.preset);
    view.cursorMin = 0;
    rerender(true);
  }

  // ───────────── Theme ─────────────
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
    else applyTheme(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
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
    populatePresetSelect();
    populateHorizonSelect();
    renderEventDock();
    bindControls();
    view.timelineChart = makeTimelineChart();
    view.scoreChart = makeScoreChart();
    resetToPresetDefaults();
  });
})();
