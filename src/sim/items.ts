/**
 * Pickups, banana peels and snake whacks.
 *
 * - **Pickups** float over a glowing ring at fixed spots on the track. Each is
 *   a banana, a snake or a parrot. Drive through one with empty hands to
 *   take it; it comes back a few seconds later, re-rolled.
 * - **Bananas:** one per pickup, stacking up to three (drive through more
 *   while holding bananas). Each one eaten is a 3 s boost and drops a
 *   peel behind you. Peels have no timer — they stay until somebody hits one
 *   and spins out. (The track holds at most `maxPeels`; the oldest goes first.)
 * - **Snake:** three swings, left or right, Road Rash style. A swing hits the
 *   nearest kart alongside on that side: it loses speed and wobbles.
 *
 * Players hold one item at a time. Everything is seeded, so a race replays
 * exactly from its seed and inputs.
 */

import { ITEMS } from '../data/tuning.js';
import type { DriverInput } from './input.js';
import type { ItemKind, Kart } from './kart.js';
import type { Move } from './swagger.js';
import { type Vec3, add, dot, scale, sub, v3 } from './math.js';
import type { Rng } from './rng.js';
import type { Track } from './track.js';

export interface PickupState {
  pos: Vec3;
  kind: Exclude<ItemKind, 'none'>;
  active: boolean;
  respawn: number;
}

export interface Peel {
  id: number;
  pos: Vec3;
  /** Heading the peel landed at, for the renderer. */
  yaw: number;
  owner: number;
  age: number;
}

export type ItemEvent =
  | { type: 'pickup'; kart: number; kind: Exclude<ItemKind, 'none'>; pos: Vec3 }
  | { type: 'boost'; kart: number; pos: Vec3 }
  | { type: 'peelDrop'; kart: number; pos: Vec3 }
  | { type: 'peelHit'; kart: number; owner: number; pos: Vec3 }
  | { type: 'swing'; kart: number; side: -1 | 1; pos: Vec3 }
  | { type: 'whack'; kart: number; victim: number; pos: Vec3 }
  | { type: 'bonk'; kart: number; pos: Vec3; strength: number }
  | { type: 'parrot'; kart: number; pos: Vec3 }
  | { type: 'toasted'; kart: number; pos: Vec3 }
  | { type: 'track'; kind: 'treefall' | 'flood' | 'snap'; pos: Vec3; stage?: number }
  | { type: 'swagger'; kart: number; move: Move; pos: Vec3; phase: 'windup' | 'hit'; victims?: number[] };

/** A banana lying loose on the road (Mama Mango's Feed the Troop): first come, first served. */
export interface Loose {
  id: number;
  pos: Vec3;
  ttl: number;
}

const rising = (now: boolean, before: boolean) => now && !before;

export class Items {
  readonly pickups: PickupState[];
  readonly peels: Peel[] = [];
  readonly loose: Loose[] = [];
  private nextLoose = 1;
  events: ItemEvent[] = [];
  private nextPeel = 1;
  private readonly rng: Rng;
  private readonly track: Track;

  constructor(track: Track, rng: Rng) {
    this.rng = rng;
    this.track = track;
    this.pickups = track.pickups.map((p) => ({
      pos: p.pos,
      kind: this.roll(),
      active: true,
      respawn: 0,
    }));
  }

  private roll(): Exclude<ItemKind, 'none'> {
    const r = this.rng.next();
    if (r < ITEMS.parrotChance) return 'parrot';
    return r < ITEMS.parrotChance + ITEMS.snakeChance ? 'snake' : 'banana';
  }

  /** Give a kart an item directly (tests, debug). */
  static give(kart: Kart, kind: Exclude<ItemKind, 'none'>, count = 1): void {
    kart.item = kind;
    kart.charges = kind === 'banana' ? Math.min(ITEMS.maxBananas, count) : kind === 'snake' ? ITEMS.snakeSwings : 1;
  }

  /**
   * Can this kart take a pickup of `kind`? Empty hands take anything; a kart
   * holding bananas can stack more bananas up to the limit; otherwise one
   * item at a time.
   */
  static canTake(kart: Kart, kind: Exclude<ItemKind, 'none'>): boolean {
    if (kart.item === 'none') return true;
    return kind === 'banana' && kart.item === 'banana' && kart.charges < ITEMS.maxBananas;
  }

