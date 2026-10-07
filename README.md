# Jungle Jalopies

Eight gorillas. Junk karts. Too many bananas.

A 3rd-person kart racer for the browser (desktop and phone). Race seven AI
gorillas over three laps: bouncy suspension, kicker ramps, banana boosts and
Road Rash-style snake whacks. The corners want braking — overcook one and you
slide into the logs.

- **Vine Valley** — sunny and fast, with a river gap to clear.
- **Canopy Creek** — deep under a full jungle canopy; tight turns and a creek to ford twice.
- **Treetop Tangle** — thirty metres up along giant branches; tree-to-tree leaps and no railing on the bare stretches.

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
| Pause | Esc | Start | — |

## Items
- **Banana bunch** (floats over a yellow ring): three bananas. Each is a 3 s
  boost and drops a peel behind you. Peels stay until someone hits one.
- **Snake** (green ring): three swings, left or right, at whoever is alongside.
- **Parrot** (blue ring): a giant macaw carries you for 6 s. Steer and set the pace;
  fly over peels and snakes, or cut straight across the infield to a later part of the lap.
- One item at a time — a full hand drives straight through pickups.

Every gorilla has their own celebration: on the select screen, on the
finish podium for the top three, and in the seat when their snake or peel
gets someone.

See `CLAUDE.md` for architecture and how to check changes.
