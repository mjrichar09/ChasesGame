# Online multiplayer

Up to 8 people race online, phones first and desktop as well; AI gorillas fill the empty karts.
One player's phone **hosts** the room, and everyone else joins with its **4-digit code** (or an
invite link). Nothing to deploy beyond the static site.

## How it plays

1. **Title → PLAY ONLINE.** Enter a name (remembered), then **HOST A ROOM** or type a code and **JOIN**.
2. **The room** shows the code with an **Invite** button (the phone's share sheet, or copy link),
   who's in, and the gorilla cards. Each gorilla can be picked by one player only; taken cards show
   who has them. The host picks the track, laps, rival difficulty and swagger on/off, then presses
   **START!**
3. **The race.** The host's phone waits until every phone has loaded the track, then the
   countdown starts for everyone at once. Players' names float over their karts and replace the
   gorilla names in the HUD and results.
4. **Results** fill in live as others finish. The host's **BACK TO ROOM** takes everyone back for a
   rematch.

The ⏸ button doesn't stop an online race: it opens a menu while the AI drives your kart. Leaving the
app does the same. After about 1.5 s of silence the host's AI takes your kart, and when you come
back you pick it up from wherever the AI left it. The screen is kept awake during races (Screen Wake
Lock). If the **host** leaves the app, the race freezes for everyone, with a "Waiting for the
host…" banner, until the host comes back. A host phone that runs slow (busy or hot) slows
everyone's race down with it: a player's clock never runs more than 0.25 s past the host's newest
snapshot. Before this cap, players raced ahead of a slow host, decided it had stalled and stopped
reporting, and then got their karts handed to the AI.

## Who decides what

Lockstep or rollback netcode needs every phone to compute bit-identical physics. iOS Safari and
Chrome don't guarantee that for `Math.sin`/`atan2`, and re-simulating 8 karts of Rapier on a phone is
too expensive. So instead:

| Thing | Decided by | How a phone hides the delay |
|---|---|---|
| Your kart's motion, respawns, wall bonks | **Your phone** (physics runs locally) | none needed: steering never waits on the network |
| Banana boost, parrot take-off, snake swing, your own swagger move | Your phone starts it on the press; the host mirrors it from your buttons | instant |
| Your item, its charges, your swagger meter | **Host** | ignored until the host has seen your last press (the report ack) |
| Hitting a peel | Your phone notices it and claims the peel; the host checks it's still there and you're near it | instant spin |
| Pickups and item rolls | **Host** | item shows up one round trip later |
| Whacks, Roar, Slow Clap, Drop the Beat, boulder/Too Cool shoves | **Host**, using its positions | the hit arrives as an event; timers merge by max |
| Laps, places, the finish, lava DNFs | **Host** | — |
| Jungle events (tree fall, flood, branch snap) | **Host**, sent as event phases | each phone rebuilds the change locally |
| AI gorillas | **Host** | other phones see them like any remote kart |

Other karts are drawn **120 ms in the past**, blended between the two host snapshots around that
moment. They are *proxies*: kinematic bodies with **no solid collider**. Karts driven on this phone
get a soft, capped push away from them (`RaceSim.bumpProxies`). An immovable body jerked along by
network updates would crush and launch whatever it pressed against: a kart wedged against a proxy
used to reach 300 m/s in `netsim`. The host sees each player slightly late, so a remote kart gets
5 m of grace from the lava front.

## Code map

- `src/net/protocol.ts`: messages, constants (snapshot 20 Hz, reports 60 Hz, interp delay, away
  timeout), `makeRaceConfig` (grid: humans in random slots, AI in the rest) and `buildRace` (every
  phone builds the identical race from the config).
- `src/net/state.ts`: binary snapshot and report packing (`bin.ts`). Peels, pickups and loose
  bananas are only sent when they change.
- `src/net/host.ts`: the room and the official race (`NetHost.step`), with proxies following
  reports, AI takeover and peel claims.
- `src/net/client.ts`: a player's side (`NetClient.step`): clock sync, interpolation, applying
  snapshots, reports, and taking the kart back after an AI spell (the epoch).
- `src/net/link.ts`: the `Link` interface, and `memoryPair`, a simulated network with latency,
  jitter and loss on a manual clock.
- `src/net/peer.ts`: WebRTC links via PeerJS (browser only). The host registers
  `jungle-jalopies-<code>` on the free public PeerJS server; players connect with two data channels,
  reliable JSON and unordered binary. PeerJS's public TURN servers relay when two phones on mobile
  data can't connect directly. `?peer=host:port` uses another signalling server.
- `src/net/harness.ts`: a whole online race in one process, behind the tests and `netsim`.
- Sim hooks: `RaceOptions.role` (`solo` | `host` | `client`), `Kart.setProxy/pose/stepProxy`,
  `Items.authority`/`claimPeel`, `RaceSim.reportRespawn/reportBonk/applyEvent/toast(…, ruled)`.
  Solo races are unchanged.
- UI: `src/ui/online.ts` (online and room screens); `src/game/session.ts` (modes, waiting banner,
  connection badge, live results, wake lock).

## Checking it

- `npm test` includes `tests/net.test.ts`:
  - the wire format round-trips;
  - room seating works;
  - a host and three phones on simulated 4G finish a lap and agree on every finish time;
  - a phone that goes quiet is driven by the AI and then takes its kart back;
  - a host running at half speed slows everyone down without anyone being taken over.
- `npm run netsim -- --players=7 --profile=4g [--track=N --laps=N --away=N --why]`: a headless online
  race. It reports the finish order as the host and each phone see it, how far the host's copy of
  each player's kart trails the real one, bandwidth, respawns and AI takeovers. Profiles:
  `lan`, `wifi`, `4g`, `bad`.
- `npm run peer` (local signalling server) + `npm run dev`, then `npx tsx tools/netcheck.ts`: two
  phone-sized Chromium pages race over real WebRTC to the results and back to the room. Screenshots
  are saved as `shots/net-*.png`.
- By hand: open the dev server on two devices on the same Wi-Fi (`http://<your-ip>:5174/`).

Measured with `netsim` (Vine Valley, 1 lap):

| | 3 players, 4G (60 ± 40 ms, 1% loss) | 7 players, Wi-Fi | 7 players, bad (150 ± 100 ms, 5% loss) |
|---|---|---|---|
| Host's copy of a player kart behind the real one (median / 95%) | 1.4 m / 2.3 m | 0.4 m / 0.6 m | 2.6 m / 5.2 m |
| Host upload | 15 KB/s per player | 15 KB/s per player (~105 KB/s total) | same |
| Player upload | 4.8 KB/s | 4.8 KB/s | 4.8 KB/s |
| All phones agree on the results | yes | yes | yes |

## Known limits / next steps

- **The host is a phone.** If the host's app is backgrounded, everyone waits. If the host leaves,
  the room ends. Moving the same `NetHost` to a small Node server later is straightforward: it
  already runs headless, and `Link` would just need a WebSocket version.
- **The public PeerJS server** is free and shared: no uptime promise and no TURN capacity
  guarantee. Running our own (`peer` package, or any PeerJS-compatible server) needs only a
  `?peer=` / config change.
- No mid-race joining. A late player waits in the room for the next race.
- Item pickups take a round trip to show; a "roulette" animation in the item slot would hide it.
- Codes are 4 digits on a shared namespace (`jungle-jalopies-NNNN`), so a room code can only be
  guessed by someone who also has this game.
