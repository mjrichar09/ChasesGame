/**
 * A seated cartoon gorilla, built from primitives.
 *
 * Origin is the seat, facing +Z. The model is a small rig of nodes the kart
 * view animates — torso (lean and bounce), head (look into corners), and two
 * arms (steer, and swing the snake) — with all the primitives on each node
 * merged by material, so a whole gorilla is a handful of draw calls.
 *
 * Proportions lean cartoon: huge shoulders and forearms, small legs, a big
 * brow and a pale muzzle. Each roster entry varies the fur, size, bulk, a
 * silverback saddle and a head accessory.
 */

import * as THREE from 'three';
import type { Gorilla } from '../data/gorillas.js';
import { GEO, PartBuilder, toon } from './toon.js';

export interface GorillaRig {
  root: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  /** Shoulder pivots, left (+X) then right (-X). */
  arms: [THREE.Group, THREE.Group];
  elbows: [THREE.Group, THREE.Group];
  hands: [THREE.Group, THREE.Group];
  /** Resting arm pose, for the animator to blend back to. */
  rest: { shoulder: THREE.Euler; elbow: THREE.Euler }[];
}

const BLACK = 0x141214;
const WHITE = 0xfbfbf5;
const SILVER = 0xb9b9bf;

export function buildGorilla(g: Gorilla): GorillaRig {
  const b = new PartBuilder();
  const fur = toon(g.fur);
  const dark = toon(g.furDark);
  const skin = toon(g.skin);
  const k = g.bulk;

  const root = new THREE.Group();
  root.name = g.id;

  // Seat, legs and feet (on the root: they do not lean).
  b.add(root, GEO.sphere, dark, { pos: [0, 0.18, 0], scale: [0.42 * k, 0.24, 0.36] });
  for (const s of [1, -1]) {
    b.add(root, GEO.capsule, dark, { pos: [s * 0.2, 0.17, 0.28], rot: [Math.PI / 2, 0, 0], scale: [0.13, 0.22, 0.13] });
    b.add(root, GEO.sphere, skin, { pos: [s * 0.22, 0.12, 0.52], scale: [0.12, 0.08, 0.16] });
  }

  const torso = new THREE.Group();
  torso.position.set(0, 0.28, 0);
  root.add(torso);
  b.add(torso, GEO.sphere, fur, { pos: [0, 0.34, 0], scale: [0.5 * k, 0.56, 0.42] });
  b.add(torso, GEO.sphere, skin, { pos: [0, 0.4, 0.22], scale: [0.34 * k, 0.34, 0.2] });
  // Pecs.
  for (const s of [1, -1]) b.add(torso, GEO.sphere, skin, { pos: [s * 0.15 * k, 0.52, 0.27], scale: [0.16 * k, 0.12, 0.1] });
  if (g.silverback) b.add(torso, GEO.sphere, toon(SILVER), { pos: [0, 0.4, -0.17], scale: [0.44 * k, 0.4, 0.28] });
  // Shoulders: the defining gorilla silhouette.
  for (const s of [1, -1]) b.add(torso, GEO.sphere, fur, { pos: [s * 0.42 * k, 0.66, 0.0], scale: 0.23 * k });

  // Head.
  const head = new THREE.Group();
  head.position.set(0, 0.9, 0.1);
  torso.add(head);
  b.add(head, GEO.sphere, fur, { pos: [0, 0, 0], scale: [0.26, 0.28, 0.26] });
  b.add(head, GEO.sphere, fur, { pos: [0, 0.2, -0.05], scale: [0.15, 0.15, 0.2] }); // crest
  b.add(head, GEO.sphere, skin, { pos: [0, -0.01, 0.17], scale: [0.2, 0.2, 0.12] }); // face
  b.add(head, GEO.sphere, skin, { pos: [0, -0.1, 0.22], scale: [0.17, 0.12, 0.13] }); // muzzle
  b.add(head, GEO.capsule, dark, { pos: [0, 0.08, 0.23], rot: [0, 0, Math.PI / 2], scale: [0.06, 0.2, 0.06] }); // brow
  for (const s of [1, -1]) {
    b.add(head, GEO.sphereLo, toon(BLACK), { pos: [s * 0.045, -0.07, 0.34], scale: 0.025 }); // nostrils
    b.add(head, GEO.sphere, toon(WHITE), { pos: [s * 0.085, 0.02, 0.255], scale: 0.05 });
    b.add(head, GEO.sphere, toon(BLACK), { pos: [s * 0.085, 0.02, 0.295], scale: 0.026 });
    b.add(head, GEO.sphere, skin, { pos: [s * 0.25, 0.02, -0.01], scale: [0.04, 0.07, 0.06] }); // ears
  }
  b.add(head, GEO.box, toon(0x2a1a18), { pos: [0, -0.16, 0.31], scale: [0.14, 0.025, 0.03] }); // grin
  accessory(b, head, g);

  // Arms: shoulder pivot -> upper arm -> elbow -> forearm -> fist.
  const arms: GorillaRig['arms'] = [new THREE.Group(), new THREE.Group()];
  const elbows: GorillaRig['elbows'] = [new THREE.Group(), new THREE.Group()];
  const hands: GorillaRig['hands'] = [new THREE.Group(), new THREE.Group()];
  const rest: GorillaRig['rest'] = [];
  [1, -1].forEach((s, i) => {
    const arm = arms[i]!;
    arm.position.set(s * 0.46 * k, 0.66, 0.02);
    torso.add(arm);
    b.add(arm, GEO.capsule, fur, { pos: [0, -0.22, 0], scale: [0.14 * k, 0.24, 0.14 * k] });
    const elbow = elbows[i]!;
    elbow.position.set(0, -0.44, 0);
    arm.add(elbow);
    // Forearms bigger than upper arms — cartoon gorilla rule.
    b.add(elbow, GEO.capsule, fur, { pos: [0, -0.2, 0], scale: [0.16 * k, 0.2, 0.16 * k] });
    const hand = hands[i]!;
    hand.position.set(0, -0.42, 0);
    elbow.add(hand);
    b.add(hand, GEO.sphere, skin, { pos: [0, 0, 0], scale: [0.13 * k, 0.11, 0.14] });
    // Reach forward and in to the wheel.
    arm.rotation.set(-1.05, 0, -s * 0.2);
    elbow.rotation.set(-0.5, 0, s * 0.05);
    rest.push({ shoulder: arm.rotation.clone(), elbow: elbow.rotation.clone() });
  });

  b.build();
  root.scale.setScalar(g.size);
  return { root, torso, head, arms, elbows, hands, rest };
}

