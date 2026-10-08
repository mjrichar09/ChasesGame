/**
 * Pickups and peels.
 *
 * A pickup floats, bobs and turns above a glowing ring of light so it reads
 * from far down the track — a banana bunch or a coiled snake, so you can see
 * what you are about to grab. Collected pickups vanish until the sim brings
 * them back. Peels lie flat on the road where they were dropped, for as long
 * as they last (until somebody hits one).
 */

import * as THREE from 'three';
import type { Items } from '../sim/items.js';
import { buildSnake } from './kartView.js';
import { buildPerchedParrot } from './parrot.js';
import { GEO, PartBuilder, toon } from './toon.js';

/** A single banana (pickups come one at a time and stack up to three). */
function bananaBunch(): THREE.Group {
  const g = new THREE.Group();
  const b = new PartBuilder();
  const yellow = toon(0xffd93b, { emissive: 0x3a2a00 });
  const tip = toon(0x5a3a1a);
  for (let i = 1; i < 2; i++) {
    const a = (i - 1) * 0.45;
    // A banana: three capsule segments bending along an arc.
    for (let j = 0; j < 3; j++) {
      const t = (j - 1) * 0.42;
      b.add(g, GEO.capsule, yellow, {
        pos: [Math.sin(a) * 0.12 + Math.sin(t) * 0.05, 0.1 + Math.cos(t) * 0.32 - 0.32, Math.cos(a) * 0.05 + Math.sin(t) * 0.25],
        rot: [-t * 1.1, 0, a],
        scale: [0.09, 0.14, 0.09],
      });
    }
    b.add(g, GEO.sphereLo, tip, { pos: [Math.sin(a) * 0.12, 0.08, -0.33], scale: 0.04 });
  }
  b.add(g, GEO.cylinder, toon(0x6b8f2a), { pos: [0, 0.12, 0.38], rot: [Math.PI / 2, 0, 0], scale: [0.06, 0.15, 0.06] });
  b.build(false);
  g.scale.setScalar(2.2);
  return g;
}

function coiledSnake(): THREE.Group {
  const g = new THREE.Group();
  const b = new PartBuilder();
  const green = toon(0x4fae3a, { emissive: 0x0c2a08 });
  for (let i = 0; i < 3; i++) {
    b.add(g, GEO.torus, i % 2 ? toon(0x3b8a2c) : green, { pos: [0, -0.25 + i * 0.14, 0], rot: [Math.PI / 2, 0, 0], scale: [0.3 - i * 0.06, 0.3 - i * 0.06, 0.7] });
  }
  const head = buildSnake();
  head.scale.setScalar(0.6);
  head.position.set(0, 0.85, 0);
  head.children.forEach((c) => (c.visible = true));
  b.build(false);
  g.add(head);
  return g;
}

function peelMesh(): THREE.Group {
  const g = new THREE.Group();
  const b = new PartBuilder();
  const yellow = toon(0xffd93b);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    b.add(g, GEO.capsule, yellow, { pos: [Math.sin(a) * 0.32, 0.06, Math.cos(a) * 0.32], rot: [Math.PI / 2, 0, -a], scale: [0.11, 0.22, 0.04] });
  }
  b.add(g, GEO.sphere, toon(0xf3e3a0), { pos: [0, 0.1, 0], scale: [0.18, 0.12, 0.18] });
  b.add(g, GEO.cylinder, toon(0x5a3a1a), { pos: [0, 0.25, 0], scale: [0.05, 0.18, 0.05] });
  b.build(false);
  g.scale.setScalar(1.3);
  return g;
}

