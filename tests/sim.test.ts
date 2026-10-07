import { beforeAll, describe, expect, it } from 'vitest';
import { TRACKS } from '../src/data/tracks/index.js';
import { VINE_VALLEY } from '../src/data/tracks/jungle1.js';
import { AiDriver, personality } from '../src/sim/driver.js';
import type { TrackDef } from '../src/sim/track.js';
import { ITEMS, PARROT, RACE } from '../src/data/tuning.js';
import { autoRace } from '../src/sim/autopilot.js';
import { type DriverInput, NEUTRAL_INPUT } from '../src/sim/input.js';
import { Items } from '../src/sim/items.js';
import { yawQuat } from '../src/sim/kart.js';
import { add, dot, scale, sub, v3 } from '../src/sim/math.js';
import { RaceSim, initPhysics } from '../src/sim/race.js';

beforeAll(async () => {
  await initPhysics();
});

/** A race already past the countdown. */
function racing(karts = 2): RaceSim {
  const sim = new RaceSim(VINE_VALLEY, { karts, seed: 7 });
  sim.clock = RACE.countdown;
  sim.phase = 'racing';
  return sim;
}

const press = (over: Partial<DriverInput>): DriverInput => ({ ...NEUTRAL_INPUT, ...over });

/** Put kart `i` at track position s / lateral, facing along the road. */
function putAt(sim: RaceSim, i: number, s: number, lateral: number): void {
  const k = sim.track.at(s);
  sim.karts[i]!.place(add(sim.track.pointAt(s, lateral), v3(0, 0.7, 0)), yawQuat(Math.atan2(k.t.x, k.t.z)));
  const pr = sim.progress[i]!;
  pr.s = sim.track.wrap(s);
  pr.safeS = pr.s;
}

function settle(sim: RaceSim, steps = 60, inputs: DriverInput[] = []): void {
  for (let i = 0; i < steps; i++) sim.step(inputs);
}

