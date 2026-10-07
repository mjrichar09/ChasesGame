/**
 * Third-person chase camera.
 *
 * Sits behind and above the kart and follows on springs rather than rigidly:
 * position and heading lag a little, which is what sells speed and makes the
 * bouncing visible (a camera bolted to the kart bounces with it and the
 * bounce disappears). The heading follows the kart's yaw but ignores
 * spin-outs, so a peel spins the gorilla, not the player's view.
 *
 * Boost widens the field of view; landings and whacks add a short shake.
 * One camera per viewport, so split-screen later is just more of these.
 */

import * as THREE from 'three';
import type { Track } from '../sim/track.js';

const DIST = 7.2;
const HEIGHT = 2.9;
const LOOK_AHEAD = 4;
const LOOK_UP = 1.1;
const BASE_FOV = 68;
const BOOST_FOV = 82;

export class ChaseCam {
  readonly camera: THREE.PerspectiveCamera;
  private yaw = 0;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private shake = 0;
  private time = 0;
  private placed = false;
  /** 0..1 blend toward the flying framing. */
  private fly = 0;
  private wasBack = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.1, 900);
  }

  /** Snap straight to the target next frame (race start, respawn). */
  cut(): void {
    this.placed = false;
  }

  kick(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  update(
    dt: number,
    target: THREE.Vector3,
    rot: THREE.Quaternion,
    opts: { boosting: boolean; spinning: boolean; flying: boolean; speed: number; track: Track; s: number; lookBack?: boolean },
  ): void {
    this.time += dt;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rot);
    const kartYaw = Math.atan2(fwd.x, fwd.z);
    if (!this.placed) this.yaw = kartYaw;
    if (!opts.spinning) {
      let d = kartYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-5.5 * dt));
    }
    // Looking back: the same framing, turned round to face what is behind.
    const back = opts.lookBack ? -1 : 1;
    const flat = new THREE.Vector3(Math.sin(this.yaw) * back, 0, Math.cos(this.yaw) * back);
    // Pull back a touch with speed — and a lot on the parrot, to see where to go.
    this.fly += ((opts.flying ? 1 : 0) - this.fly) * (1 - Math.exp(-2.5 * dt));
    const dist = DIST + Math.min(opts.speed, 35) * 0.04 + this.fly * 4;
    const want = target.clone().addScaledVector(flat, -dist);
    want.y += HEIGHT + this.fly * 3.5;

    // Never below the road (or the ground) where the camera is.
    const roadHere = opts.track.project({ x: want.x, y: want.y, z: want.z }, opts.s);
    const k = opts.track.at(roadHere.s);
    if (Math.abs(roadHere.lateral) < k.halfWidth + 3) want.y = Math.max(want.y, k.p.y + 1.4);
    want.y = Math.max(want.y, 0.8);

    const lookWant = target.clone().addScaledVector(flat, LOOK_AHEAD);
    lookWant.y += LOOK_UP;

    if (!this.placed || opts.lookBack !== this.wasBack) {
      this.wasBack = !!opts.lookBack;
      this.pos.copy(want);
      this.look.copy(lookWant);
      this.placed = true;
    } else {
      // Horizontal follows tighter than vertical, so bounces read on screen.
      const kh = 1 - Math.exp(-9 * dt);
      const kv = 1 - Math.exp(-5 * dt);
      this.pos.x += (want.x - this.pos.x) * kh;
      this.pos.z += (want.z - this.pos.z) * kh;
      this.pos.y += (want.y - this.pos.y) * kv;
      this.look.lerp(lookWant, 1 - Math.exp(-14 * dt));
    }

    this.camera.position.copy(this.pos);
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.35;
      this.camera.position.x += Math.sin(this.time * 61) * s;
      this.camera.position.y += Math.sin(this.time * 47 + 1) * s;
      this.shake *= Math.exp(-6 * dt);
    }
    this.camera.lookAt(this.look);

    const fov = opts.boosting ? BOOST_FOV : BASE_FOV;
    this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-4 * dt));
    this.camera.updateProjectionMatrix();
  }
}
