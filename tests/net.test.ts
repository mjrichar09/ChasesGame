import { beforeAll, describe, expect, it } from 'vitest';
import { VINE_VALLEY } from '../src/data/tracks/jungle1.js';
import { netRace } from '../src/net/harness.js';
import { PROFILES } from '../src/net/link.js';
import { makeRaceConfig } from '../src/net/protocol.js';
import { packReport, packSnapshot, statusOf, unpackReport, unpackSnapshot, withAck } from '../src/net/state.js';
import { autoRace } from '../src/sim/autopilot.js';
import { NEUTRAL_INPUT } from '../src/sim/input.js';
import { RaceSim, initPhysics } from '../src/sim/race.js';

beforeAll(async () => {
  await initPhysics();
});

describe('wire format', () => {
  it('a snapshot comes back as the race it was taken from (to quantisation)', () => {
    const r = autoRace(VINE_VALLEY, { seed: 5 });
    for (let i = 0; i < 900; i++) r.step();
    const sim = r.sim;
    const buf = withAck(packSnapshot(sim, 77, sim.karts.map((k) => k.index === 3), sim.karts.map(() => 2)), 1234);
    const snap = unpackSnapshot(buf);
    expect(snap.ack).toBe(1234);
    expect(snap.tick).toBe(77);
    expect(snap.time).toBeCloseTo(sim.clock, 4);
    expect(snap.order).toEqual(sim.standings());
    expect(snap.items!.pickups.map((p) => p.active)).toEqual(sim.items.pickups.map((p) => p.active));
    expect(snap.items!.peels.map((p) => p.id)).toEqual(sim.items.peels.map((p) => p.id));
    sim.karts.forEach((k, i) => {
      const ks = snap.karts[i]!;
      expect(ks.pos.x).toBeCloseTo(k.position.x, 3);
      expect(ks.pos.z).toBeCloseTo(k.position.z, 3);
      expect(ks.rot.w).toBeCloseTo(k.rotation.w, 3);
      expect(ks.vel.x).toBeCloseTo(k.velocity.x, 1);
      expect(ks.boostTime).toBeCloseTo(k.boostTime, 2);
      expect(ks.item).toBe(k.item);
      expect(ks.ai).toBe(i === 3);
      expect(ks.epoch).toBe(2);
      expect(ks.dist).toBeCloseTo(sim.progress[i]!.dist, 2);
    });
    // Peels and pickups ride along only when they change.
    expect(unpackSnapshot(packSnapshot(sim, 78, [], [], false)).items).toBeNull();
    // Small enough for a phone to send seven of, twenty times a second.
    expect(buf.byteLength).toBeLessThan(1400);
    sim.free();
  });

  it('a report round-trips', () => {
    const sim = new RaceSim(VINE_VALLEY, { seed: 1 });
    const k = sim.karts[2]!;
    const rep = {
      ...statusOf(k),
      tick: 99,
      epoch: 3,
      input: { ...NEUTRAL_INPUT, throttle: 1, steer: -0.5, item: true, swagger: true },
      pos: k.position,
      rot: k.rotation,
      vel: { x: 12.34, y: -1, z: 3 },
      respawns: 2,
      bonks: 5,
      landed: true,
    };
    const back = unpackReport(packReport(rep));
    expect(back.tick).toBe(99);
    expect(back.epoch).toBe(3);
    expect(back.input.item).toBe(true);
    expect(back.input.whackLeft).toBe(false);
    expect(back.input.swagger).toBe(true);
    expect(back.input.steer).toBeCloseTo(-0.5, 1);
    expect(back.pos.x).toBeCloseTo(k.position.x, 4);
    expect(back.vel.x).toBeCloseTo(12.34, 2);
    expect([back.respawns, back.bonks, back.landed]).toEqual([2, 5, true]);
    expect(packReport(rep).byteLength).toBeLessThan(100);
    sim.free();
  });
});

