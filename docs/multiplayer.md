# Online multiplayer — plan

Status: **proposal, nothing built yet.** This document records the decisions and the order of work so
each step can be reviewed and tested before the next one starts.

Goal: 2–8 people race each other online, phones first and desktop as well, on any of the
existing tracks. Empty seats get AI gorillas. It has to feel as good as single player on a
4G phone with a 100–200 ms round trip, and it must not break the solo game.

---

## 1. The key decision: who is in charge of what

### Options considered

| Model | How it works | Why not (for this game) |
|---|---|---|
| **Lockstep / rollback (GGPO)** | Every device runs the whole race from the same inputs. Rollback re-runs the last few frames when late inputs arrive. | Needs **bit-identical** results on every device. The sim calls `Math.sin/cos/atan2/hypot` (45 call sites), and iOS Safari (JavaScriptCore) and Chrome (V8) don't promise identical results for those. Rapier's standard `-compat` build doesn't promise cross-platform determinism either. On top of that, rollback re-runs 8 karts of Rapier physics several times per frame, and phones can't afford that at 120 Hz. One desync ends the race. |
| **Full server authority + prediction with rewind** (the Rocket League model) | The server simulates everything. Each client predicts its own kart, then rewinds and replays its inputs when a snapshot disagrees. | A Rapier world can't be rewound cheaply: `takeSnapshot()` also serialises the road and tree trimeshes. Long-travel, bouncy suspension diverges quickly, so on 4G the player would feel constant corrections. |
| **P2P, one player's phone hosts** | Same as below, but the host is a player's device, connected over WebRTC. | No server bill, but the race dies when the host locks their phone (iOS suspends the tab). Cellular NAT needs TURN servers anyway. The host's phone also does twice the work. Worth keeping as a later option for LAN / couch play. |
| **Server-authoritative race, client-authoritative own kart** ✅ | Each phone drives its own kart physics locally. The server runs the official race (items, hits, laps, events, AI, lava) and checks that each kart's reported motion is plausible. | **Recommended.** This is the usual model for kart racers. |

### Recommended model

- **Your own kart moves on your device, immediately.** Driving never waits on the network, so
  4G latency never touches steering, drifting, jumps or suspension.
- **Everything shared is decided once, on the server:** item rolls, peel and snake hits, swagger
  moves, mid-race track events, laps and positions, the finish, lava DNFs, and the AI fill-ins.
  The server runs the existing headless `RaceSim` in Node, the same code `npm test` and
  `npm run telemetry` already run.
- **Other karts are shown about 100 ms in the past**, interpolated between server snapshots, so
  they move smoothly. On your device they are solid kinematic bodies, so you can still bump them.
- **The server checks reported motion** against speed caps, a teleport limit, progress continuity
  and the kart's status (it can't boost without a banana). A report that fails is clamped; repeated
  failures put the kart back on the server's version.

Determinism still matters. It keeps the tests repeatable, gives free replays (seed + input log), and
means server and clients agree on track layout, props and item spots without sending them.
Nothing depends on two different JS engines agreeing to the last bit.

### Who decides what

| Thing | Authority | Latency hiding on the client |
|---|---|---|
| Own kart position/velocity | **Client** (server validates) | none needed |
| Status effects on own kart (spin, wobble, slow, swapped steering) | **Server** decides; client applies on receipt | Spins start ~RTT/2 late, from where you actually are |
| Item pickups | **Server** | Client predicts the pickup ring vanishing and starts the **item roulette** at once. The server's roll arrives during the roulette (MK-style latency hiding) |
| Eating a banana (boost) | Client predicts while the server-mirrored inventory says there are charges; server confirms | Instant boost, rolled back if refused |
| Hitting a peel | **Client** reports "hit peel #id" (it sees exactly where it drove); server checks the distance | Instant spin |
| Snake whacks, swagger moves on others | **Server**, using its own positions | Swing animation plays at once; the hit callout arrives with the server event |
| Laps, positions, finish, DNF | **Server** | HUD shows predicted lap ticks; position comes from the server |
| Track events (tree fall, flood, snap) | **Server**, by leader lap | Already timed with warnings, so no change needed |
| Parrot flight | Client flies, server validates the shortcut via the existing `PARROT.maxSkip` rule | none needed |

---

## 2. Architecture

### New layering

```
data → sim → net → game | render | audio → ui → main
                 ↘ server/   (Node: data + sim + net only)
```

