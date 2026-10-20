# Jungle Jalopies — working notes

A browser kart racer: 3rd-person chase cam, eight gorillas in junk karts,
bouncy suspension, twisty jungle tracks full of ramps, banana boosts and snake
whacks. Built on RSC's base setup (`../RSC`): same stack, same layering rules.

## Stack
TypeScript, three.js (render), Rapier (physics, wasm inlined), Vite, Vitest,
Playwright. Deploys to GitHub Pages (`.github/workflows/pages.yml`).

## Layering (do not break)
`data → sim → net → game | render | audio → ui → main`

- `src/sim/` is the whole simulation: **no three.js, no DOM, no Math.random**
  (use `sim/rng.ts`). A race is a pure function of seed + inputs — that is what
  the tests rely on and what online multiplayer will rely on later.
- `src/render/` only reads sim state. `src/game/session.ts` turns sim events
  into effects, sound and HUD callouts.
- `src/net/` is online play (docs/multiplayer.md): pure TS like sim, except
  `net/peer.ts` (WebRTC via PeerJS, browser only).
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
- `npm run levels` — clean solo lap time per AI level (0 rookie … 1 ace) on each track.
- With `npm run dev` running: `npm run shoot`, `npm run shoot:mobile`,
  `npm run racecheck` (full 1-lap autopilot race to the results screen).
  Screenshots land in `shots/`.
- URL switches for dev: `?laps=1`, `?autopilot`, `?give=parrot|banana|snake`,
  `?room=1234` (invite link), `?peer=localhost:9000` (local signalling server).
- Online: `npm run netsim -- --players=7 --profile=4g` — headless host + phones over a
  simulated network (results agreement, host-copy error, bandwidth). Run after any sim
  or net change. `npm run peer` + `npm run dev`, then `npx tsx tools/netcheck.ts`:
  two Chromium pages race over real WebRTC (`CHROMIUM=path` for a non-Playwright browser).

## Things that bit us (keep them fixed)
- Wheel rays ignore barriers and other karts (collision groups in `sim/kart.ts`):
  raycast wheels standing on logs or karts let karts climb barriers and stack.
- Each kart has an invisible skirt collider (karts only) under its high chassis,
  so pile-ups push apart instead of riding up on each other.
- The track builder relaxes any corner tighter than half the road width + 2.5 m;
  sharper and the inside edge folds and barrier boxes poke across the road.
- Tracks live in `src/data/tracks/` (`index.ts` lists them, `looks.ts` styles them).
  A `TrackDef` can be `open` (point to point: `Track.closed` false, `startS`/`finishS`;
  `wrap`/`delta`/`between` clamp instead of wrapping), `elevated` (branches: crowned
  road via `surfaceDrop`, no skirts), have `terrain` (sim/terrain.ts: physics + render
  ground from a height function) and `lava` (sim/lava.ts: a front that DNFs karts it
  catches on the ground; parrot flight is safe until you land).
