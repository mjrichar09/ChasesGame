/**
 * Pickups, peels and coconuts.
 *
 * A pickup floats, bobs and turns above a glowing ring of light so it reads
 * from far down the track — a banana, a coiled snake, a parrot or a coconut,
 * so you can see what you are about to grab. Each kind has its own ring
 * colour (yellow, purple, cyan, orange), with a solid band under the glow so
 * it reads in bright sun. Collected pickups vanish until the sim brings
 * them back. Peels lie flat on the road where they were dropped, for as long
 * as they last (until somebody hits one). Thrown coconuts tumble through the
 * air where the sim has them; one that runs out of range bounces and rolls
 * away (drawn only — the sim is done with it).
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

/**
 * A hairy brown coconut, radius 1 (callers scale it): a shell, tufts of
 * fibre, and the three dark "eyes" at one end.
 */
export function coconutModel(glow = false): THREE.Group {
  const g = new THREE.Group();
  const b = new PartBuilder();
  const shell = toon(0x6b4325, glow ? { emissive: 0x2a1404 } : {});
  const hair = toon(0x8a5a33);
  const dark = toon(0x3a2414);
  b.add(g, GEO.sphere, shell, { scale: [1, 0.92, 1.08] });
  // Fibre: little flat wisps all over, leaning back along the shell.
  for (let i = 0; i < 22; i++) {
    const y = 1 - ((i + 0.5) / 22) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.39996;
    const n = new THREE.Vector3(Math.cos(a) * r, y * 0.92, Math.sin(a) * r * 1.08);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    b.add(g, GEO.cone, i % 3 ? hair : shell, { pos: [n.x * 0.98, n.y * 0.98, n.z * 0.98], rot: [e.x, e.y, e.z], scale: [0.16, 0.26, 0.05] });
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.add(g, GEO.sphereLo, dark, { pos: [Math.sin(a) * 0.24, Math.cos(a) * 0.24, 1.02], scale: [0.13, 0.13, 0.06] });
  }
  b.build(false);
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

/** Pickup sizes: the item itself, and its ring. */
const PICKUP_SCALE = 1.5;
const RING_SCALE = 1.35;

/** Ring colours: solid band and glow, per kind. */
export const ITEM_COLORS = { banana: 0xffd21f, snake: 0xa64dff, parrot: 0x29c8ff, coconut: 0xff7a1f } as const;

/** A solid coloured band with an additive glow, a soft disc and a light column, under a pickup. */
function glowRing(color: number): THREE.Group {
  const g = new THREE.Group();
  // Solid (not additive) so the colour holds against sunlit road and sky.
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.11, 10, 40), new THREE.MeshBasicMaterial({ color }));
  band.rotation.x = Math.PI / 2;
  g.add(band);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.2, 8, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
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

type PickupKind = keyof typeof ITEM_COLORS;

interface PickupView {
  root: THREE.Group;
  /** The floating item and its ring, per kind. */
  kinds: Record<PickupKind, { item: THREE.Group; ring: THREE.Group }>;
  phase: number;
}

/** Thrown coconuts: this size in the air and on the road, m. */
const COCONUT_R = 0.32;

/** A coconut that ran out of range, bouncing and rolling to a stop. */
interface Dropped {
  obj: THREE.Group;
  vel: THREE.Vector3;
  ground: number;
  t: number;
}

export class ItemsView {
  readonly group = new THREE.Group();
  private readonly pickups: PickupView[] = [];
  private readonly peels = new Map<number, THREE.Group>();
  private readonly peelProto = peelMesh();
  private readonly loose = new Map<number, THREE.Group>();
  private readonly bunchProto = bananaBunch();
  private readonly coconutProto = coconutModel();
  private readonly flying = new Map<number, THREE.Group>();
  private readonly dropped: Dropped[] = [];
  private lastTime = -1;

  constructor(items: Items) {
    const makers: Record<PickupKind, () => THREE.Group> = {
      banana: bananaBunch,
      snake: coiledSnake,
      parrot: buildPerchedParrot,
      coconut: () => {
        const c = coconutModel(true);
        c.scale.setScalar(0.42);
        return c;
      },
    };
    items.pickups.forEach((p, i) => {
      const root = new THREE.Group();
      root.position.set(p.pos.x, p.pos.y - 1.1, p.pos.z);
      const kinds = {} as PickupView['kinds'];
      for (const kind of Object.keys(makers) as PickupKind[]) {
        const item = makers[kind]();
        item.position.y = 1.2;
        item.scale.multiplyScalar(PICKUP_SCALE);
        const ring = glowRing(ITEM_COLORS[kind]);
        root.add(item, ring);
        kinds[kind] = { item, ring };
      }
      this.group.add(root);
      this.pickups.push({ root, kinds, phase: i * 1.7 });
    });
  }

  /** A coconut out of range at `at`: it falls to `ground` and bounces along. */
  drop(at: THREE.Vector3, vel: THREE.Vector3, ground: number): void {
    const obj = this.coconutProto.clone();
    obj.scale.setScalar(COCONUT_R);
    obj.position.copy(at);
    this.group.add(obj);
    this.dropped.push({ obj, vel: vel.clone().multiplyScalar(0.55), ground, t: 0 });
  }

  update(items: Items, time: number): void {
    const dt = this.lastTime < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    items.pickups.forEach((p, i) => {
      const v = this.pickups[i]!;
      v.root.visible = p.active;
      const bob = Math.sin(time * 2.4 + v.phase) * 0.18;
      const pulse = RING_SCALE * (1 + Math.sin(time * 4 + v.phase) * 0.08);
      for (const kind of Object.keys(v.kinds) as PickupKind[]) {
        const { item, ring } = v.kinds[kind];
        item.visible = ring.visible = p.kind === kind;
        item.position.y = 1.5 + bob;
        item.rotation.y = time * 1.8 + v.phase;
        ring.scale.setScalar(pulse);
      }
    });

    // Coconuts in the air, tumbling end over end.
    const liveNuts = new Set<number>();
    for (const c of items.coconuts) {
      liveNuts.add(c.id);
      let m = this.flying.get(c.id);
      if (!m) {
        m = this.coconutProto.clone();
        m.scale.setScalar(COCONUT_R);
        this.group.add(m);
        this.flying.set(c.id, m);
      }
      m.position.set(c.pos.x, c.pos.y, c.pos.z);
      m.rotation.set(c.age * 22, Math.atan2(c.vel.x, c.vel.z), c.age * 6);
    }
    for (const [id, m] of this.flying) {
      if (liveNuts.has(id)) continue;
      this.group.remove(m);
      this.flying.delete(id);
    }
    // Dropped ones: bounce, roll, settle, and sink away.
    for (let i = this.dropped.length - 1; i >= 0; i--) {
      const d = this.dropped[i]!;
      d.t += dt;
      d.vel.y -= 16 * dt;
      d.obj.position.addScaledVector(d.vel, dt);
      const floor = d.ground + COCONUT_R;
      if (d.obj.position.y < floor) {
        d.obj.position.y = floor;
        d.vel.y = Math.abs(d.vel.y) * 0.35;
        d.vel.x *= 0.7;
        d.vel.z *= 0.7;
      }
      const speed = Math.hypot(d.vel.x, d.vel.z);
      d.obj.rotation.x += (speed / COCONUT_R) * dt;
      if (d.t > 2.2) d.obj.position.y -= (d.t - 2.2) * 0.6;
      if (d.t > 3) {
        this.group.remove(d.obj);
        this.dropped.splice(i, 1);
      }
    }

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
