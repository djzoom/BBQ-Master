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

- `index.html` — **planner home** (default surface). Single-page flow:
  pick a cook → pick a serve time → render timeline + .ics calendar +
  text/share. Uses `js/menuLibrary.js` + `js/icsGenerator.js` only — no
  physics modules loaded here.
- `pitmaster.html` — the original three-screen physics simulator
  (pregame / cook / score + compare modal). Linked from the planner
  via the ⚙️ icon for the deep-dive crowd.
- `reminder.html` — legacy redirect to `index.html?menu=brisket-picanha`
  (kept so external links survive).
- `js/menuLibrary.js` — schedule templates (`skewers`, `wings`,
  `pork-belly`, `brisket-picanha`). Add new cooks here, in
  `TEMPLATE_ORDER`, and they appear on the home grid.
- `js/icsGenerator.js` — turns `(serveTime, templateId)` into events
  / RFC 5545 .ics / shareable text. Reads from `menuLibrary`.
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
- URL state: planner reads `?menu=<id>&serve=<datetime-local>` on load
  and writes them on selection, so a shared link reopens the same plan.

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