- `terraces` features (Coconut Cove's treetops): a run of flat platforms, each a drop
  below the last, levels taken from the spline. Platforms flare wide where karts land
  and taper to the next ledge; barriers there are taller (`WALL_ALOFT_HEIGHT`) because
  landings rebound; terrain stays low under them (`Track.aloft`). Respawns are kept
  clear of every gap's far edge — put down there, a kart tipped back off forever.
- Shaped terrain without `lava` renders as a coast (`coastColour`, sea); with it, the
  volcano. `TrackLook.shoreline` keeps scenery out of the sea.
- Mid-race track changes live in `sim/events.ts` (definitions + timing by leader
  lap); `RaceSim.applyEvent` makes them physical (new hulls, rebuilt road collider,
  disabled barrier colliders, wider `waters`, `track.brush`). The renderer reads
  `sim.events` — it has its own `Track` instance, so never read mutable track
  state from the render copy during a race.
- Leaving the page (hidden/blur/pagehide) suspends audio and pauses the race.
- Phones go fullscreen on a tap (`ui/fullscreen.ts`: the Fullscreen API needs a
  gesture; touchend/click count, pointerdown doesn't). iPhone Safari can't: the manifest
  (`public/manifest.webmanifest`) and apple meta tags make a home-screen launch fullscreen.
- Coconuts (`sim/items.ts`) are the one projectile: they fly in the sim (`Items.coconuts`,
  stepped on every phone so they can be drawn) but only the host decides hits (`conk`).
  `Items.shot` flies each bend against karts carried on along their velocity — the AI
  only throws when one connects, and the item button bends toward that kart. A client
  launches other karts' coconuts from the host's `throw` event and plays its own drops.
- Swagger lives in `sim/swagger.ts` (meter, earnings/costs, hold → wind-up → move,
  `goodMoment` for the AI). Moves come from `RaceOptions.moves` (roster order =
  `MOVES`). Overtakes only pay once a place is held 0.6 s (side-by-side karts
  swapping places every step used to farm it).
- Trees are placed in `sim/props.ts` (seeded) and shared by render and sim. Only trees
  within `TREE_REACH` of the road are solid, baked into ONE trimesh collider —
  hundreds of separate Rapier colliders cost ~60% more per physics step.
- Road widths are scaled once by `WIDTH_SCALE` in `sim/track.ts`; track data stays
  in its original units.
- Narrow and wide stretches are `width` features (`WidthDef`: width, length, taper).
  Corners are rounded for the wider of the usual width and the stretch, so narrowing
  never sharpens a corner. Full-width ramps and pickup lanes follow the local width
  (`Track.kickerHalf`). `tests/track.test.ts` checks part-width ramps and pickups stay
  on the road and separate stretches never overlap. Keep chokes off chicanes and
  out of jump landings: both multiplied respawns in telemetry.
- Particles: `render/fx.ts` is the cheap pooled point cloud for most puffs;
  `render/vfx.ts` (three.quarks 0.16 — the last release that supports three 0.169)
  does the showpieces: bursts from round-robin pools (sparks, dust rings, whack
  stars and fur, banana bits, fireworks), per-kart trails whose rate the game sets
  every frame (`Game.kartTrails`: boost, tyre and No Brakes smoke, wall-scrape
  sparks, boulder grit, Too Cool glitter, parrot feathers), leaves/embers ahead of
  the camera (`TrackLook.leaves`/`embers`), waves over a coast's ford
  (`waveSpray`) and podium confetti. Kart-on-kart sparks are spotted from the
  views (`Game.kartSparks`; the sim has no event, and online karts are proxies).
  Emitters must stay under the Scene: three.quarks disposes a system whose
  emitter has no Scene ancestor. Particles are render-only — never in the sim.
- Roadside palms and broadleaf trees are built in `render/flora.ts` (fronds of single
  leaflet triangles, lumpy leaf clumps) and instanced by `trackView.scenery`; keep them
  inside the trunk/crown envelopes `sim/props.ts` makes solid. Karts (`render/kartModel.ts`)
  have seats and stub axles; never leave two faces flush (the crate's slats flickered).
- Looks: `render/polish.ts` (rim light, ink outlines on desktop, contact shadows,
  clouds/sun, roadside tufts); `Stage.render` runs bloom + grade + vignette on
  desktop only (`Quality.post`). Headless SwiftShader is very slow with post on —
  use a phone viewport (`--mobile`) for quick visual checks.
- `npx tsx tools/looks.ts <tag>` shoots every track at a fixed moment; `tools/sheet.ts` tiles shots.
- AI skill: every derived trait comes from `Personality.level`; a field's levels come
  from `fieldLevels(difficulty)`. Tools/tests that need a *good* driver pass level 1
  explicitly — the default personality is a mid-field driver.
- Lap progress normally only searches ±40 m of the last position (no shortcuts).
  During a parrot flight (+2.5 s) it searches the whole lap, accepting forward
  jumps up to `PARROT.maxSkip` of a lap per flight, so flying shortcuts count
  but can't be chained into a lap.

- Online, one player's phone hosts (`net/host.ts`, `RaceOptions.role`): each phone
  drives its *own* kart's physics; the host owns items, hits, laps, events, lava and
  AI. Other phones' karts are **proxies** (`Kart.setProxy`): kinematic, **no
  collider** — a kinematic body jerked by network updates crushed karts against
  walls and launched them at 300 m/s. Karts get a soft push off proxies instead
  (`RaceSim.bumpProxies`). Solo races never create proxies.
- An online race never pauses: the pause menu and a backgrounded phone hand the kart to
  the AI (host side after `AWAY_AFTER`; the client takes it back via the epoch).
- Bump `PROTOCOL` in `net/protocol.ts` when messages or race-building change.

## Conventions
- Every source file opens with a comment saying why it exists.
- Prefer numbers (headless runs) before screenshots when tuning.
- Python edits on Windows: always pass `encoding='utf-8'`.
