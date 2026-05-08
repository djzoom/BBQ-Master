/**
 * Smoker Dynamics — timeline-first UI controller.
 * The physics modules remain untouched; this file only maps events to a
 * single temperature timeline and a live final-score radar.
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
    { id: 'ignite', label: 'Light 12', lane: 'Fire', tone: 'fire' },
    { id: 'refuel', label: '+4 Coal', lane: 'Fire', tone: 'fire' },
    { id: 'wood', label: 'Wood', lane: 'Smoke', tone: 'smoke' },
    { id: 'paper', label: 'Paper', lane: 'Wrap', tone: 'wrap' },
    { id: 'foil', label: 'Foil', lane: 'Wrap', tone: 'wrap' },
    { id: 'bare', label: 'Bare', lane: 'Wrap', tone: 'wrap' },
    { id: 'spritz', label: 'Spritz', lane: 'Handling', tone: 'water' },
    { id: 'lid', label: 'Lid 30s', lane: 'Handling', tone: 'handling' },
    { id: 'damper-up', label: 'Damper +10', lane: 'Fire', tone: 'fire' },
    { id: 'damper-down', label: 'Damper -10', lane: 'Fire', tone: 'fire' },
    { id: 'pull', label: 'Pull', lane: 'Handling', tone: 'finish' },
    { id: 'slice', label: 'Slice', lane: 'Handling', tone: 'finish' }
  ];

  var view = {
    presetId: 'texas',
    preset: null,
    sim: null,
    running: false,
    loopTimer: null,
    lastWallMs: 0,
    speed: 7200,
    samples: [],
    timelineChart: null,
    scoreChart: null
  };

  function $(id) {
    return document.getElementById(id);
  }

  function css(name, fallback) {
    var value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function formatClock(min) {
    var total = Math.max(0, Math.round(min));
    var h = Math.floor(total / 60);
    var m = total % 60;
    return h + ':' + String(m).padStart(2, '0');
  }

  function formatF(c) {
    return Math.round(C.cToF(c)) + 'F';
  }

  function horizonMin() {
    if (!view.sim) return 360;
    return Math.max(360, Math.ceil((view.sim.tSimMin + 60) / 60) * 60);
  }

  function resetCook() {
    stop();
    view.preset = Presets.get(view.presetId);
    view.sim = Sim.create(view.preset.inputs);
    view.sim.damperPct = view.preset.policy.damperPct;
    view.samples = [];
    Sim.ignite(view.sim, view.preset.policy.igniteN || 10);
    pushSample(true);
    syncCharts(true);
    updateUI();
  }

  function pushSample(force) {
    if (!view.sim) return;
    var last = view.samples[view.samples.length - 1];
    if (!force && last && view.sim.tSimMin - last.x < 2) return;
    var n = view.sim.T.length - 1;
    view.samples.push({
      x: view.sim.tSimMin,
      pit: C.cToF(view.sim.tPitC),
      meat: C.cToF(view.sim.T[n])
    });
    if (view.samples.length > 1600) view.samples.shift();
  }

  function advanceSeconds(totalSec) {
    var remaining = Math.max(0, totalSec);
    while (remaining > 0 && view.sim.tSimMin < 24 * 60) {
      var stepSec = Math.min(remaining, 60);
      Sim.step(view.sim, stepSec);
      remaining -= stepSec;
      pushSample(false);
    }
  }

  function start() {
    if (view.running) {
      stop();
      return;
    }
    view.running = true;
    view.lastWallMs = performance.now();
    $('btn-play').textContent = 'Pause';
    view.loopTimer = window.setInterval(tick, 250);
  }

  function stop() {
    view.running = false;
    if (view.loopTimer) window.clearInterval(view.loopTimer);
    view.loopTimer = null;
    if ($('btn-play')) $('btn-play').textContent = 'Run';
  }

  function tick() {
    if (!view.running) return;
    var now = performance.now();
    if (!view.lastWallMs) view.lastWallMs = now;
    var dWall = (now - view.lastWallMs) / 1000;
    view.lastWallMs = now;
    advanceSeconds(Math.min(dWall * view.speed, 1200));
    syncCharts(false);
    updateUI();
    if (view.sim.phase === 'slice' || view.sim.tSimMin >= 24 * 60) {
      stop();
      return;
    }
  }

  function applyEvent(id) {
    var s = view.sim;
    if (!s) return;
    switch (id) {
      case 'ignite':
        Sim.ignite(s, 12);
        break;
      case 'refuel':
        Sim.refuel(s, 4);
        break;
      case 'wood':
        Sim.addWood(s, 0.15, 'post_oak');
        break;
      case 'paper':
        Sim.wrap(s, 'butcher_paper');
        break;
      case 'foil':
        Sim.wrap(s, 'aluminum_foil');
        break;
      case 'bare':
        Sim.wrap(s, 'none');
        break;
      case 'spritz':
        Sim.spritz(s, 30);
        break;
      case 'lid':
        Sim.openLid(s, 30);
        break;
      case 'damper-up':
        Sim.damper(s, s.damperPct + 10);
        break;
      case 'damper-down':
        Sim.damper(s, s.damperPct - 10);
        break;
      case 'pull':
        Sim.pull(s);
        break;
      case 'slice':
        if (s.phase !== 'rest') Sim.pull(s);
        Sim.slice(s, view.preset.policy.restMethod);
        break;
    }
    pushSample(true);
    syncCharts(false);
    updateUI();
  }

  function scoreCook() {
    // Each dimension cites the PHYSICS.md section that drives it.
    var s = view.sim;
    var n = s.T.length - 1;
    var coreF = C.cToF(s.T[n]);
    var water = s.wRetained != null ? s.wRetained : s.w;
    var smokeGood = s.smoke ? s.smoke.good : 0;
    var smokeBad = s.smoke ? s.smoke.bad : 0;
    var wrapped = s.wrapState && s.wrapState !== 'none';

    // §4 collagen — direct: full credit at C ≥ 0.85 (probe-tender), capped 100
    var tender = clamp(((s.C || 0) / 0.85) * 100, 0, 100);

    // §3 water budget + rest rebound — direct on retained water
    var juicy = clamp(water * 100, 0, 100);

    // §8.7 doneness — distance from 203°F probe-tender target
    var doneness = clamp(100 - Math.abs(coreF - 203) * 2.5, 0, 100);

    // §5 smoke uptake (good vs creosote) — net flavour
    var smoke = clamp(15 + smokeGood * 60 - smokeBad * 35, 0, 100);

    // §3 + bark formation — surface drying time + smoke condensation
    var barkTime = Math.min(s.tSimMin / 240, 1);
    var bark = clamp(18 + barkTime * 42 + smokeGood * 18 - (wrapped ? 10 : 0), 0, 100);

    var scores = [doneness, tender, juicy, bark, smoke];
    var overall = scores.reduce(function (sum, v) { return sum + v; }, 0) / scores.length;
    return {
      labels: ['Done', 'Tender', 'Juicy', 'Bark', 'Smoke'],
      scores: scores.map(function (v) { return Math.round(v); }),
      overall: Math.round(overall)
    };
  }

  function recentSlopeFperMin() {
    // °F/min over last ~5 sim minutes from the sample buffer.
    var s = view.samples;
    if (s.length < 2) return 0;
    var last = s[s.length - 1];
    var cutoff = last.x - 5;
    var first = last;
    for (var i = s.length - 2; i >= 0; i--) {
      if (s[i].x <= cutoff) { first = s[i]; break; }
      first = s[i];
    }
    var dt = last.x - first.x;
    if (dt <= 0.1) return 0;
    return (last.meat - first.meat) / dt;
  }

  function physicsReadouts() {
    var s = view.sim;
    if (!s) return { collagen: 0, water: 100, stall: 0, qFireW: 0 };
    var qFireW = FM ? FM.qFire(s.coals, s.tSimMin, s.damperPct) : 0;
    var n = s.T.length - 1;
    var coreF = C.cToF(s.T[n]);
    var thicknessIn = s.halfThickM ? (2 * s.halfThickM / 0.0254) : 3;
    var pStall = Stall ? Stall.stallProbability(coreF, s.humidityPct || 50,
        s.windMph || 2, thicknessIn, recentSlopeFperMin()) : 0;
    var w = s.wRetained != null ? s.wRetained : s.w;
    return {
      collagen: Math.round((s.C || 0) * 100),
      water: Math.round(w * 100),
      stall: Math.round(pStall * 100),
      qFireW: Math.round(qFireW)
    };
  }

  function phaseLabel() {
    if (!view.sim) return 'Ready';
    if (view.sim.phase === 'rest') return 'Rest';
    if (view.sim.phase === 'slice') return 'Slice';
    if (view.sim.wrapState && view.sim.wrapState !== 'none') return 'Wrapped';
    var n = view.sim.T.length - 1;
    var coreF = C.cToF(view.sim.T[n]);
    if (coreF >= 145 && coreF <= 175) return 'Stall';
    return 'Smoke';
  }

  function wrapLabel() {
    var wrap = view.sim.wrapState;
    if (wrap === 'butcher_paper') return 'Paper';
    if (wrap === 'aluminum_foil') return 'Foil';
    if (wrap === 'foil_boat') return 'Boat';
    return 'Bare';
  }

  function updateUI() {
    if (!view.sim) return;
    var n = view.sim.T.length - 1;
    $('metric-clock').textContent = formatClock(view.sim.tSimMin);
    $('metric-phase').textContent = phaseLabel();
    $('metric-pit').textContent = formatF(view.sim.tPitC);
    $('metric-meat').textContent = formatF(view.sim.T[n]);
    $('metric-damper').textContent = view.sim.damperPct + '%';
    $('metric-wrap').textContent = wrapLabel();
    $('score-overall').textContent = scoreCook().overall;
    var p = physicsReadouts();
    if ($('metric-collagen')) $('metric-collagen').textContent = p.collagen + '%';
    if ($('metric-water'))    $('metric-water').textContent    = p.water + '%';
    if ($('metric-stall'))    $('metric-stall').textContent    = p.stall + '%';
    if ($('metric-fire'))     $('metric-fire').textContent     = p.qFireW + ' W';
    renderEventLanes();
  }

  function makeTimelineChart() {
    if (!window.Chart) return null;
    var canvas = $('chart-timeline');
    return new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Pit',
            data: [],
            borderColor: css('--pit-line', '#E5483D'),
            backgroundColor: 'rgba(229, 72, 61, 0.10)',
            borderWidth: 3,
            pointRadius: 0,
            tension: 0.25
          },
          {
            label: 'Meat',
            data: [],
            borderColor: css('--meat-line', '#0F8C8C'),
            backgroundColor: 'rgba(15, 140, 140, 0.10)',
            borderWidth: 3,
            pointRadius: 0,
            tension: 0.25,
            fill: true
          }
        ]
      },
      options: {
        animation: false,
        parsing: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: {
            align: 'start',
            labels: { boxWidth: 10, color: css('--text-secondary', '#475569'), font: { size: 12 } }
          },
          tooltip: {
            callbacks: {
              title: function (items) { return formatClock(items[0].parsed.x); },
              label: function (ctx) { return ctx.dataset.label + ' ' + Math.round(ctx.parsed.y) + 'F'; }
            }
          },
          annotation: {
            // Filled in dynamically by syncCharts(): vertical flag at each event time
            annotations: {}
          }
        },
        scales: {
          x: {
            type: 'linear',
            min: 0,
            max: 360,
            grid: { color: css('--chart-grid', 'rgba(15, 23, 42, 0.09)') },
            ticks: {
              color: css('--text-muted', '#94A3B8'),
              callback: function (v) { return formatClock(v); },
              maxTicksLimit: 9
            }
          },
          y: {
            min: 30,
            max: 330,
            grid: { color: css('--chart-grid', 'rgba(15, 23, 42, 0.09)') },
            ticks: {
              color: css('--text-muted', '#94A3B8'),
              callback: function (v) { return v + 'F'; }
            }
          }
        }
      }
    });
  }

  function makeScoreChart() {
    if (!window.Chart) return null;
    var canvas = $('chart-score');
    return new Chart(canvas.getContext('2d'), {
      type: 'radar',
      data: {
        labels: ['Done', 'Tender', 'Juicy', 'Bark', 'Smoke'],
        datasets: [{
          data: [0, 0, 0, 0, 0],
          borderColor: css('--score-line', '#315CFF'),
          backgroundColor: 'rgba(49, 92, 255, 0.16)',
          borderWidth: 2,
          pointRadius: 2
        }]
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          r: {
            min: 0,
            max: 100,
            ticks: { display: false, stepSize: 25 },
            angleLines: { color: css('--chart-grid', 'rgba(15, 23, 42, 0.10)') },
            grid: { color: css('--chart-grid', 'rgba(15, 23, 42, 0.10)') },
            pointLabels: { color: css('--text-secondary', '#475569'), font: { size: 11 } }
          }
        }
      }
    });
  }

  function eventAnnotationStyle(kind) {
    // Color flag by physical category. Cited tones map to PHYSICS.md sections.
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
    if (!events) return ann;
    events.forEach(function (e, i) {
      var sty = eventAnnotationStyle(e.kind);
      var labelText;
      if (e.kind === 'refuel')      labelText = '+' + e.n;
      else if (e.kind === 'ignite') labelText = sty.symbol + e.n;
      else                          labelText = sty.symbol;
      ann['ev-' + i] = {
        type: 'line',
        scaleID: 'x',
        value: e.t,
        borderColor: sty.color,
        borderWidth: 1.25,
        borderDash: [3, 4],
        drawTime: 'beforeDatasetsDraw',
        label: {
          display: true,
          content: labelText,
          position: 'start',
          backgroundColor: sty.color,
          color: '#fff',
          font: { size: 9, weight: '700' },
          padding: { top: 1, bottom: 1, left: 4, right: 4 },
          borderRadius: 2,
          yAdjust: -4
        }
      };
    });
    return ann;
  }

  function syncCharts(reset) {
    var horizon = horizonMin();
    if (view.timelineChart) {
      view.timelineChart.data.datasets[0].data = view.samples.map(function (p) { return { x: p.x, y: p.pit }; });
      view.timelineChart.data.datasets[1].data = view.samples.map(function (p) { return { x: p.x, y: p.meat }; });
      view.timelineChart.options.scales.x.max = horizon;
      // Vertical event flags driven by simulator.eventLog
      var annPlugin = view.timelineChart.options.plugins.annotation;
      if (annPlugin) {
        annPlugin.annotations = buildEventAnnotations(view.sim && view.sim.eventLog);
      }
      view.timelineChart.update(reset ? undefined : 'none');
    }
    if (view.scoreChart && view.sim) {
      var score = scoreCook();
      view.scoreChart.data.labels = score.labels;
      view.scoreChart.data.datasets[0].data = score.scores;
      view.scoreChart.update(reset ? undefined : 'none');
    }
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
    if (e.kind === 'wood') return 'Wood';
    if (e.kind === 'wrap') return wrapLabelFor(e.type);
    if (e.kind === 'spritz') return 'Spritz';
    if (e.kind === 'lid') return 'Lid';
    if (e.kind === 'damper') return e.pct + '%';
    if (e.kind === 'pull') return 'Pull';
    if (e.kind === 'slice') return 'Slice';
    return e.kind;
  }

  function wrapLabelFor(type) {
    if (type === 'butcher_paper') return 'Paper';
    if (type === 'aluminum_foil') return 'Foil';
    if (type === 'foil_boat') return 'Boat';
    return 'Bare';
  }

  function renderEventLanes() {
    var root = $('event-lanes');
    if (!root || !view.sim) return;
    var horizon = horizonMin();
    var playheadPct = clamp((view.sim.tSimMin / horizon) * 100, 0, 100);
    var events = view.sim.eventLog || [];
    root.innerHTML = LANES.map(function (lane) {
      var chips = events.filter(function (e) {
        return eventLane(e.kind) === lane;
      }).map(function (e, i) {
        var left = clamp((e.t / horizon) * 100, 0, 100);
        var label = eventLabel(e);
        return '<span class="event-chip event-' + eventLane(e.kind).toLowerCase() + '" style="left:' + left + '%" title="' + label + ' @ ' + formatClock(e.t) + '">' + label + '</span>';
      }).join('');
      return '<div class="event-row"><span class="lane-label">' + lane + '</span><div class="lane-track"><span class="lane-playhead" style="left:' + playheadPct + '%"></span>' + chips + '</div></div>';
    }).join('');
  }

  function renderEventDock() {
    var dock = $('event-dock');
    dock.innerHTML = EVENT_DEFS.map(function (ev) {
      return '<button class="event-btn tone-' + ev.tone + '" type="button" data-event="' + ev.id + '">' + ev.label + '</button>';
    }).join('');
    dock.querySelectorAll('[data-event]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyEvent(btn.dataset.event);
      });
    });
  }

  function populatePresetSelect() {
    var select = $('in-preset');
    select.value = view.presetId;
    select.addEventListener('change', function () {
      view.presetId = select.value;
      resetCook();
    });
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
    else applyTheme(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    $('btn-theme').addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      applyTheme(current === 'dark' ? 'light' : 'dark');
      syncCharts(true);
    });
  }

  function bindControls() {
    $('btn-play').addEventListener('click', start);
    $('btn-step').addEventListener('click', function () {
      advanceSeconds(15 * 60);
      syncCharts(false);
      updateUI();
    });
    $('btn-reset').addEventListener('click', resetCook);
    $('in-speed').addEventListener('change', function () {
      view.speed = parseFloat($('in-speed').value) || 7200;
    });
    document.addEventListener('keydown', function (e) {
      if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
      if (e.key === ' ') {
        e.preventDefault();
        start();
      }
      if (e.key === 'r' || e.key === 'R') resetCook();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    populatePresetSelect();
    renderEventDock();
    bindControls();
    view.speed = parseFloat($('in-speed').value) || 7200;
    view.timelineChart = makeTimelineChart();
    view.scoreChart = makeScoreChart();
    resetCook();
  });
})();
