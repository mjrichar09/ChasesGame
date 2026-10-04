/**
 * One race: the physics world, the track, eight karts and the rules.
 *
 * This is the whole simulation — no three.js, no DOM, no Math.random — so a
 * race can be run headless in Node from a seed and a stream of inputs. The
 * game layer feeds it inputs (from the keyboard, touch, or the AI) and the
 * renderer only reads from it.
 *
 * Progress is a single number per kart, `dist`: metres travelled along the
 * centreline since the start line, unwrapped. Laps, positions and the finish
 * all fall out of it, and because it only grows by driving the road in order,
 * there is no shortcut and no lap credit for driving backwards.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { RACE, SIM } from '../data/tuning.js';
import { type DriverInput, NEUTRAL_INPUT } from './input.js';
import { Items } from './items.js';
import { Kart, yawQuat } from './kart.js';
import { type Vec3, add, scale, v3 } from './math.js';
import { Rng } from './rng.js';
import { Track, type TrackDef } from './track.js';

let rapierReady: Promise<void> | null = null;
/** Rapier's wasm has to be initialised once before any world exists. */
export function initPhysics(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export type Phase = 'countdown' | 'racing' | 'done';

export interface Progress {
  /** Metres along the centreline since the start line, unwrapped. */
  dist: number;
  /** Last projected position on the centreline. */
  s: number;
  lateral: number;
  /** Completed laps (0 on the first lap). */
  lap: number;
  /** Race time when the kart crossed the line for the last time, or null. */
  finishTime: number | null;
  /** Last spot known to be safely on the road, for respawns. */
  safeS: number;
  offTrack: number;
  stuck: number;
  /** Seconds left of respawn grace. */
  grace: number;
  respawns: number;
  /** Why the last respawn happened — for tuning and tests. */
  lastRespawn: 'fell' | 'offTrack' | 'stuck' | null;
  /** Best and per-lap times. */
  lapTimes: number[];
}

export interface RaceOptions {
  seed?: number;
  karts?: number;
  laps?: number;
}

export class RaceSim {
  readonly track: Track;
  readonly world: RAPIER.World;
  readonly karts: Kart[] = [];
  readonly progress: Progress[] = [];
  readonly items: Items;
  readonly laps: number;
  readonly dt = 1 / SIM.hz;
  readonly rng: Rng;

  phase: Phase = 'countdown';
  /** Seconds since the countdown began. Racing starts at `RACE.countdown`. */
  clock = 0;
  /** Finishing order, by kart index. */
  readonly finishOrder: number[] = [];
  /** Kart indices that respawned this step (for effects). */
  respawned: number[] = [];

  constructor(def: TrackDef, opts: RaceOptions = {}) {
    this.track = new Track(def);
    this.laps = opts.laps ?? RACE.laps;
    this.rng = new Rng(opts.seed ?? 1);
    this.world = new RAPIER.World({ x: 0, y: -SIM.gravity, z: 0 });
    this.world.timestep = this.dt;
    this.buildTrack();
    this.items = new Items(this.track, this.rng);

    const count = opts.karts ?? RACE.karts;
    for (let i = 0; i < count; i++) {
      const { pos, yaw } = this.gridSlot(i);
      this.karts.push(new Kart(RAPIER, this.world, i, pos, yawQuat(yaw)));
      const p = this.track.project(pos);
      this.progress.push({
        dist: this.track.delta(0, p.s),
        s: p.s,
        lateral: p.lateral,
        lap: 0,
        finishTime: null,
        safeS: p.s,
        offTrack: 0,
        stuck: 0,
        grace: 0,
        respawns: 0,
        lastRespawn: null,
        lapTimes: [],
      });
    }
  }

  private buildTrack(): void {
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const road = this.track.roadMesh();
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(road.vertices, road.indices).setFriction(0.6), ground);
    // The jungle floor around and under the track.
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(600, 0.5, 600).setTranslation(100, -1, -40).setFriction(0.8),
      ground,
    );
    for (const hull of this.track.kickerHulls()) {
      const desc = RAPIER.ColliderDesc.convexHull(hull);
      if (desc) this.world.createCollider(desc.setFriction(0.6), ground);
    }
    for (const w of this.track.walls) {
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(w.half.x, w.half.y, w.half.z)
          .setTranslation(w.center.x, w.center.y, w.center.z)
          .setRotation(yawQuat(w.yaw))
          .setFriction(0.1)
          .setRestitution(0.4),
        ground,
      );
    }
  }

  /** Two-wide staggered grid behind the start line. */
  gridSlot(i: number): { pos: Vec3; yaw: number } {
    const row = Math.floor(i / 2);
    const side = i % 2 === 0 ? -1 : 1;
    const s = -6 - row * 7 - (side > 0 ? 3 : 0);
    const k = this.track.at(s);
    const pos = add(this.track.pointAt(s, side * 3.2), v3(0, 0.9, 0));
    return { pos, yaw: Math.atan2(k.t.x, k.t.z) };
  }

  get raceTime(): number {
    return Math.max(0, this.clock - RACE.countdown);
  }

  get raceLength(): number {
    return this.laps * this.track.length;
  }

  /** Kart indices ordered first to last. */
  standings(): number[] {
    const order = this.karts.map((k) => k.index);
    return order.sort((a, b) => {
      const fa = this.progress[a]!.finishTime;
      const fb = this.progress[b]!.finishTime;
      if (fa !== null && fb !== null) return fa - fb;
      if (fa !== null) return -1;
      if (fb !== null) return 1;
      return this.progress[b]!.dist - this.progress[a]!.dist;
    });
  }

  /** 1-based race position of a kart. */
  position(index: number): number {
    return this.standings().indexOf(index) + 1;
  }

  /** Advance one fixed step with each kart's held input. */
  step(inputs: readonly DriverInput[]): void {
    const dt = this.dt;
    this.clock += dt;
    this.respawned = [];
    if (this.phase === 'countdown' && this.clock >= RACE.countdown) this.phase = 'racing';
    const live = this.phase !== 'countdown';
    const held = this.karts.map((_, i) => (live ? (inputs[i] ?? NEUTRAL_INPUT) : NEUTRAL_INPUT));

    this.items.step(dt, this.karts, held, live);
    for (const kart of this.karts) kart.step(dt, held[kart.index]!);
    this.world.step();
    for (const kart of this.karts) this.track1(kart, held[kart.index]!);
  }

  /** Lap progress, finishing, and respawns for one kart. */
  private track1(kart: Kart, input: DriverInput): void {
    const pr = this.progress[kart.index]!;
    const pos = kart.position;
    const p = this.track.project(pos, pr.s);
    const d = this.track.delta(pr.s, p.s);
    pr.dist += d;
    pr.s = p.s;
    pr.lateral = p.lateral;
    pr.grace = Math.max(0, pr.grace - this.dt);

    const lap = Math.max(0, Math.floor(pr.dist / this.track.length));
    if (lap > pr.lap && pr.finishTime === null) {
      const prevTotal = pr.lapTimes.reduce((a, b) => a + b, 0);
      pr.lapTimes.push(this.raceTime - prevTotal);
      pr.lap = lap;
      if (lap >= this.laps) {
        pr.finishTime = this.raceTime;
        this.finishOrder.push(kart.index);
      }
    }

    const sample = this.track.at(p.s);
    const onRoad = sample.road && Math.abs(p.lateral) < sample.halfWidth + 1;
    if (onRoad && kart.grounded >= 2 && !this.nearGap(p.s)) pr.safeS = p.s;

    // Fell in the river, off an edge, or out of the world.
    const fell = pos.y < sample.p.y - (sample.road ? 4 : 2.5) || pos.y < -3;
    if (Math.abs(p.lateral) > sample.halfWidth + 2.5) pr.offTrack += this.dt;
    else pr.offTrack = 0;
    const speed = Math.hypot(kart.velocity.x, kart.velocity.z);
    if (this.phase === 'racing' && input.throttle > 0.5 && speed < 1 && !kart.spinning) pr.stuck += this.dt;
    else pr.stuck = 0;

    const why = fell ? 'fell' : pr.offTrack > RACE.offTrackTime ? 'offTrack' : pr.stuck > RACE.stuckTime ? 'stuck' : null;
    if (why) {
      pr.lastRespawn = why;
      this.respawn(kart);
    }
  }

  /** True within the run-up to a gap, the gap itself, or just after it. */
  private nearGap(s: number): boolean {
    return this.track.gaps.some((g) => this.track.between(s, g.s0 - 25, g.s1 + 4));
  }

  /** Put a kart back on the road at its last safe spot, facing the right way. */
  respawn(kart: Kart): void {
    const pr = this.progress[kart.index]!;
    let s = pr.safeS - 3;
    const k = this.track.at(s);
    const lateral = Math.max(-k.halfWidth + 2, Math.min(k.halfWidth - 2, pr.lateral * 0.5));
    const pos = add(this.track.pointAt(s, lateral), add(scale(k.n, 1.0), v3(0, 0.2, 0)));
    kart.place(pos, yawQuat(Math.atan2(k.t.x, k.t.z)));
    pr.dist += this.track.delta(pr.s, s);
    pr.s = s = this.track.wrap(s);
    pr.offTrack = 0;
    pr.stuck = 0;
    pr.grace = RACE.respawnGrace;
    pr.respawns++;
    this.respawned.push(kart.index);
  }

  /** True once every kart has finished. */
  get allFinished(): boolean {
    return this.progress.every((p) => p.finishTime !== null);
  }

  free(): void {
    this.world.free();
  }
}
