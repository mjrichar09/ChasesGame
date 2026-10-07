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
import { KART, PARROT, RACE, SIM } from '../data/tuning.js';
import { type DriverInput, NEUTRAL_INPUT } from './input.js';
import { Items } from './items.js';
import { BARRIER_GROUPS, GROUND_GROUPS, Kart, yawQuat } from './kart.js';
import { type EventState, TREE, stepEvents } from './events.js';
import { lavaFront } from './lava.js';
import { buildTerrain } from './terrain.js';
import { type Vec3, add, cross, dot, normalize, scale, sub, v3 } from './math.js';
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
  /** Caught by the lava: out of the race. */
  dnf: boolean;
  /** Lap distance when the current parrot flight began (null when not flying). */
  flightStart: number | null;
  /** Seconds before another wall bonk can register. */
  bonkCooldown: number;
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
  /** Mid-race track events and their phases (read by the renderer). */
  readonly events: EventState[];
  /** The road collider, rebuilt when a branch snaps. */
  private roadCollider!: RAPIER.Collider;
  private ground!: RAPIER.RigidBody;
  private readonly wallColliders: RAPIER.Collider[] = [];
  /** Where each kart sits on the grid; held there until GO. */
  private readonly gridPos: Vec3[] = [];
  /** Kart indices that respawned this step (for effects). */
  respawned: number[] = [];

  constructor(def: TrackDef, opts: RaceOptions = {}) {
    this.track = new Track(def);
    // A point-to-point track is one "lap", start line to finish line.
    this.laps = this.track.closed ? (opts.laps ?? RACE.laps) : 1;
    this.rng = new Rng(opts.seed ?? 1);
    this.world = new RAPIER.World({ x: 0, y: -SIM.gravity, z: 0 });
    this.world.timestep = this.dt;
    this.buildTrack();
    this.items = new Items(this.track, this.rng);
    this.events = (def.events ?? []).map((d) => ({ def: d, phase: 'idle' as const, t: 0, stage: 0 }));

    const count = opts.karts ?? RACE.karts;
    for (let i = 0; i < count; i++) {
      const { pos, yaw } = this.gridSlot(i);
      this.karts.push(new Kart(RAPIER, this.world, i, pos, yawQuat(yaw)));
      this.gridPos.push(pos);
      const p = this.track.project(pos);
      this.progress.push({
        dist: this.track.closed ? this.track.delta(0, p.s) : p.s - this.track.startS,
        s: p.s,
        lateral: p.lateral,
        lap: 0,
        finishTime: null,
        safeS: p.s,
        offTrack: 0,
        stuck: 0,
        grace: 0,
        respawns: 0,
        bonkCooldown: 0,
        dnf: false,
        flightStart: null,
        lastRespawn: null,
        lapTimes: [],
      });
    }
  }

  private buildTrack(): void {
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.ground = ground;
    this.roadCollider = this.makeRoad();
    // The jungle floor around and under the track.
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(600, 0.5, 600)
        .setTranslation(100, -1, -40)
        .setFriction(0.8)
        .setCollisionGroups(GROUND_GROUPS),
      ground,
    );
    // A mountainside (or other shaped ground) under and around the road.
    const terrain = buildTerrain(this.track);
    if (terrain) {
      this.world.createCollider(
        RAPIER.ColliderDesc.trimesh(terrain.vertices, terrain.indices).setFriction(0.8).setCollisionGroups(GROUND_GROUPS),
        ground,
      );
    }
    for (const hull of this.track.kickerHulls()) {
      const desc = RAPIER.ColliderDesc.convexHull(hull);
      if (desc) this.world.createCollider(desc.setFriction(0.6).setCollisionGroups(GROUND_GROUPS), ground);
    }
    for (const w of this.track.walls) {
      const c = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(w.half.x, w.half.y, w.half.z)
          .setTranslation(w.center.x, w.center.y, w.center.z)
          .setRotation(yawQuat(w.yaw))
          // Grippy logs: scraping along the barrier costs real speed, so
          // overcooking a corner is slower than braking for it.
          .setFriction(0.7)
          .setRestitution(0.25)
          .setCollisionGroups(BARRIER_GROUPS),
        ground,
      );
      this.wallColliders.push(c);
    }
  }

  private makeRoad(): RAPIER.Collider {
    const road = this.track.roadMesh();
    return this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(road.vertices, road.indices).setFriction(0.6).setCollisionGroups(GROUND_GROUPS),
      this.ground,
    );
  }

  /** Laps completed by whoever is furthest round (DNFs excluded). */
  private get leaderLaps(): number {
    let best = 0;
    for (const p of this.progress) if (!p.dnf) best = Math.max(best, Math.floor(p.dist / this.lapLength));
    return Math.max(0, best);
  }

  /** Make an event's change to the track real. */
  private applyEvent(e: EventState): void {
    const d = e.def;
    const track = this.track;
    if (d.kind === 'treefall') {
      const s = track.anchor(d);
      const k = track.at(s);
      // The trunk: a low triangular bump lying diagonally across the road.
      const a = track.pointAt(s, -d.blocked * (k.halfWidth + 2));
      const b = track.pointAt(s + TREE.slant, d.blocked * (k.halfWidth + 2));
      const axis = normalize(sub(b, a));
      const perp = normalize(cross(axis, v3(0, 1, 0)));
      const pts: number[] = [];
      for (const end of [a, b]) {
        for (const [w, h] of [[-TREE.trunkWidth / 2, -0.2], [TREE.trunkWidth / 2, -0.2], [0, TREE.trunkHeight]] as const) {
          pts.push(end.x + perp.x * w, end.y + h, end.z + perp.z * w);
        }
      }
      const hull = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
      if (hull) this.world.createCollider(hull.setFriction(0.6).setCollisionGroups(GROUND_GROUPS), this.ground);
      track.brush.push({ s0: s + TREE.crownFrom, s1: s + TREE.crownTo, side: d.blocked });
      this.items.events.push({ type: 'track', kind: 'treefall', pos: track.pointAt(s + 4, 0) });
    } else if (d.kind === 'flood') {
      for (const w of track.waters) {
        w.s0 = w.base[0] - (d.grow / 2) * e.stage;
        w.s1 = w.base[1] + (d.grow / 2) * e.stage;
      }
      this.items.events.push({ type: 'track', kind: 'flood', pos: track.pointAt(track.waters[0]?.s0 ?? 0, 0), stage: e.stage });
    } else if (d.kind === 'snap') {
      const s = track.anchor(d);
      const gap = { s0: s + d.rampLength, s1: s + d.rampLength + d.length };
      track.kickers.push({ s0: s, s1: gap.s0, height: d.rampHeight, lateral: 0, halfWidth: track.def.width / 2 });
      track.gaps.push(gap);
      for (const smp of track.samples) if (track.inGap(smp.s)) smp.road = false;
      // New road (with the hole in it), the stub as a ramp, and no barrier over the drop.
      this.world.removeCollider(this.roadCollider, false);
      this.roadCollider = this.makeRoad();
      const hulls = track.kickerHulls();
      const ramp = RAPIER.ColliderDesc.convexHull(hulls[hulls.length - 1]!);
      if (ramp) this.world.createCollider(ramp.setFriction(0.6).setCollisionGroups(GROUND_GROUPS), this.ground);
      track.walls.forEach((w, i) => {
        if (track.between(w.s, gap.s0 - 2, gap.s1 + 2) || track.between(w.s + 2, gap.s0, gap.s1)) {
          this.wallColliders[i]?.setEnabled(false);
        }
      });
      this.items.events.push({ type: 'track', kind: 'snap', pos: track.pointAt((gap.s0 + gap.s1) / 2, 0) });
    }
  }

  /** Two-wide staggered grid behind the start line. */
  gridSlot(i: number): { pos: Vec3; yaw: number } {
    const row = Math.floor(i / 2);
    const side = i % 2 === 0 ? -1 : 1;
    const s = this.track.startS - 6 - row * 7 - (side > 0 ? 3 : 0);
    const k = this.track.at(s);
    const pos = add(this.track.pointAt(s, side * 3.2), v3(0, 0.9, 0));
    return { pos, yaw: Math.atan2(k.t.x, k.t.z) };
  }

  get raceTime(): number {
    return Math.max(0, this.clock - RACE.countdown);
  }

  /** One lap: the loop, or start line to finish line on an open track. */
  get lapLength(): number {
    return this.track.closed ? this.track.length : this.track.finishS - this.track.startS;
  }

  get raceLength(): number {
    return this.laps * this.lapLength;
  }

  /** Where the lava front is (−∞ on tracks without lava). */
  get lavaS(): number {
    return this.phase === 'countdown' ? -Infinity : lavaFront(this.track.def, this.track.startS, this.raceTime);
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
      // Still running ahead of anyone the lava has taken.
      const da = this.progress[a]!.dnf;
      const db = this.progress[b]!.dnf;
      if (da !== db) return da ? 1 : -1;
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
    const held = this.karts.map((_, i) =>
      live && !this.progress[i]!.dnf ? (inputs[i] ?? NEUTRAL_INPUT) : NEUTRAL_INPUT,
    );

    if (live) for (const e of stepEvents(this.events, this.leaderLaps, dt)) this.applyEvent(e);
    const flood = this.events.find((e) => e.def.kind === 'flood');
    const stage = flood?.stage ?? 0;
    for (const kart of this.karts) {
      const pr = this.progress[kart.index]!;
      kart.wet = !kart.flying && this.track.inWater(pr.s) && Math.abs(pr.lateral) < this.track.at(pr.s).halfWidth + 4;
      kart.brush = !kart.flying && kart.grounded > 0 && this.track.inBrush(pr.s, pr.lateral);
      kart.waterDepth = 1 + 0.45 * stage;
      if (kart.wet && flood && flood.def.kind === 'flood') {
        // The creek runs across the road; the flood pushes karts downstream.
        const r = this.track.at(pr.s).r;
        kart.current = scale(v3(r.x, 0, r.z), flood.def.current * stage);
      } else kart.current = v3();
      // The parrot holds its height over the road below (never below take-off).
      if (kart.flying) kart.flyTargetY = Math.max(kart.flyBaseY, this.track.at(pr.s).p.y) + PARROT.altitude;
    }
    this.items.step(dt, this.karts, held, live);
    for (const kart of this.karts) if (!this.progress[kart.index]!.dnf) kart.step(dt, held[kart.index]!);
    this.world.step();
    // Until GO every kart is held on its grid spot: free to settle on its
    // springs, but not to roll down a banked or sloping grid (Lava Run's grid
    // is downhill, and karts used to coast metres before the lights).
    if (this.phase === 'countdown') {
      for (const kart of this.karts) {
        const g = this.gridPos[kart.index]!;
        const t = kart.body.translation();
        const v = kart.body.linvel();
        const w = kart.body.angvel();
        kart.body.setTranslation({ x: g.x, y: t.y, z: g.z }, true);
        kart.body.setLinvel({ x: 0, y: v.y, z: 0 }, true);
        kart.body.setAngvel({ x: w.x, y: 0, z: w.z }, true);
      }
    }
    for (const kart of this.karts) if (!this.progress[kart.index]!.dnf) this.track1(kart, held[kart.index]!);
  }

  /** Lap progress, finishing, and respawns for one kart. */
  private track1(kart: Kart, input: DriverInput): void {
    const pr = this.progress[kart.index]!;
    const pos = kart.position;
    let p = this.track.project(pos, pr.s);
    // In and just after a parrot flight the kart may be anywhere — that is
    // the point of it — so search the whole lap and accept a shortcut (a
    // forward jump of up to `maxSkip` of a lap; never a lap's worth).
    // One flight is worth at most `maxSkip` of a lap however it is flown.
    const airborne = kart.flying || kart.sinceFlight < PARROT.landGrace;
    if (kart.flying && pr.flightStart === null) pr.flightStart = pr.dist;
    if (!airborne) pr.flightStart = null;
    if (airborne) {
      const g = this.track.project(pos, -1);
      const jump = this.track.delta(pr.s, g.s);
      const cap = (pr.flightStart ?? pr.dist) + this.track.length * PARROT.maxSkip;
      const localOff = Math.abs(p.lateral) - this.track.at(p.s).halfWidth;
      const globalOff = Math.abs(g.lateral) - this.track.at(g.s).halfWidth;
      if (g.s !== p.s && globalOff < localOff - 1 && jump > -20 && pr.dist + jump <= cap) p = g;
    }
    const d = this.track.delta(pr.s, p.s);
    pr.dist += d;
    pr.s = p.s;
    pr.lateral = p.lateral;
    pr.grace = Math.max(0, pr.grace - this.dt);

    const lap = Math.max(0, Math.floor(pr.dist / this.lapLength));
    if (lap > pr.lap && pr.finishTime === null) {
      const prevTotal = pr.lapTimes.reduce((a, b) => a + b, 0);
      pr.lapTimes.push(this.raceTime - prevTotal);
      pr.lap = lap;
      if (lap >= this.laps) {
        pr.finishTime = this.raceTime;
        this.finishOrder.push(kart.index);
      }
    }

    // Caught by the lava — unless the parrot has you up out of it.
    if (pr.finishTime === null && !kart.flying && p.s < this.lavaS) {
      this.toast(kart);
      return;
    }

    const sample = this.track.at(p.s);
    this.bonk(kart, pr, sample, p.lateral);
    const onRoad = sample.road && Math.abs(p.lateral) < sample.halfWidth + 1;
    if (onRoad && kart.grounded >= 2 && !this.nearGap(p.s)) pr.safeS = p.s;
    // While flying, the nearest road under the kart is where it would respawn
    // — a bad landing costs the landing, not the shortcut.
    if (kart.flying && sample.road && !this.nearGap(p.s) && Math.abs(p.lateral) < sample.halfWidth + 25) pr.safeS = p.s;
    if (kart.flying) {
      pr.offTrack = 0;
      pr.stuck = 0;
      return;
    }

    // Fell in the river, off an edge, or out of the world.
    const fell = pos.y < sample.p.y - (sample.road ? 4 : 2.5) || pos.y < -3;
    if (Math.abs(p.lateral) > sample.halfWidth + 2.5) pr.offTrack += this.dt;
    else pr.offTrack = 0;
    const speed = Math.hypot(kart.velocity.x, kart.velocity.z);
    // Stuck: trying to go (either pedal — the AI backs out on the brake) and
    // not moving, or hung up with no wheels on anything (beached on a barrier).
    const trying = input.throttle > 0.5 || input.brake > 0.5;
    const beached = kart.airTime > RACE.stuckTime;
    if (this.phase === 'racing' && ((trying && speed < 1 && !kart.spinning) || beached)) pr.stuck += this.dt;
    else pr.stuck = 0;

    const why = fell ? 'fell' : pr.offTrack > RACE.offTrackTime ? 'offTrack' : pr.stuck > RACE.stuckTime ? 'stuck' : null;
    if (why) {
      pr.lastRespawn = why;
      // Into a lava fissure is into the lava.
      if (why === 'fell' && this.track.def.lava && this.track.inGap(p.s)) this.toast(kart);
      else this.respawn(kart);
    }
  }

  /**
   * Arcade wall penalty. The kart's edge is at the barrier and it is closing on
   * it fast: take a big bite of speed, wobble it, and report it for effects.
   */
  private bonk(kart: Kart, pr: Progress, sample: ReturnType<Track['at']>, lateral: number): void {
    pr.bonkCooldown = Math.max(0, pr.bonkCooldown - this.dt);
    // Only a kart on its wheels can bonk — not one flying or jumping over the logs.
    if (pr.bonkCooldown > 0 || !sample.road || this.track.inWater(pr.s) || kart.grounded === 0) return;
    const side = Math.sign(lateral);
    if (Math.abs(lateral) < sample.halfWidth - KART.half.x - 0.35) return;
    const v = kart.velocity;
    // Closing speed toward this side's barrier (sample.r points to the right).
    const closing = dot(v, sample.r) * side;
    if (closing < KART.bonkSpeed) return;
    kart.body.setLinvel(v3(v.x * KART.bonkKeep, v.y, v.z * KART.bonkKeep), true);
    kart.wobbleTime = Math.max(kart.wobbleTime, 0.4);
    pr.bonkCooldown = 0.6;
    this.items.events.push({ type: 'bonk', kart: kart.index, pos: kart.position, strength: Math.min(1, closing / 12) });
  }

  /** True within the run-up to a gap, the gap itself, or just after it. */
  private nearGap(s: number): boolean {
    return this.track.gaps.some((g) => this.track.between(s, g.s0 - 25, g.s1 + 4));
  }

  /** Put a kart back on the road at its last safe spot, facing the right way. */
  respawn(kart: Kart): void {
    const pr = this.progress[kart.index]!;
    let s = pr.safeS - 3;
    // Nowhere safe left to put it: the lava already has the spot.
    if (s < this.lavaS + 6) {
      this.toast(kart);
      return;
    }
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
    return this.progress.every((p) => p.finishTime !== null || p.dnf);
  }

  /** The lava takes a kart: it stops where it is, out of the race. */
  private toast(kart: Kart): void {
    const pr = this.progress[kart.index]!;
    pr.dnf = true;
    kart.out = true;
    kart.body.setLinvel(v3(), false);
    kart.body.setAngvel(v3(), false);
    kart.body.setEnabled(false);
    this.items.events.push({ type: 'toasted', kart: kart.index, pos: kart.position });
  }

  free(): void {
    this.world.free();
  }
}
