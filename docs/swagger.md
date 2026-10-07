# Swagger — design plan

**Goal:** give every gorilla a signature move, earned by driving with style.
Celebrations already exist; swagger gives them a job. Showing off fills a
meter; a full meter unlocks the move.

## 1. The meter

One bar per kart, 0–100, shown as a curled-up banana that fills and glows
gold. It sits next to the item slot on the HUD and above each rival's kart as a
small pip when it's full (so you can see the threat coming).

### What fills it

| Action | Swagger | Why |
|---|---|---|
| Airtime: per 0.1 s off the ground (wheels up) | +1 | The bouncy suspension is the game's identity |
| Clean landing (all 4 wheels within 0.15 s, < 15° tilt) | +6 | Rewards controlling the bounce, not just jumping |
| Near miss: passing within 1.2 m of a kart or peel at > 18 m/s | +4 | Risk without contact |
| Snake whack landed | +10 | Combat |
| Someone slips on your peel | +8 | |
| Overtake (position gained, not on a respawn) | +5 | Racing |
| Drafting: within 6 m directly behind a kart for 1 s | +2/s | Gives the pack something to do |
| Late braking: brake hard inside the last 20 m before a corner and make it without a bonk | +4 | Rewards the braking the tracks now demand |
| Parrot landing on the road (not off it) | +6 | |
| Celebrating! (tap the item button within 1 s of a whack/peel hit) | +5 | Players choose to show off — the gorilla does its move in the seat |

### What drains it

- **Bonks:** a wall hit costs 10.
- **Spin-outs:** a peel or whack costs 15. Swagger is confidence; getting embarrassed knocks it.
- **Respawns:** cost 25.
- **Idling:** a full meter doesn't drain on its own. It just waits, so you choose the moment.

**Tuning target:** a decent driver fills it about **once per lap**, an excellent one about twice. A field of 8 should see a signature move roughly every 10–15 s, which is lively without becoming noise. Measure it with telemetry: swagger per lap, by AI level.

## 2. Triggering

- **Button:** a new **Swagger** button, held for 0.3 s so it isn't triggered by accident.
  - Keyboard: **F**.
  - Pad: **X**, or both shoulders together.
  - Touch: a gold button that appears above the item button when the meter is full.
- **On use:** the gorilla stands up in the seat and does its celebration (the existing animations), and the move fires at the peak of the pose (~0.35 s in). The short wind-up is deliberate: rivals see it coming and can react.
- **Use limits:** usable while airborne, but not during spin-out or parrot flight.

## 3. The eight signature moves

Each one should feel like the character, be readable at a glance, and be counterable.

| Gorilla | Move | Effect | Counter |
|---|---|---|---|
| **Big Boris** | **Roar** (chest-pound) | A shockwave ring 12 m wide: karts inside wobble for 1.2 s and drop held bananas as peels | Be out of range, or airborne |
| **Koko Loco** | **No Brakes** (windmill) | 2.5 s of boost that ignores corner grip limits: no understeer, no bonk penalty | Peels still work on him |
| **Professor Tumbles** | **Slow Clap** | Every kart within 25 m ahead is slowed to 70% top speed for 2 s, reading the "applause" | Be behind him |
| **Mama Mango** | **Feed the Troop** (wave) | Drops a bunch of 3 bananas behind her as *pickups*. Also refills her own item slot with a banana bunch | Grab them first |
| **Tiny Tank** | **Pogo** (jump) | A huge bounce: 4 m of airtime from flat ground. Hops gaps, rivals, peels and lava edges | Timing: too early or late wastes it |
| **DJ Banana** | **Drop the Beat** (scratch) | Rivals within 30 m get swapped steering (left is right) for 1.5 s, with a visible beat ring | Brake and wait it out |
| **Smooth Steve** | **Too Cool** (finger guns) | 3 s of total immunity: peels, whacks, bonks and lava ignore him; passing karts get shoved aside | None, but it's short |
| **Granite Gus** | **Boulder** (flex) | Curls into a rolling rock for 2.5 s: heavier, unstoppable, bowls karts aside, smashes a fallen tree's crown flat | Get out of the way |

**Balance principles:**
- **Short durations** (1.2–3 s), so a move swings a moment, not a race.
- **Comeback lean:** the further back you are, the faster you earn swagger (×1.0 in 1st, up to ×1.5 in 8th). Leaders still earn it, just slower. Same spirit as the light rubber-banding.
- **No move wins outright.** Each must have a counter or a cost, listed above.
- **Readable:** every move has a wind-up, a sound sting, a colour flash on the kart, and a HUD callout naming it ("BORIS ROARS!").

## 4. AI use

Driven by the AI `level` and `itemIQ` that already exist:

- **Rookies** fire it as soon as it's full, often wasting it (Boris roaring at nobody, Tiny pogoing on a straight).
- **Aces** fire it when it pays off:

| Gorilla | When the AI fires it |
|---|---|
| Boris | 2+ karts within 12 m |
| Professor Tumbles, DJ Banana | someone close ahead |
| Tiny Tank | a gap, peel or hazard coming up |
| Steve | a peel field ahead, or the lava within 40 m |
| Gus | stuck in a pack, or the tree crown ahead |
| Koko Loco | before a corner run |
| Mama Mango | holding no item |

## 5. Build order

1. **Sim meter** (`sim/swagger.ts`): accrual and drain events, per-kart value, deterministic, with unit tests per rule. Telemetry gets "swagger per lap by level". *(About a day.)*
2. **HUD meter, rival pips and the Swagger button** (keyboard, pad, touch), with the celebration on use and no effect yet. Playtest how often the meter fills.
3. **Moves, simplest first:**
   - Pogo (an impulse).
   - Too Cool (immunity flags).
   - No Brakes (grip override).
   - Boulder (mass and shove).
   - Roar (an area wobble).
   - Slow Clap and Drop the Beat (area effects on rivals' input and engine).
   - Feed the Troop (spawns pickups).

   Each move gets a sim test: effect, duration, counter.
4. **AI usage rules**, then the telemetry check that no single gorilla wins disproportionately. Run 50 seeded races per track and compare win rates by character at equal AI level; flag anyone over 1.5× the average.
5. **Polish:** sound stings, kart flash, callouts, a short slow-mo zoom on your own move (0.25 s), and a stats line on the results screen ("Swagger: 4 moves").

## 6. Decisions (agreed)

- **One charge.** A full meter is one use, and it doesn't bank. Once full, extra swagger is wasted, so use it.
- **Separate slot.** Swagger has its own meter and button, independent of the item slot. You can hold a snake *and* a full meter.
- **Toggle.** A "Swagger: On / Off" option on the select screen (next to Rivals), saved like difficulty. With it off, there's no meter, no button and no AI moves: pure racing.