- `src/net/` is pure TS with **no DOM, no three.js, no Node APIs**, shared by browser and server:
  - `protocol.ts`: message types and a `PROTOCOL_VERSION`. A client and server that disagree on the
    version refuse to connect and tell the player to reload.
  - `codec.ts`: compact binary encoding using `DataView`, with quantised floats and a smallest-three
    quaternion.
  - `snapshot.ts`: takes a snapshot from a `RaceSim` and applies one to it, plus the interpolation
    buffer.
  - `clock.ts`: server-time estimate (NTP-style pings, median filter) and the adaptive
    interpolation delay.
  - `transport.ts`: a `Transport` interface with a WebSocket implementation and an **in-memory
    implementation that adds latency, jitter and loss** for tests and tools.
- `server/` is the Node entry point: an HTTP health check, a WebSocket endpoint, rooms, and a
  120 Hz fixed loop per racing room. It runs the same `RaceSim`, plus `AiDriver` for empty or
  away seats.
- `src/game/` gets a `RaceSource` interface. Today's code becomes `LocalRace`, and a new `NetRace`
  feeds views, HUD and effects through the same interface. `session.ts` stops assuming
  `sim.step()` + `this.player` and asks the source for the race state, the local seat, and the
  events to play out.

### Sim changes (small, behaviour-preserving for solo)

1. `Kart.mode: 'driven' | 'proxy'`. A proxy is a kinematic body moved from snapshots: other
   players' karts on a client, and the server's copy of a human kart, which follows that kart's
   reports. Collision groups stay the same, so skirts and barrier rules still apply.
2. Status effects move into one `applyEffect(kart, effect)` function, called by `Items`,
   `swagger.ts` and the client when a server event arrives.
3. `RaceSim.step` gets a hook so it can skip `kart.step` for proxies, and so the server's
   `track1` (laps, respawns, lava) runs on the reported positions.
4. Respawns stay client-side for your own kart, because `fell`, `offTrack` and `stuck` depend on
   your own physics. The server checks that the spot is a real `safeS`.
5. Kart state serialisation (`net/snapshot.ts`), tested as a round trip. The determinism test
   still passes untouched.

### Messages (binary over a WebSocket)

| Direction | Message | Rate | Size |
|---|---|---|---|
| C→S | `input`: held `DriverInput` + own kart state (pos, quat, linvel, angvel, flags) + client tick + last snapshot ack | 30 Hz (every 4th sim step) | ~60 B |
| C→S | `claim`: peel hit / pickup / item use / respawn | on event | ~16 B |
| S→C | `snapshot`: server tick, 8 × kart (pos, quat, vel, status bits, item, swagger, progress), new/removed peels & loose bananas, lava | 30 Hz | ~350 B (≈ 10 KB/s) |
| S→C | `events`: the existing `ItemEvent`s (pickup, whack, swagger, track, toasted…) with ticks | on event | small |
| both | `ping`/`pong`, lobby messages (JSON is fine here) | 1 Hz / rare | — |

Downstream traffic is about 10 KB/s per player, roughly **4–5 MB for a 7-minute race**, which is
fine on mobile data.

**Transport:** start with WebSocket. It works everywhere, including iOS Safari and captive
networks, and it is simple. Because inputs are *held state*, a late packet is replaced by the next
one, so TCP's head-of-line stalls only cost smoothness. The adaptive interpolation delay soaks most
of that up. The `Transport` interface leaves room for WebTransport datagrams later, once every
target browser supports them.

### Server capacity

Measured headless (Node 22, this container): **~1.5 ms per 120 Hz step for a full 8-kart race
including AI**, which is ~18% of one core per room. A small 1-vCPU instance comfortably runs
3–4 simultaneous races. Proxy karts are cheaper than AI karts, so human-heavy rooms cost less.

---

## 3. Player flow (mobile first)

1. **Title → "Play online"** next to the solo race.
2. **Create room** gives a 4-letter code (no look-alike letters), a **Share** button (Web Share API
   on phones; copy-link on desktop), and a QR code on desktop so a phone on the sofa can scan in.
   A link like `…/?room=KBZQ` opens straight into the room.
3. **Room screen:** the players with their gorillas (each gorilla once, first come first served),
   a nickname (stored locally, 12 chars, filtered), and a ready toggle. The host picks the track,
   laps, rival difficulty for AI fill-ins and swagger on/off; everyone else sees the settings.
   Start needs everyone ready, or the host forces it after a timeout.
4. **Race:** the server-timed countdown begins at the same moment for everyone (start time sent in
   server time). Humans are placed on the grid randomly, or by the last race's results on a rematch.
5. **Finish:** your result shows at once, then a live leaderboard as others finish. Spectate the
   remaining racers with the chase cam. The results screen offers **Rematch** (same room) and
   **Leave**.

### Phone-specific handling

