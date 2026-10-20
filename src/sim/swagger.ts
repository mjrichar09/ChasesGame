/**
 * Swagger: driving with style fills a meter; a full meter is one signature move.
 *
 * Design (docs/swagger.md): one charge, its own slot (separate from items),
 * and an on/off switch per race. Everything here is deterministic sim — the
 * meter, what earns and costs it, the hold-to-fire with its wind-up, and the
 * eight moves' effects. The renderer reads `kart.swagger`, `kart.move*` and
 * the 'swagger' events.
 */

import { ITEMS } from '../data/tuning.js';
import type { DriverInput } from './input.js';
import type { Kart } from './kart.js';
import { type Vec3, add, dot, length, scale, sub, v3 } from './math.js';
import type { RaceSim } from './race.js';

export type Move = 'roar' | 'noBrakes' | 'slowClap' | 'feed' | 'pogo' | 'beat' | 'tooCool' | 'boulder';

/** The roster's moves in roster order (Boris, Koko, Professor, Mama, Tiny, DJ, Steve, Gus). */
export const MOVES: readonly Move[] = ['roar', 'noBrakes', 'slowClap', 'feed', 'pogo', 'beat', 'tooCool', 'boulder'];

export const MOVE_NAMES: Record<Move, string> = {
  roar: 'ROAR',
  noBrakes: 'NO BRAKES',
  slowClap: 'SLOW CLAP',
  feed: 'FEED THE TROOP',
  pogo: 'POGO',
  beat: 'DROP THE BEAT',
  tooCool: 'TOO COOL',
  boulder: 'BOULDER',
};

/** One line on what each move does, for the select screen. */
export const MOVE_INFO: Record<Move, string> = {
  roar: 'Karts within 20 m are blasted back, lose speed, fishtail and drop their bananas as peels. Airborne karts are safe.',
  noBrakes: '4 s of boost with sharp steering and huge grip — wall hits don’t slow you.',
  slowClap: 'Karts up to 45 m ahead lose 45% of their pace for 3.5 s.',
  feed: 'Leaves 5 bananas on the road behind you and fills your hands with a full stack.',
  pogo: 'A huge 6 m bounce — over gaps, peels and rivals.',
  beat: 'Rivals within 45 m get swapped steering (left is right) for 3 s.',
  tooCool: '5 s immune to everything — peels, whacks, walls, even lava. Karts within 4 m get shoved aside.',
  boulder: '4 s as a heavy rolling rock: bowls karts within 4 m aside and flattens fallen branches.',
};

export const SWAGGER = {
  max: 100,
  // Earning.
  airPerSecond: 10,
  cleanLanding: 6,
  nearMiss: 4,
  whack: 10,
  peelVictim: 8,
  overtake: 5,
  draftPerSecond: 2,
  lateBrake: 4,
  parrotLanding: 6,
  showOff: 5,
  // Costs.
  bonk: 10,
  spin: 15,
  respawn: 25,
  /** Earning multiplier for last place; 1st earns ×1. */
  comeback: 1.5,
  /** Hold the button this long to fire (no accidents); then this wind-up before it hits. */
  hold: 0.3,
  windup: 0.35,
  // Moves.
  roarRadius: 20,
  roarWobble: 2.2,
  /** Roar: fraction of speed kept, and the outward blast (impulse, N·s) at point-blank range. */
  roarKeep: 0.6,
  roarBlast: 1400,
  noBrakesTime: 4,
  /** No Brakes: tyre grip and steering lock multipliers (read by the kart). */
  noBrakesGrip: 2.8,
  noBrakesSteer: 2.1,
  /** Slow Clap's pace loss is `ITEMS.slowPower`. */
  clapRange: 45,
  clapTime: 3.5,
  feedBananas: 5,
  feedTtl: 20,
  pogoHeight: 6,
  beatRadius: 45,
  beatTime: 3,
  coolTime: 5,
  boulderTime: 4,
  boulderMass: 4,
  shoveRadius: 4,
  shove: 4200,
} as const;

/** Per-kart bookkeeping the race keeps for earning swagger. */
export interface SwaggerTrack {
  /** The place we last paid out for, and how long a better place has been held. */
  lastPlace: number;
  betterFor: number;
  /** Cooldowns, s: near misses (per other kart), late brakes. */
  nearCool: number[];
  brakeCool: number;
  /** Seconds since this kart last scored a hit (for the show-off bonus). */
  sinceHit: number;
  wasFlying: boolean;
}

export function newSwaggerTrack(karts: number, place: number): SwaggerTrack {
  return { lastPlace: place, betterFor: 0, nearCool: new Array(karts).fill(0), brakeCool: 0, sinceHit: 99, wasFlying: false };
}