  /** Take a pickup: a fresh item, or one more banana on the stack. */
  static take(kart: Kart, kind: Exclude<ItemKind, 'none'>): void {
    if (kind === 'banana' && kart.item === 'banana') kart.charges = Math.min(ITEMS.maxBananas, kart.charges + 1);
    else Items.give(kart, kind);
  }

  /**
   * One fixed step. `inputs[i]` is kart i's held input this step; the karts'
   * `prevInput` still holds last step's, so call this *before* the karts step.
   */
  step(dt: number, karts: readonly Kart[], inputs: readonly DriverInput[], canUse: boolean): void {
    for (const p of this.pickups) {
      if (p.active) continue;
      p.respawn -= dt;
      if (p.respawn <= 0) {
        p.active = true;
        p.kind = this.roll();
      }
    }
    for (const peel of this.peels) peel.age += dt;
    for (let i = this.loose.length - 1; i >= 0; i--) {
      this.loose[i]!.ttl -= dt;
      if (this.loose[i]!.ttl <= 0) this.loose.splice(i, 1);
    }

    for (const kart of karts) {
      if (kart.out) continue;
      const pos = kart.position;
      this.collect(kart, pos);
      if (canUse) this.use(kart, inputs[kart.index]!, karts);
      this.peelHits(kart, pos);
    }
  }

  /** Leave a banana on the road at `at` (dropped onto the surface). */
  addLoose(at: Vec3, ttl: number): void {
    const proj = this.track.project(at, -1);
    const k = this.track.at(proj.s);
    const pos = add(sub(at, scale(k.n, proj.height)), v3(0, 1.0, 0));
    this.loose.push({ id: this.nextLoose++, pos, ttl });
  }

  /** Drop a peel behind `kart`, `back` metres further back than usual. */
  dropPeel(kart: Kart, back = 0): void {
    const f = kart.forward;
    let at = add(kart.position, scale(f, -2.2 - back));
    const proj = this.track.project(at, -1);
    const k = this.track.at(proj.s);
    if (k.road) at = sub(at, scale(k.n, proj.height));
    this.peels.push({ id: this.nextPeel++, pos: at, yaw: Math.atan2(f.x, f.z), owner: kart.index, age: 0 });
    if (this.peels.length > ITEMS.maxPeels) this.peels.shift();
    this.events.push({ type: 'peelDrop', kart: kart.index, pos: at });
  }

  private collect(kart: Kart, pos: Vec3): void {
    if (kart.flying) return;
    const r2 = ITEMS.pickupRadius * ITEMS.pickupRadius;
    for (let i = 0; i < this.loose.length; i++) {
      const l = this.loose[i]!;
      if (!Items.canTake(kart, 'banana')) break;
      const d = sub(pos, l.pos);
      if (d.x * d.x + d.y * d.y * 0.5 + d.z * d.z > r2) continue;
      Items.take(kart, 'banana');
      this.loose.splice(i, 1);
      this.events.push({ type: 'pickup', kart: kart.index, kind: 'banana', pos: l.pos });
      return;
    }
    for (const p of this.pickups) {
      if (!p.active || !Items.canTake(kart, p.kind)) continue;
      const d = sub(pos, p.pos);
      if (d.x * d.x + d.y * d.y * 0.5 + d.z * d.z > r2) continue;
      Items.take(kart, p.kind);
      p.active = false;
      p.respawn = ITEMS.pickupRespawn;
      this.events.push({ type: 'pickup', kart: kart.index, kind: p.kind, pos: p.pos });
      return;
    }
  }

  private use(kart: Kart, input: DriverInput, karts: readonly Kart[]): void {
    const prev = kart.prevInput;
    if (kart.item === 'banana' && rising(input.item, prev.item)) {
      this.eatBanana(kart);
      return;
    }
    if (kart.item === 'parrot' && rising(input.item, prev.item)) {
      kart.item = 'none';
      kart.charges = 0;
      const pos = kart.position;
      const road = this.track.at(this.track.project(pos, -1).s);
      kart.takeOff(Math.max(road.p.y, pos.y - 1));
      this.events.push({ type: 'parrot', kart: kart.index, pos });
      return;
    }
    if (kart.item !== 'snake') return;
    let side: -1 | 0 | 1 = 0;
    if (rising(input.whackLeft, prev.whackLeft)) side = -1;
    else if (rising(input.whackRight, prev.whackRight)) side = 1;
    else if (rising(input.item, prev.item)) {
      // The generic use button swings at whoever is closest alongside.
      const l = this.target(kart, -1, karts);
      const r = this.target(kart, 1, karts);
      side = l && (!r || l.d < r.d) ? -1 : 1;
    }
    if (side !== 0) this.swing(kart, side, karts);
  }