- **Backgrounding doesn't pause an online race.** The current behaviour (pause on
  hidden/blur/pagehide) stays for solo. Online, the kart is marked *away* and an AI driver
  (`AiDriver`, mid level) takes over after 1 s with no input. When you come back, the server's
  state is applied and you drive again. The HUD shows a small "🤖 was driving" note.
- **Reconnect:** a seat token is kept in `sessionStorage`. Switching between Wi-Fi and 4G, or a
  dropped socket, reconnects with exponential backoff, and the player keeps their seat for the
  whole race.
- **Screen Wake Lock** while racing online, so the phone doesn't dim mid-race.
- **Network indicator:** a small signal-bars icon from RTT and jitter, plus a "connection lost —
  reconnecting" banner. Never a frozen screen: remote karts extrapolate for up to 250 ms, then hold.
- **Touch UI** is unchanged. The room screen is designed for portrait and landscape with big tap
  targets. The ⏸ button opens a menu (mute, leave) that doesn't stop the race.
- **Battery/CPU:** a client runs physics for one driven kart and seven kinematic proxies, and no
  AI. That is less work than solo today.

---

## 4. Milestones

Each step ends with `npm test` green, plus that step's own checks. Solo play must keep working at
every step.

**M0 — Groundwork in the sim (no networking yet)**
- `applyEffect`, `Kart.mode = 'proxy'`, snapshot take/apply, the `RaceSource` split in
  `session.ts`.
- Tests: snapshot round trip is exact; a race where every kart is replayed as a proxy from a
  recorded run produces the same laps and finish order; solo determinism test unchanged.

**M1 — Server + protocol, headless**
- `server/` with rooms and a racing loop. `src/net/` codec, clock, interpolation and in-memory
  transport.
- `npm run netsim -- --players=4 --profile=4g`: a headless server plus N headless bot clients
  (autopilot) over the lossy in-memory transport. It reports position error, corrections, rejected
  claims, hit timing and bandwidth.
- Tests: codec fuzz/round trip; a full 1-lap race with 4 bot clients and 4 AI finishes with the
  same standings the server reports to every client; the validation rejects a teleporting client.

**M2 — Playable in the browser (desktop first, local server)**
- `NetRace`: own-kart driving, remote kart interpolation, server events into the existing effects,
  sound and HUD.
- Bare-bones lobby (create/join by code, start).
- `npm run dev:server` + `npm run dev`. `npm run netcheck`: Playwright with two browser contexts
  racing 1 lap to the results screen (a sibling of `racecheck`).

**M3 — Lobby, mobile polish, resilience**
- Full room screen, share links, QR, gorilla picking, host settings, rematch.
- Away → AI takeover, reconnect, wake lock, network indicator, spectating.
- `npm run shoot:mobile` covers the room screen; `netsim` adds a "phone locks for 5 s" scenario.

**M4 — Deploy**
- `server/Dockerfile` + host config. The Pages build gets the server URL from
  `VITE_MP_SERVER` (when it is unset, the online button is hidden, so forks keep working
  offline).
- CI: the GitHub workflow also builds the server and runs the net tests.
- Basic abuse limits: origin check, message rate and size caps, room cap per IP, idle room
  expiry, no accounts and no PII stored.

**Later (not in this pass):** public quick-match, LAN/P2P host mode, ghost/replay sharing
(free with seed + inputs), voice reactions/emotes, ranked play.

---

## 5. Risks and how we'll know

| Risk | Mitigation / measurement |
|---|---|
| Bumping another human feels asymmetric (each side sees the other a bit in the past) | Expected in this model. `netsim` measures contact mismatch; soften proxy impulses if needed |
| Status hits feel late on bad connections | Animate swings and wind-ups locally at once; measure event latency in `netsim` |
| Cheating (client authority) | Plausibility checks on the server, server-owned items and hits. Fine for friends' rooms; ranked play would need more |
| iOS kills the socket in the background | AI takeover + seat token + reconnect, covered by a `netsim` scenario |
| Server cost | ~18% of a core per room, measured; rooms expire when idle |
| `session.ts` (900 lines) refactor regresses solo | M0 is refactor-only, with `racecheck`/`shoot` before and after |

---

## 6. Open questions for the owner

1. **Hosting:** a small always-on Node host (e.g. Fly.io, Render, Railway or a VPS, a few
   dollars a month) is recommended. The alternatives are zero-cost P2P with a phone as host (less
   reliable on mobile) or Cloudflare Durable Objects (cheap, but a poor fit for a 120 Hz physics
   loop).
2. **Who plays:** friends via room codes only (recommended for v1), or public matchmaking too?
3. **Room size:** up to 8 humans (AI fills the rest), or cap humans lower at first?
