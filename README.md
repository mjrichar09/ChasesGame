# Jungle Jalopies

Eight gorillas. Junk karts. Too many bananas.

A 3rd-person kart racer for the browser (desktop and phone). Race seven AI
gorillas over three laps of **Vine Valley**: bouncy suspension, kicker ramps,
a river gap, banana boosts and Road Rash-style snake whacks.

## Play
```
npm install
npm run dev        # http://localhost:5174
```

| | Keyboard | Pad | Touch |
|---|---|---|---|
| Drive / brake | W S / ↑ ↓ | RT / LT | automatic gas, BRAKE button |
| Steer | A D / ← → | left stick | drag on the left half |
| Banana (or snake) | Space | A | 🍌 button |
| Whack left / right | Q / E | LB / RB | 🐍 buttons |
| Pause | Esc | Start | — |

## Items
- **Banana bunch** (floats over a yellow ring): three bananas. Each is a 3 s
  boost and drops a peel behind you. Peels stay until someone hits one.
- **Snake** (green ring): three swings, left or right, at whoever is alongside.
- One item at a time — a full hand drives straight through pickups.

See `CLAUDE.md` for architecture and how to check changes.
