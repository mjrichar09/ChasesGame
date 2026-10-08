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
import { ITEMS, KART, PARROT } from '../data/tuning.js';
import type { Kart } from '../sim/kart.js';
import { celebrate } from './celebrate.js';
import { type ParrotRig, animateParrot, buildParrot } from './parrot.js';
import { contactShadow, outline, rimLight } from './polish.js';
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
  /** Built the first time this kart flies. */
  private parrot: ParrotRig | null = null;
  private parrotT = 0;
  /** Swagger visuals: a star when the meter is full, auras while a move lasts. */
  private swag: {
    star: THREE.Sprite;
    mark: THREE.Sprite;
    markKind: string;
    cool: THREE.Mesh;
    fire: THREE.Mesh;
    rock: THREE.Mesh;
  } | null = null;
  /** Seconds the gorilla has been doing its show-off. */
  private lastShowOff = 0;
  /** Seconds since the lava took this kart (−1 while racing). */
  private toastT = -1;
  /** Rendered pose this frame, for the camera and effects. */
  readonly pos = new THREE.Vector3();
  readonly rot = new THREE.Quaternion();

  /** A soft blob on the ground under the kart (positioned by the session). */
  readonly shadow: THREE.Mesh;
  private readonly ink: boolean;

  constructor(gorilla: Gorilla, opts: { ink?: boolean } = {}) {
    this.gorilla = gorilla;
    this.rig = buildKart(gorilla);
    this.snake = buildSnake();
    this.snake.visible = false;
    this.rig.gorilla.hands[1].add(this.snake);
    this.seatY = this.rig.gorilla.root.position.y;
    // Cartoon pop: a warm rim light, and ink outlines where the device can afford them.
    this.ink = opts.ink ?? false;
    rimLight(this.rig.root);
    if (this.ink) outline(this.rig.root);
    this.shadow = contactShadow();
  }

  /**
   * Lay the contact shadow on the ground at `ground` (a point on the surface
   * under the kart, with that surface's normal). It shrinks and fades as the
   * kart rises.
   */
  placeShadow(ground: THREE.Vector3, normal: THREE.Vector3): void {
    const height = Math.max(0, this.pos.y - ground.y - 0.9);
    const f = Math.max(0, 1 - height / 8);
    this.shadow.visible = f > 0.02 && this.rig.root.visible;
    this.shadow.position.copy(ground).addScaledVector(normal, 0.06);
    const yaw = new THREE.Euler().setFromQuaternion(this.rot, 'YXZ').y;
    this.shadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    this.shadow.rotateZ(-yaw);
    this.shadow.scale.setScalar(0.6 + f * 0.4);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = f;
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

  /** Swagger: the full-meter star, the wind-up bounce, and each move's look while it lasts. */
  private animateSwagger(kart: Kart, dt: number): void {
    const any = kart.swagger >= 100 || kart.coolTime > 0 || kart.boulderTime > 0 || kart.noBrakesTime > 0 ||
      kart.slowTime > 0 || kart.steerSwapTime > 0 || kart.moveWindup > 0;
    // Showing off after a hit: a quick seated celebration.
    if (kart.showOff > this.lastShowOff + 0.5) this.celebrate(1.4, true);
    this.lastShowOff = kart.showOff;
    if (!any && !this.swag) return;
    if (!this.swag) {
      const additive = (color: number) =>
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
      const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture('★', '#ffcc33'), depthTest: false }));
      star.scale.setScalar(1.1);
      star.position.set(0, 3.1, 0);
      const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture('👏'), depthTest: false }));
      mark.scale.setScalar(1.3);
      mark.position.set(0, 3.4, 0);
      const cool = new THREE.Mesh(new THREE.SphereGeometry(2.1, 20, 14), additive(0xffd84a));
      const fire = new THREE.Mesh(new THREE.SphereGeometry(1.9, 16, 12), additive(0xff4a1a));
      const rock = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.9, 1),
        new THREE.MeshToonMaterial({ color: 0x7d776c, gradientMap: toon(0).gradientMap }),
      );
      for (const o of [star, mark, cool, fire, rock]) {
        o.visible = false;
        this.rig.root.add(o);
      }
      this.swag = { star, mark, markKind: '👏', cool, fire, rock };
    }
    const s = this.swag;
    const t = kart.moveT;
    s.star.visible = kart.swagger >= 100;
    if (s.star.visible) s.star.material.rotation = Math.sin(t * 3) * 0.3;
    // Wind-up: the kart puffs up for a beat.
    const puff = kart.moveWindup > 0 ? 1 + Math.sin((0.35 - kart.moveWindup) * 18) * 0.08 : 1;
    this.rig.body.scale.setScalar(puff);
    s.cool.visible = kart.coolTime > 0;
    if (s.cool.visible) s.cool.scale.setScalar(1 + Math.sin(t * 8) * 0.05);
    s.fire.visible = kart.noBrakesTime > 0;
    if (s.fire.visible) s.fire.scale.set(1, 0.8 + Math.sin(t * 20) * 0.1, 1.3);
    s.rock.visible = kart.boulderTime > 0;
    if (s.rock.visible) s.rock.rotation.x -= Math.max(0, kart.forwardSpeed) * dt * 0.55;
    this.rig.gorilla.root.visible = !s.rock.visible;
    // Over a victim's head: clapped, or the music that scrambled their steering.
    const kind = kart.steerSwapTime > 0 ? '🎵' : kart.slowTime > 0 ? '👏' : '';
    s.mark.visible = kind !== '';
    if (kind && kind !== s.markKind) {
      s.markKind = kind;
      s.mark.material.map = emojiTexture(kind);
      s.mark.material.needsUpdate = true;
    }
    if (s.mark.visible) s.mark.position.y = 3.4 + Math.sin(t * 6) * 0.15;
  }

  /**
   * The parrot swoops down at take-off, hauls the kart along on two vines,
   * flaps harder as it tires, and after letting go climbs away and is gone.
   */
  private animateParrot(kart: Kart, dt: number): void {
    const leaving = !kart.flying && kart.sinceFlight < 1.4;
    if (!kart.flying && !leaving) {
      if (this.parrot) this.parrot.root.visible = false;
      return;
    }
    if (!this.parrot) {
      this.parrot = buildParrot();
      rimLight(this.parrot.root);
      if (this.ink) outline(this.parrot.root);
      this.rig.root.add(this.parrot.root);
    }
    const p = this.parrot;
    p.root.visible = true;
    this.parrotT += dt;
    const HOVER = 3.1;
    let y = HOVER;
    let z = 0.2;
    let effort = 0.2;
    if (kart.flying) {
      // Swoop in from high above over the first half-second.
      const arrive = Math.min(1, kart.flyElapsed / 0.5);
      y = HOVER + (1 - arrive) * (1 - arrive) * 10;
      effort = kart.flyElapsed < 0.8 ? 1 : kart.flyTime < PARROT.sag ? 1 : 0.25;
    } else {
      // Let go: climb away and shrink into the distance.
      const t = kart.sinceFlight;
      y = HOVER + t * t * 6;
      z = 0.2 + t * 8;
      effort = 0.6;
    }
    p.root.position.set(0, y, z);
    // The rig root is the kart; keep the bird level in the world-ish sense.
    animateParrot(p, this.parrotT, effort);
    // Vines reach from the talons down to the chassis while carrying.
    for (const v of p.vines) {
      v.visible = kart.flying;
      v.scale.y = Math.max(0.1, (y - 0.9) / 1.25 - 0.7);
    }
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
    // Taken by the lava: char black and sink into it.
    if (kart.out) {
      if (this.toastT < 0) {
        this.toastT = 0;
        const charred = toon(0x1c1614, { emissive: 0x2a0800 });
        rig.root.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = charred;
        });
      }
      this.toastT += dt;
      rig.root.position.y -= Math.min(1.8, this.toastT * 0.6);
      rig.root.visible = this.toastT < 4;
      return;
    }

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
    this.animateParrot(kart, dt);
    this.animateSwagger(kart, dt);

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

const emojiCache = new Map<string, THREE.CanvasTexture>();
/** A big emoji (or symbol) on a transparent texture, for floating markers. */
export function emojiTexture(text: string, color = '#ffffff'): THREE.CanvasTexture {
  const key = text + color;
  const hit = emojiCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.font = '96px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = '#2a1a0e';
  g.strokeText(text, 64, 70);
  g.fillStyle = color;
  g.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  emojiCache.set(key, tex);
  return tex;
}
