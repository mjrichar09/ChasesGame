# Jungle Jalopies

Eight gorillas. Junk karts. Too many bananas.

A 3rd-person kart racer for the browser (desktop and phone). Race seven AI
gorillas over three laps: bouncy suspension, kicker ramps, banana boosts and
Road Rash-style snake whacks. The corners want braking — overcook one and you
slide into the logs.

- **Vine Valley** — sunny and fast, with a river gap to clear.
- **Canopy Creek** — deep under a full jungle canopy; tight turns and a creek to ford twice.
- **Treetop Tangle** — thirty metres up along the tops of giant branches; tree-to-tree leaps and no railing on the bare stretches.
- **Lava Run** — the volcano is erupting: race point to point down the mountain with the lava
  chasing you. It is a little slower than a clean run and much faster than a crash. Caught is out.

The jungle changes mid-race: on Vine Valley a giant tree crashes across the road
on lap 2 (pick the side its crown didn't land on), Canopy Creek's creek floods on
laps 2 and 3 (hit the water fast and straight to **skim** across the top — slow down or swerve and you wade), and on Treetop Tangle a cracked branch snaps off on lap 3 — leaving
a new gap with the broken stub as a ramp.

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
| Whack left / right | Q / E | LB / RB | 🐍 buttons |
| Swagger move (hold) | F | X | gold ★ button (pops up left of the snake buttons when the meter is full) |
| Look back | C (hold) | Y | — |
| Pause / quit | Esc | Start | ⏸ button |

## Items
- **Banana** (floats over a yellow ring): one per pickup — drive through more to
  stack up to three. Each is a 3 s
  boost and drops a peel behind you. Peels stay until someone hits one.
- **Snake** (green ring): three swings, left or right, at whoever is alongside.
- **Parrot** (blue ring): a giant macaw carries you for 6 s. Steer and set the pace;
  fly over peels and snakes, or cut straight across the infield to a later part of the lap.
- One item at a time — a full hand drives straight through pickups.

**Swagger.** Drive with style — big air, clean landings, near misses, overtakes,
drafting, late braking, landing hits — to fill the swagger meter (bonks, spins and
respawns drain it). Full? Hold **F** (pad X, or the gold ★ on touch) for your
gorilla's signature move:

| Gorilla | Move |
|---|---|
| Big Boris | **Roar** — karts nearby wobble and drop their bananas |
| Koko Loco | **No Brakes** — boost with grip to spare and no wall penalty |
| Professor Tumbles | **Slow Clap** — karts just ahead lose 30% pace |
| Mama Mango | **Feed the Troop** — leaves bananas on the road, refills her hands |
| Tiny Tank | **Pogo** — a huge bounce over gaps, peels and rivals |
| DJ Banana | **Drop the Beat** — rivals' steering swaps for 1.5 s |
| Smooth Steve | **Too Cool** — 3 s immune to everything, lava included |
| Granite Gus | **Boulder** — a heavy rolling rock that shoves karts aside |

Swagger can be switched off on the select screen for pure racing.

Every gorilla has their own celebration: on the select screen, on the
finish podium for the top three, and in the seat when their snake or peel
gets someone.

See `CLAUDE.md` for architecture and how to check changes.
