/**
 * The AI gorillas.
 *
 * Pure pursuit toward a point on a racing line ahead, like RSC's driver, plus
 * what racing needs on top: each AI keeps its own lane offset that weaves a
 * little so the pack spreads out, cuts toward the inside of corners, slows only
 * as much as the curvature ahead demands, keeps its foot down into a gap, steps
 * around peels, eats bananas on straights, and swings its snake at anyone
 * alongside.
 *
 * Not every gorilla is good at that. Each has a `level`, 0 (rookie) to 1
 * (ace), and it shapes everything: engine, how much grip it trusts, how early
 * it brakes, how steady its hands are, how often it overcooks a corner — and
 * how it uses items. Rookies fire bananas whenever, swing the snake late (or
 * at nothing), miss peels on the road and take whatever line the parrot
 * happens to fly. A field is a spread of levels, shifted by the difficulty.
 * The AI's own randomness is seeded, so races still replay exactly.
 *
 * Rubber-banding is deliberately light: AI well ahead of the leading player
 * lose a little power and AI well behind gain a little, so races stay close
 * without the leader feeling robbed.
 */

import { KART, PARROT } from '../data/tuning.js';
import type { DriverInput } from './input.js';
import type { Items } from './items.js';
import type { Kart } from './kart.js';
import { clamp, dot, lerp, sub } from './math.js';
import type { Progress } from './race.js';
import { Rng } from './rng.js';
import type { Track } from './track.js';

export type Difficulty = 'chill' | 'normal' | 'wild';

/** The range of AI levels in a field, per difficulty. */
const LEVELS: Record<Difficulty, [number, number]> = {
  chill: [0, 0.5],
  normal: [0.1, 0.85],
  wild: [0.5, 1],
};

/** Levels for `count` AI drivers, evenly spread over the difficulty's range, shuffled. */
export function fieldLevels(difficulty: Difficulty, count: number, rng: Rng): number[] {
  const [lo, hi] = LEVELS[difficulty];
  const levels = Array.from({ length: count }, (_, i) => (count === 1 ? hi : lo + ((hi - lo) * i) / (count - 1)));
  for (let i = levels.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [levels[i], levels[j]] = [levels[j]!, levels[i]!];
  }
  return levels;
}

export interface Personality {
  /** 0 rookie .. 1 ace. Everything below is derived from it, with a little jitter. */
  level: number;
  /** Preferred lane, m (+ = right). */
  lane: number;
  /** How far the lane weaves, m, and how often (rad per metre). */
  weave: number;
  weaveFreq: number;
  phase: number;
  /** Fraction of the kart's full power. */
  skill: number;
  /** Lateral grip the driver trusts in corners, m/s². */
  cornerGrip: number;
  /** Deceleration it plans its braking around, m/s² (rookies brake early). */
  brakeDecel: number;
  /** Steering wobble, fraction of full lock. */
  steerNoise: number;
  /** Chance per second of overcooking the next corner. */
  mistakes: number;
  /** 0..1: how well it uses items. */
  itemIQ: number;
  /** Seconds it waits before using an item it has picked up. */
  patience: number;
  /** Seeds the driver's own decisions. */
  seed: number;
}

/** Level for kart `index` when no field was set up (tests, headless runs). */
const defaultLevel = (index: number) => 0.2 + 0.7 * ((index * 0.37) % 1);

export function personality(rng: Rng, index: number, level = defaultLevel(index)): Personality {
  const l = Math.min(1, Math.max(0, level));
  const jitter = () => rng.range(-0.05, 0.05);
  return {
    level: l,
    lane: rng.range(-3.5, 3.5),
    weave: rng.range(0.8, 2.4) * (1.6 - 0.6 * l),
    weaveFreq: rng.range(0.015, 0.04),
    phase: rng.range(0, Math.PI * 2),
    skill: 0.86 + 0.14 * l + jitter() * 0.2,
    cornerGrip: 13 + 9 * l + jitter() * 10,
    brakeDecel: 11 + 6 * l,
    steerNoise: (1 - l) * 0.14,
    mistakes: (1 - l) * 0.12,
    itemIQ: Math.min(1, Math.max(0, l + jitter() * 2)),
    patience: rng.range(0.4, 2.5) + (1 - l) * rng.range(0, 4),
    seed: Math.floor(rng.next() * 0xffffffff),
  };
}

