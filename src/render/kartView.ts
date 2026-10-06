/**
 * Draws one kart from the sim: interpolated pose, wheels on their springs,
 * steering, and the gorilla's secondary motion.
 *
 * The sim steps at 120 Hz and the screen at whatever the display does, so
 * the pose is blended between the last two sim states. Wheel travel comes
 * straight from the sim's suspension — what you see bouncing is what the
 * physics is doing — and the gorilla's torso rides on its own little lagging
 * spring on top, so every landing ends in a satisfying wobble.
 */

import * as THREE from 'three';
import type { Gorilla } from '../data/gorillas.js';
import { ITEMS, KART } from '../data/tuning.js';
import type { Kart } from '../sim/kart.js';
import { celebrate } from './celebrate.js';
import { type KartRig, buildKart } from './kartModel.js';
import { GEO, PartBuilder, toon } from './toon.js';

export interface KartSnapshot {
  pos: THREE.Vector3;
  rot: THREE.Quaternion;
  vel: THREE.Vector3;
}

export class KartView {
  readonly rig: KartRig;
  readonly gorilla: Gorilla;
  private readonly snake: THREE.Group;
  private prev: KartSnapshot = { pos: new THREE.Vector3(), rot: new THREE.Quaternion(), vel: new THREE.Vector3() };
  private curr: KartSnapshot = { pos: new THREE.Vector3(), rot: new THREE.Quaternion(), vel: new THREE.Vector3() };
  /** Torso lag spring: offset (m) and its velocity. */
  private bob = 0;
  private bobV = 0;
  private lean = 0;
  private lastVelY = 0;
  private spinVisual = 0;
  /** Celebration: seconds left (Infinity = until stopped), time into it, and whether seated. */
  private celebLeft = 0;
  private celebT = 0;
  private celebSeated = true;
  private readonly seatY: number;
  /** Rendered pose this frame, for the camera and effects. */
  readonly pos = new THREE.Vector3();
  readonly rot = new THREE.Quaternion();

  constructor(gorilla: Gorilla) {
    this.gorilla = gorilla;
    this.rig = buildKart(gorilla);
    this.snake = buildSnake();
    this.snake.visible = false;
    this.rig.gorilla.hands[1].add(this.snake);
    this.seatY = this.rig.gorilla.root.position.y;
  }

  /** Start this gorilla's celebration: seated (mid-race) or standing (podiums). */
  celebrate(seconds: number, seated: boolean): void {
    if (this.celebLeft <= 0) this.celebT = 0;
    this.celebLeft = seconds;
    this.celebSeated = seated;
  }

  stopCelebrating(): void {
    this.celebLeft = 0;
  }

  get celebrating(): boolean {
    return this.celebLeft > 0;
  }

  /** Blend the celebration over whatever pose the frame has set so far. */
  private applyCelebration(dt: number): void {
    const g = this.rig.gorilla;
    if (this.celebLeft <= 0) {
      g.root.position.y = this.seatY;
      return;
    }
    this.celebT += dt;
    this.celebLeft -= dt;
    // Ease in over 0.2 s, out over the last 0.3 s.
    const w = Math.min(1, this.celebT / 0.2, this.celebLeft / 0.3);
    celebrate(g, this.gorilla.celebration, this.celebT, w, this.celebSeated, this.seatY);
  }

  /**
   * Animate a kart that is not in a race (menu or finish podium): rest pose,
   * idle breathing, and any celebration.
   */
  animateIdle(dt: number): void {
    const g = this.rig.gorilla;
    for (let i = 0; i < 2; i++) {
      g.arms[i]!.rotation.copy(g.rest[i]!.shoulder);
      g.elbows[i]!.rotation.copy(g.rest[i]!.elbow);
    }
    this.bob += dt;
    g.torso.position.y = 0.28 + Math.sin(this.bob * 2) * 0.012;
    g.torso.rotation.set(0, 0, 0);
    g.torso.scale.set(1, 1, 1);
    g.head.rotation.set(0, Math.sin(this.bob * 0.7) * 0.25, 0);
    this.snake.visible = false;
    this.applyCelebration(dt);
  }

  get object(): THREE.Object3D {
    return this.rig.root;
  }

  /** Wheels settled on their springs, for a kart not in a race (menu podium). */
  restPose(): void {
    for (const wr of this.rig.wheels) {
      const travel = KART.restLength - 0.12;
      wr.node.position.set(wr.mount.x, wr.mount.y - travel, wr.mount.z);
      wr.spring.scale.set(1, travel, 1);
    }
  }

  /** Call after every sim step. */
  capture(kart: Kart, reset = false): void {
    const t = kart.position;
    const r = kart.rotation;
    const v = kart.velocity;
    [this.prev, this.curr] = [this.curr, this.prev];
    this.curr.pos.set(t.x, t.y, t.z);
    this.curr.rot.set(r.x, r.y, r.z, r.w);
    this.curr.vel.set(v.x, v.y, v.z);
    if (reset) {
      this.prev.pos.copy(this.curr.pos);
      this.prev.rot.copy(this.curr.rot);
      this.prev.vel.copy(this.curr.vel);
    }
  }

