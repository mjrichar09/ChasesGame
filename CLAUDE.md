# Jungle Jalopies — working notes

A browser kart racer: 3rd-person chase cam, eight gorillas in junk karts,
bouncy suspension, twisty jungle tracks full of ramps, banana boosts and snake
whacks. Built on RSC's base setup (`../RSC`): same stack, same layering rules.

## Stack
TypeScript, three.js (render), Rapier (physics, wasm inlined), Vite, Vitest,
Playwright. Deploys to GitHub Pages (`.github/workflows/pages.yml`).

## Layering (do not break)
`data → sim → game | render | audio → ui → main`

- `src/sim/` is the whole simulation: **no three.js, no DOM, no Math.random**
  (use `sim/rng.ts`). A race is a pure function of seed + inputs — that is what
  the tests rely on and what online multiplayer will rely on later.
- `src/render/` only reads sim state. `src/game/session.ts` turns sim events
  into effects, sound and HUD callouts.
- All kart, item and race numbers live in `src/data/tuning.ts`.
- Inputs are *held* state (`DriverInput`); karts detect button presses
  (rising edges) inside the sim. Never pass one-shot "pressed" flags.
- Kart frame: right-handed, Y-up, nose +Z, local +X is the kart's **left**.
  `steer` is driver-frame (+ = right) and is negated once, in `sim/kart.ts`.

## Checking a change
- `npm test` — the gate for every change (determinism, laps, items, full AI race).
- `npm run telemetry` — headless 8-kart race: lap times, respawns (and why), airtime.
  Run after any physics, track or AI change; respawns should stay low.
- `npm run braking` — one kart per track at several corner commitments vs flat-out.
  Braking must beat flat-out (a test enforces it); re-run after tuning or layout edits.
- `npm run trackcheck` / `npm run trackmap` — layout sanity (overlaps, inside-edge
  clearance) and a plan-view PNG per track in `shots/`.
- `npm run celebrations` — every gorilla's celebration, screenshotted (dev server running).
- With `npm run dev` running: `npm run shoot`, `npm run shoot:mobile`,
  `npm run racecheck` (full 1-lap autopilot race to the results screen).
  Screenshots land in `shots/`.
- URL switches for dev: `?laps=1`, `?autopilot`.

## Things that bit us (keep them fixed)
- Wheel rays ignore barriers and other karts (collision groups in `sim/kart.ts`):
  raycast wheels standing on logs or karts let karts climb barriers and stack.
- Each kart has an invisible skirt collider (karts only) under its high chassis,
  so pile-ups push apart instead of riding up on each other.
- The track builder relaxes any corner tighter than half the road width + 2.5 m;
  sharper and the inside edge folds and barrier boxes poke across the road.
- Tracks live in `src/data/tracks/` (`index.ts` lists them, `looks.ts` styles them).

## Conventions
- Every source file opens with a comment saying why it exists.
- Prefer numbers (headless runs) before screenshots when tuning.
- Python edits on Windows: always pass `encoding='utf-8'`.