/** Add (or with a negative amount, take) swagger, with the comeback lean on earnings. */
export function earn(sim: RaceSim, kart: Kart, amount: number): void {
  if (!sim.swaggerOn || kart.out) return;
  if (amount > 0) {
    const n = sim.karts.length;
    const place = sim.position(kart.index);
    amount *= 1 + ((SWAGGER.comeback - 1) * (place - 1)) / Math.max(1, n - 1);
  }
  kart.swagger = Math.max(0, Math.min(SWAGGER.max, kart.swagger + amount));
}

/**
 * One step of swagger for the whole field: earnings from what karts did this
 * step, then holds, wind-ups and moves. `eventsFrom` is where this step's
 * item events start in `sim.items.events`.
 */
export function stepSwagger(sim: RaceSim, held: readonly DriverInput[], eventsFrom: number): void {
  if (!sim.swaggerOn || sim.phase !== 'racing') return;
  const dt = sim.dt;
  // Online, a client only fires its own moves; the host keeps every meter.
  const client = sim.role === 'client';
  // Hits and slips this step.
  const evs = sim.items.events;
  for (let i = client ? evs.length : eventsFrom; i < evs.length; i++) {
    const e = evs[i]!;
    if (e.type === 'whack') {
      earn(sim, sim.karts[e.kart]!, SWAGGER.whack);
      sim.swaggerTrack[e.kart]!.sinceHit = 0;
      earn(sim, sim.karts[e.victim]!, -SWAGGER.spin);
    } else if (e.type === 'peelHit') {
      earn(sim, sim.karts[e.kart]!, -SWAGGER.spin);
      if (e.owner !== e.kart) {
        earn(sim, sim.karts[e.owner]!, SWAGGER.peelVictim);
        sim.swaggerTrack[e.owner]!.sinceHit = 0;
      }
    } else if (e.type === 'bonk') {
      earn(sim, sim.karts[e.kart]!, -SWAGGER.bonk);
    }
  }
  if (!client) for (const i of sim.respawned) earn(sim, sim.karts[i]!, -SWAGGER.respawn);

  for (const kart of sim.karts) {
    if (kart.out || (client && kart.index !== sim.own)) continue;
    const input = held[kart.index]!;
    if (!client) earnings(sim, kart, input);

    // Firing: hold the button, then a wind-up, then the move.
    if (kart.moveWindup > 0) {
      kart.moveWindup -= dt;
      if (kart.moveWindup <= 1e-9) {
        kart.moveWindup = 0;
        fire(sim, kart);
      }
      continue;
    }
    const can = kart.swagger >= SWAGGER.max && !kart.spinning && !kart.flying;
    kart.swaggerHold = can && input.swagger ? kart.swaggerHold + dt : 0;
    if (kart.swaggerHold >= SWAGGER.hold) {
      kart.swaggerHold = 0;
      kart.swagger = 0;
      kart.moveWindup = SWAGGER.windup;
      kart.moveT = 0;
      sim.items.events.push({ type: 'swagger', kart: kart.index, move: kart.move, pos: kart.position, phase: 'windup' });
    }
  }
}

