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

- `index.html` — three screens: pregame / cook / score + compare modal
- `js/app.js` — view-model, sim loop (RAF-driven), decision-card renderer
- `js/simulator.js` — orchestrator; composes the 10 physics modules

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
  `<em>` inline. Decision cards carry `verdict`, `verdict_zh`, `why`,
  `why_zh`, `label_zh`, `hint_zh`.
- Progressive disclosure: default view hides telemetry, manual override,
  history behind `<details>`. Only primary chart + decision cards visible.
- Status over numbers: phase pills (🟡 Stall) and trend arrows
  (▲ +0.3 °F/min) above the big readouts.
- `[hidden] { display: none !important; }` at top of CSS — HTML5 `hidden`
  attribute silently loses to any later `display:` rule, so forcing it
  prevents the modal-close bug we hit.
- IIFE modules attached to `window.SmokerSim.*`. No ES modules, no bundler.

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
