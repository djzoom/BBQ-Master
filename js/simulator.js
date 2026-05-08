/**
 * Smoker BBQ — Top-level integrator.
 * Composes heatDiffusion, collagen, smoke, fire, pit, rest into a single step.
 * Event-driven control inputs (refuel, wrap, spritz, lid, pull, slice).
 */
window.SmokerSim = window.SmokerSim || {};

window.SmokerSim.simulator = (function () {
  'use strict';

  var C  = window.SmokerSim.constants;
  var HD = window.SmokerSim.heatDiffusion;
  var CM = window.SmokerSim.collagenModel;
  var SM = window.SmokerSim.smokeModel;
  var FM = window.SmokerSim.fireModel;
  var PM = window.SmokerSim.pitModel;
  var RM = window.SmokerSim.restModel;
  var SF = window.SmokerSim.safety;

  function create(inputs) {
    var alpha = C.THERMAL_DIFFUSIVITY[inputs.protein][inputs.grade];
    var halfThickM = C.inchToM(inputs.thicknessIn) / 2;
    var n = C.N_NODES;
    var dx = halfThickM / n;
    var tInitC = C.fToC(inputs.tInitF != null ? inputs.tInitF : 40);
    return {
      alpha: alpha, halfThickM: halfThickM, dx: dx,
      weightLb: inputs.weightLb || 10,
      areaM2: 0.07,
      tAmbC: C.fToC(inputs.tAmbF != null ? inputs.tAmbF : 70),
      humidityPct: inputs.humidityPct || 50,
      windMph: inputs.windMph || 2,
      equipment: inputs.equipment || 'offset',
      elevationFt: inputs.elevationFt || 0,
      tSimMin: 0,
      T: HD.initProfile(n, tInitC),
      w: 0.75, wSurface: 1.0, C: 0.0,
      smoke: { good: 0, bad: 0, ringFrozen: false },
      smokeRingGoodAtCutoff: 0,
      crust: 0,
      // Thermal damage + creosote (oxygen-starved combustion).
      // Once burnLevel hits ~0.4 the cook is irreversibly burnt: bark
      // turns to charcoal, juiciness collapses. creosote is the dirty-
      // smoke byproduct of running too many coals at low damper.
      burnLevel: 0,
      creosote:  0,
      kSafety: 0.0,
      spritzEndMin: 0, spritzCount: 0,
      tPitC: C.fToC(inputs.tPitInitF != null ? inputs.tPitInitF
                                              : (inputs.tAmbF != null ? inputs.tAmbF : 70)),
      coals: [], damperPct: 60, woodAdds: [],
      wrapState: inputs.wrapType || 'none',
      phase: 'bark_build',
      lidOpenSec: 0, dangerZoneMin: 0, eventLog: []
    };
  }

  function step(state, dtSec) {
    var n = state.T.length - 1;
    var stab = HD.stableStep(state.alpha, C.H_BASE, C.K_MEAT, state.dx, dtSec);
    var fo = stab.fo, bi = stab.bi;
    var subDt = stab.dt;
    var nSub = Math.max(1, Math.ceil(dtSec / subDt));
    subDt = dtSec / nSub;
    fo = (state.alpha * subDt) / (state.dx * state.dx);

    var wrapRed = C.WRAP_EVAP_REDUCTION[state.wrapState] || 0;
    var humidityFactor = 1 - 0.5 * (state.humidityPct / 100);
    var tBoilC = HD.boilingPointC(state.elevationFt);

    for (var s = 0; s < nSub; s++) {
      // Combustion saturation: drum smokers have finite oxygen. Past
      // ~12 active coals at damper 70%, the bed runs rich — Q_fire
      // stops climbing linearly and creosote accumulates.
      var qFireRaw = FM.qFire(state.coals, state.tSimMin, state.damperPct);
      var activeCoals = 0;
      for (var ci = 0; ci < state.coals.length; ci++) {
        var x = (state.tSimMin - state.coals[ci].tIgniteMin) / state.coals[ci].tauBurnMin;
        if (x > 0 && x < 1.3) activeCoals++;
      }
      var oxCapacity = 4 + 0.12 * state.damperPct;
      var oxStarved = Math.max(0, activeCoals - oxCapacity);
      var qFire = oxStarved > 0
        ? qFireRaw * oxCapacity / activeCoals
        : qFireRaw;
      if (oxStarved > 0) {
        state.creosote = Math.min(1, (state.creosote || 0)
          + (oxStarved / oxCapacity) * (subDt / 3600));
      }

      var hEff = C.H_BASE * (1 + 0.05 * state.windMph);
      if (state.lidOpenSec > 0) hEff *= C.H_LID_OPEN_MULT;
      var qToMeat = PM.qToMeat(state.tPitC, state.T[0], hEff, state.areaM2);
      state.tPitC = PM.step(state.tPitC, qFire, qToMeat, state.tAmbC, subDt, {
        lidOpen: state.lidOpenSec > 0
      });

      var spritzBoost = 1.0;
      if (state.tSimMin < state.spritzEndMin) spritzBoost = 2.0;

      var flux = HD.evapFluxKgPerM2S(state.T[0], state.tAmbC, state.w, wrapRed, humidityFactor) * spritzBoost;
      var evapC = 0;
      if (flux > 0) {
        var fluxW = flux * C.L_V_WATER;
        evapC = (fluxW * subDt) / (C.RHO_MEAT * C.CP_MEAT * state.dx);
      }

      // Wet-bulb stall cap. While the meat is wet (w >= 0.6) the
      // surface evaporates faster than it can absorb conductive heat,
      // so it locks at wet-bulb temperature (~72 °C / 162 °F). As w
      // drains through 0.45 the cap ramps up to boiling (~100 °C).
      // This is what produces the visible stall plateau in core temp.
      var WET_BULB_C = 72;
      var wMix = Math.min(1, Math.max(0, (state.w - 0.45) / 0.15));
      var surfaceCap = WET_BULB_C * wMix + tBoilC * (1 - wMix);
      HD.stepExplicit(state.T, state.tPitC, fo, bi, evapC, surfaceCap);

      if (flux > 0) {
        var meatMassKg = (state.weightLb || 10) * 0.4535924;
        var areaPerMass = state.areaM2 / meatMassKg;
        var metabolicFlux = flux / spritzBoost;
        state.w = Math.max(0, state.w - metabolicFlux * areaPerMass * subDt);
        state.wSurface = Math.max(0, state.wSurface - metabolicFlux * areaPerMass * subDt * 5);
      }

      state.C = CM.step(state.C, state.T[n], subDt);
      state.kSafety = SF.step(state.kSafety, state.T[0], subDt);

      var smokeDensity = densityFromWood(state.woodAdds, state.tSimMin);
      var eta = combustionEfficiency(state);
      state.smoke = SM.step(state.smoke, state.T[0], smokeDensity, eta, subDt);
      if (!state.smoke.ringFrozen) state.smokeRingGoodAtCutoff = state.smoke.good;

      // Thermal damage. Tuned slow so a brief preheat overshoot is
      // forgiven, but sustained 400 °F+ pit (200 °C+) actually scorches.
      // 60 min @ 250 °C pit ≈ 0.36 burn. Sustained 4 h → full.
      var burnRate = 0;
      if (state.tPitC > 200) burnRate += (state.tPitC - 200) * 0.000012;
      if (state.T[0]  > 110) burnRate += (state.T[0]  - 110) * 0.000018;
      if (burnRate > 0) state.burnLevel = Math.min(1, (state.burnLevel || 0) + burnRate * subDt);

      var surfC = state.T[0];
      if (surfC >= 95 && surfC <= 180) {
        var dryness = 1 - Math.min(1, state.wSurface || 0);
        var wrapOpen = state.wrapState === 'aluminum_foil' ? 0.10
                     : state.wrapState === 'butcher_paper' ? 0.55
                     : state.wrapState === 'foil_boat'     ? 0.70
                     : 1.0;
        state.crust = Math.min(1, (state.crust || 0)
          + dryness * wrapOpen * (subDt / 60) * 0.012);
      }

      if (state.T[0] >= 4 && state.T[0] < 60) state.dangerZoneMin += subDt / 60;
      if (state.lidOpenSec > 0) state.lidOpenSec = Math.max(0, state.lidOpenSec - subDt);
      state.tSimMin += subDt / 60;
    }
    return state;
  }

  function densityFromWood(woodAdds, tSimMin) {
    var density = 0;
    var BURN_MIN = 360, RAMP = 5, PLATEAU_PEAK = 0.40;
    for (var i = 0; i < woodAdds.length; i++) {
      var add = woodAdds[i];
      var elapsed = tSimMin - add.tAddMin;
      if (elapsed < 0 || elapsed > BURN_MIN) continue;
      var profile;
      if (elapsed < RAMP) profile = elapsed / RAMP;
      else if (elapsed > BURN_MIN - 30) profile = Math.max(0, (BURN_MIN - elapsed) / 30);
      else profile = 1.0;
      density += profile * PLATEAU_PEAK * (add.mass || 1);
    }
    return Math.min(density, 1);
  }

  function combustionEfficiency(state) {
    var active = 0;
    for (var i = 0; i < state.coals.length; i++) {
      var x = (state.tSimMin - state.coals[i].tIgniteMin) / state.coals[i].tauBurnMin;
      if (x > 0 && x < 1.3) active += 1;
    }
    if (active === 0) return 0.5;
    var open = state.damperPct / 100;
    return 0.4 + 0.5 * Math.min(open * active / 4, 1);
  }

  function ignite(state, n) {
    FM.refuel(state.coals, n, state.tSimMin, C.COAL_P_PEAK, C.COAL_TAU_BURN_MIN);
    state.eventLog.push({ t: state.tSimMin, kind: 'ignite', n: n });
  }
  function refuel(state, n) {
    FM.refuel(state.coals, n, state.tSimMin, C.COAL_P_PEAK, C.COAL_TAU_BURN_MIN);
    state.eventLog.push({ t: state.tSimMin, kind: 'refuel', n: n });
  }
  function addWood(state, massKg, species) {
    state.woodAdds.push({ tAddMin: state.tSimMin, mass: massKg, species: species || 'oak' });
    state.eventLog.push({ t: state.tSimMin, kind: 'wood', mass: massKg, species: species });
  }
  function damper(state, pct) {
    state.damperPct = Math.max(0, Math.min(100, pct));
    state.eventLog.push({ t: state.tSimMin, kind: 'damper', pct: pct });
  }
  function wrap(state, type) {
    state.wrapState = type;
    state.phase = 'push';
    state.eventLog.push({ t: state.tSimMin, kind: 'wrap', type: type });
  }
  function openLid(state, seconds) {
    state.lidOpenSec = (state.lidOpenSec || 0) + seconds;
    state.tPitC -= C.T_PIT_LID_DROP_C * Math.min(seconds / 60, 1);
    state.eventLog.push({ t: state.tSimMin, kind: 'lid', seconds: seconds });
  }
  function spritz(state, volumeMl) {
    var v = volumeMl || 30;
    state.wSurface = Math.min(1, (state.wSurface || 0) + 0.15);
    state.spritzEndMin = state.tSimMin + 2;
    state.spritzCount = (state.spritzCount || 0) + 1;
    state.eventLog.push({ t: state.tSimMin, kind: 'spritz', volume: v });
  }
  function tallow(state, volumeMl) {
    var v = volumeMl || 30;
    state.w = Math.min(1, state.w + 0.05);
    state.wSurface = Math.min(1, (state.wSurface || 0) + 0.20);
    state.eventLog.push({ t: state.tSimMin, kind: 'tallow', volume: v });
  }
  function pull(state) {
    state.phase = 'rest';
    state.tPullC = state.T[state.T.length - 1];
    state.wAtPull = state.w;
    state.tPullMin = state.tSimMin;
    state.eventLog.push({ t: state.tSimMin, kind: 'pull' });
  }
  function slice(state, restMethod) {
    var tRest = (state.tPullMin != null) ? Math.max(0, state.tSimMin - state.tPullMin) : (state.tRestMin || 0);
    state.tRestMin = tRest;
    state.phase = 'slice';
    state.wRetained = RM.wRetained(state.wAtPull != null ? state.wAtPull : state.w, tRest);
    state.tCoreAtSlice = RM.restTemperatureC(state.tPullC || state.T[state.T.length - 1], state.tAmbC, tRest, restMethod || 'cooler');
    state.eventLog.push({ t: state.tSimMin, kind: 'slice', restMin: tRest });
  }

  function removeCoals(state, n) {
    var want = Math.max(1, n || 1), removed = 0;
    for (var i = state.eventLog.length - 1; i >= 0 && removed < want; i--) {
      var e = state.eventLog[i];
      if (e.kind !== 'refuel' && e.kind !== 'ignite') continue;
      while (e.n > 0 && removed < want) {
        for (var j = state.coals.length - 1; j >= 0; j--) {
          if (state.coals[j].tIgniteMin === e.t) { state.coals.splice(j, 1); break; }
        }
        e.n -= 1; removed += 1;
      }
      if (e.n <= 0) state.eventLog.splice(i, 1);
    }
    return removed;
  }

  function removeEvent(state, idx) {
    if (idx < 0 || idx >= state.eventLog.length) return false;
    var e = state.eventLog[idx];
    if (e.kind === 'refuel' || e.kind === 'ignite') {
      state.coals = state.coals.filter(function (c) { return c.tIgniteMin !== e.t; });
    } else if (e.kind === 'wood') {
      state.woodAdds = state.woodAdds.filter(function (w) { return w.tAddMin !== e.t; });
    } else if (e.kind === 'wrap') {
      var prev = 'none';
      for (var i = idx - 1; i >= 0; i--) {
        if (state.eventLog[i].kind === 'wrap') { prev = state.eventLog[i].type; break; }
      }
      state.wrapState = prev;
    } else if (e.kind === 'damper') {
      var prevD = 60;
      for (var k = idx - 1; k >= 0; k--) {
        if (state.eventLog[k].kind === 'damper') { prevD = state.eventLog[k].pct; break; }
      }
      state.damperPct = prevD;
    } else if (e.kind === 'pull' || e.kind === 'slice') {
      state.phase = 'bark_build';
      state.wRetained = null; state.tPullC = null; state.tPullMin = null;
    }
    state.eventLog.splice(idx, 1);
    return true;
  }

  return {
    create: create, step: step,
    ignite: ignite, refuel: refuel, addWood: addWood,
    damper: damper, wrap: wrap, openLid: openLid,
    spritz: spritz, tallow: tallow,
    pull: pull, slice: slice,
    removeCoals: removeCoals, removeEvent: removeEvent
  };
})();