/** What one kart earned (or lost) by its driving this step. */
function earnings(sim: RaceSim, kart: Kart, input: DriverInput): void {
  const dt = sim.dt;
  {
    const st = sim.swaggerTrack[kart.index]!;
    const pr = sim.progress[kart.index]!;
    st.sinceHit += dt;
    st.brakeCool = Math.max(0, st.brakeCool - dt);
    const speed = kart.forwardSpeed;
    // Air (not a parrot ride), and a tidy landing at the end of it.
    if (kart.grounded === 0 && !kart.flying) earn(sim, kart, SWAGGER.airPerSecond * dt);
    if (kart.landedThisStep && kart.up.y > 0.966 && kart.grounded >= 3) earn(sim, kart, SWAGGER.cleanLanding);
    // A parrot ride ending on the road.
    if (st.wasFlying && !kart.flying && kart.grounded > 0 && Math.abs(pr.lateral) < sim.track.at(pr.s).halfWidth) {
      earn(sim, kart, SWAGGER.parrotLanding);
    }
    if (!kart.flying) st.wasFlying = false;
    if (kart.flying) st.wasFlying = true;
    // Overtakes: a better place has to stick for a moment before it pays —
    // otherwise two karts side by side swap places every step and farm it.
    // Losing a place counts at once; a respawn is never an overtake.
    const place = sim.position(kart.index);
    if (place >= st.lastPlace || sim.respawned.includes(kart.index)) {
      st.lastPlace = place;
      st.betterFor = 0;
    } else {
      st.betterFor += dt;
      if (st.betterFor >= 0.6) {
        earn(sim, kart, SWAGGER.overtake * (st.lastPlace - place));
        st.lastPlace = place;
        st.betterFor = 0;
      }
    }
    // Late braking: hard on the brakes, fast, with a real corner just ahead.
    if (input.brake > 0.8 && speed > 20 && st.brakeCool === 0 && kart.grounded > 0) {
      let k = 0;
      for (let d = 6; d <= 26; d += 4) k = Math.max(k, Math.abs(sim.track.at(pr.s + d).curvature));
      if (k > 0.03) {
        earn(sim, kart, SWAGGER.lateBrake);
        st.brakeCool = 3;
      }
    }
    // Showing off: tap the item button with empty hands just after a hit.
    if (kart.item === 'none' && input.item && !kart.prevInput.item && st.sinceHit < 1) {
      earn(sim, kart, SWAGGER.showOff);
      st.sinceHit = 99;
      kart.showOff = 1.4;
    }
    // Near misses and drafting, against every other kart.
    const pos = kart.position;
    for (const other of sim.karts) {
      if (other === kart || other.out) continue;
      st.nearCool[other.index] = Math.max(0, st.nearCool[other.index]! - dt);
      const rel = sub(other.position, pos);
      const d = Math.hypot(rel.x, rel.z);
      if (d < 2.3 && d > 1.6 && Math.abs(rel.y) < 1.5 && speed > 18 && st.nearCool[other.index] === 0) {
        earn(sim, kart, SWAGGER.nearMiss);
        st.nearCool[other.index] = 2;
      }
      // Tucked in behind: 2–6 m back, nearly in line.
      const ahead = dot(rel, kart.forward);
      const side = Math.abs(dot(rel, kart.right));
      if (ahead > 2 && ahead < 6 && side < 1.5 && speed > 15) earn(sim, kart, SWAGGER.draftPerSecond * dt);
    }
    // Near misses on peels.
    for (const peel of sim.items.peels) {
      const d = Math.hypot(peel.pos.x - pos.x, peel.pos.z - pos.z);
      if (d > ITEMS.peelRadius && d < ITEMS.peelRadius + 0.8 && speed > 18 && st.brakeCool === 0) {
        earn(sim, kart, SWAGGER.nearMiss);
        st.brakeCool = 1;
      }
    }
  }
}

/** Moves that only change the kart making them. */
const SELF_MOVES: readonly Move[] = ['noBrakes', 'pogo', 'tooCool', 'boulder'];

/** The move hits. */
function fire(sim: RaceSim, kart: Kart): void {
  const S = SWAGGER;
  const pos = kart.position;
  const others = sim.karts.filter((o) => o !== kart && !o.out);
  const near = (r: number) => others.filter((o) => length(sub(o.position, pos)) < r);
  const victims: number[] = [];
  kart.moveT = 0;
  // A client plays its own move at once, but what it does to others (and to
  // the items on the road) is the host's to decide.
  const self = sim.role === 'client';
  switch (self && !SELF_MOVES.includes(kart.move) ? null : kart.move) {
    case 'roar':
      // Everyone close and on the ground is blasted back, loses speed,
      // fishtails, and drops any bananas as peels.
      for (const o of near(S.roarRadius)) {
        if (o.grounded === 0 || o.immune) continue;
        o.wobbleTime = Math.max(o.wobbleTime, S.roarWobble);
        // A proxy's own phone feels the blast (net/client.ts).
        if (!o.proxy) roared(o, pos);
        if (o.item === 'banana') {
          for (let i = 0; i < o.charges; i++) sim.items.dropPeel(o, i * 1.6);
          o.item = 'none';
          o.charges = 0;
        }
        victims.push(o.index);
      }
      break;
    case 'noBrakes':
      kart.noBrakesTime = S.noBrakesTime;
      kart.boostTime = Math.max(kart.boostTime, S.noBrakesTime);
      break;
    case 'slowClap': {
      const pr = sim.progress[kart.index]!;
      for (const o of others) {
        const ahead = sim.progress[o.index]!.dist - pr.dist;
        if (ahead > 0 && ahead < S.clapRange && !o.immune) {
          o.slowTime = S.clapTime;
          victims.push(o.index);
        }
      }
      break;
    }
    case 'feed': {
      // Three bananas left behind as pickups — and her own hands refilled.
      const f = kart.forward;
      for (let i = 0; i < S.feedBananas; i++) {
        const at = add(pos, add(scale(f, -4 - i * 2.2), scale(kart.right, (i % 3 - 1) * 2)));
        sim.items.addLoose(at, S.feedTtl);
      }
      if (kart.item === 'none' || kart.item === 'banana') {
        kart.item = 'banana';
        kart.charges = ITEMS.maxBananas;
      }
      break;
    }
    case 'pogo': {
      const v = kart.velocity;
      kart.body.setLinvel(v3(v.x, Math.sqrt(2 * 16 * S.pogoHeight), v.z), true);
      break;
    }
    case 'beat':
      for (const o of near(S.beatRadius)) {
        if (o.immune) continue;
        o.steerSwapTime = S.beatTime;
        victims.push(o.index);
      }
      break;
    case 'tooCool':
      kart.coolTime = S.coolTime;
      break;
    case 'boulder':
      kart.boulderTime = S.boulderTime;
      kart.setMassScale(S.boulderMass);
      break;
  }
  sim.items.events.push({ type: 'swagger', kart: kart.index, move: kart.move, pos, phase: 'hit', victims });
}

