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

  /**
   * Construct a fresh simulation state from inputs.
   * @param {Object} inputs
   *   - protein, grade
   *   - thicknessIn, weightLb
   *   - equipment ('offset'|'pellet'|...)
   *   - elevationFt
   *   - tAmbF, humidityPct, windMph
   *   - wrapType ('none'|'foil_boat'|'butcher_paper'|'aluminum_foil')
   *   - tInitF initial meat temperature
   */
  function create(inputs) {
    var alpha = C.THERMAL_DIFFUSIVITY[inputs.protein][inputs.grade];
    var halfThickM = C.inchToM(inputs.thicknessIn) / 2;
    var n = C.N_NODES;
    var dx = halfThickM / n;
    var tInitC = C.fToC(inputs.tInitF != null ? inputs.tInitF : 40);
    return {
      // Inputs locked in
      alpha:         alpha,
      halfThickM:    halfThickM,
      dx:            dx,
      weightLb:      inputs.weightLb || 10,
      areaM2:        0.07,                     // placeholder: 10 lb brisket ≈ 700 cm²
      tAmbC:         C.fToC(inputs.tAmbF != null ? inputs.tAmbF : 70),
      humidityPct:   inputs.humidityPct || 50,
      windMph:       inputs.windMph || 2,
      equipment:     inputs.equipment || 'offset',
      elevationFt:   inputs.elevationFt || 0,

      // Mutable state
      tSimMin:       0,
      T:             HD.initProfile(n, tInitC),
      w:             0.75,                     // raw brisket surface-available water fraction
      wSurface:      1.0,
      C:             0.0,
      smoke:         { good: 0, bad: 0, ringFrozen: false },
      smokeRingGoodAtCutoff: 0,

      // Crust accumulator (0..1). Integrated each step from surface
      // temperature × dryness × wrap penalty. See scoreFromState in
      // app.js for the bark dimension on the radar.
      crust:         0,

      // Food safety: cumulative log-reductions at surface
      kSafety:       0.0,

      // Spritz state: tMin of last spritz, if active
      spritzEndMin:  0,
      spritzCount:   0,

      // Pit starts at user-specified pit-initial (default = ambient).
      // Heat then enters only via ignite/refuel events.
      tPitC:         C.fToC(inputs.tPitInitF != null
                              ? inputs.tPitInitF
                              : (inputs.tAmbF != null ? inputs.tAmbF : 70)),
      coals:         [],
      damperPct:     60,
      woodAdds:      [],

      // Wrap / phase
      wrapState:     inputs.wrapType || 'none',
      phase:         'bark_build',

      // Outputs / flags
      lidOpenSec:    0,
      dangerZoneMin: 0,
      eventLog:      []
    };
  }

  /**
   * Advance the simulation by dtSec seconds. Internally runs multiple
   * FDM micro-steps so the heat equation stays stable regardless of caller dt.
   */
  function step(state, dtSec) {
    var n = state.T.length - 1;

    // Resolve stable sub-dt once, subdivide the request.
    var stab = HD.stableStep(state.alpha, C.H_BASE, C.K_MEAT, state.dx, dtSec);
    var fo = stab.fo, bi = stab.bi;
    var subDt = stab.dt;
    var nSub = Math.max(1, Math.ceil(dtSec / subDt));
    subDt = dtSec / nSub;
    // Recompute fo for the chosen subDt
    fo = (state.alpha * subDt) / (state.dx * state.dx);

    var wrapRed = C.WRAP_EVAP_REDUCTION[state.wrapState] || 0;
    var humidityFactor = 1 - 0.5 * (state.humidityPct / 100);
    var tBoilC = HD.boilingPointC(state.elevationFt);

    for (var s = 0; s < nSub; s++) {
      // Pit update
      var qFire = FM.qFire(state.coals, state.tSimMin, state.damperPct);
      var hEff  = C.H_BASE * (1 + 0.05 * state.windMph);
      if (state.lidOpenSec > 0) hEff *= C.H_LID_OPEN_MULT;
      var qToMeat = PM.qToMeat(state.tPitC, state.T[0], hEff, state.areaM2);
      state.tPitC = PM.step(state.tPitC, qFire, qToMeat, state.tAmbC, subDt, {
        lidOpen: state.lidOpenSec > 0
      });

      // Spritz boost: the mop liquid on the surface needs to boil off first.
      // While active, surface has an extra water reservoir — evap is locally
      // stronger (from the spritz, not the meat) but meat's own w is spared.
      var spritzBoost = 1.0;
      if (state.tSimMin < state.spritzEndMin) {
        spritzBoost = 2.0;        // surface flux doubled by puddled liquid
      }

      // Meat surface evap cooling + water-loss flux (kg/m²/s)
      var flux = HD.evapFluxKgPerM2S(state.T[0], state.tAmbC, state.w, wrapRed, humidityFactor) * spritzBoost;
      var evapC = 0;
      if (flux > 0) {
        var fluxW = flux * C.L_V_WATER;
        evapC = (fluxW * subDt) / (C.RHO_MEAT * C.CP_MEAT * state.dx);
      }

      // Meat heat diffusion step
      HD.stepExplicit(state.T, state.tPitC, fo, bi, evapC, tBoilC);

      // Water budget: d(w)/dt = -flux · (A/m_meat). Normalised so an unwrapped
      // brisket loses ~15–25 % over a full cook at ref conditions.
      // During spritz (spritzBoost>1), the extra flux is from puddled mop
      // liquid, not from the meat — don't charge it to internal w.
      if (flux > 0) {
        var meatMassKg = (state.weightLb || 10) * 0.4535924;
        var areaPerMass = state.areaM2 / meatMassKg;
        var metabolicFlux = flux / spritzBoost;  // meat-sourced only
        state.w = Math.max(0, state.w - metabolicFlux * areaPerMass * subDt);
        state.wSurface = Math.max(0, state.wSurface - metabolicFlux * areaPerMass * subDt * 5);
      }

      // Collagen (core temperature)
      state.C = CM.step(state.C, state.T[n], subDt);

      // Food-safety D-value integration at SURFACE (cold zone for pathogens)
      state.kSafety = SF.step(state.kSafety, state.T[0], subDt);

      // Smoke
      var smokeDensity = densityFromWood(state.woodAdds, state.tSimMin);
      var eta = combustionEfficiency(state);
      state.smoke = SM.step(state.smoke, state.T[0], smokeDensity, eta, subDt);
      if (!state.smoke.ringFrozen) state.smokeRingGoodAtCutoff = state.smoke.good;

      // Crust (bark) accumulation. Real bark needs:
      //   - surface in the Maillard band (95–180 °C / 200–355 °F)
      //   - dry surface (low wSurface) — bark = dehydrated muscle + smoke
      //   - exposed (foil traps moisture and steams the crust soft;
      //     paper allows some still; bare is best)
      // Integrate: dCrust/dt ∝ band(T_surf) × (1 - wSurface) × wrap_open
      var surfC = state.T[0];
      if (surfC >= 95 && surfC <= 180) {
        var dryness = 1 - Math.min(1, state.wSurface || 0);
        var wrapOpen = state.wrapState === 'aluminum_foil' ? 0.10
                     : state.wrapState === 'butcher_paper' ? 0.55
                     : state.wrapState === 'foil_boat'     ? 0.70
                     : 1.0;
        // 0.012 calibrated so ~3 h of perfect conditions reaches crust=1.0
        state.crust = Math.min(1, (state.crust || 0) + dryness * wrapOpen * (subDt / 60) * 0.012);
      }

      // Danger zone
      if (state.T[0] >= 4 && state.T[0] < 60) {
        state.dangerZoneMin += subDt / 60;
      }

      // Lid recovery
      if (state.lidOpenSec > 0) state.lidOpenSec = Math.max(0, state.lidOpenSec - subDt);

      state.tSimMin += subDt / 60;
    }
    return state;
  }

  /**
   * Sawdust-in-maze smoke density 0–1. Each load smoulders for ~6 h
   * with a slow ramp-in (5 min to peak), a long sustained plateau,
   * and a gentle taper as fuel runs out. Multiple loads stack so the
   * cook can be re-fueled (open the smoker briefly, drop in another
   * pellet load, light, close).
   */
  function densityFromWood(woodAdds, tSimMin) {
    var density = 0;
    var BURN_MIN = 360;        // 6 h smoulder per load
    var RAMP = 5;              // minutes to reach peak after lighting
    var PLATEAU_PEAK = 0.40;   // sustained density per unit mass — well below pyrolysis pulse
    for (var i = 0; i < woodAdds.length; i++) {
      var add = woodAdds[i];
      var elapsed = tSimMin - add.tAddMin;
      if (elapsed < 0 || elapsed > BURN_MIN) continue;
      var profile;
      if (elapsed < RAMP) {
        profile = elapsed / RAMP;                                       // ramp up
      } else if (elapsed > BURN_MIN - 30) {
        profile = Math.max(0, (BURN_MIN - elapsed) / 30);               // taper
      } else {
        profile = 1.0;                                                  // sustained
      }
      density += profile * PLATEAU_PEAK * (add.mass || 1);
    }
    return Math.min(density, 1);
  }

  /**
   * Proxy for thin-blue vs white smoke. High when Q_fire per unit fuel is strong.
   */
  function combustionEfficiency(state) {
    var active = 0;
    for (var i = 0; i < state.coals.length; i++) {
      var x = (state.tSimMin - state.coals[i].tIgniteMin) / state.coals[i].tauBurnMin;
      if (x > 0 && x < 1.3) active += 1;
    }
    if (active === 0) return 0.5;
    // Efficiency peaks with a moderately open damper and a healthy coal set.
    var open = state.damperPct / 100;
    return 0.4 + 0.5 * Math.min(open * active / 4, 1);
  }

  // --- Event API ---
  function ignite(state, n) {
    FM.refuel(state.coals, n, state.tSimMin, C.COAL_P_PEAK, C.COAL_TAU_BURN_MIN);
    state.eventLog.push({ t: state.tSimMin, kind: 'ignite', n: n });
  }
  function refuel(state, n) {
    FM.refuel(state.coals, n, state.tSimMin, C.COAL_P_PEAK, C.COAL_TAU_BURN_MIN);
    state.eventLog.push({ t: state.tSimMin, kind: 'refuel', n: n });
  }
  /**
   * Sawdust pellet load in a smoking maze (a.k.a. "AMAZN tube" — a
   * perforated metal labyrinth filled with pelletized sawdust). Lit
   * once and smoulders cold for hours. Physics:
   *   - much longer smoke duration (~6 h vs ~15 min for a chunk)
   *   - lower peak smoke density — slow smoulder, not pyrolysis pulse
   *   - negligible heat contribution (we already ignore Q_wood here)
   */
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

  /**
   * Spritz: deposit mop liquid on the surface. Physics:
   *   - wSurface rewet by +0.15 (pellicle partially restored)
   *   - for the next ~2 min, evap flux doubled (puddled liquid boils off first)
   *   - but that extra evap pulls heat from pit/meat, not from meat's w
   *   - side effect: brief T_surf dip that "resets the crust"
   */
  function spritz(state, volumeMl) {
    var v = volumeMl || 30;
    state.wSurface = Math.min(1, (state.wSurface || 0) + 0.15);
    state.spritzEndMin = state.tSimMin + 2;   // boost lasts ~2 min
    state.spritzCount = (state.spritzCount || 0) + 1;
    state.eventLog.push({ t: state.tSimMin, kind: 'spritz', volume: v });
  }

  /**
   * Tallow: spoon beef tallow into the wrap. Physics:
   *   - bumps the meat's bulk water reservoir (w += 0.05) — fat layer
   *     literally seals in moisture so future evap eats less of it
   *   - rewets the surface (wSurface += 0.20)
   *   - no flux spike (unlike spritz) — fat doesn't boil off the way
   *     mop liquid does, it just sits and lubricates
   */
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
    state.tCoreAtSlice = RM.restTemperatureC(state.tPullC || state.T[state.T.length - 1],
                                             state.tAmbC, tRest, restMethod || 'cooler');
    state.eventLog.push({ t: state.tSimMin, kind: 'slice', restMin: tRest });
  }

  // --- Reverse / undo ---

  /**
   * Peel `n` coals off the most-recent ignite/refuel batch. Used by the
   * "−1 coal" UI button. Returns how many were actually removed.
   * Going forward, Q_fire(t) drops because those coals are no longer in
   * state.coals; past ticks are not retroactively recomputed.
   */
  function removeCoals(state, n) {
    var want = Math.max(1, n || 1);
    var removed = 0;
    for (var i = state.eventLog.length - 1; i >= 0 && removed < want; i--) {
      var e = state.eventLog[i];
      if (e.kind !== 'refuel' && e.kind !== 'ignite') continue;
      while (e.n > 0 && removed < want) {
        // Remove one coal whose tIgniteMin matches this event
        for (var j = state.coals.length - 1; j >= 0; j--) {
          if (state.coals[j].tIgniteMin === e.t) {
            state.coals.splice(j, 1);
            break;
          }
        }
        e.n -= 1;
        removed += 1;
      }
      if (e.n <= 0) state.eventLog.splice(i, 1);
    }
    return removed;
  }

  /**
   * Remove a single event by index and reverse its physics where reversible.
   * Used by the "↶ Undo" button and by clicking a chip on the timeline.
   */
  function removeEvent(state, idx) {
    if (idx < 0 || idx >= state.eventLog.length) return false;
    var e = state.eventLog[idx];
    if (e.kind === 'refuel' || e.kind === 'ignite') {
      state.coals = state.coals.filter(function (c) { return c.tIgniteMin !== e.t; });
    } else if (e.kind === 'wood') {
      state.woodAdds = state.woodAdds.filter(function (w) { return w.tAddMin !== e.t; });
    } else if (e.kind === 'wrap') {
      // Revert to most recent earlier wrap event, default 'none'
      var prev = 'none';
      for (var i = idx - 1; i >= 0; i--) {
        if (state.eventLog[i].kind === 'wrap') { prev = state.eventLog[i].type; break; }
      }
      state.wrapState = prev;
    } else if (e.kind === 'damper') {
      // Revert to previous damper event, default 60
      var prevD = 60;
      for (var k = idx - 1; k >= 0; k--) {
        if (state.eventLog[k].kind === 'damper') { prevD = state.eventLog[k].pct; break; }
      }
      state.damperPct = prevD;
    } else if (e.kind === 'pull' || e.kind === 'slice') {
      // Revert phase to bark_build (cook resumes)
      state.phase = 'bark_build';
      state.wRetained = null;
      state.tPullC = null;
      state.tPullMin = null;
    }
    // spritz / lid are transient — physics already faded; we just drop the log entry
    state.eventLog.splice(idx, 1);
    return true;
  }

  return {
    create: create,
    step: step,
    ignite: ignite,
    refuel: refuel,
    addWood: addWood,
    damper: damper,
    wrap: wrap,
    openLid: openLid,
    spritz: spritz,
    tallow: tallow,
    pull: pull,
    slice: slice,
    removeCoals: removeCoals,
    removeEvent: removeEvent
  };
})();