/**
 * The jungle's roadside trees, drawn with some botany: palms with ringed,
 * curving trunks, fronds of separate drooping leaflets, a husk collar, dead
 * fronds hanging down and a bunch of coconuts; broadleaf trees with root
 * flares, forking limbs and a crown of lumpy leaf clumps shaded darker
 * underneath.
 *
 * Each builder adds its parts to a PartBuilder node, so a whole tree merges
 * into one geometry per material and instances by the hundred. They keep to
 * the envelopes the sim's solids assume (`sim/props.ts`): a palm's trunk
 * reaches 9 m with its tuft 0.6 m off to the side; a broadleaf's trunk is
 * 6 m with its crown round 7.4 m.
 */

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GEO, type PartBuilder, toon } from './toon.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Euler angles (XYZ) that turn +Y to point along `dir`. */
function aim(dir: THREE.Vector3): [number, number, number] {
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()));
  return [e.x, e.y, e.z];
}

/** A tapered round section, wider at the bottom (the ringed look of a palm trunk). */
const SECTION = new THREE.CylinderGeometry(0.82, 1, 1, 9);

/** A limb from `a` to `b`, radius `r`. */
function limb(b: PartBuilder, n: THREE.Object3D, mat: THREE.Material, a: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number): void {
  const d = to.clone().sub(a);
  const mid = a.clone().addScaledVector(d, 0.5);
  const geo = new THREE.CylinderGeometry(r1, r0, 1, 8);
  b.add(n, geo, mat, { pos: [mid.x, mid.y, mid.z], rot: aim(d), scale: [1, d.length(), 1] });
}

let frond: THREE.BufferGeometry | null = null;
/**
 * One palm frond along +Z from the origin: a midrib arching up then
 * drooping, with a leaflet either side of every segment hanging down in a
 * V. Each leaflet is a triangle, drawn both ways round so it shows from
 * below.
 */