/**
 * The physical half of a roar on one kart: speed knocked off and a blast
 * outward from `from`, strongest up close. Shared with the online client.
 */
export function roared(o: Kart, from: Vec3): void {
  const S = SWAGGER;
  const v = o.velocity;
  o.body.setLinvel(v3(v.x * S.roarKeep, v.y, v.z * S.roarKeep), true);
  const rel = sub(o.position, from);
  const d = Math.max(1, Math.hypot(rel.x, rel.z));
  const blast = S.roarBlast * (1 - 0.6 * Math.min(1, d / S.roarRadius));
  o.body.applyImpulse(scale(v3(rel.x / d, 0.25, rel.z / d), blast), true);
}

/** While Steve is too cool or Gus is a boulder, karts that get close are shoved aside. */
export function shoves(sim: RaceSim): void {
  for (const kart of sim.karts) {
    if (kart.out || (kart.coolTime <= 0 && kart.boulderTime <= 0)) continue;
    const pos = kart.position;
    for (const o of sim.karts) {
      if (o === kart || o.out || o.immune || o.proxy) continue;
      const rel = sub(o.position, pos);
      const d = Math.hypot(rel.x, rel.z);
      if (d > SWAGGER.shoveRadius || d < 0.01) continue;
      const push = scale(v3(rel.x / d, 0.15, rel.z / d), SWAGGER.shove * sim.dt * 20);
      o.body.applyImpulse(push, true);
      if (kart.boulderTime > 0) o.wobbleTime = Math.max(o.wobbleTime, 0.6);
    }
  }
}

/** For the AI: is now a good moment for this move? (Aces wait for one; rookies don't.) */
export function goodMoment(sim: RaceSim, kart: Kart): boolean {
  const pos = kart.position;
  const pr = sim.progress[kart.index]!;
  const others = sim.karts.filter((o) => o !== kart && !o.out);
  const within = (r: number) => others.filter((o) => length(sub(o.position, pos)) < r).length;
  const ahead = (r: number) => others.filter((o) => {
    const a = sim.progress[o.index]!.dist - pr.dist;
    return a > 0 && a < r;
  }).length;
  const hazardAhead = (d: number) => {
    for (let x = 4; x < d; x += 4) {
      if (sim.track.inGap(pr.s + x) || sim.track.inBrush(pr.s + x, pr.lateral) || sim.track.inWater(pr.s + x)) return true;
    }
    return sim.items.peels.some((p) => {
      const q = sim.track.project(p.pos, pr.s);
      const a = sim.track.delta(pr.s, q.s);
      return a > 0 && a < d && Math.abs(q.lateral - pr.lateral) < 2.5;
    });
  };
  const lava = Number.isFinite(sim.lavaS) && pr.s - sim.lavaS < 40;
  switch (kart.move) {
    case 'roar':
      return within(SWAGGER.roarRadius) >= 2;
    case 'slowClap':
      return ahead(SWAGGER.clapRange) >= 1;
    case 'beat':
      return within(SWAGGER.beatRadius) >= 2;
    case 'pogo':
      return hazardAhead(30);
    case 'tooCool':
      return hazardAhead(40) || lava;
    case 'boulder':
      return within(6) >= 2 || hazardAhead(25);
    case 'noBrakes': {
      let k = 0;
      for (let d = 10; d < 60; d += 5) k = Math.max(k, Math.abs(sim.track.at(pr.s + d).curvature));
      return k > 0.025;
    }
    case 'feed':
      return kart.item === 'none';
  }
}