  private eatBanana(kart: Kart): void {
    kart.boostTime = ITEMS.boostTime;
    kart.charges--;
    if (kart.charges <= 0) {
      kart.item = 'none';
      kart.charges = 0;
    }
    const pos = kart.position;
    this.events.push({ type: 'boost', kart: kart.index, pos });
    // The peel lands behind the kart, on the road (or ramp) surface.
    const f = kart.forward;
    let at = add(pos, scale(f, -2.2));
    const proj = this.track.project(at, -1);
    const k = this.track.at(proj.s);
    if (k.road) {
      const surface = this.track.kickerHeight(proj.s, proj.lateral) - this.track.surfaceDrop(proj.lateral, k.halfWidth);
      at = sub(at, scale(k.n, proj.height - surface));
    }
    this.peels.push({ id: this.nextPeel++, pos: at, yaw: Math.atan2(f.x, f.z), owner: kart.index, age: 0 });
    if (this.peels.length > ITEMS.maxPeels) this.peels.shift();
    this.events.push({ type: 'peelDrop', kart: kart.index, pos: at });
  }

  /** The nearest kart in the swing zone on `side` (-1 left, 1 right). */
  target(kart: Kart, side: -1 | 1, karts: readonly Kart[]): { kart: Kart; d: number } | null {
    const pos = kart.position;
    const right = kart.right;
    const fwd = kart.forward;
    let best: { kart: Kart; d: number } | null = null;
    for (const other of karts) {
      if (other === kart || other.flying || other.out || other.immune) continue;
      const rel = sub(other.position, pos);
      const lat = dot(rel, right) * side;
      const lon = dot(rel, fwd);
      if (lat < ITEMS.whackLateralMin || lat > ITEMS.whackLateralMax) continue;
      if (Math.abs(lon) > ITEMS.whackLong || Math.abs(rel.y) > 2) continue;
      const d = Math.hypot(lat, lon);
      if (!best || d < best.d) best = { kart: other, d };
    }
    return best;
  }

  private swing(kart: Kart, side: -1 | 1, karts: readonly Kart[]): void {
    if (kart.swingCooldown > 0) return;
    kart.swingSide = side;
    kart.swingTime = 0;
    kart.swingCooldown = ITEMS.swingCooldown;
    kart.charges--;
    if (kart.charges <= 0) {
      kart.item = 'none';
      kart.charges = 0;
    }
    this.events.push({ type: 'swing', kart: kart.index, side, pos: kart.position });
    const hit = this.target(kart, side, karts);
    if (!hit) return;
    const victim = hit.kart;
    const v = victim.velocity;
    victim.body.setLinvel(v3(v.x * ITEMS.whackKeep, v.y, v.z * ITEMS.whackKeep), true);
    victim.wobbleTime = ITEMS.wobbleTime;
    victim.body.applyImpulse(scale(kart.right, side * ITEMS.whackShove), true);
    this.events.push({ type: 'whack', kart: kart.index, victim: victim.index, pos: victim.position });
  }

  private peelHits(kart: Kart, pos: Vec3): void {
    if (kart.spinning || kart.flying || kart.immune) return;
    const r2 = ITEMS.peelRadius * ITEMS.peelRadius;
    for (let i = 0; i < this.peels.length; i++) {
      const peel = this.peels[i]!;
      if (peel.owner === kart.index && peel.age < ITEMS.peelGrace) continue;
      const d = sub(pos, peel.pos);
      if (Math.abs(d.y) > 1.6 || d.x * d.x + d.z * d.z > r2) continue;
      this.peels.splice(i, 1);
      this.spinOut(kart);
      this.events.push({ type: 'peelHit', kart: kart.index, owner: peel.owner, pos: peel.pos });
      return;
    }
  }

  spinOut(kart: Kart): void {
    if (kart.immune) return;
    kart.spinTime = ITEMS.spinTime;
    kart.boostTime = 0;
  }
}