/** Additive glowing ring + soft disc under a pickup. */
function glowRing(color: number): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.07, 8, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 32),
    new THREE.MeshBasicMaterial({ map: radialTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.02;
  g.add(disc);
  // A faint light column.
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.75, 0.85, 2.6, 24, 1, true),
    new THREE.MeshBasicMaterial({ map: beamTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = 1.3;
  g.add(beam);
  return g;
}

let radial: THREE.Texture | null = null;
export function radialTexture(): THREE.Texture {
  if (radial) return radial;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  radial = new THREE.CanvasTexture(c);
  return radial;
}

let beamTex: THREE.Texture | null = null;
function beamTexture(): THREE.Texture {
  if (beamTex) return beamTex;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,0.35)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 64);
  beamTex = new THREE.CanvasTexture(c);
  return beamTex;
}

interface PickupView {
  root: THREE.Group;
  banana: THREE.Group;
  snake: THREE.Group;
  parrot: THREE.Group;
  ring: THREE.Group;
  ringSnake: THREE.Group;
  ringParrot: THREE.Group;
  phase: number;
}

export class ItemsView {
  readonly group = new THREE.Group();
  private readonly pickups: PickupView[] = [];
  private readonly peels = new Map<number, THREE.Group>();
  private readonly peelProto = peelMesh();
  private readonly loose = new Map<number, THREE.Group>();
  private readonly bunchProto = bananaBunch();

  constructor(items: Items) {
    items.pickups.forEach((p, i) => {
      const root = new THREE.Group();
      root.position.set(p.pos.x, p.pos.y - 1.1, p.pos.z);
      const banana = bananaBunch();
      const snake = coiledSnake();
      const parrot = buildPerchedParrot();
      const ring = glowRing(0xffe14d);
      const ringSnake = glowRing(0x7dff6a);
      const ringParrot = glowRing(0x4dd2ff);
      for (const o of [banana, snake, parrot]) o.position.y = 1.2;
      root.add(banana, snake, parrot, ring, ringSnake, ringParrot);
      this.group.add(root);
      this.pickups.push({ root, banana, snake, parrot, ring, ringSnake, ringParrot, phase: i * 1.7 });
    });
  }

  update(items: Items, time: number): void {
    items.pickups.forEach((p, i) => {
      const v = this.pickups[i]!;
      v.root.visible = p.active;
      v.banana.visible = v.ring.visible = p.kind === 'banana';
      v.snake.visible = v.ringSnake.visible = p.kind === 'snake';
      v.parrot.visible = v.ringParrot.visible = p.kind === 'parrot';
      const bob = Math.sin(time * 2.4 + v.phase) * 0.18;
      for (const o of [v.banana, v.snake, v.parrot]) {
        o.position.y = 1.25 + bob;
        o.rotation.y = time * 1.8 + v.phase;
      }
      const pulse = 1 + Math.sin(time * 4 + v.phase) * 0.08;
      for (const r of [v.ring, v.ringSnake, v.ringParrot]) r.scale.setScalar(pulse);
    });

    // Loose bunches (Feed the Troop): bob and spin until someone grabs them.
    const liveLoose = new Set<number>();
    for (const l of items.loose) {
      liveLoose.add(l.id);
      let m = this.loose.get(l.id);
      if (!m) {
        m = this.bunchProto.clone();
        this.group.add(m);
        this.loose.set(l.id, m);
      }
      m.position.set(l.pos.x, l.pos.y + Math.sin(time * 3 + l.id) * 0.15, l.pos.z);
      m.rotation.y = time * 2 + l.id;
    }
    for (const [id, m] of this.loose) {
      if (liveLoose.has(id)) continue;
      this.group.remove(m);
      this.loose.delete(id);
    }

    // Peels: add new, drop gone.
    const live = new Set<number>();
    for (const peel of items.peels) {
      live.add(peel.id);
      if (this.peels.has(peel.id)) continue;
      const m = this.peelProto.clone();
      m.position.set(peel.pos.x, peel.pos.y, peel.pos.z);
      m.rotation.y = peel.yaw;
      this.group.add(m);
      this.peels.set(peel.id, m);
    }
    for (const [id, m] of this.peels) {
      if (live.has(id)) continue;
      this.group.remove(m);
      this.peels.delete(id);
    }
  }
}
