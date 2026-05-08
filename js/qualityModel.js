/**
 * Smoker Dynamics — Quality Predictor
 * 烟熏品质预测器
 *
 * Heuristic 5-dimension scoring grounded in PHYSICS.md and OPERATIONS.md.
 * Each dimension is a 0–100 score; safety is a gate (fail → overall 0).
 *
 * Dimensions (cite PHYSICS.md sections):
 *   - Tenderness   §4 collagen kinetics
 *   - Juiciness    §3 water budget + rest rebound
 *   - Smoke        §5 smoke uptake (cold-surface window)
 *   - Doneness     §8.7 phase thresholds vs target
 *   - Safety       §8.7 USDA / D-value gating
 *
 * The full ODE solver in simulator.js is *not* invoked here — that lives
 * in pitmaster.html. This module gives a fast, live-updating predictor
 * suitable for a calculator UI. Numbers within ±10 of the full model.
 */
(function () {
  'use strict';

  // ─── Meat profiles ──────────────────────────────────────────────
  // Each profile encodes BBQ-domain defaults + scoring anchors.
  var MEATS = {
    'brisket': {
      label: 'Brisket', label_zh: '牛胸肉',
      defaultWeightKg: 4.5, defaultThicknessCm: 7,
      defaultPitC: 121,           // 250°F low-and-slow
      defaultPullC: 95,           // probe-tender 200–205°F
      pullIdealC: [93, 96],       // ideal range
      collagenStyle: true,        // long-cook needed
      minCookHrPerKg: 1.8,        // unwrapped baseline at 121°C
      safeMinC: 63,               // USDA whole-muscle beef
      grade: 'choice'
    },
    'picanha': {
      label: 'Picanha', label_zh: 'Picanha',
      defaultWeightKg: 1.8, defaultThicknessCm: 5,
      defaultPitC: 121,
      defaultPullC: 54,           // medium-rare
      pullIdealC: [52, 57],
      collagenStyle: false,       // steak — don't cook to collagen breakdown
      minCookHrPerKg: 0.8,
      safeMinC: 52,               // whole-muscle beef rare (surface pasteurised by sear)
      grade: 'prime'
    },
    'pork-belly': {
      label: 'Pork belly', label_zh: '五花肉',
      defaultWeightKg: 1.5, defaultThicknessCm: 4,
      defaultPitC: 121,
      defaultPullC: 71,
      pullIdealC: [68, 75],
      collagenStyle: true,
      minCookHrPerKg: 1.5,
      safeMinC: 63,               // USDA pork
      grade: 'choice'
    },
    'pork-shoulder': {
      label: 'Pork shoulder', label_zh: '猪肩肉',
      defaultWeightKg: 4.0, defaultThicknessCm: 12,
      defaultPitC: 121,
      defaultPullC: 96,           // pull-pork tender
      pullIdealC: [93, 98],
      collagenStyle: true,
      minCookHrPerKg: 2.0,
      safeMinC: 63,
      grade: 'choice'
    },
    'ribs': {
      label: 'Ribs (St. Louis)', label_zh: '排骨',
      defaultWeightKg: 1.4, defaultThicknessCm: 4,
      defaultPitC: 121,
      defaultPullC: 91,
      pullIdealC: [88, 93],
      collagenStyle: true,
      minCookHrPerKg: 3.0,
      safeMinC: 63,
      grade: 'choice'
    },
    'wings': {
      label: 'Wings', label_zh: '鸡翅',
      defaultWeightKg: 1.0, defaultThicknessCm: 3,
      defaultPitC: 200,           // hot grill
      defaultPullC: 78,           // safe + crispy
      pullIdealC: [75, 82],
      collagenStyle: false,       // poultry — short hot cook
      minCookHrPerKg: 0.6,
      safeMinC: 74,               // USDA poultry
      grade: 'choice',
      isPoultry: true
    },
    'lamb-leg': {
      label: 'Lamb leg', label_zh: '羊腿',
      defaultWeightKg: 2.5, defaultThicknessCm: 9,
      defaultPitC: 135,           // 275°F
      defaultPullC: 90,
      pullIdealC: [85, 93],
      collagenStyle: true,
      minCookHrPerKg: 1.4,
      safeMinC: 54,               // whole-muscle lamb
      grade: 'choice'
    },
    'whole-fish': {
      label: 'Whole fish', label_zh: '整鱼',
      defaultWeightKg: 1.2, defaultThicknessCm: 5,
      defaultPitC: 175,
      defaultPullC: 60,
      pullIdealC: [58, 63],
      collagenStyle: false,
      minCookHrPerKg: 0.5,
      safeMinC: 52,               // fish flakes at ~52°C; FDA 63°C is precaution
      grade: 'select'
    }
  };
  var MEAT_ORDER = ['brisket', 'picanha', 'pork-belly', 'pork-shoulder',
                    'ribs', 'wings', 'lamb-leg', 'whole-fish'];

  // ─── Equipment profiles (PHYSICS.md §8.4) ───────────────────────
  // pit-temp standard deviation drives doneness uncertainty
  var EQUIPMENT = {
    'electric':  { label: 'Electric', label_zh: '电烤', sigmaF: 5,  cookFactor: 1.00 },
    'pellet':    { label: 'Pellet',   label_zh: '颗粒', sigmaF: 8,  cookFactor: 1.00 },
    'kamado':    { label: 'Kamado',   label_zh: 'Kamado', sigmaF: 10, cookFactor: 0.95 },
    'drum':      { label: 'Drum',     label_zh: '桶式', sigmaF: 12, cookFactor: 1.00 },
    'wsm':       { label: 'WSM',      label_zh: 'WSM',  sigmaF: 15, cookFactor: 1.05 },
    'kettle':    { label: 'Kettle',   label_zh: '炭炉', sigmaF: 20, cookFactor: 1.05 },
    'offset':    { label: 'Offset',   label_zh: 'Offset', sigmaF: 25, cookFactor: 1.10 },
    'gas':       { label: 'Gas',      label_zh: '气烤', sigmaF: 6,  cookFactor: 0.95 },
    'oven':      { label: 'Home oven',label_zh: '家用烤箱', sigmaF: 4, cookFactor: 0.90 }
  };
  var EQUIPMENT_ORDER = ['drum', 'kamado', 'wsm', 'kettle', 'offset',
                         'pellet', 'electric', 'gas', 'oven'];

  // ─── Wrap factors (PHYSICS.md §8.5) ─────────────────────────────
  var WRAPS = {
    'none':          { label: 'No wrap',       label_zh: '不包', evapReduce: 0.00, cookSpeedup: 1.00, barkBonus: 1.00 },
    'butcher_paper': { label: 'Butcher paper', label_zh: '屠夫纸', evapReduce: 0.60, cookSpeedup: 0.85, barkBonus: 0.90 },
    'foil_boat':     { label: 'Foil boat',     label_zh: '半包铝箔', evapReduce: 0.45, cookSpeedup: 0.90, barkBonus: 0.95 },
    'aluminum_foil': { label: 'Aluminum foil', label_zh: '全包铝箔', evapReduce: 0.95, cookSpeedup: 0.70, barkBonus: 0.55 }
  };

  // ─── Smoke woods ────────────────────────────────────────────────
  var WOODS = {
    'none':     { label: '—',         label_zh: '不熏', strength: 0.0 },
    'oak':      { label: 'Oak',       label_zh: '橡木', strength: 1.0 },
    'hickory':  { label: 'Hickory',   label_zh: '胡桃', strength: 1.2 },
    'mesquite': { label: 'Mesquite',  label_zh: '牧豆', strength: 1.4 },
    'cherry':   { label: 'Cherry',    label_zh: '樱桃', strength: 0.7 },
    'apple':    { label: 'Apple',     label_zh: '苹果', strength: 0.6 },
    'pecan':    { label: 'Pecan',     label_zh: '山核桃', strength: 0.9 }
  };

  // ─── Rest profiles (PHYSICS.md §8.6) ────────────────────────────
  var REST = {
    'open_air':  { label: 'Open air',     label_zh: '室温', cooling: 0.025, juiceBonus: 0.0 },
    'oven':      { label: 'Warm oven',    label_zh: '烤箱保温', cooling: 0.005, juiceBonus: 0.5 },
    'cooler':    { label: 'Faux-cambro',  label_zh: '保温箱', cooling: 0.003, juiceBonus: 1.0 }
  };

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function lerp(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }

  // ─── Cook-time estimator ────────────────────────────────────────
  // Heuristic, calibrated to match menuLibrary timings.
  function estimateCookHours(cfg) {
    var meat = MEATS[cfg.meat];
    var equip = EQUIPMENT[cfg.equipment];
    var wrap = WRAPS[cfg.wrap];
    var pitC = cfg.pitC;

    // Base: minutes per kg at default pit temp 121°C (low-and-slow)
    // Faster pit temp → shorter cook (linear-ish above 100°C)
    var pitFactor = clamp(135 / pitC, 0.6, 1.5);
    var hrPerKg = meat.minCookHrPerKg * pitFactor * wrap.cookSpeedup * equip.cookFactor;
    var cookHr = cfg.weightKg * hrPerKg;

    // Floor for short cooks (skewers / wings shouldn't go below ~30 min)
    return Math.max(0.5, cookHr);
  }

  // ─── Tenderness score (PHYSICS.md §4) ───────────────────────────
  // Collagen needs sustained 71–82°C internal then ≥85% conversion at pull.
  function scoreTenderness(cfg, cookHr) {
    var meat = MEATS[cfg.meat];

    // Steak-style cuts (picanha, fish): "tenderness" means cooked just
    // enough; over-cooking is the failure mode.
    if (!meat.collagenStyle) {
      var idealMid = (meat.pullIdealC[0] + meat.pullIdealC[1]) / 2;
      var deviation = Math.abs(cfg.pullC - idealMid);
      return clamp(100 - deviation * 6, 0, 100);
    }

    // Collagen-style: enough time + correct pull temp
    var pullPenalty = 0;
    if (cfg.pullC < meat.pullIdealC[0]) pullPenalty = (meat.pullIdealC[0] - cfg.pullC) * 8;
    if (cfg.pullC > meat.pullIdealC[1]) pullPenalty = (cfg.pullC - meat.pullIdealC[1]) * 4;

    // Time at target — full-cook baseline credits 100, undercook drops fast
    var requiredHr = cfg.weightKg * meat.minCookHrPerKg * 0.7; // wrap-adjusted floor
    var timeFactor = clamp(cookHr / requiredHr, 0.3, 1.2);
    var timeScore = lerp(60, 100, (timeFactor - 0.7) / 0.3);

    return clamp(timeScore - pullPenalty, 0, 100);
  }

  // ─── Juiciness score (PHYSICS.md §3) ────────────────────────────
  // Water budget = pit temp × unwrapped time × surface area; rest rebounds.
  function scoreJuiciness(cfg, cookHr) {
    var wrap = WRAPS[cfg.wrap];
    var rest = REST[cfg.restMethod];

    // Higher pit temp → more evaporation
    var pitPenalty = clamp((cfg.pitC - 121) * 0.7, 0, 30);

    // Unwrapped hours — rough fraction depends on wrap (0 if always wrapped)
    var unwrappedFraction = wrap.cookSpeedup; // proxy: more speedup = wrapped more
    var evapPenalty = (1 - wrap.evapReduce) * cookHr * 4;

    // Rest rebound — τ_rest = 45 min, full benefit by 90 min
    var restFactor = 1 - Math.exp(-cfg.restMin / 45);
    var restBonus = restFactor * 18 + rest.juiceBonus * 5;

    // Aluminum foil = "boat anchor" — too wrapped means texture loss
    var foilPenalty = cfg.wrap === 'aluminum_foil' ? 8 : 0;

    return clamp(95 - pitPenalty - evapPenalty + restBonus - foilPenalty, 0, 100);
  }

  // ─── Smoke flavor score (PHYSICS.md §5) ─────────────────────────
  // Uptake gated by surface < 60°C (first ~90 min). More wood ≠ better.
  function scoreSmoke(cfg, cookHr) {
    if (cfg.smokeWood === 'none' || cfg.smokeAmount <= 0) {
      return 60; // not smoked = neutral, not failure
    }
    var wood = WOODS[cfg.smokeWood];

    // Ideal: 1–2 chunks for short cooks, 2–3 for long (>4h)
    var idealAmount = cookHr > 4 ? 2.5 : 1.5;
    var amountDelta = Math.abs(cfg.smokeAmount - idealAmount);
    var amountScore = clamp(100 - amountDelta * 18, 30, 100);

    // Strength match: collagen-style cuts handle stronger wood; lean/short cuts pair sweeter
    var meat = MEATS[cfg.meat];
    var idealStrength = meat.collagenStyle ? 1.0 : 0.7;
    var strengthDelta = Math.abs(wood.strength - idealStrength);
    var pairingBonus = clamp(15 - strengthDelta * 12, -10, 15);

    // Aluminum foil after early phase → smoke locked in OK; foil throughout = no smoke ring
    var foilPenalty = cfg.wrap === 'aluminum_foil' ? 12 : 0;

    return clamp(amountScore + pairingBonus - foilPenalty, 0, 100);
  }

  // ─── Doneness score ─────────────────────────────────────────────
  // How close pull temp is to ideal range for this cut.
  function scoreDoneness(cfg) {
    var meat = MEATS[cfg.meat];
    var lo = meat.pullIdealC[0], hi = meat.pullIdealC[1];
    if (cfg.pullC >= lo && cfg.pullC <= hi) return 100;
    var dist = cfg.pullC < lo ? lo - cfg.pullC : cfg.pullC - hi;
    return clamp(100 - dist * 7, 0, 100);
  }

  // ─── Safety score (PHYSICS.md §8.7, USDA + cut-specific) ────────
  // Whole-muscle beef/lamb: surface pasteurised, interior rare OK.
  // Pork ≥63°C, poultry ≥74°C. Each meat profile carries its own floor.
  function scoreSafety(cfg) {
    var meat = MEATS[cfg.meat];
    if (cfg.pullC < meat.safeMinC) return 0; // hard fail
    return 100;
  }

  // ─── Overall + grade ────────────────────────────────────────────
  function letterGrade(score) {
    if (score >= 95) return 'A+';
    if (score >= 90) return 'A';
    if (score >= 85) return 'B+';
    if (score >= 80) return 'B';
    if (score >= 75) return 'C+';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  // ─── Diagnostics (OPERATIONS.md red/yellow lines) ───────────────
  function buildDiagnostics(cfg, cookHr, scores) {
    var d = [];
    var meat = MEATS[cfg.meat];

    // R1: pit too cold for stall (low-and-slow only)
    if (meat.collagenStyle && cfg.pitC < 107) {
      d.push({ tier: 'red',
        msg: 'Pit below 107°C / 225°F — stall will trap you',
        msg_zh: '桶温低于 107°C / 225°F —— stall 会拖垮整个 cook' });
    }
    // R3: pull too early for collagen
    if (meat.collagenStyle && cfg.pullC < meat.pullIdealC[0] - 3) {
      d.push({ tier: 'red',
        msg: 'Pulling before collagen converts — flat will be tough',
        msg_zh: '在胶原转化前出炉 —— 肉一定老' });
    }
    // R5: foil throughout = no bark
    if (cfg.wrap === 'aluminum_foil' && meat.collagenStyle) {
      d.push({ tier: 'yellow',
        msg: 'Foil = faster but soft bark; consider butcher paper',
        msg_zh: '铝箔加速但树皮变软；建议屠夫纸' });
    }
    // R4 / smoke advice
    if (cfg.smokeWood !== 'none' && cfg.smokeAmount > 3) {
      d.push({ tier: 'yellow',
        msg: 'Heavy smoke — risk of bitter creosote',
        msg_zh: '烟太重 —— 容易有 creosote 苦味' });
    }
    // Pull temp too high
    if (cfg.pullC > meat.pullIdealC[1] + 3) {
      d.push({ tier: 'yellow',
        msg: 'Pull temp above ideal — over-dry risk',
        msg_zh: '出炉温度过高 —— 过干风险' });
    }
    // Rest too short
    if (cfg.restMin < 30 && meat.collagenStyle) {
      d.push({ tier: 'yellow',
        msg: 'Rest <30 min loses juice rebound',
        msg_zh: '静置不到 30 分钟 —— 肉汁来不及回流' });
    }
    // Safety hard fail
    if (scores.safety === 0) {
      d.push({ tier: 'red',
        msg: 'Pull temp below USDA safe minimum',
        msg_zh: '出炉温度低于 USDA 食品安全底线' });
    }
    // Green: happy path
    if (d.length === 0) {
      d.push({ tier: 'green',
        msg: 'Plan looks clean — no red/yellow flags',
        msg_zh: '方案干净 —— 无红黄警告' });
    }
    return d;
  }

  function score(cfg) {
    // Fill defaults from meat profile if missing
    var meat = MEATS[cfg.meat] || MEATS['brisket'];
    cfg = Object.assign({
      weightKg: meat.defaultWeightKg,
      thicknessCm: meat.defaultThicknessCm,
      grade: meat.grade,
      equipment: 'drum',
      pitC: meat.defaultPitC,
      wrap: meat.collagenStyle ? 'butcher_paper' : 'none',
      smokeWood: meat.collagenStyle ? 'oak' : 'none',
      smokeAmount: meat.collagenStyle ? 2 : 1,
      pullC: meat.defaultPullC,
      restMethod: meat.collagenStyle ? 'cooler' : 'open_air',
      restMin: meat.collagenStyle ? 60 : 10
    }, cfg);

    var cookHr = estimateCookHours(cfg);

    var s = {
      tenderness: scoreTenderness(cfg, cookHr),
      juiciness: scoreJuiciness(cfg, cookHr),
      smoke: scoreSmoke(cfg, cookHr),
      doneness: scoreDoneness(cfg),
      safety: scoreSafety(cfg)
    };

    // Weighted overall (Tenderness 35, Juiciness 30, Doneness 20, Smoke 15)
    // Safety gates: fail = overall 0
    var weighted = s.tenderness * 0.35 + s.juiciness * 0.30
                 + s.doneness * 0.20 + s.smoke * 0.15;
    s.overall = s.safety === 0 ? 0 : Math.round(weighted);
    s.tenderness = Math.round(s.tenderness);
    s.juiciness  = Math.round(s.juiciness);
    s.smoke      = Math.round(s.smoke);
    s.doneness   = Math.round(s.doneness);

    return {
      cfg: cfg,
      cookHours: cookHr,
      cookHoursDisplay: cookHr >= 1 ? cookHr.toFixed(1) + ' h'
                                    : Math.round(cookHr * 60) + ' min',
      scores: s,
      grade: letterGrade(s.overall),
      diagnostics: buildDiagnostics(cfg, cookHr, s)
    };
  }

  // ─── Generic schedule generator ─────────────────────────────────
  // Used when the chosen meat has no hand-tuned template in menuLibrary.
  // Produces an event list compatible with icsGenerator.buildEvents().
  function buildGenericSchedule(cfg, cookHr) {
    var meat = MEATS[cfg.meat];
    var wrap = WRAPS[cfg.wrap];
    var cookMin = Math.round(cookHr * 60);
    var restMin = cfg.restMin;
    var lightLeadMin = cookHr > 4 ? 30 : 20;

    var ev = [];
    var t = -(cookMin + restMin + lightLeadMin);

    ev.push({
      offsetMin: t, dur: lightLeadMin,
      title: '🔥 Light fire / preheat',
      title_zh: '引火 / 预热',
      body: 'Bring pit to ' + cfg.pitC + '°C. ' + (cfg.smokeWood !== 'none'
        ? 'Add ' + (WOODS[cfg.smokeWood].label.toLowerCase()) + ' wood (' + cfg.smokeAmount + ' chunks).'
        : 'No smoking wood needed.'),
      body_zh: '桶温到 ' + cfg.pitC + '°C。' + (cfg.smokeWood !== 'none'
        ? '加 ' + (WOODS[cfg.smokeWood].label_zh) + '木 ' + cfg.smokeAmount + ' 块。'
        : '不加烟木。')
    });

    t = -(cookMin + restMin);
    ev.push({
      offsetMin: t, dur: 5,
      title: '🥩 ' + meat.label + ' on',
      title_zh: meat.label_zh + ' 下锅',
      body: cfg.weightKg + ' kg, ' + cfg.thicknessCm + ' cm thick. Probe in thickest part. Pit ' + cfg.pitC + '°C.',
      body_zh: cfg.weightKg + ' kg，' + cfg.thicknessCm + ' cm 厚。探针插最厚处。桶温 ' + cfg.pitC + '°C。'
    });

    if (cookHr > 2) {
      ev.push({
        offsetMin: -(cookMin * 0.5 + restMin), dur: 5,
        title: '💧 Mid-cook check',
        title_zh: '中途检查',
        body: 'Quick look. Spritz if surface looks dry. Internal should be near ' + Math.round(meat.pullIdealC[0] * 0.7) + '°C.',
        body_zh: '快速查看，干了喷一下。中心约 ' + Math.round(meat.pullIdealC[0] * 0.7) + '°C。'
      });
    }

    if (cfg.wrap !== 'none' && meat.collagenStyle) {
      ev.push({
        offsetMin: -(cookMin * 0.45 + restMin), dur: 10,
        title: '📦 Wrap in ' + wrap.label.toLowerCase(),
        title_zh: '包：' + wrap.label_zh,
        body: 'Wrap when bark is dark and internal ~71°C / 160°F. Reinsert probe.',
        body_zh: '树皮深色、内温到 ~71°C / 160°F 时包。重新插探针。'
      });
    }

    ev.push({
      offsetMin: -(restMin + 10), dur: 10,
      title: '🌡️ Probe-tender check, pull',
      title_zh: '测嫩出炉',
      body: 'Target internal ' + cfg.pullC + '°C. ' + (meat.collagenStyle
        ? 'Probe should slide in like room-temp butter — temp is just a guide.'
        : 'Pull at exact temp; internal carryover is small.'),
      body_zh: '目标内温 ' + cfg.pullC + '°C。' + (meat.collagenStyle
        ? '探针滑入像插室温黄油 —— 温度只是参考。'
        : '到温即出，残温升幅有限。')
    });

    ev.push({
      offsetMin: -restMin, dur: restMin,
      title: '🛌 Rest in ' + REST[cfg.restMethod].label.toLowerCase(),
      title_zh: '静置：' + REST[cfg.restMethod].label_zh,
      body: 'Rest ' + restMin + ' min. Juices redistribute (τ ≈ 45 min). Hold above 60°C.',
      body_zh: '静置 ' + restMin + ' 分钟。肉汁回流（τ ≈ 45 分）。保温 60°C 以上。'
    });

    ev.push({
      offsetMin: -8, dur: 8,
      title: '🔪 Slice + plate',
      title_zh: '切片装盘',
      body: 'Slice against the grain. Thickness depends on cut.',
      body_zh: '横纹切。厚度看部位。'
    });

    ev.push({
      offsetMin: 0, dur: 60,
      title: '🍽️ Serve',
      title_zh: '上桌',
      body: 'Plate and eat. Take a photo first.',
      body_zh: '装盘开吃。先拍张照。'
    });

    return ev;
  }

  window.SmokerSim = window.SmokerSim || {};
  window.SmokerSim.Quality = {
    score: score,
    buildGenericSchedule: buildGenericSchedule,
    MEATS: MEATS, MEAT_ORDER: MEAT_ORDER,
    EQUIPMENT: EQUIPMENT, EQUIPMENT_ORDER: EQUIPMENT_ORDER,
    WRAPS: WRAPS, WOODS: WOODS, REST: REST
  };
})();
