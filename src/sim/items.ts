/**
 * Pickups, banana peels and snake whacks.
 *
 * - **Pickups** float over a glowing ring at fixed spots on the track. Each is
 *   a banana, a snake or a parrot. Drive through one with empty hands to
 *   take it; it comes back a few seconds later, re-rolled.
 * - **Bananas:** one per pickup, stacking up to three (drive through more
 *   while holding bananas). Each one eaten is a 3 s boost and drops a
 *   peel behind you. Peels have no timer — they stay until somebody hits one
 *   and spins out, turning toward the side the peel was on. (The track holds
 *   at most `maxPeels`; the oldest goes first.)
 * - **Snake:** three swings, left or right, Road Rash style. A swing hits the
 *   nearest kart alongside on that side: it loses most of its speed, wobbles
 *   and stays slowed for a moment.
 * - **Coconut:** one throw, flung sidearm at whoever is in front. The left
 *   and right attack buttons bend it that way; the item button throws it
 *   straight, or bends it toward the nearest kart ahead. It flies six kart
 *   lengths ahead of the thrower, then drops. A hit costs half your speed,
 *   a wobble and a short slowdown.
 *
 * Players hold one item at a time. Everything is seeded, so a race replays
 * exactly from its seed and inputs.
 */

import { ITEMS, KART, SIM } from '../data/tuning.js';
import type { DriverInput } from './input.js';
import type { ItemKind, Kart } from './kart.js';
import type { Move } from './swagger.js';
import { type Vec3, add, dot, normalize, scale, sub, v3 } from './math.js';
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

/** A coconut in the air. */
export interface Coconut {
  id: number;
  owner: number;
  pos: Vec3;
  vel: Vec3;
  /** Sideways acceleration that bends its flight, m/s². */
  curve: Vec3;
  /** Seconds flown, and how long it flies before it drops. */
  age: number;
  life: number;
}

