/**
 * The parrot: a huge scarlet macaw that carries a kart by two vines.
 *
 * Built from primitives like the gorillas. Wings are their own nodes so they
 * can flap; the vines are scaled to reach from its talons down to the kart.
 * `buildPerchedParrot` is the small, wings-folded version that floats over a
 * pickup ring.
 */

import * as THREE from 'three';
import { GEO, PartBuilder, toon } from './toon.js';

const RED = 0xd8262b;
const YELLOW = 0xffcf2e;
const BLUE = 0x2a6fd8;
const IVORY = 0xf3ead2;

export interface ParrotRig {
  root: THREE.Group;
  wings: [THREE.Group, THREE.Group];
  tail: THREE.Group;
  head: THREE.Group;
  vines: THREE.Mesh[];
}

function addBody(b: PartBuilder, body: THREE.Object3D, head: THREE.Object3D, tail: THREE.Object3D): void {
  const red = toon(RED);
  b.add(body, GEO.sphere, red, { pos: [0, 0, 0], scale: [0.55, 0.5, 0.95] });
  b.add(body, GEO.sphere, toon(0xe8484a), { pos: [0, -0.18, 0.15], scale: [0.45, 0.35, 0.7] }); // chest
  // Head: red, a white face patch, a big hooked beak, a beady eye each side.
  b.add(head, GEO.sphere, red, { pos: [0, 0, 0], scale: 0.42 });
  for (const s of [1, -1]) {
    b.add(head, GEO.sphere, toon(0xfbfbf5), { pos: [s * 0.24, 0.02, 0.18], scale: [0.14, 0.18, 0.18] });
    b.add(head, GEO.sphere, toon(0x111111), { pos: [s * 0.3, 0.06, 0.22], scale: 0.06 });
  }
  b.add(head, GEO.cone, toon(IVORY), { pos: [0, 0.02, 0.48], rot: [Math.PI / 2 + 0.5, 0, 0], scale: [0.16, 0.36, 0.16] });
  b.add(head, GEO.cone, toon(0x2b2b2b), { pos: [0, -0.12, 0.38], rot: [Math.PI / 2 - 0.2, 0, 0], scale: [0.1, 0.18, 0.1] });
  // Tail: long red feathers with blue tips.
  for (let i = -1; i <= 1; i++) {
    b.add(tail, GEO.box, red, { pos: [i * 0.12, 0, -0.8], rot: [0.15, i * 0.1, 0], scale: [0.14, 0.05, 1.6] });
    b.add(tail, GEO.box, toon(BLUE), { pos: [i * 0.13, -0.02, -1.55], rot: [0.15, i * 0.1, 0], scale: [0.13, 0.05, 0.5] });
  }
}

/** One wing as bands: red at the shoulder, a yellow band, blue flight feathers. */
function addWing(b: PartBuilder, wing: THREE.Object3D, side: number): void {
  const bands: [number, number, number][] = [
    [RED, 0.5, 0.9],
    [YELLOW, 1.1, 0.8],
    [BLUE, 1.8, 0.75],
  ];
  for (const [color, reach, depth] of bands) {
    b.add(wing, GEO.box, toon(color), { pos: [side * reach, 0, -0.1], scale: [0.85, 0.06, depth] });
  }
  for (let i = 0; i < 4; i++) {
    b.add(wing, GEO.box, toon(BLUE), { pos: [side * (2.2 + i * 0.12), 0, -0.25 - i * 0.12], rot: [0, side * (0.2 + i * 0.12), 0], scale: [0.5, 0.05, 0.22] });
  }
}

export function buildParrot(): ParrotRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const head = new THREE.Group();
  head.position.set(0, 0.35, 0.85);
  body.add(head);
  const tail = new THREE.Group();
  tail.position.set(0, 0.05, -0.8);
  body.add(tail);
  const wings: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  const b = new PartBuilder();
  addBody(b, body, head, tail);
  wings.forEach((w, i) => {
    w.position.set(i === 0 ? 0.45 : -0.45, 0.15, 0.05);
    body.add(w);
    addWing(b, w, i === 0 ? 1 : -1);
  });
  // Talons, gripping the vines.
  const vines: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    b.add(body, GEO.cylinder, toon(0x55524b), { pos: [s * 0.22, -0.55, 0.1], scale: [0.06, 0.35, 0.06] });
    const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 5).translate(0, -0.5, 0), toon(0x3f7d2c));
    vine.position.set(s * 0.22, -0.7, 0.1);
    body.add(vine);
    vines.push(vine);
  }
  b.build(false);
  root.scale.setScalar(1.25);
  return { root, wings, tail, head, vines };
}

/** Flap and sway. `effort` 0..1 flaps harder (lifting off, tiring). */
export function animateParrot(r: ParrotRig, t: number, effort: number): void {
  const rate = 7 + effort * 6;
  const amp = 0.55 + effort * 0.35;
  const flap = Math.sin(t * rate) * amp;
  r.wings[0].rotation.z = flap;
  r.wings[1].rotation.z = -flap;
  r.root.children[0]!.position.y = -Math.sin(t * rate) * 0.12;
  r.tail.rotation.x = Math.sin(t * rate * 0.5) * 0.08;
  r.head.rotation.y = Math.sin(t * 1.3) * 0.3;
}

/** A small perched parrot with folded wings, for the pickup. */
export function buildPerchedParrot(): THREE.Group {
  const g = new THREE.Group();
  const head = new THREE.Group();
  head.position.set(0, 0.55, 0.35);
  g.add(head);
  const tail = new THREE.Group();
  tail.position.set(0, -0.2, -0.4);
  tail.rotation.x = -0.9;
  g.add(tail);
  const b = new PartBuilder();
  addBody(b, g, head, tail);
  for (const s of [1, -1]) {
    b.add(g, GEO.sphere, toon(YELLOW), { pos: [s * 0.42, 0.0, -0.1], scale: [0.12, 0.38, 0.7] });
    b.add(g, GEO.sphere, toon(BLUE), { pos: [s * 0.44, -0.12, -0.35], scale: [0.1, 0.28, 0.5] });
  }
  b.build(false);
  // Perched birds sit upright: tip the body back.
  const upright = new THREE.Group();
  g.rotation.x = -0.75;
  upright.add(g);
  upright.scale.setScalar(0.85);
  return upright;
}
