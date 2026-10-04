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
 * Rubber-banding is deliberately light: AI well ahead of the leading player
 * lose a little power and AI well behind gain a little, so races stay close
 * without the leader feeling robbed.
 */

import { KART } from '../data/tuning.js';
import type { DriverInput } from './input.js';
import type { Items } from './items.js';
import type { Kart } from './kart.js';
import { clamp, dot, lerp, sub } from './math.js';
import type { Progress } from './race.js';
import type { Rng } from './rng.js';
import type { Track } from './track.js';

export interface Personality {
  /** Preferred lane, m (+ = right). */
  lane: number;
  /** How far the lane weaves, m, and how often (rad per metre). */
  weave: number;
  weaveFreq: number;
  phase: number;
  /** 0.9 .. 1.0: fraction of the kart's full power. */
  skill: number;
  /** Lateral grip the driver trusts in corners, m/s². */
  cornerGrip: number;
  /** Seconds it waits before eating a banana it has picked up. */
  patience: number;
}

export function personality(rng: Rng, index: number): Personality {
  return {
    lane: rng.range(-3.5, 3.5),
    weave: rng.range(0.8, 2.4),
    weaveFreq: rng.range(0.015, 0.04),
    phase: rng.range(0, Math.PI * 2),
    // A spread so the field strings out rather than running as one blob.
    skill: 0.9 + 0.1 * ((index * 0.37) % 1),
    cornerGrip: rng.range(17, 22),
    patience: rng.range(0.4, 2.5),
  };
}

export class AiDriver {
  readonly me: Personality;
  private holding = 0;
  private pressed = false;
  /** Seconds spent pushing without moving, and seconds left of backing out. */
  private blocked = 0;
  private reversing = 0;

  constructor(me: Personality) {
    this.me = me;
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

    // Rubber-band against the best human, when there is one.
    let band = 1;
    if (leaderPlayerDist !== null) {
      const gap = pr.dist - leaderPlayerDist;
      band = clamp(1 - gap / 1500, 0.9, 1.08);
    }
    kart.power = me.skill * band;

    // Curvature ahead decides speed; a gap ahead overrides it.
    const reach = 12 + Math.max(0, speed) * 1.4;
    let maxK = 0;
    let gapAhead = false;
    for (let d = 4; d <= reach; d += 3) {
      const k = track.at(pr.s + d);
      maxK = Math.max(maxK, Math.abs(k.curvature));
      if (!k.road || track.inGap(pr.s + d + 10)) gapAhead = true;
    }
    const cornerSpeed = Math.sqrt(me.cornerGrip / Math.max(maxK, 1e-4));

    // Lane: personal offset, a weave, and a cut to the inside of the corner.
    const here = track.at(pr.s + 10);
    let lane = me.lane + Math.sin(pr.dist * me.weaveFreq + me.phase) * me.weave;
    lane -= clamp(here.curvature * 120, -1, 1) * 3; // + curvature = left turn = inside is left (-)
    if (gapAhead) lane = 0;
    lane = this.dodgePeels(lane, pr, track, items);
    const limit = here.halfWidth - 1.8;
    lane = clamp(lane, -limit, limit);

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
    let steer = clamp(angle / lock, -1, 1);
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
    } else if (Math.abs(speed) < 1.5 && !kart.spinning) {
      this.blocked += dt;
      if (this.blocked > 0.7) {
        this.blocked = 0;
        this.reversing = 1.1;
      }
    } else {
      this.blocked = 0;
    }

    const use = this.items(dt, kart, maxK, gapAhead, karts, items);
    return { throttle, brake, steer, ...use };
  }

  /** Shift the lane away from any peel lying near it in the next stretch. */
  private dodgePeels(lane: number, pr: Progress, track: Track, items: Items): number {
    for (const peel of items.peels) {
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
    if (kart.item === 'banana') {
      const straight = maxK < 0.012;
      if (this.holding > this.me.patience && (straight || gapAhead) && !kart.boosting) {
        this.pressed = true;
        this.holding = 0;
        return { ...none, item: true };
      }
      return none;
    }
    // Snake.
    if (kart.swingCooldown > 0) return none;
    const left = items.target(kart, -1, karts);
    const right = items.target(kart, 1, karts);
    if (!left && !right) return none;
    this.pressed = true;
    if (left && (!right || left.d < right.d)) return { ...none, whackLeft: true };
    return { ...none, whackRight: true };
  }
}
