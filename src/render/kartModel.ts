/**
 * Junk karts the gorillas built themselves, one style per gorilla.
 *
 * Every kart shares the same rig — chassis, four wheels on visible coil
 * springs, a steering wheel, and a seat for the gorilla — so the kart view can
 * animate any of them from the sim. The springs are drawn on purpose: they
 * stretch and squash with the real suspension, which is where most of the
 * game's bounce reads on screen.
 *
 * Coordinates match the sim: origin at the chassis centre, nose along +Z,
 * local +X on the kart's left.
 */

import * as THREE from 'three';
import type { Gorilla, KartStyle } from '../data/gorillas.js';
import { KART } from '../data/tuning.js';
import { type GorillaRig, buildGorilla } from './gorilla.js';
import { GEO, PartBuilder, toon } from './toon.js';

export interface WheelRig {
  /** Moves up and down with the suspension. */
  node: THREE.Group;
  /** Turns with the steering (fronts only). */
  steer: THREE.Group;
  /** Rolls. */
  spin: THREE.Group;
  spring: THREE.Mesh;
  front: boolean;
  mount: THREE.Vector3;
}

export interface KartRig {
  root: THREE.Group;
  /** Chassis + gorilla, squashed and tilted by the animator. */
  body: THREE.Group;
  wheels: WheelRig[];
  steeringWheel: THREE.Group;
  gorilla: GorillaRig;
  /** Where boost flames come out, chassis coordinates. */
  exhaust: THREE.Vector3;
}

let springGeo: THREE.BufferGeometry | null = null;
/** A unit-height coil, scaled in Y to the current spring length. */
function coil(): THREE.BufferGeometry {
  if (springGeo) return springGeo;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const a = t * Math.PI * 2 * 5;
    pts.push(new THREE.Vector3(Math.cos(a) * 0.09, -t, Math.sin(a) * 0.09));
  }
  springGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.025, 5, false);
  return springGeo;
}

export function buildKart(g: Gorilla): KartRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const b = new PartBuilder();
  const seatY = chassis(b, body, g.kart, g.kartColor, g.kartTrim);

  // Steering column and wheel.
  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(0, seatY + 0.42, 0.55);
  steeringWheel.rotation.x = -0.9;
  body.add(steeringWheel);
  b.add(body, GEO.cylinder, toon(0x3a3a3e), { pos: [0, seatY + 0.2, 0.68], rot: [-0.6, 0, 0], scale: [0.03, 0.5, 0.03] });
  b.add(steeringWheel, GEO.torus, toon(0x2b2018), { scale: [0.17, 0.17, 0.2] });
  b.add(steeringWheel, GEO.box, toon(0x2b2018), { scale: [0.3, 0.035, 0.03] });

  // Wheels on springs.
  const wheels: WheelRig[] = [];
  const springMat = toon(0xd9d4c4);
  for (const [x, z, front] of [
    [KART.wheelX, KART.wheelFrontZ, true],
    [-KART.wheelX, KART.wheelFrontZ, true],
    [KART.wheelX, KART.wheelRearZ, false],
    [-KART.wheelX, KART.wheelRearZ, false],
  ] as const) {
    const mount = new THREE.Vector3(x, KART.wheelMountY, z);
    const node = new THREE.Group();
    node.position.copy(mount);
    root.add(node);
    const steer = new THREE.Group();
    node.add(steer);
    const spin = new THREE.Group();
    steer.add(spin);
    wheel(b, spin, g.kart, Math.sign(x), g.kartTrim);
    const spring = new THREE.Mesh(coil(), springMat);
    spring.position.copy(mount);
    root.add(spring);
    wheels.push({ node, steer, spin, spring, front, mount });
  }
  b.build();

  const gorilla = buildGorilla(g);
  gorilla.root.position.set(0, seatY, -0.25);
  body.add(gorilla.root);

  return { root, body, wheels, steeringWheel, gorilla, exhaust: new THREE.Vector3(0, 0.05, -1.3) };
}