  /** Call once per rendered frame. `alpha` blends prev -> curr. */
  update(kart: Kart, alpha: number, dt: number): void {
    const rig = this.rig;
    this.pos.lerpVectors(this.prev.pos, this.curr.pos, alpha);
    this.rot.slerpQuaternions(this.prev.rot, this.curr.rot, alpha);
    rig.root.position.copy(this.pos);
    rig.root.quaternion.copy(this.rot);

    // Wheels hang at the spring length the sim has for them.
    kart.wheels.forEach((w, i) => {
      const wr = rig.wheels[i]!;
      const travel = KART.restLength - w.compression;
      wr.node.position.set(wr.mount.x, wr.mount.y - travel, wr.mount.z);
      wr.spring.scale.set(1, Math.max(travel, 0.05), 1);
      wr.spin.rotation.x = w.spin;
      if (wr.front) wr.steer.rotation.y = -kart.steerAngle;
    });

    // Body squat from how compressed the springs are, plus a lagging torso.
    const avg = kart.wheels.reduce((a, w) => a + w.compression, 0) / 4;
    rig.body.position.y = -Math.max(0, avg - 0.12) * 0.25;
    const vy = this.curr.vel.y;
    const accel = dt > 0 ? (vy - this.lastVelY) / dt : 0;
    this.lastVelY = vy;
    // Spring-damper driven by vertical acceleration: lands -> slumps -> rebounds.
    const k = 160;
    const c = 7;
    this.bobV += (-k * this.bob - c * this.bobV - THREE.MathUtils.clamp(accel, -60, 60) * 0.35) * dt;
    this.bob = THREE.MathUtils.clamp(this.bob + this.bobV * dt, -0.18, 0.14);
    const g = rig.gorilla;
    g.torso.position.y = 0.28 + this.bob;
    g.torso.scale.set(1 - this.bob * 0.6, 1 + this.bob * 1.2, 1 - this.bob * 0.6);

    // Lean into corners and look where we are going.
    this.lean = THREE.MathUtils.damp(this.lean, kart.steerAngle, 8, dt);
    g.torso.rotation.z = this.lean * 0.5;
    g.head.rotation.y = -this.lean * 0.8;
    rig.steeringWheel.rotation.z = kart.steerAngle * 2.2;
    // Arms follow the wheel.
    for (let i = 0; i < 2; i++) {
      const rest = g.rest[i]!;
      g.arms[i]!.rotation.copy(rest.shoulder);
      g.elbows[i]!.rotation.copy(rest.elbow);
      g.arms[i]!.rotation.x += (i === 0 ? 1 : -1) * kart.steerAngle * 0.5;
    }

    // Snake: held in the right fist, swung out to either side.
    this.snake.visible = kart.item === 'snake' || kart.swingSide !== 0;
    if (kart.swingSide !== 0) {
      const t = Math.min(1, kart.swingTime / ITEMS.swingTime);
      const arc = Math.sin(t * Math.PI);
      const arm = g.arms[1]!;
      // Right arm swings for both sides — across the body for a left whack.
      arm.rotation.set(-1.4 + arc * 0.6, 0, kart.swingSide === 1 ? -arc * 1.6 : arc * 1.9);
      g.elbows[1]!.rotation.set(-0.1, 0, 0);
      g.torso.rotation.y = kart.swingSide * -arc * 0.5;
      this.snake.rotation.set(arc * 1.2, 0, 0);
    } else {
      g.torso.rotation.y = 0;
      this.snake.rotation.set(0, 0, 0);
    }

    // Spin-out: the gorilla flails.
    if (kart.spinning) {
      this.spinVisual += dt * 18;
      g.arms[0]!.rotation.set(-2.6 + Math.sin(this.spinVisual) * 0.6, 0, 0.6);
      g.arms[1]!.rotation.set(-2.6 + Math.cos(this.spinVisual) * 0.6, 0, -0.6);
      g.head.rotation.z = Math.sin(this.spinVisual * 0.7) * 0.4;
    } else {
      g.head.rotation.z = 0;
    }
    if (kart.wobbleTime > 0) {
      g.head.rotation.z = Math.sin(kart.wobbleTime * 30) * 0.35;
    }
    // A spin-out or a wobble interrupts any celebrating.
    if (kart.spinning || kart.wobbleTime > 0) this.celebLeft = 0;
    this.applyCelebration(dt);
  }
}

/** A floppy green snake, held by the tail. */
export function buildSnake(): THREE.Group {
  const g = new THREE.Group();
  const b = new PartBuilder();
  const green = toon(0x4fae3a);
  const belly = toon(0xd9e36a);
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = 0.05 + t * 0.035;
    b.add(g, GEO.sphere, i % 2 ? green : toon(0x3b8a2c), {
      pos: [Math.sin(t * 5) * 0.06, -0.08 - t * 0.85, Math.cos(t * 4) * 0.04],
      scale: [r, r * 1.5, r],
    });
  }
  // Head with eyes and a tongue.
  b.add(g, GEO.sphere, green, { pos: [0, -1.02, 0.03], scale: [0.11, 0.09, 0.14] });
  b.add(g, GEO.sphere, belly, { pos: [0, -1.06, 0.06], scale: [0.08, 0.04, 0.1] });
  for (const s of [1, -1]) {
    b.add(g, GEO.sphere, toon(0xffffff), { pos: [s * 0.06, -0.98, 0.1], scale: 0.035 });
    b.add(g, GEO.sphere, toon(0x111111), { pos: [s * 0.065, -0.98, 0.125], scale: 0.018 });
  }
  b.add(g, GEO.box, toon(0xd8343a), { pos: [0, -1.1, 0.2], scale: [0.015, 0.01, 0.12] });
  b.build();
  return g;
}