export class AiDriver {
  readonly me: Personality;
  private readonly rng: Rng;
  private holding = 0;
  private pressed = false;
  /** Seconds spent pushing without moving, and seconds left of backing out. */
  private blocked = 0;
  private reversing = 0;
  private t = 0;
  /** Seconds left of a corner it is about to overcook. */
  private overcook = 0;
  /** Seconds a whack target has been alongside (reaction time). */
  private sighted = 0;

  constructor(me: Personality) {
    this.me = me;
    this.rng = new Rng(me.seed ?? 1);
  }

  /** A fixed 0..1 roll per (driver, thing) — e.g. "does this driver ever notice that peel?". */
  private notices(id: number): number {
    let h = (Math.imul(id + 1, 2654435761) ^ (this.me.seed ?? 1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    return (h >>> 0) / 4294967296;
  }

  drive(
    dt: number,
    kart: Kart,
    pr: Progress,
    track: Track,
    karts: readonly Kart[],
    items: Items,
    leaderPlayerDist: number | null,
  ): DriverInput {
    const me = this.me;
    const pos = kart.position;
    const fwd = kart.forward;
    const right = kart.right;
    const speed = kart.forwardSpeed;
    this.t += dt;
    if (kart.flying) return this.fly(kart, pr, track);
    // Now and then a less able driver goes into the next corner too hot.
    this.overcook = Math.max(0, this.overcook - dt);
    if (this.overcook === 0 && this.rng.next() < me.mistakes * dt) this.overcook = 1.6;
    const trust = this.overcook > 0 ? 1.45 : 1;

    // Rubber-band against the best human, when there is one.
    let band = 1;
    if (leaderPlayerDist !== null) {
      const gap = pr.dist - leaderPlayerDist;
      band = clamp(1 - gap / 1500, 0.9, 1.08);
    }
    kart.power = me.skill * band;

    // Speed: for every corner ahead, the fastest we could be going *now* and
    // still brake down to its cornering speed in the distance left
    // (v² = v_corner² + 2·a·d). Brake late and hard, like a good driver.
    // A gap ahead overrides it — never arrive at the river slow.
    const reach = 18 + Math.max(0, speed) * 2.2;
    let maxK = 0;
    let gapAhead = false;
    let cornerSpeed = Infinity;
    for (let d = 2; d <= reach; d += 2) {
      const k = track.at(pr.s + d);
      const curv = Math.abs(k.curvature);
      if (d < 40) maxK = Math.max(maxK, curv);
      if (!k.road || track.inGap(pr.s + d + 10)) gapAhead = true;
      const vCorner = Math.sqrt((me.cornerGrip * trust) / Math.max(curv, 1e-4));
      cornerSpeed = Math.min(cornerSpeed, Math.sqrt(vCorner * vCorner + 2 * me.brakeDecel * trust * Math.max(0, d - 3)));
    }

    // Lane: personal offset, a weave, and a cut to the inside of the corner.
    const here = track.at(pr.s + 10);
    let lane = me.lane + Math.sin(pr.dist * me.weaveFreq + me.phase) * me.weave;
    lane -= clamp(here.curvature * 120, -1, 1) * 3; // + curvature = left turn = inside is left (-)
    if (gapAhead) lane = 0;
    lane = this.dodgePeels(lane, pr, track, items);
    // A fallen tree's crown ahead: take the clear half (if it is seen in time).
    for (const b of track.brush) {
      const ahead = track.delta(pr.s, b.s0);
      if (ahead > -2 && ahead < 45 && this.notices(9000 + Math.floor(b.s0)) < 0.5 + 0.5 * me.itemIQ) lane = -b.side * here.halfWidth * 0.5;
    }
    // No railing: hold the middle, whatever the line says.
    const openL = track.isOpen(pr.s + 10, -1) || track.isOpen(pr.s, -1);
    const openR = track.isOpen(pr.s + 10, 1) || track.isOpen(pr.s, 1);
    const limit = here.halfWidth - 1.8;
    lane = clamp(lane, openL ? -1 : -limit, openR ? 1 : limit);
    // Water ahead: a good driver lines up straight to skim across it.
    const fordAhead = track.inWater(pr.s + 18) || track.inWater(pr.s + 6);
    if (fordAhead && me.level > 0.5) lane = clamp(lane * 0.3, -1.5, 1.5);
    const careful = openL || openR || (fordAhead && me.level > 0.5) ? 0.35 : 1;

    // Pure pursuit.
    const look = 6 + Math.max(0, speed) * 0.45;
    const target = track.pointAt(pr.s + look, lane);
    const rel = sub(target, pos);
    const x = dot(rel, right);
    const z = dot(rel, fwd);
    const ld2 = Math.max(x * x + z * z, 1);
    const wheelbase = KART.wheelFrontZ - KART.wheelRearZ;
    const angle = Math.atan2(2 * wheelbase * x, ld2);
    const lock = lerp(KART.steerLow, KART.steerHigh, clamp(Math.abs(speed) / KART.topSpeed, 0, 1));
    // Unsteady hands: a slow wander on top of the line, bigger for rookies.
    const wander = (Math.sin(this.t * 0.9 + me.phase) + Math.sin(this.t * 2.3 + me.phase * 2) * 0.5) * me.steerNoise * careful;
    let steer = clamp(angle / lock + wander, -1, 1);
    if (z < 0) steer = x >= 0 ? 1 : -1; // Facing the wrong way: turn round.

    let throttle = 1;
    let brake = 0;
    if (!gapAhead && speed > cornerSpeed + 1.5) {
      throttle = 0;
      brake = clamp((speed - cornerSpeed) / 6, 0.2, 1);
    } else if (!gapAhead && speed > cornerSpeed) {
      throttle = 0.4;
    }

    // Nosed into a wall or a pile-up: back out on opposite lock, then go again.
    if (this.reversing > 0) {
      this.reversing -= dt;
      throttle = 0;
      brake = 1;
      steer = -steer;
    } else if (Math.abs(speed) < 1.5 && !kart.spinning && kart.applied.throttle > 0.5) {
      // (Only while the kart was actually driving — during the countdown it
      // is held still, and counting that made the whole grid reverse at GO.)
      this.blocked += dt;
      if (this.blocked > 0.7) {
        this.blocked = 0;
        this.reversing = 1.1;
      }
    } else {
      this.blocked = 0;
    }

    const use = this.items(dt, kart, maxK, gapAhead, karts, items, pr, track);
    return { throttle, brake, steer, ...use };
  }

  /**
   * On the parrot: aim straight at the furthest point down the lap that the
   * remaining flight can reach, so the AI cuts across the infield.
   */
  private fly(kart: Kart, pr: Progress, track: Track): DriverInput {
    const pos = kart.position;
    // Aces find the longest shortcut the flight can reach; rookies flap
    // roughly onward and leave most of it on the table.
    const reach = Math.max(0, kart.flyTime - 0.4) * PARROT.speed * 0.9 * (0.45 + 0.45 * this.me.itemIQ);
    const best = shortcut(pos, pr.s, track, reach);
    const target = track.pointAt(pr.s + best, 0);
    const rel = sub(target, pos);
    const x = dot(rel, kart.right);
    const z = dot(rel, kart.forward);
    const steer = clamp(Math.atan2(x, Math.max(z, 0.1)) * 1.6, -1, 1);
    return { throttle: 1, brake: 0, steer, item: false, whackLeft: false, whackRight: false };
  }

  /** Shift the lane away from any peel lying near it in the next stretch. */
  private dodgePeels(lane: number, pr: Progress, track: Track, items: Items): number {
    for (const peel of items.peels) {
      // Some drivers never see some peels.
      if (this.notices(peel.id) > 0.25 + 0.75 * this.me.itemIQ) continue;
      const p = track.project(peel.pos, pr.s);
      const ahead = track.delta(pr.s, p.s);
      if (ahead < 3 || ahead > 30) continue;
      if (Math.abs(p.lateral - lane) < 2.2) lane = p.lateral + (lane >= p.lateral ? 3 : -3);
    }
    return lane;
  }

  private items(
    dt: number,
    kart: Kart,
    maxK: number,
    gapAhead: boolean,
    karts: readonly Kart[],
    items: Items,
    pr: Progress,
    track: Track,
  ): Pick<DriverInput, 'item' | 'whackLeft' | 'whackRight'> {
    const none = { item: false, whackLeft: false, whackRight: false };
    // Buttons have to be released between presses — the sim acts on rising edges.
    if (this.pressed) {
      this.pressed = false;
      return none;
    }
    if (kart.item === 'none') {
      this.holding = 0;
      return none;
    }
    this.holding += dt;
    const iq = this.me.itemIQ;
    if (kart.item === 'parrot') {
      // A smart driver waits for a flight that cuts off a lot of track;
      // a rookie just goes once it feels like it.
      const reach = (PARROT.time - 0.6) * PARROT.speed * 0.9;
      const skip = shortcut(kart.position, pr.s, track, reach);
      const worth = iq < 0.4 || skip > reach * 1.4 || this.holding > 8;
      if (this.holding > this.me.patience && worth && !gapAhead) {
        this.pressed = true;
        this.holding = 0;
        return { ...none, item: true };
      }
      return none;
    }
    if (kart.item === 'banana') {
      // Smart: boost down straights. Rookie: whenever (even mid-corner).
      const straight = maxK < 0.012 || iq < 0.35;
      // Never into a gap: a boosted kart overshoots the landing.
      if (this.holding > this.me.patience && straight && !gapAhead && !kart.boosting) {
        this.pressed = true;
        this.holding = 0;
        return { ...none, item: true };
      }
      return none;
    }
    // Snake.
    if (kart.swingCooldown > 0) return none;
    // Rookies sometimes swing at thin air.
    if (this.rng.next() < (1 - iq) * 0.3 * dt) {
      this.pressed = true;
      return this.rng.next() < 0.5 ? { ...none, whackLeft: true } : { ...none, whackRight: true };
    }
    const left = items.target(kart, -1, karts);
    const right = items.target(kart, 1, karts);
    if (!left && !right) {
      this.sighted = 0;
      return none;
    }
    // Reaction time: a target has to be alongside a moment before it swings.
    this.sighted += dt;
    if (this.sighted < (1 - iq) * 0.7) return none;
    this.sighted = 0;
    this.pressed = true;
    // ...and a slow reader picks the wrong side now and then.
    const wrong = this.rng.next() < (1 - iq) * 0.3;
    const goLeft = !!left && (!right || left.d < right.d);
    return goLeft !== wrong ? { ...none, whackLeft: true } : { ...none, whackRight: true };
  }
}

/**
 * The furthest distance down the lap (m) whose road point lies within `reach`
 * metres in a straight line — where a parrot flight can get to.
 */
export function shortcut(pos: { x: number; z: number }, s: number, track: Track, reach: number): number {
  let best = 30;
  const limit = track.length * PARROT.maxSkip * 0.9;
  for (let d = 30; d <= limit; d += 8) {
    const k = track.at(s + d);
    if (!k.road) continue;
    if (Math.hypot(k.p.x - pos.x, k.p.z - pos.z) <= reach) best = d;
  }
  return best;
}