describe('rooms', () => {
  it('seats humans with their gorillas and fills the grid with the rest', () => {
    const seats = [
      { id: 'host', name: 'Ann', gorilla: 2 },
      { id: 'b', name: 'Bo', gorilla: 5 },
    ];
    const { config, slots } = makeRaceConfig(seats, { track: 1, laps: 2, difficulty: 'wild', swagger: false }, 9);
    expect(config.roster).toHaveLength(8);
    expect(new Set(config.roster).size).toBe(8);
    expect(config.roster[slots[0]!]).toBe(2);
    expect(config.roster[slots[1]!]).toBe(5);
    expect(config.names[slots[1]!]).toBe('Bo');
    expect(config.names.filter((n) => n).length).toBe(2);
  });
});

describe('an online race', () => {
  it('host and three phones on 4G finish one lap and agree on the result', () => {
    const net = netRace(3, PROFILES['4g']!, { laps: 1 }, 2);
    const sim = net.host.race!.sim;
    let worst = 0;
    for (let i = 0; i < 120 * 150 && !sim.allFinished; i++) {
      net.step();
      if (i % 30 === 0 && sim.phase === 'racing') {
        for (const c of net.clients) {
          const mine = c.race!.sim.karts[c.race!.own]!;
          const theirs = sim.karts[c.race!.own]!;
          const same = c.race!.sim.progress[c.race!.own]!.respawns === sim.progress[c.race!.own]!.respawns;
          if (!mine.out && same) worst = Math.max(worst, Math.hypot(mine.position.x - theirs.position.x, mine.position.z - theirs.position.z));
        }
      }
    }
    expect(sim.allFinished).toBe(true);
    // Let the last snapshot land.
    for (let i = 0; i < 60; i++) net.step();
    for (const c of net.clients) {
      expect(c.race!.sim.standings()).toEqual(sim.standings());
      for (let i = 0; i < 8; i++) expect(c.race!.sim.progress[i]!.finishTime).toBeCloseTo(sim.progress[i]!.finishTime!, 3);
    }
    // The host's copy of each player's kart trails it by about one trip's worth.
    expect(worst).toBeLessThan(6);
    for (const p of sim.progress) expect(p.respawns).toBeLessThan(6);
  }, 180_000);

  it('a phone that goes quiet is driven by the AI, then picks its kart back up', () => {
    const net = netRace(2, PROFILES.wifi!, { laps: 1 }, 3);
    const sim = net.host.race!.sim;
    const quiet = net.clients[0]!;
    const kart = quiet.race!.own;
    let wasAway = false;
    for (let i = 0; i < 120 * 30; i++) {
      const asleep = sim.raceTime > 8 && sim.raceTime < 12;
      net.host.step(null);
      net.clients.forEach((c) => {
        if (c !== quiet || !asleep) c.step(null);
      });
      net.clock.advance(1 / 120);
      sim.items.events = [];
      for (const c of net.clients) c.race!.sim.items.events = [];
      if (net.host.players.find((p) => p.kart === kart)!.away) wasAway = true;
    }
    expect(wasAway).toBe(true);
    expect(net.host.players.find((p) => p.kart === kart)!.away).toBe(false);
    expect(sim.karts[kart]!.proxy).toBe(true);
    // Back in step with the host after the handover.
    const mine = quiet.race!.sim.karts[kart]!.position;
    const theirs = sim.karts[kart]!.position;
    expect(Math.hypot(mine.x - theirs.x, mine.z - theirs.z)).toBeLessThan(6);
    // It kept racing while away.
    expect(sim.progress[kart]!.dist).toBeGreaterThan(200);
  }, 120_000);

  it('a slow host phone slows everyone down instead of losing them', () => {
    const net = netRace(2, PROFILES.wifi!, { laps: 1 }, 4);
    const sim = net.host.race!.sim;
    let takeovers = 0;
    let worstLead = 0;
    for (let i = 0; i < 120 * 30; i++) {
      // The host manages one step for every two of real time.
      if (i % 2 === 0) net.host.step(null);
      for (const c of net.clients) c.step(null);
      net.clock.advance(1 / 120);
      sim.items.events = [];
      for (const c of net.clients) c.race!.sim.items.events = [];
      if (net.host.players.some((p) => p.away)) takeovers++;
      if (sim.phase === 'racing') for (const c of net.clients) worstLead = Math.max(worstLead, c.race!.sim.clock - sim.clock);
    }
    expect(takeovers).toBe(0);
    expect(worstLead).toBeLessThan(0.5);
    for (const c of net.clients) expect(c.stalled).toBe(false);
  }, 120_000);
});
