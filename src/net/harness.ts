/**
 * A whole online race in one process: a host and N players' phones joined by
 * simulated links (latency, jitter, loss), every human kart on autopilot.
 * Behind `npm run netsim` and the net tests — the netcode equivalent of
 * sim/autopilot.ts.
 */

import { Rng } from '../sim/rng.js';
import { NetClient } from './client.js';
import { NetHost } from './host.js';
import { type LinkProfile, ManualClock, memoryPair } from './link.js';
import type { Settings } from './protocol.js';

export interface NetRace {
  clock: ManualClock;
  host: NetHost;
  clients: NetClient[];
  /** Advance everyone one fixed step (1/120 s of simulated time). */
  step(): void;
  /** Bytes sent host → players and players → host so far. */
  bytes: { down: number; up: number };
}

export function netRace(players: number, profile: LinkProfile, settings: Partial<Settings> = {}, seed = 1): NetRace {
  const clock = new ManualClock();
  const rng = new Rng(seed * 31 + 5);
  const random = () => rng.next();
  const host = new NetHost(clock.now, 'Host', 0);
  host.setSettings(settings);
  const bytes = { down: 0, up: 0 };
  const clients: NetClient[] = [];
  for (let i = 0; i < players; i++) {
    const [toPlayer, toHost] = memoryPair(clock, `host`, `p${i}`, profile, random);
    // Count what crosses the wire.
    const fastDown = toPlayer.sendFast.bind(toPlayer);
    toPlayer.sendFast = (d) => {
      bytes.down += d.byteLength;
      fastDown(d);
    };
    const fastUp = toHost.sendFast.bind(toHost);
    toHost.sendFast = (d) => {
      bytes.up += d.byteLength;
      fastUp(d);
    };
    host.accept(toPlayer);
    clients.push(new NetClient(toHost, clock.now, `P${i}`, i + 1));
  }
  // Let the hellos land.
  clock.advance(1);
  host.start(seed);
  // Let the start messages land and the phones load.
  clock.advance(0.5);
  const dt = 1 / 120;
  return {
    clock,
    host,
    clients,
    bytes,
    step() {
      host.step(null);
      for (const c of clients) c.step(null);
      clock.advance(dt);
      // Nobody plays the events out here: drop them like the game does each frame.
      host.race!.sim.items.events = [];
      for (const c of clients) if (c.race) c.race.sim.items.events = [];
    },
  };
}