/** Builds the chassis and returns the seat height. */
function chassis(b: PartBuilder, body: THREE.Group, style: KartStyle, color: number, trim: number): number {
  const main = toon(color);
  const accent = toon(trim);
  const wood = toon(0x7a4f2c);
  const vine = toon(0x3f7d2c);
  switch (style) {
    case 'logRaft': {
      for (const x of [-0.6, -0.2, 0.2, 0.6]) {
        b.add(body, GEO.cylinder, main, { pos: [x, 0, 0], rot: [Math.PI / 2, 0, 0], scale: [0.2, 2.4, 0.2] });
        b.add(body, GEO.cylinder, toon(0xc79a62), { pos: [x, 0, 1.2], rot: [Math.PI / 2, 0, 0], scale: [0.17, 0.02, 0.17] });
      }
      for (const z of [-0.8, 0.8]) b.add(body, GEO.torus, vine, { pos: [0, 0, z], scale: [0.85, 0.3, 0.6] });
      b.add(body, GEO.box, wood, { pos: [0, 0.22, -0.3], scale: [0.7, 0.08, 0.6] });
      return 0.24;
    }
    case 'barrel': {
      b.add(body, GEO.cylinder, main, { pos: [0, 0, 0], rot: [Math.PI / 2, 0, 0], scale: [0.6, 2.3, 0.55] });
      for (const z of [-0.9, -0.3, 0.3, 0.9]) b.add(body, GEO.torus, accent, { pos: [0, 0, z], scale: [0.6, 0.56, 0.3] });
      b.add(body, GEO.cylinder, toon(0x4d2e17), { pos: [0, 0, 1.16], rot: [Math.PI / 2, 0, 0], scale: [0.5, 0.02, 0.46] });
      return 0.4;
    }
    case 'crate': {
      b.add(body, GEO.box, main, { pos: [0, 0, 0], scale: [1.5, 0.6, 2.3] });
      for (const z of [-1.1, 0, 1.1]) b.add(body, GEO.box, toon(0x8c6a3c), { pos: [0, 0, z], scale: [1.54, 0.64, 0.1] });
      b.add(body, GEO.box, toon(0x8c6a3c), { pos: [0, 0, 0], rot: [0.26, 0, 0], scale: [1.56, 0.08, 2.3] });
      b.add(body, GEO.box, accent, { pos: [0.77, 0, 0.5], scale: [0.02, 0.3, 0.3] });
      b.add(body, GEO.box, accent, { pos: [-0.77, 0, 0.5], scale: [0.02, 0.3, 0.3] });
      return 0.3;
    }
    case 'bamboo': {
      const pole = toon(color);
      for (const x of [-0.7, 0.7]) b.add(body, GEO.cylinder, pole, { pos: [x, 0, 0], rot: [Math.PI / 2, 0, 0], scale: [0.08, 2.5, 0.08] });
      for (const z of [-1.1, -0.4, 0.4, 1.1]) {
        b.add(body, GEO.cylinder, pole, { pos: [0, 0, z], rot: [0, 0, Math.PI / 2], scale: [0.07, 1.5, 0.07] });
        for (const x of [-0.7, 0.7]) b.add(body, GEO.sphere, toon(0x8c9a3c), { pos: [x, 0, z], scale: 0.1 });
      }
      for (let x = -0.55; x <= 0.56; x += 0.18) b.add(body, GEO.cylinder, pole, { pos: [x, 0.08, -0.1], rot: [Math.PI / 2, 0, 0], scale: [0.06, 1.6, 0.06] });
      b.add(body, GEO.box, accent, { pos: [0, 0.18, -0.3], scale: [0.6, 0.06, 0.5] });
      return 0.2;
    }
    case 'canoe': {
      b.add(body, GEO.sphere, main, { pos: [0, 0, 0], scale: [0.72, 0.38, 1.35] });
      b.add(body, GEO.box, toon(0x1d5f52), { pos: [0, 0.2, -0.1], scale: [1.0, 0.1, 1.5] });
      b.add(body, GEO.torus, accent, { pos: [0, 0.05, 0], rot: [Math.PI / 2, 0, 0], scale: [0.73, 1.36, 0.3] });
      return 0.26;
    }
    case 'tire': {
      b.add(body, GEO.torus, main, { pos: [0, 0, 0], rot: [Math.PI / 2, 0, 0], scale: [0.85, 1.15, 1.2] });
      b.add(body, GEO.cylinder, accent, { pos: [0, -0.05, 0], scale: [0.7, 0.1, 1.0] });
      b.add(body, GEO.box, toon(0x3d3d40), { pos: [0, 0.1, -0.3], scale: [0.6, 0.15, 0.6] });
      return 0.2;
    }
    case 'bathtub': {
      b.add(body, GEO.capsule, main, { pos: [0, 0, 0], rot: [Math.PI / 2, 0, 0], scale: [0.7, 1.0, 0.4] });
      b.add(body, GEO.capsule, toon(0x9fd3e6), { pos: [0, 0.22, 0], rot: [Math.PI / 2, 0, 0], scale: [0.6, 0.85, 0.1] });
      for (const x of [-0.6, 0.6]) for (const z of [-0.9, 0.9]) b.add(body, GEO.sphere, accent, { pos: [x, -0.3, z], scale: [0.12, 0.08, 0.12] });
      b.add(body, GEO.cylinder, toon(0xd8b448), { pos: [0, 0.45, -1.0], scale: [0.04, 0.6, 0.04] });
      b.add(body, GEO.cylinder, toon(0xd8b448), { pos: [0, 0.75, -0.9], rot: [0.6, 0, 0], scale: [0.12, 0.05, 0.12] });
      // Rubber duck, obviously.
      b.add(body, GEO.sphere, toon(0xffd43a), { pos: [0.4, 0.42, 0.85], scale: [0.11, 0.09, 0.13] });
      b.add(body, GEO.sphere, toon(0xffd43a), { pos: [0.4, 0.53, 0.92], scale: 0.07 });
      b.add(body, GEO.cone, toon(0xf28c28), { pos: [0.4, 0.53, 1.0], rot: [Math.PI / 2, 0, 0], scale: [0.03, 0.05, 0.03] });
      return 0.24;
    }
    case 'stone': {
      b.add(body, GEO.box, main, { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1.5, 0.5, 2.3] });
      b.add(body, GEO.box, main, { pos: [0, 0.32, 0.85], rot: [-0.3, 0, 0], scale: [1.2, 0.3, 0.5] });
      for (const [x, z, s] of [[0.5, -0.8, 0.3], [-0.6, 0.3, 0.25], [0.2, 0.9, 0.2]] as const)
        b.add(body, GEO.sphereLo, accent, { pos: [x, 0.26, z], scale: [s, 0.08, s] });
      return 0.26;
    }
  }
}