function accessory(b: PartBuilder, head: THREE.Group, g: Gorilla): void {
  const accent = toon(g.accent);
  switch (g.accessory) {
    case 'crown':
      b.add(head, GEO.cylinder, accent, { pos: [0, 0.27, -0.02], scale: [0.16, 0.08, 0.16] });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        b.add(head, GEO.cone, accent, { pos: [Math.sin(a) * 0.13, 0.36, -0.02 + Math.cos(a) * 0.13], scale: [0.04, 0.12, 0.04] });
      }
      b.add(head, GEO.sphere, toon(0xd8343a), { pos: [0, 0.28, 0.15], scale: 0.035 });
      break;
    case 'bandana':
      b.add(head, GEO.torus, accent, { pos: [0, 0.1, 0], rot: [Math.PI / 2 - 0.15, 0, 0], scale: [0.25, 0.25, 0.3] });
      b.add(head, GEO.sphere, accent, { pos: [0, 0.12, -0.27], scale: [0.06, 0.05, 0.05] });
      b.add(head, GEO.box, accent, { pos: [0.04, 0.05, -0.32], rot: [0.4, 0, 0.3], scale: [0.05, 0.14, 0.02] });
      break;
    case 'goggles':
      b.add(head, GEO.torus, toon(0x3a2a20), { pos: [0, 0.13, 0], rot: [Math.PI / 2 - 0.2, 0, 0], scale: [0.26, 0.26, 0.2] });
      for (const s of [1, -1]) {
        b.add(head, GEO.cylinder, toon(0x8a6a3a), { pos: [s * 0.09, 0.17, 0.22], rot: [Math.PI / 2 - 0.3, 0, 0], scale: [0.075, 0.05, 0.075] });
        b.add(head, GEO.cylinder, accent, { pos: [s * 0.09, 0.18, 0.25], rot: [Math.PI / 2 - 0.3, 0, 0], scale: [0.06, 0.02, 0.06] });
      }
      break;
    case 'hardhat':
      b.add(head, GEO.sphere, accent, { pos: [0, 0.16, -0.01], scale: [0.27, 0.2, 0.27] });
      b.add(head, GEO.cylinder, accent, { pos: [0, 0.17, 0.02], scale: [0.32, 0.02, 0.32] });
      b.add(head, GEO.box, toon(0xe0b010), { pos: [0, 0.3, 0], scale: [0.04, 0.06, 0.4] });
      break;
    case 'flower':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.add(head, GEO.sphere, accent, { pos: [0.2 + Math.cos(a) * 0.06, 0.2 + Math.sin(a) * 0.06, 0.06], scale: [0.045, 0.045, 0.02] });
      }
      b.add(head, GEO.sphere, toon(0xffd43a), { pos: [0.2, 0.2, 0.08], scale: 0.035 });
      break;
    case 'shades':
      for (const s of [1, -1]) b.add(head, GEO.box, toon(0x111114), { pos: [s * 0.09, 0.03, 0.3], scale: [0.13, 0.08, 0.03] });
      b.add(head, GEO.box, toon(0x111114), { pos: [0, 0.05, 0.3], scale: [0.08, 0.02, 0.02] });
      b.add(head, GEO.box, toon(0xffffff, { emissive: 0x444444 }), { pos: [0.12, 0.05, 0.316], scale: [0.03, 0.015, 0.005] });
      break;
    case 'headphones':
      b.add(head, GEO.torus, toon(0x26232a), { pos: [0, 0.03, -0.01], rot: [0, Math.PI / 2, 0], scale: [0.29, 0.29, 0.25] });
      for (const s of [1, -1]) b.add(head, GEO.cylinder, accent, { pos: [s * 0.28, 0.02, 0], rot: [0, 0, Math.PI / 2], scale: [0.09, 0.07, 0.09] });
      break;
    case 'none':
      // A scar over one eye — Gus has been through things.
      b.add(head, GEO.box, toon(0x8c5a50), { pos: [-0.09, 0.05, 0.27], rot: [0, 0, 0.5], scale: [0.02, 0.13, 0.01] });
      break;
  }
}
