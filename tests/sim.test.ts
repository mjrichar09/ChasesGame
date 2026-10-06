import { beforeAll, describe, expect, it } from 'vitest';
import { TRACKS } from '../src/data/tracks/index.js';
import { VINE_VALLEY } from '../src/data/tracks/jungle1.js';
import { AiDriver, personality } from '../src/sim/driver.js';
import type { TrackDef } from '../src/sim/track.js';
import { ITEMS, RACE } from '../src/data/tuning.js';
import { autoRace } from '../src/sim/autopilot.js';
import { type DriverInput, NEUTRAL_INPUT } from '../src/sim/input.js';
import { Items } from '../src/sim/items.js';
import { yawQuat } from '../src/sim/kart.js';
import { add, scale, v3 } from '../src/sim/math.js';
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
  });
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
    for (const p of r.sim.progress) {
      expect(p.lapTimes).toHaveLength(3);
      expect(p.respawns).toBeLessThan(10);
    }
    r.sim.free();
  }, 180_000);

  it('rewards braking: a driver who slows for corners beats one who never lifts', () => {
    const lap = (cornerGrip: number) => {
      const sim = new RaceSim({ ...def, pickups: [] }, { karts: 1, laps: 1, seed: 1 });
      const ai = new AiDriver({ ...personality(sim.rng, 0), lane: 0, weave: 0, skill: 1, cornerGrip });
      const kart = sim.karts[0]!;
      const pr = sim.progress[0]!;
      for (let i = 0; i < 120 * 180 && pr.finishTime === null; i++) {
        sim.step([ai.drive(sim.dt, kart, pr, sim.track, sim.karts, sim.items, null)]);
      }
      sim.free();
      return pr.finishTime ?? Infinity;
    };
    const braking = Math.min(lap(15), lap(18));
    const flatOut = lap(9999);
    expect(braking).toBeLessThan(flatOut - 1);
  }, 120_000);
});
