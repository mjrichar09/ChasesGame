/**
 * Pickups, banana peels and snake whacks.
 *
 * - **Pickups** float over a glowing ring at fixed spots on the track. Each is
 *   either a banana bunch or a snake. Drive through one with empty hands to
 *   take it; it comes back a few seconds later, re-rolled.
 * - **Banana bunch:** three bananas. Each one eaten is a 3 s boost and drops a
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
  | { type: 'peelHit'; kart: number; pos: Vec3 }
  | { type: 'swing'; kart: number; side: -1 | 1; pos: Vec3 }
  | { type: 'whack'; kart: number; victim: number; pos: Vec3 };

const rising = (now: boolean, before: boolean) => now && !before;

export class Items {
  readonly pickups: PickupState[];
  readonly peels: Peel[] = [];
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
    return this.rng.next() < ITEMS.snakeChance ? 'snake' : 'banana';
  }

  /** Give a kart an item directly (tests, debug). */
  static give(kart: Kart, kind: Exclude<ItemKind, 'none'>): void {
    kart.item = kind;
    kart.charges = kind === 'banana' ? ITEMS.bananasPerBunch : ITEMS.snakeSwings;
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

    for (const kart of karts) {
      const pos = kart.position;
      this.collect(kart, pos);
      if (canUse) this.use(kart, inputs[kart.index]!, karts);
      this.peelHits(kart, pos);
    }
  }

  private collect(kart: Kart, pos: Vec3): void {
    if (kart.item !== 'none') return;
    const r2 = ITEMS.pickupRadius * ITEMS.pickupRadius;
    for (const p of this.pickups) {
      if (!p.active) continue;
      const d = sub(pos, p.pos);
      if (d.x * d.x + d.y * d.y * 0.5 + d.z * d.z > r2) continue;
      Items.give(kart, p.kind);
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
    if (k.road) at = sub(at, scale(k.n, proj.height - this.track.kickerHeight(proj.s, proj.lateral)));
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
      if (other === kart) continue;
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
    if (kart.spinning) return;
    const r2 = ITEMS.peelRadius * ITEMS.peelRadius;
    for (let i = 0; i < this.peels.length; i++) {
      const peel = this.peels[i]!;
      if (peel.owner === kart.index && peel.age < ITEMS.peelGrace) continue;
      const d = sub(pos, peel.pos);
      if (Math.abs(d.y) > 1.6 || d.x * d.x + d.z * d.z > r2) continue;
      this.peels.splice(i, 1);
      this.spinOut(kart);
      this.events.push({ type: 'peelHit', kart: kart.index, pos: peel.pos });
      return;
    }
  }

  spinOut(kart: Kart): void {
    kart.spinTime = ITEMS.spinTime;
    kart.boostTime = 0;
  }
}