function wheel(b: PartBuilder, spin: THREE.Group, style: KartStyle, side: number, trim: number): void {
  const r = KART.wheelRadius;
  const axle: [number, number, number] = [0, 0, Math.PI / 2];
  const outward = side * 0.06;
  switch (style) {
    case 'tire':
    case 'bathtub':
      b.add(spin, GEO.torus, toon(0x222225), { pos: [outward, 0, 0], rot: [0, Math.PI / 2, 0], scale: [r * 0.8, r * 0.8, r * 1.4] });
      b.add(spin, GEO.cylinder, toon(trim), { pos: [outward, 0, 0], rot: axle, scale: [r * 0.55, 0.2, r * 0.55] });
      break;
    case 'stone':
    case 'crate':
      b.add(spin, GEO.cylinder, toon(style === 'stone' ? 0x8a867c : 0x6e4a2a), { pos: [outward, 0, 0], rot: axle, scale: [r, 0.28, r] });
      b.add(spin, GEO.cylinder, toon(0x55524b), { pos: [outward + side * 0.15, 0, 0], rot: axle, scale: [r * 0.3, 0.04, r * 0.3] });
      b.add(spin, GEO.box, toon(0x55524b), { pos: [outward + side * 0.145, 0, 0], scale: [0.02, r * 1.7, 0.06] });
      break;
    default:
      // Coconut wheels: hairy brown shells with three "eyes".
      b.add(spin, GEO.sphere, toon(0x6b4325), { pos: [outward, 0, 0], scale: [0.16, r, r] });
      b.add(spin, GEO.cylinder, toon(0xf3ead2), { pos: [outward + side * 0.15, 0, 0], rot: axle, scale: [r * 0.62, 0.02, r * 0.62] });
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        b.add(spin, GEO.sphereLo, toon(0x3a2414), { pos: [outward + side * 0.165, Math.sin(a) * 0.09, Math.cos(a) * 0.09], scale: 0.03 });
      }
  }
}
