# CLAUDE.md — project memory

**Smoker Dynamics · 烟熏动力学** — physics-driven BBQ simulator that
surfaces the next-best action as ranked decision cards. Not a recipe app;
runs real heat-transfer ODEs under the hood.

## Canonical sources (read these first)

- `PHYSICS.md` — equations, calibrated constants, parameter table
- `OPERATIONS.md` — red/yellow/green constraints, ten-mode failure library
- `DESIGN.md` — 8-category variable taxonomy + architecture + roadmap
- `README.md` — user-facing project tour

## Entry points

- `index.html` — **Smoker Almanac** home (default surface). Hipster
  almanac aesthetic (cream paper, Fraunces serif, ember accent). Live
  calculator: 4 sections of inputs (THE CUT / THE FIRE / THE WRAP &
  PULL / THE REST) → 5-dimension quality score (Tenderness, Juiciness,
  Smoke, Doneness, Safety) + diagnostics → schedule with .ics, text,
  share, and a `🔔 Live timer` that fires browser Notifications at
  step boundaries. Uses `menuLibrary` + `qualityModel` + `icsGenerator`.
  No physics ODE solver here — the score is a fast heuristic grounded
  in PHYSICS.md / OPERATIONS.md.
- `pitmaster.html` — the original three-screen physics simulator
  (pregame / cook / score + compare modal). Reachable from the
  almanac via the "Deep mode →" link in the masthead.
- `reminder.html` — legacy redirect to `index.html?preset=brisket-picanha`.
- `js/menuLibrary.js` — hand-tuned schedule templates (`skewers`,
  `wings`, `pork-belly`, `brisket-picanha`). Quick-start chips on the
  home page apply both calculator inputs and the matching template.
- `js/qualityModel.js` — 5-dimension scorer + meat / equipment / wrap /
  wood / rest catalogs + `buildGenericSchedule(cfg, cookHr)` that
  produces a fallback timetable for cuts without a hand-tuned template.
- `js/icsGenerator.js` — turns `(serveAt, source)` → events / RFC 5545
  .ics / shareable text. `source` can be a templateId or an inline
  `{ id, name, name_zh, icon, schedule }` object (so generic schedules
  flow through the same path as presets).
- `.github/workflows/pages.yml` — deterministic Pages deploy on push to
  `main`. Avoids the "Deploy from a branch" Settings cache issues.
- `js/app.js` (pitmaster) — view-model, sim loop (RAF-driven),
  decision-card renderer.
- `js/simulator.js` (pitmaster) — orchestrator; composes the 10
  physics modules.

## Dev

```bash
python3 -m http.server 8000       # static site, zero build step
open http://localhost:8000/
```

Zero runtime deps. Chart.js loaded from CDN.

## Calibration anchors (don't drift these without re-running the 5 regressions)

- `COAL_P_PEAK = 130 W` — `js/constants.js`
- `COAL_TAU_BURN_MIN = 90`
- `UA_PIT_DEFAULT = 5.5 W/K` — `js/pitModel.js`
- `maxFlux = 5.0e-4 kg/m²/s` — `js/heatDiffusion.js`

Target behaviours: 8 coals + 4/45 min refuel → 250 °F pit avg;
stall plateau visible 148–175 °F; foil-wrap @ 150 °F finishes ~9 h.

## Conventions

- Bilingual 中英对照: English primary, Chinese via `<span class="zh">` or
  `<em>` inline. Schedule events carry `title`, `title_zh`, `body`,
  `body_zh`. Decision cards carry `verdict`, `verdict_zh`, `why`,
  `why_zh`, `label_zh`, `hint_zh`.
- Progressive disclosure: planner shows menu + time + button only;
  timeline appears on click. Pitmaster default view hides telemetry,
  manual override, history behind `<details>`. Only primary chart +
  decision cards visible.
- Status over numbers: phase pills (🟡 Stall) and trend arrows
  (▲ +0.3 °F/min) above the big readouts.
- `[hidden] { display: none !important; }` at top of CSS — HTML5 `hidden`
  attribute silently loses to any later `display:` rule, so forcing it
  prevents the modal-close bug we hit.
- IIFE modules attached to `window.SmokerSim.*`. No ES modules, no bundler.
- Schedule offsets are **always relative to serve time** (negative =
  before). The icsGenerator never re-reads wall clock to interpret
  them — `serveAt` is the only anchor. Floating local time in .ics
  output (no TZID, no Z) so cross-timezone imports stay intuitive.
- URL state: home reads `?preset|meat|w|pit|pull|wrap|serve` on load
  and writes them on input change, so a shared link reopens the same
  configured cook.
- Quality scoring is a **fast heuristic**, not the full ODE solver.
  Each scoring function cites the PHYSICS.md section it reflects
  (e.g. `scoreTenderness` ↔ §4 collagen kinetics). The full simulator
  remains available in `pitmaster.html` for the deep dive — it is the
  source of truth and the heuristic must stay numerically close
  (target: ±10 of the full model in nominal scenarios).
- Hipster almanac visual identity: cream paper (`#F4ECDD`), ink
  (`#1F1A14`), ember accent (`#C84B23`), Fraunces serif display +
  Inter body + JetBrains Mono numerics, dotted dividers, double-bordered
  masthead, stamp-style verdict badge. Defined inline in `index.html`
  — `css/styles.css` is the pitmaster theme and is not loaded by the
  almanac.

## Open items / ideas backlog

- Equipment-specific `UA_PIT` (kamado lower, offset higher) — currently
  only equipment-specific std-dev differs.
- 2-node meat (flat + point) for non-uniform brisket prediction.
- Water-pan dynamics as first-class state (currently baked into humidity
  input).
- Fat-cap orientation (up/down) → asymmetric `h` on each side.
- Wind direction (firebox-side wind → overventilation) — currently scalar
  speed.
- PWA service worker for offline use.
- Export cook history to CSV matching the training-data schema in
  `DESIGN.md` §6.

## Deploy

- Pages from `main` branch, root directory
- CNAME: `smoker.0xgarfield.com`
- DNS: `CNAME smoker → djzoom.github.io`

## Session history

Extracted in 2026-04 from a long design session that built the physics
from scratch against Baldwin (CRC Handbook) + Blonder (genuineideas.com),
using `tskunz/Predictive-Pitmaster` as reference. See `DESIGN.md` §6 for
the staged roadmap.
