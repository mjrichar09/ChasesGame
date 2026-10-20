# Jungle Jalopies

Eight gorillas. Junk karts. Too many bananas.

A 3rd-person kart racer for the browser (desktop and phone). Race seven AI
gorillas over three laps: bouncy suspension, kicker ramps, banana boosts,
Road Rash-style snake whacks and flung coconuts. The corners want braking — overcook one and you
slide into the logs.

- **Vine Valley** — sunny and fast: a broad start straight, a single-file squeeze through the ferns, and a river gap to clear.
- **Canopy Creek** — deep under a full jungle canopy; tight turns, narrow hairpins and a creek to ford twice (the first ford is wide — pick your line).
- **Treetop Tangle** — thirty metres up along the tops of giant branches; broad boughs, a tightrope branch, tree-to-tree leaps and no railing on the bare stretches.
- **Coconut Cove** — climb a jungle ridge, drop off it onto three treetop platforms in a row, each one lower than the last, then swoop down a headland onto the beach and race round a sandy cove with waves washing over the road.
- **Lava Run** — the volcano is erupting: race point to point from the broad crater rim, along narrow ledges, down to the village with the lava
  chasing you. It is a little slower than a clean run and much faster than a crash. Caught is out.

The jungle changes mid-race: on Vine Valley a giant tree crashes across the road
on lap 2 (pick the side its crown didn't land on), Canopy Creek's creek floods on
laps 2 and 3 (hit the water fast and straight to **skim** across the top — slow down or swerve and you wade), and on Treetop Tangle a cracked branch snaps off on lap 3 — leaving
a new gap with the broken stub as a ramp.

On a phone the game goes **fullscreen** at the first tap (Android, iPad). On an
iPhone, use Share → **Add to Home Screen** to play fullscreen.

**Play online** with up to 8 friends: one phone hosts a room and shares its
4-digit code (or an invite link); AI gorillas fill the empty karts. No accounts, no
server to run — phones connect directly over WebRTC. See `docs/multiplayer.md`.

Pick your rivals: **Chill**, **Normal** or **Wild**. Every field is a spread of skill, from rookies
who brake early, wobble and waste their items to an ace or two who don't.

## Play
```
npm install
npm run dev        # http://localhost:5174
```

| | Keyboard | Pad | Touch |
|---|---|---|---|
| Drive / brake | W S / ↑ ↓ | RT / LT | GAS / BRAKE buttons |
| Steer | A D / ← → | left stick | drag on the left half |
| Banana (or snake) | Space | A | 🍌 button |
| Whack (or fling a coconut) left / right | Q / E | LB / RB | 🐍 / 🥥 buttons |
| Swagger move (hold) | F | X | gold ★ button (pops up left of the snake buttons when the meter is full) |
| Look back | C (hold) | Y | — |
| Pause / quit | Esc | Start | ⏸ button |

## Items
- **Banana** (floats over a yellow ring): one per pickup — drive through more to
  stack up to three. Each is a 3 s
  boost and drops a peel behind you. Brake (or hit a wall) to call a boost off.
  Peels stay until someone hits one, and spin you toward the side they were on.
- **Snake** (purple ring): three swings, left or right, at whoever is alongside —
  a hit takes most of their speed, fishtails them and slows them for a couple of seconds.
- **Coconut** (orange ring): one throw, flung sidearm at whoever is in front — up
  to six kart lengths ahead. Q / E (or the left / right buttons) bend it left or
  right; the item button throws it straight, or bends it toward the nearest kart.
  A hit costs half your speed and leaves you wobbling.
- **Parrot** (blue ring): a giant macaw carries you for 6 s. Steer and set the pace;
  fly over peels and snakes, or cut straight across the infield to a later part of the lap.
- One item at a time — a full hand drives straight through pickups.

**Swagger.** Drive with style — big air, clean landings, near misses, overtakes,
drafting, late braking, landing hits — to fill the swagger meter (bonks, spins and
respawns drain it). Full? Hold **F** (pad X, or the gold ★ on touch) for your
gorilla's signature move:

| Gorilla | Move |
|---|---|
| Big Boris | **Roar** — karts within 20 m are blasted back, fishtail and drop their bananas |
| Koko Loco | **No Brakes** — boost with grip to spare and no wall penalty |
| Professor Tumbles | **Slow Clap** — karts just ahead lose 30% pace |
| Mama Mango | **Feed the Troop** — leaves bananas on the road, refills her hands |
| Tiny Tank | **Pogo** — a huge bounce over gaps, peels and rivals |
| DJ Banana | **Drop the Beat** — rivals' steering swaps for 3 s |
| Smooth Steve | **Too Cool** — 3 s immune to everything, lava included |
| Granite Gus | **Boulder** — rolls as a heavy rock that shoves karts aside |

Swagger can be switched off on the select screen for pure racing.

Every gorilla has their own celebration: on the select screen, on the
finish podium for the top three, and in the seat when their snake or peel
gets someone.

See `CLAUDE.md` for architecture and how to check changes.