function frondGeometry(): THREE.BufferGeometry {
  if (frond) return frond;
  const L = 4.1;
  const N = 15;
  const pts: number[] = [];
  const spine = (t: number) => new THREE.Vector3(0, L * (0.32 * t - 0.78 * t * t), L * t);
  for (let i = 0; i < N; i++) {
    const t0 = i / N;
    const t1 = (i + 1) / N;
    const a = spine(t0);
    const c = spine(t1);
    // Leaflets are longest in the middle of the frond.
    const w = 0.95 * Math.sin(Math.PI * Math.min(1, t0 * 1.15 + 0.06)) ** 0.8 + 0.08;
    for (const side of [-1, 1]) {
      const tip = spine(Math.min(1, t0 + 1.7 / N)).add(new THREE.Vector3(side * w, -0.45 * w, 0));
      const tri = [a, c, tip];
      if (side < 0) tri.reverse();
      for (const p of tri) pts.push(p.x, p.y, p.z);
      for (const p of [...tri].reverse()) pts.push(p.x, p.y, p.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.computeVertexNormals();
  frond = g;
  return g;
}

/** Frond geometry tilted `pitch` (+ = tip up), turned to `yaw`, scaled, at `at`. */
function placeFrond(at: THREE.Vector3, yaw: number, pitch: number, size: number): THREE.BufferGeometry {
  const g = frondGeometry().clone();
  g.scale(size, size, size);
  g.rotateX(-pitch);
  g.rotateY(yaw);
  g.translate(at.x, at.y, at.z);
  return g;
}

/** A coconut palm, 9 m to the crown, leaning toward +X. */
export function palm(b: PartBuilder, n: THREE.Object3D): void {
  const barkA = toon(0x8a5f36);
  const barkB = toon(0x75502e);
  const SEG = 10;
  // The trunk curves: upright at the foot, leaning out toward the crown.
  const at = (t: number) => new THREE.Vector3(0.6 * t * t, 9 * t, 0.12 * Math.sin(t * 3));
  for (let i = 0; i < SEG; i++) {
    const a = at(i / SEG);
    const c = at((i + 1) / SEG);
    const d = c.clone().sub(a);
    const r = 0.36 - (0.12 * i) / SEG;
    const mid = a.clone().addScaledVector(d, 0.5);
    b.add(n, SECTION, i % 2 ? barkA : barkB, { pos: [mid.x, mid.y, mid.z], rot: aim(d), scale: [r, d.length() * 1.04, r] });
  }
  // Root bulge at the foot.
  b.add(n, GEO.cone, barkB, { pos: [0, 0.35, 0], scale: [0.62, 0.9, 0.62] });
  const top = at(1);
  // The husk collar where the fronds sprout, and the coconuts under it.
  b.add(n, GEO.sphereLo, toon(0x6b5a2a), { pos: [top.x, top.y - 0.05, top.z], scale: [0.42, 0.5, 0.42] });
  const nut = toon(0x5a3a1e);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    b.add(n, GEO.sphere, nut, { pos: [top.x + Math.cos(a) * 0.36, top.y - 0.42 - (i % 2) * 0.12, top.z + Math.sin(a) * 0.36], scale: [0.22, 0.24, 0.22] });
  }
  // Fronds: an outer ring arching out and drooping, an inner ring of young
  // ones standing up, and two dead ones hanging down the trunk.
  const greens = [toon(0x3f9a34), toon(0x4fae3e), toon(0x358a2e)];
  for (let i = 0; i < 11; i++) {
    const yaw = (i / 11) * Math.PI * 2 + (i % 2) * 0.2;
    const size = 0.9 + ((i * 7) % 5) * 0.06;
    b.add(n, placeFrond(top, yaw, 0.25 - (i % 3) * 0.1, size), greens[i % 3]!);
  }
  for (let i = 0; i < 4; i++) {
    const yaw = (i / 4) * Math.PI * 2 + 0.7;
    b.add(n, placeFrond(top.clone().setY(top.y + 0.15), yaw, 0.95, 0.55), toon(0x6cc04f));
  }
  for (const yaw of [2.2, 4.4]) b.add(n, placeFrond(top.clone().setY(top.y - 0.3), yaw, -1.15, 0.7), toon(0x9a7a45));
}

const clumps: THREE.BufferGeometry[] = [];
/** A few lumpy leaf-clump shapes (unit radius), shared by every tree. */
function clump(i: number): THREE.BufferGeometry {
  if (!clumps.length) {
    for (let v = 0; v < 3; v++) {
      let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 1);
      g.deleteAttribute('normal');
      g.deleteAttribute('uv');
      g = mergeVertices(g);
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const p = new THREE.Vector3();
      for (let k = 0; k < pos.count; k++) {
        p.fromBufferAttribute(pos, k).normalize();
        const bump = Math.sin(p.x * 4.1 + v * 1.7) * Math.sin(p.y * 3.3 + v) * Math.sin(p.z * 3.9 + v * 2.3) * 0.22 + Math.sin((p.x + p.z) * 7 + v) * 0.05;
        // Flatter underneath, like a real crown's shaded bottom.
        p.multiplyScalar(1 + bump);
        if (p.y < 0) p.y *= 0.7;
        pos.setXYZ(k, p.x, p.y, p.z);
      }
      g.computeVertexNormals();
      clumps.push(g);
    }
  }
  return clumps[i % clumps.length]!;
}

/** A broadleaf jungle tree: 6 m trunk, crown about 7.4 m up and 3 m round. */
export function broadleaf(b: PartBuilder, n: THREE.Object3D): void {
  const bark = toon(0x6e4a2c);
  const barkDark = toon(0x5a3b22);
  // Trunk with a slight lean and a knot, and root flares at the foot.
  const foot = new THREE.Vector3(0, 0, 0);
  const fork = new THREE.Vector3(0.25, 4.6, -0.1);
  limb(b, n, bark, foot, fork, 0.6, 0.42);
  b.add(n, GEO.sphereLo, barkDark, { pos: [0.15, 2.6, 0.42], scale: [0.18, 0.24, 0.12] });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    limb(b, n, i % 2 ? bark : barkDark, out.clone().multiplyScalar(0.25).setY(0.9), out.clone().multiplyScalar(1.15).setY(-0.1), 0.2, 0.12);
  }
  // Limbs forking up into the crown.
  const ends = [
    new THREE.Vector3(-1.5, 6.6, 0.6),
    new THREE.Vector3(1.6, 6.3, 0.7),
    new THREE.Vector3(0.3, 7.4, -1.4),
    new THREE.Vector3(0.4, 7.8, 0.2),
  ];
  for (const e of ends) limb(b, n, bark, fork, e, 0.32, 0.12);
  // The crown: a core, a lower ring, an upper ring and a top, lumpy and
  // turned every which way, dark underneath and sunlit on top.
  const dark = toon(0x2a6e27);
  const mid = toon(0x37882f);
  const light = toon(0x4ea83c);
  const parts: [number, number, number, number, THREE.Material][] = [[0.2, 7.4, 0, 1.9, mid]];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = 2.05 + (i % 3) * 0.2;
    parts.push([Math.cos(a) * r, 6.5 + (i % 2) * 0.35, Math.sin(a) * r, 0.95 + (i % 3) * 0.15, dark]);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    parts.push([Math.cos(a) * 1.55, 7.7 + (i % 2) * 0.3, Math.sin(a) * 1.55, 0.95 + (i % 2) * 0.2, i % 2 ? light : mid]);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 1;
    parts.push([Math.cos(a) * 0.8, 8.8, Math.sin(a) * 0.8, 0.9, light]);
  }
  parts.push([0.1, 9.5, -0.1, 0.8, light]);
  parts.forEach(([x, y, z, s, mat], i) =>
    b.add(n, clump(i), mat, { pos: [x, y, z], rot: [0, i * 1.3, 0], scale: [s, s * 0.82, s] }),
  );
  // A few vines hanging out of the crown.
  const vine = toon(0x2f6b25);
  for (const [x, z, len] of [[1.7, 0.9, 2.2], [-1.4, -1.2, 1.6], [0.6, -1.9, 2.6]] as const) {
    b.add(n, GEO.cylinder, vine, { pos: [x, 6.2 - len / 2, z], scale: [0.04, len, 0.04] });
    b.add(n, clump(0), dark, { pos: [x, 6.2 - len, z], scale: 0.16 });
  }
}