describe('determinism', () => {
  it('replays a race exactly from its seed', () => {
    const run = () => {
      const r = autoRace(VINE_VALLEY, { seed: 3 });
      for (let i = 0; i < 1500; i++) r.step();
      const out = r.sim.karts.map((k) => [k.position.x, k.position.y, k.position.z]);
      r.sim.free();
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe('laps', () => {
  it('counts nothing during the countdown and starts everyone behind the line', () => {
    const sim = new RaceSim(VINE_VALLEY, { seed: 1 });
    settle(sim, 120, sim.karts.map(() => press({ throttle: 1 })));
    expect(sim.phase).toBe('countdown');
    for (const p of sim.progress) {
      expect(p.dist).toBeLessThan(0);
      expect(p.lap).toBe(0);
    }
  });

  it('gives no credit for a teleport across the track', () => {
    const sim = racing(1);
    settle(sim, 30);
    const before = sim.progress[0]!.dist;
    const s = 500;
    const k = sim.track.at(s);
    // Move the body without telling the progress tracker — like a shortcut would.
    sim.karts[0]!.place(add(k.p, v3(0, 0.7, 0)), yawQuat(Math.atan2(k.t.x, k.t.z)));
    settle(sim, 5);
    expect(sim.progress[0]!.dist - before).toBeLessThan(45);
  });

  it('ranks by distance, and the race ends after the set laps', () => {
    const r = autoRace(VINE_VALLEY, { seed: 2, laps: 1, karts: 3 });
    for (let i = 0; i < 120 * 150 && !r.sim.allFinished; i++) r.step();
    expect(r.sim.allFinished).toBe(true);
    expect(r.sim.finishOrder).toEqual(r.sim.standings());
    for (const p of r.sim.progress) expect(p.lapTimes).toHaveLength(1);
    r.sim.free();
  }, 60_000);
});

describe('bananas', () => {
  it('a bunch is three 3-second boosts, each dropping a peel', () => {
    const sim = racing(1);
    putAt(sim, 0, 120, 0);
    settle(sim, 30);
    const kart = sim.karts[0]!;
    Items.give(kart, 'banana');
    for (let n = 1; n <= 3; n++) {
      sim.step([press({ item: true })]);
      expect(kart.boostTime).toBeGreaterThan(ITEMS.boostTime - 0.05);
      expect(sim.items.peels).toHaveLength(n);
      sim.step([press({})]); // release
    }
    expect(kart.item).toBe('none');
    settle(sim, Math.ceil(ITEMS.boostTime * 120) + 2, [press({ throttle: 1 })]);
    expect(kart.boostTime).toBe(0);
  });

  it('peels have no timer — they stay until hit', () => {
    const sim = racing(1);
    putAt(sim, 0, 120, 0);
    settle(sim, 20);
    Items.give(sim.karts[0]!, 'banana');
    sim.step([press({ item: true })]);
    putAt(sim, 0, 300, 0);
    settle(sim, 120 * 60);
    expect(sim.items.peels).toHaveLength(1);
    expect(sim.items.peels[0]!.age).toBeGreaterThan(59);
  });

  it('hitting a peel spins you out and uses the peel up', () => {
    const sim = racing(2);
    putAt(sim, 0, 140, 0);
    putAt(sim, 1, 300, 0);
    settle(sim, 30);
    // Dead ahead of the kart, at road level.
    const me = sim.karts[0]!;
    const ahead = add(add(me.position, scale(me.forward, 6)), v3(0, -0.4, 0));
    sim.items.peels.push({ id: 99, pos: ahead, yaw: 0, owner: 1, age: 10 });
    let spun = false;
    for (let i = 0; i < 240 && !spun; i++) {
      sim.step([press({ throttle: 1 })]);
      spun = sim.karts[0]!.spinning;
    }
    expect(spun).toBe(true);
    expect(sim.items.peels).toHaveLength(0);
  });

  it('caps the track at maxPeels by dropping the oldest', () => {
    const sim = racing(1);
    putAt(sim, 0, 120, 0);
    settle(sim, 20);
    const kart = sim.karts[0]!;
    for (let i = 0; i < ITEMS.maxPeels + 5; i++) {
      Items.give(kart, 'banana');
      sim.step([press({ item: true })]);
      sim.step([press({})]);
      putAt(sim, 0, 120 + (i % 5) * 20, 0);
    }
    expect(sim.items.peels).toHaveLength(ITEMS.maxPeels);
    expect(sim.items.peels[0]!.id).toBe(6);
  });
});

describe('snake', () => {
  function sideBySide(): RaceSim {
    const sim = racing(2);
    putAt(sim, 0, 140, -1.5);
    putAt(sim, 1, 140, 1.5);
    settle(sim, 40);
    return sim;
  }

  it('a swing hits the kart alongside on that side only', () => {
    const sim = sideBySide();
    const [me, them] = sim.karts as [typeof sim.karts[0], typeof sim.karts[0]];
    Items.give(me, 'snake');
    sim.step([press({ whackLeft: true }), press({})]);
    expect(them.wobbleTime).toBe(0);
    settle(sim, 70);
    them.body.setLinvel(scale(them.forward, 15), true);
    me.body.setLinvel(scale(me.forward, 15), true);
    const before = Math.hypot(them.velocity.x, them.velocity.z);
    sim.step([press({ whackRight: true }), press({})]);
    expect(them.wobbleTime).toBeGreaterThan(0);
    expect(Math.hypot(them.velocity.x, them.velocity.z)).toBeLessThan(before * 0.75);
  });

  it('gives exactly three swings', () => {
    const sim = sideBySide();
    const me = sim.karts[0]!;
    Items.give(me, 'snake');
    let swings = 0;
    for (let i = 0; i < 10; i++) {
      const before = me.charges;
      sim.step([press({ whackRight: true }), press({})]);
      if (me.charges < before || (before === 1 && me.item === 'none')) swings++;
      settle(sim, 70);
    }
    expect(swings).toBe(ITEMS.snakeSwings);
    expect(me.item).toBe('none');
  });
});

describe('the grid', () => {
  it.each(TRACKS.map((t) => [t.name, t] as const))('%s: nobody moves before GO', (_n, def: TrackDef) => {
    const sim = new RaceSim(def, { seed: 1 });
    const start = sim.karts.map((k) => ({ ...k.position }));
    settle(sim, 120 * 3 - 1, sim.karts.map(() => press({ throttle: 1 })));
    expect(sim.phase).toBe('countdown');
    sim.karts.forEach((k, i) => expect(Math.hypot(k.position.x - start[i]!.x, k.position.z - start[i]!.z)).toBeLessThan(0.02));
    sim.free();
  });
});

describe('a jungle that changes', () => {
  /** Pretend the leader is `laps` laps in, so lap-triggered events fire. */
  function leaderOn(sim: RaceSim, laps: number): void {
    sim.progress[1]!.dist = sim.lapLength * laps + 1;
    sim.progress[1]!.lap = laps;
    settle(sim, 2);
  }

  it('Vine Valley: a tree falls across the road on lap 2, and its crown slows you', () => {
    const sim = racing(2);
    const tree = sim.events[0]!;
    expect(tree.phase).toBe('idle');
    settle(sim, 2);
    expect(tree.phase).toBe('warning');
    leaderOn(sim, 1);
    expect(tree.phase).toBe('active');
    expect(sim.track.brush).toHaveLength(1);
    const b = sim.track.brush[0]!;
    const mid = (b.s0 + b.s1) / 2;
    // Same speed into the crown and into the clear half: the crown costs more.
    const through = (lateral: number) => {
      putAt(sim, 0, mid - 6, lateral);
      settle(sim, 30);
      sim.karts[0]!.body.setLinvel(scale(sim.karts[0]!.forward, 15), true);
      settle(sim, 60, [press({})]);
      return Math.hypot(sim.karts[0]!.velocity.x, sim.karts[0]!.velocity.z);
    };
    expect(through(b.side * 3.5)).toBeLessThan(through(-b.side * 3.5) - 2);
  });

  it('Canopy Creek: the creek floods wider in two stages', async () => {
    const { CANOPY_CREEK } = await import('../src/data/tracks/jungle2.js');
    const sim = new RaceSim(CANOPY_CREEK, { karts: 2, seed: 4 });
    sim.clock = RACE.countdown;
    sim.phase = 'racing';
    const width = () => sim.track.waters[0]!.s1 - sim.track.waters[0]!.s0;
    const w0 = width();
    leaderOn(sim, 1);
    const w1 = width();
    leaderOn(sim, 2);
    const w2 = width();
    expect(w1).toBeGreaterThan(w0 + 10);
    expect(w2).toBeGreaterThan(w1 + 10);
  });

  it('a flooded ford: skim it fast and straight, or wade through slowly', async () => {
    const { CANOPY_CREEK } = await import('../src/data/tracks/jungle2.js');
    const cross = (speed: number, weave: number, throttle = 1) => {
      const sim = new RaceSim({ ...CANOPY_CREEK, pickups: [] }, { karts: 2, seed: 2 });
      sim.clock = RACE.countdown;
      sim.phase = 'racing';
      sim.progress[1]!.dist = sim.lapLength * 2 + 1;
      settle(sim, 3);
      const w = sim.track.waters[0]!;
      putAt(sim, 0, w.s0 - 18, 0);
      settle(sim, 30);
      const kart = sim.karts[0]!;
      const k = sim.track.at(w.s0 - 18);
      kart.body.setLinvel({ x: k.t.x * speed, y: 0, z: k.t.z * speed }, true);
      for (let i = 0; i < 120 * 4 && sim.progress[0]!.s < w.s1 + 3; i++) {
        const pr = sim.progress[0]!;
        const tgt = sim.track.pointAt(pr.s + 8, 0);
        const rel = sub(tgt, kart.position);
        const steer = Math.atan2(dot(rel, kart.right), Math.max(dot(rel, kart.forward), 1)) * 2.5 + Math.sin(i / 14) * weave;
        sim.step([press({ throttle, steer: Math.max(-1, Math.min(1, steer)) }), press({})]);
      }
      const out = kart.forwardSpeed;
      sim.free();
      return out;
    };
    const skim = cross(27, 0);
    expect(skim).toBeGreaterThan(20);
    expect(skim).toBeGreaterThan(cross(27, 1) + 10);
    // Lifting off into the water: below skimming speed, it wades.
    expect(skim).toBeGreaterThan(cross(15, 0, 0.3) + 10);
  });

  it('Treetop Tangle: the branch snaps on lap 3 — a real hole, and a ramp before it', async () => {
    const { TREETOP_TANGLE } = await import('../src/data/tracks/jungle3.js');
    const sim = new RaceSim(TREETOP_TANGLE, { karts: 2, seed: 4 });
    sim.clock = RACE.countdown;
    sim.phase = 'racing';
    const snap = sim.track.snapRanges()[0]!;
    const mid = (snap.s0 + snap.s1) / 2;
    expect(sim.track.inGap(mid)).toBe(false);
    leaderOn(sim, 1);
    expect(sim.events[0]!.phase).toBe('warning');
    leaderOn(sim, 2);
    expect(sim.events[0]!.phase).toBe('active');
    expect(sim.track.inGap(mid)).toBe(true);
    expect(sim.track.kickerHeight(snap.ramp[1] - 0.5, 0)).toBeGreaterThan(1);
    // Parked over the hole, a kart drops through it.
    const k = sim.track.at(mid);
    sim.karts[0]!.place({ x: k.p.x, y: k.p.y + 1, z: k.p.z }, yawQuat(Math.atan2(k.t.x, k.t.z)));
    sim.progress[0]!.s = mid;
    const y0 = sim.karts[0]!.position.y;
    settle(sim, 120);
    expect(sim.karts[0]!.position.y).toBeLessThan(y0 - 2);
  });
});

describe('lava', () => {
  it('toasts a kart the front catches, and spares one flying over it', async () => {
    const { LAVA_RUN } = await import('../src/data/tracks/volcano.js');
    const sim = new RaceSim(LAVA_RUN, { karts: 2, seed: 3 });
    settle(sim, 120 * 3 + 2);
    expect(sim.phase).toBe('racing');
    // Kart 1 takes off on a parrot; kart 0 just sits on the grid.
    Items.give(sim.karts[1]!, 'parrot');
    sim.step([press({}), press({ item: true })]);
    for (let i = 0; i < 120 * 30 && !sim.progress[0]!.dnf; i++) sim.step([press({}), press({})]);
    expect(sim.progress[0]!.dnf).toBe(true);
    expect(sim.standings()[1]).toBe(0);
    // Overtaken by the lava while airborne: still alive until it lands.
    const flyer = sim.progress[1]!;
    if (sim.karts[1]!.flying) expect(flyer.dnf).toBe(false);
  });

  it('is a point to point race: one run, start line to finish line', async () => {
    const { LAVA_RUN } = await import('../src/data/tracks/volcano.js');
    const sim = new RaceSim(LAVA_RUN, { karts: 1 });
    expect(sim.laps).toBe(1);
    expect(sim.track.closed).toBe(false);
    expect(sim.raceLength).toBeCloseTo(sim.track.finishS - sim.track.startS);
    expect(sim.progress[0]!.dist).toBeLessThan(0);
  });
});

describe('parrot', () => {
  function airborne(): RaceSim {
    const sim = racing(2);
    putAt(sim, 0, 140, 0);
    putAt(sim, 1, 300, 0);
    settle(sim, 40);
    Items.give(sim.karts[0]!, 'parrot');
    sim.step([press({ item: true }), press({})]);
    return sim;
  }

  it('lifts the kart for six seconds at altitude, then lets go', () => {
    const sim = airborne();
    const kart = sim.karts[0]!;
    expect(kart.flying).toBe(true);
    expect(kart.item).toBe('none');
    const road = sim.track.at(sim.progress[0]!.s).p.y;
    settle(sim, 120 * 3, [press({ throttle: 1 })]);
    expect(kart.flying).toBe(true);
    expect(kart.position.y - sim.track.at(sim.progress[0]!.s).p.y).toBeGreaterThan(PARROT.altitude - 1.5);
    expect(kart.position.y).toBeGreaterThan(road + 3);
    settle(sim, 120 * 3 + 10, [press({ throttle: 1 })]);
    expect(kart.flying).toBe(false);
  });

  it('flies over peels and out of reach of snakes', () => {
    const sim = airborne();
    const [me, them] = sim.karts as [typeof sim.karts[0], typeof sim.karts[0]];
    settle(sim, 120);
    // A peel right under the flying kart.
    sim.items.peels.push({ id: 7, pos: sim.track.pointAt(sim.progress[0]!.s, sim.progress[0]!.lateral), yaw: 0, owner: 1, age: 9 });
    settle(sim, 5, [press({ throttle: 1 })]);
    expect(me.spinning).toBe(false);
    // A snake beside the flying kart's shadow finds nobody.
    putAt(sim, 1, sim.progress[0]!.s, sim.progress[0]!.lateral + 1.6);
    Items.give(them, 'snake');
    expect(sim.items.target(them, 1, sim.karts)).toBeNull();
    expect(sim.items.target(them, -1, sim.karts)).toBeNull();
  });

  it('credits a forward shortcut, but never more than the cap', () => {
    const sim = airborne();
    const kart = sim.karts[0]!;
    const pr = sim.progress[0]!;
    settle(sim, 60, [press({ throttle: 1 })]);
    const before = pr.dist;
    // Carry the kart straight across to a stretch 250 m further round the lap.
    const ahead = sim.track.at(pr.s + 250);
    kart.place({ x: ahead.p.x, y: ahead.p.y + 6, z: ahead.p.z }, kart.rotation);
    kart.takeOff(ahead.p.y);
    settle(sim, 2, [press({ throttle: 1 })]);
    expect(pr.dist - before).toBeGreaterThan(220);
    expect(pr.dist - before).toBeLessThan(sim.track.length * PARROT.maxSkip);
    // A carry *backwards* gives nothing back.
    const after = pr.dist;
    const behind = sim.track.at(pr.s - 300);
    kart.place({ x: behind.p.x, y: behind.p.y + 6, z: behind.p.z }, kart.rotation);
    kart.takeOff(behind.p.y);
    settle(sim, 2, [press({ throttle: 1 })]);
    expect(pr.dist).toBeGreaterThan(after - 50);
    expect(pr.dist).toBeLessThan(after + 1);
  });
});

describe('pickups', () => {
  it('one item at a time: a full hand leaves the pickup on the track', () => {
    const sim = racing(1);
    const kart = sim.karts[0]!;
    Items.give(kart, 'snake');
    const p = sim.items.pickups[0]!;
    kart.place(add(p.pos, v3(0, -0.4, 0)), kart.rotation);
    sim.step([press({})]);
    expect(p.active).toBe(true);
    expect(kart.item).toBe('snake');

    kart.item = 'none';
    kart.charges = 0;
    kart.place(add(p.pos, v3(0, -0.4, 0)), kart.rotation);
    sim.step([press({})]);
    expect(p.active).toBe(false);
    expect(kart.item).toBe(p.kind);
  });
});

describe.each(TRACKS.map((t) => [t.name, t] as const))('%s', (_name, def: TrackDef) => {
  it('all eight karts finish three laps without getting stuck', () => {
    const r = autoRace(def, { seed: 11 });
    for (let i = 0; i < 120 * 60 * 6 && !r.sim.allFinished; i++) {
      r.step();
      r.sim.items.events = [];
    }
    expect(r.sim.allFinished).toBe(true);
    const laps = def.open ? 1 : 3;
    for (const p of r.sim.progress) {
      // On an escape track some are caught by the lava — but nobody is stuck.
      if (!p.dnf) expect(p.lapTimes).toHaveLength(laps);
      expect(p.respawns).toBeLessThan(14);
    }
    if (def.lava) expect(r.sim.progress.filter((p) => !p.dnf).length).toBeGreaterThanOrEqual(4);
    r.sim.free();
  }, 180_000);

  it('rewards braking: a driver who slows for corners beats one who never lifts', () => {
    const lap = (cornerGrip: number) => {
      const sim = new RaceSim({ ...def, pickups: [], lava: undefined }, { karts: 1, laps: 1, seed: 1 });
      const ai = new AiDriver({ ...personality(sim.rng, 0, 1), lane: 0, weave: 0, skill: 1, cornerGrip, steerNoise: 0, mistakes: 0 });
      const kart = sim.karts[0]!;
      const pr = sim.progress[0]!;
      for (let i = 0; i < 120 * 180 && pr.finishTime === null; i++) {
        sim.step([ai.drive(sim.dt, kart, pr, sim.track, sim.karts, sim.items, null)]);
      }
      sim.free();
      return pr.finishTime ?? Infinity;
    };
    const braking = Math.min(lap(15), lap(18), lap(22), lap(28));
    const flatOut = lap(9999);
    expect(braking).toBeLessThan(flatOut - 1);
  }, 120_000);
});