export type ItemEvent =
  | { type: 'pickup'; kart: number; kind: Exclude<ItemKind, 'none'>; pos: Vec3 }
  | { type: 'boost'; kart: number; pos: Vec3 }
  | { type: 'peelDrop'; kart: number; pos: Vec3 }
  | { type: 'peelHit'; kart: number; owner: number; pos: Vec3; peel?: number }
  | { type: 'swing'; kart: number; side: -1 | 1; pos: Vec3 }
  | { type: 'whack'; kart: number; victim: number; pos: Vec3 }
  | { type: 'throw'; kart: number; side: -1 | 0 | 1; pos: Vec3; vel: Vec3; curve: Vec3; life: number }
  | { type: 'conk'; kart: number; victim: number; pos: Vec3; vel: Vec3 }
  | { type: 'coconutDrop'; kart: number; pos: Vec3; vel: Vec3 }
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
  readonly coconuts: Coconut[] = [];
  private nextLoose = 1;
  private nextCoconut = 1;
  events: ItemEvent[] = [];
  private nextPeel = 1;
  private readonly rng: Rng;
  private readonly track: Track;
  /**
   * False in an online client race: pickups, peels and hits on others come
   * from the host. The client still uses its own kart's items at once (a
   * banana boosts on the press, not a round trip later) and notices its own
   * peel hits — see net/.
   */
  authority = true;
  /** The client's own kart. */
  own = -1;

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
    if (r < ITEMS.parrotChance + ITEMS.coconutChance) return 'coconut';
    return r < ITEMS.parrotChance + ITEMS.coconutChance + ITEMS.snakeChance ? 'snake' : 'banana';
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
    if (!this.authority) {
      const kart = karts[this.own];
      if (!kart || kart.out) return;
      if (canUse) this.use(kart, inputs[kart.index]!, karts);
      this.peelHits(kart, kart.position);
      // Coconuts fly here too (to be drawn); the host says who they hit.
      this.flyCoconuts(dt, karts);
      return;
    }
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
      // A proxy's phone reports its own peel hits (see `claimPeel`).
      if (!kart.proxy) this.peelHits(kart, pos);
    }
    this.flyCoconuts(dt, karts);
  }

  /**
   * A player's phone says its kart hit peel `id`. True (and the peel is
   * gone) if that peel is still there and the kart is plausibly on it.
   */
  claimPeel(kart: Kart, id: number): boolean {
    const i = this.peels.findIndex((p) => p.id === id);
    if (i < 0 || kart.out) return false;
    const peel = this.peels[i]!;
    const d = sub(kart.position, peel.pos);
    if (d.x * d.x + d.z * d.z > (ITEMS.peelRadius + 6) ** 2) return false;
    this.peels.splice(i, 1);
    this.spinOut(kart, Items.spinSide(kart, peel.pos));
    this.events.push({ type: 'peelHit', kart: kart.index, owner: peel.owner, pos: peel.pos, peel: id });
    return true;
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
    if (kart.item === 'coconut') {
      if (rising(input.whackLeft, prev.whackLeft)) this.throwCoconut(kart, -1);
      else if (rising(input.whackRight, prev.whackRight)) this.throwCoconut(kart, 1);
      else if (rising(input.item, prev.item)) this.throwCoconut(kart, this.aim(kart, karts));
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
    // A client's own peel is a guess (negative id) until the host's arrives.
    const id = this.authority ? this.nextPeel++ : -this.nextPeel++;
    this.peels.push({ id, pos: at, yaw: Math.atan2(f.x, f.z), owner: kart.index, age: 0 });
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
      if (Math.abs(lon) > ITEMS.whackLong || Math.abs(rel.y) > ITEMS.whackHeight) continue;
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
    if (!this.authority) return;
    const hit = this.target(kart, side, karts);
    if (!hit) return;
    const victim = hit.kart;
    Items.whacked(victim, scale(kart.right, side));
    this.events.push({ type: 'whack', kart: kart.index, victim: victim.index, pos: victim.position });
  }

  /**
   * Which way to bend a throw from the item button: the way that hits the
   * nearest kart ahead (see `shot`), else straight.
   */
  aim(kart: Kart, karts: readonly Kart[]): -1 | 0 | 1 {
    return this.shot(kart, karts)?.side ?? 0;
  }

  /**
   * Would a coconut thrown now hit anyone? Flies each throw (straight, bent
   * left, bent right) against every kart carried on along its velocity, and
   * returns the first that connects — straight preferred — or null.
   */
  shot(kart: Kart, karts: readonly Kart[]): { side: -1 | 0 | 1; kart: Kart } | null {
    const targets = karts.filter((o) => {
      if (o === kart || o.flying || o.out || o.immune) return false;
      const rel = sub(o.position, kart.position);
      const lon = dot(rel, kart.forward);
      return lon > 0 && lon < ITEMS.coconutRange + 12 && Math.abs(rel.y) < 4;
    });
    if (!targets.length) return null;
    const step = 1 / 60;
    for (const side of [0, -1, 1] as const) {
      const f = Items.flight(kart, side);
      let pos = f.pos;
      let vel = f.vel;
      for (let t = step; t <= f.life; t += step) {
        vel = add(vel, scale(add(f.curve, v3(0, -SIM.gravity, 0)), step));
        pos = add(pos, scale(vel, step));
        for (const o of targets) {
          const rel = sub(pos, add(o.position, scale(o.velocity, t)));
          if (Items.inReach(o, rel)) return { side, kart: o };
        }
      }
    }
    return null;
  }

  /** Is a coconut `rel` from `kart`'s centre inside its hit box? */
  private static inReach(kart: Kart, rel: Vec3): boolean {
    return (
      Math.abs(rel.y) <= ITEMS.coconutHeight &&
      Math.abs(dot(rel, kart.right)) <= KART.half.x + ITEMS.coconutReach &&
      Math.abs(dot(rel, kart.forward)) <= KART.half.z + ITEMS.coconutReach
    );
  }

  /**
   * A coconut flung from `kart` toward `side`: from the right hand, forward
   * at the kart's speed plus `coconutSpeed`, rising a little, with a
   * sideways pull that bends it `coconutCurve` metres that way by the end of
   * its range.
   */
  private static flight(kart: Kart, side: -1 | 0 | 1): { pos: Vec3; vel: Vec3; curve: Vec3; life: number } {
    const fwd = kart.forward;
    const right = kart.right;
    const flat = normalize(v3(fwd.x, 0, fwd.z));
    const life = ITEMS.coconutRange / ITEMS.coconutSpeed;
    const pos = add(add(kart.position, scale(fwd, 1.1)), add(scale(right, 0.45), v3(0, 0.9, 0)));
    const vel = add(add(kart.velocity, scale(flat, ITEMS.coconutSpeed)), v3(0, ITEMS.coconutLift, 0));
    const curve = scale(normalize(v3(right.x, 0, right.z)), (side * 2 * ITEMS.coconutCurve) / (life * life));
    return { pos, vel, curve, life };
  }

  private throwCoconut(kart: Kart, side: -1 | 0 | 1): void {
    kart.item = 'none';
    kart.charges = 0;
    kart.throwSide = side === 0 ? 1 : side;
    kart.throwTime = 0;
    const { pos, vel, curve, life } = Items.flight(kart, side);
    this.launch(kart.index, pos, vel, curve, life);
    this.events.push({ type: 'throw', kart: kart.index, side, pos, vel, curve, life });
  }

  /** Put a thrown coconut in the air (online clients: from the host's `throw` event). */
  launch(owner: number, pos: Vec3, vel: Vec3, curve: Vec3, life: number): void {
    this.coconuts.push({ id: this.nextCoconut++, owner, pos, vel, curve, age: 0, life });
  }

  /**
   * Move the coconuts, and (with authority) knock any kart one reaches.
   * Its thrower is never hit; a too-cool or boulder kart bats it away.
   */
  private flyCoconuts(dt: number, karts: readonly Kart[]): void {
    for (let i = this.coconuts.length - 1; i >= 0; i--) {
      const c = this.coconuts[i]!;
      c.age += dt;
      c.vel = add(c.vel, scale(add(c.curve, v3(0, -SIM.gravity, 0)), dt));
      c.pos = add(c.pos, scale(c.vel, dt));
      let victim: Kart | null = null;
      if (this.authority) {
        for (const kart of karts) {
          if (kart.index === c.owner || kart.out || kart.flying) continue;
          if (!Items.inReach(kart, sub(c.pos, kart.position))) continue;
          victim = kart;
          break;
        }
      }
      if (victim && !victim.immune) {
        Items.conked(victim, c.vel);
        this.events.push({ type: 'conk', kart: c.owner, victim: victim.index, pos: c.pos, vel: c.vel });
        this.coconuts.splice(i, 1);
      } else if (victim || c.age >= c.life) {
        // Batted away by an immune kart, or out of range: it drops.
        this.coconuts.splice(i, 1);
        this.events.push({ type: 'coconutDrop', kart: c.owner, pos: c.pos, vel: victim ? scale(c.vel, -0.3) : c.vel });
      }
    }
  }

  /** The host says one of `owner`'s coconuts hit someone: it is gone here too. */
  dropCoconut(owner: number): void {
    const i = this.coconuts.findIndex((c) => c.owner === owner);
    if (i >= 0) this.coconuts.splice(i, 1);
  }

  /**
   * A coconut connects: half the speed gone, a wobble, a short slowdown, and
   * a shove the way it was flying. Shared with the online client.
   */
  static conked(victim: Kart, flight: Vec3): void {
    const v = victim.velocity;
    victim.body.setLinvel(v3(v.x * ITEMS.coconutKeep, v.y, v.z * ITEMS.coconutKeep), true);
    victim.wobbleTime = Math.max(victim.wobbleTime, ITEMS.coconutWobble);
    victim.slowTime = Math.max(victim.slowTime, ITEMS.coconutSlow);
    victim.boostTime = Math.min(victim.boostTime, victim.noBrakesTime);
    victim.body.applyImpulse(scale(normalize(v3(flight.x, 0, flight.z)), ITEMS.coconutShove), true);
  }

  private peelHits(kart: Kart, pos: Vec3): void {
    if (kart.spinning || kart.flying || kart.immune) return;
    const r2 = ITEMS.peelRadius * ITEMS.peelRadius;
    for (let i = 0; i < this.peels.length; i++) {
      const peel = this.peels[i]!;
      if (peel.owner === kart.index && peel.age < ITEMS.peelGrace) continue;
      if (peel.id < 0) continue;
      const d = sub(pos, peel.pos);
      if (Math.abs(d.y) > 1.6 || d.x * d.x + d.z * d.z > r2) continue;
      this.peels.splice(i, 1);
      this.spinOut(kart, Items.spinSide(kart, peel.pos));
      this.events.push({ type: 'peelHit', kart: kart.index, owner: peel.owner, pos: peel.pos, peel: peel.id });
      return;
    }
  }

  /**
   * Which way a peel spins `kart`: toward the side it was on (a peel under
   * the right wheels whips the nose round to the right). Returns `Kart.spinDir`.
   */
  static spinSide(kart: Kart, at: Vec3): -1 | 1 {
    return dot(sub(at, kart.position), kart.right) > 0 ? -1 : 1;
  }

  /**
   * A snake connects: most of the speed gone, a long fishtailing wobble, a
   * slowed engine, and a shove along `away` (unit, flat). Shared with the
   * online client, which applies hits on its own kart.
   */
  static whacked(victim: Kart, away: Vec3): void {
    const v = victim.velocity;
    victim.body.setLinvel(v3(v.x * ITEMS.whackKeep, v.y, v.z * ITEMS.whackKeep), true);
    victim.wobbleTime = Math.max(victim.wobbleTime, ITEMS.wobbleTime);
    victim.slowTime = Math.max(victim.slowTime, ITEMS.whackSlow);
    victim.boostTime = Math.min(victim.boostTime, victim.noBrakesTime);
    victim.body.applyImpulse(scale(away, ITEMS.whackShove), true);
  }

  spinOut(kart: Kart, dir: -1 | 1 = 1): void {
    if (kart.immune) return;
    kart.spinTime = ITEMS.spinTime;
    kart.spinDir = dir;
    kart.boostTime = 0;
  }
}
