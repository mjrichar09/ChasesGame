/**
 * The circuit and the jungle around it.
 *
 * Built entirely from the sim's `Track` — the same samples the physics uses —
 * so the road you see is the road you drive on. The scenery is instanced:
 * a few prototype props (palms, broadleaf trees, ferns, bushes, rocks,
 * flowers) placed a few hundred times each, seeded so the jungle is the same
 * every visit.
 */

import * as THREE from 'three';
import type { TrackLook } from '../data/tracks/looks.js';
import { Rng } from '../sim/rng.js';
import { type Track, WALL_HEIGHT, WALL_SOLID_HEIGHT, WALL_THICK } from '../sim/track.js';
import { GEO, PartBuilder, toon } from './toon.js';

export interface TrackView {
  group: THREE.Group;
  /** Animated each frame (water, banner). */
  update(time: number): void;
}

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Packed-dirt road with tyre ruts and grassy edges. */
function roadTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (c) => {
    c.fillStyle = '#b98a55';
    c.fillRect(0, 0, 256, 256);
    const rng = new Rng(5);
    for (let i = 0; i < 1400; i++) {
      const shade = rng.range(-30, 30);
      c.fillStyle = `rgb(${185 + shade},${138 + shade},${85 + shade})`;
      c.fillRect(rng.range(0, 256), rng.range(0, 256), rng.range(2, 7), rng.range(2, 7));
    }
    // Ruts.
    c.fillStyle = 'rgba(110,75,40,0.35)';
    for (const x of [62, 88, 168, 194]) c.fillRect(x, 0, 10, 256);
    // Grass verges at the edges.
    for (const [x0, dir] of [[0, 1], [256, -1]] as const) {
      for (let i = 0; i < 300; i++) {
        const d = Math.abs(rng.range(0, 1) ** 2 * 26);
        c.fillStyle = rng.next() < 0.5 ? '#5f9d3a' : '#4b8a2e';
        c.fillRect(x0 + dir * d - 2, rng.range(0, 256), 4, rng.range(3, 9));
      }
    }
  });
}

function groundTexture(base: string): THREE.CanvasTexture {
  return canvasTexture(256, 256, (c) => {
    c.fillStyle = base;
    c.fillRect(0, 0, 256, 256);
    const rng = new Rng(9);
    for (let i = 0; i < 2600; i++) {
      const g = rng.range(-22, 22);
      c.fillStyle = `rgb(${60 + g},${125 + g},${45 + g * 0.6})`;
      c.beginPath();
      c.arc(rng.range(0, 256), rng.range(0, 256), rng.range(1, 4), 0, Math.PI * 2);
      c.fill();
    }
  });
}

function plankTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (c) => {
    c.fillStyle = '#a0703f';
    c.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 16) {
      c.fillStyle = y % 32 ? '#8f6234' : '#a97a47';
      c.fillRect(0, y, 128, 14);
      c.fillStyle = '#5c3b1c';
      c.fillRect(0, y + 14, 128, 2);
    }
    // Hazard chevrons at the lip end.
    c.fillStyle = '#f2c14e';
    for (let x = -32; x < 128; x += 32) {
      c.beginPath();
      c.moveTo(x, 128);
      c.lineTo(x + 16, 112);
      c.lineTo(x + 32, 128);
      c.fill();
    }
  });
}

export function buildTrackView(track: Track, look: TrackLook): TrackView {
  const group = new THREE.Group();
  group.add(roadMesh(track));
  group.add(skirtMesh(track));
  group.add(ground(look.ground));
  group.add(walls(track));
  for (const k of kickerMeshes(track)) group.add(k);
  const water = river(track);
  if (look.stream) water.push(stream(look.stream));
  for (const w of fords(track)) water.push(w);
  for (const w of water) group.add(w);
  group.add(startArch(track));
  if (look.vineArches) group.add(vineArches(track));
  if (look.canopy) group.add(canopy(track));
  group.add(scenery(track, look.scenery));

  return {
    group,
    update(time: number) {
      for (const w of water) {
        const mat = w.material as THREE.MeshToonMaterial;
        if (mat.map) mat.map.offset.set(time * 0.05, time * 0.2);
      }
    },
  };
}

/** Road surface with UVs: u across the road, v along it. */
function roadMesh(track: Track): THREE.Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = track.samples.length;
  for (let i = 0; i <= n; i++) {
    const k = track.samples[i % n]!;
    const hw = k.halfWidth + WALL_THICK;
    for (const side of [-1, 1]) {
      const p = k.p;
      pos.push(p.x + k.r.x * hw * side, p.y + k.r.y * hw * side + 0.02, p.z + k.r.z * hw * side);
      uv.push(side < 0 ? 0 : 1, (i * 1) / 10);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = track.samples[i]!;
    const b = track.samples[(i + 1) % n]!;
    if (!a.road || !b.road) continue;
    const i0 = i * 2;
    idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const tex = roadTexture();
  tex.repeat.set(1, 1);
  const mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ map: tex, gradientMap: toon(0).gradientMap }));
  mesh.receiveShadow = true;

  // Checkered start line, built straight from track points.
  const hw0 = track.samples[0]!.halfWidth;
  const corners = [
    track.pointAt(-1.2, -hw0),
    track.pointAt(-1.2, hw0),
    track.pointAt(1.2, -hw0),
    track.pointAt(1.2, hw0),
  ];
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(corners.flatMap((c) => [c.x, c.y + 0.05, c.z]), 3));
  lineGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  lineGeo.setIndex([0, 1, 2, 1, 3, 2]);
  const line = new THREE.Mesh(
    lineGeo,
    new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      map: canvasTexture(64, 16, (c) => {
        for (let x = 0; x < 16; x++)
          for (let y = 0; y < 4; y++) {
            c.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
            c.fillRect(x * 4, y * 4, 4, 4);
          }
      }),
    }),
  );
  mesh.add(line);
  return mesh;
}

/** Earth banks down to the jungle floor, plus end caps at gaps. */
function skirtMesh(track: Track): THREE.Mesh {
  const all = track.roadMesh();
  // Reuse the collision mesh: it already contains skirts. Drawn underneath the
  // textured road, so only the banks show.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(all.vertices, 3));
  geo.setIndex(new THREE.BufferAttribute(all.indices, 1));
  geo.computeVertexNormals();
  const caps: number[] = [];
  for (const g of track.gaps) {
    for (const s of [g.s0, g.s1]) {
      const k = track.at(s);
      const hw = k.halfWidth + WALL_THICK;
      const l = { x: k.p.x - k.r.x * hw, y: k.p.y - k.r.y * hw, z: k.p.z - k.r.z * hw };
      const r = { x: k.p.x + k.r.x * hw, y: k.p.y + k.r.y * hw, z: k.p.z + k.r.z * hw };
      caps.push(l.x, l.y, l.z, r.x, r.y, r.z, l.x, -0.5, l.z, r.x, r.y, r.z, r.x, -0.5, r.z, l.x, -0.5, l.z);
    }
  }
  const capGeo = new THREE.BufferGeometry();
  capGeo.setAttribute('position', new THREE.Float32BufferAttribute(caps, 3));
  capGeo.computeVertexNormals();
  const mat = new THREE.MeshToonMaterial({ color: 0x7a5232, gradientMap: toon(0).gradientMap, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.add(new THREE.Mesh(capGeo, mat));
  mesh.receiveShadow = true;
  return mesh;
}

function ground(base: string): THREE.Mesh {
  const tex = groundTexture(base);
  tex.repeat.set(120, 120);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshToonMaterial({ map: tex, gradientMap: toon(0).gradientMap }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(100, -0.5, -40);
  mesh.receiveShadow = true;
  return mesh;
}

/** Log barriers: one instanced log per wall segment, with a cut-end cap. */
function walls(track: Track): THREE.Group {
  const g = new THREE.Group();
  const logGeo = new THREE.CylinderGeometry(WALL_HEIGHT * 0.42, WALL_HEIGHT * 0.45, 1, 9);
  logGeo.rotateX(Math.PI / 2);
  const logs = new THREE.InstancedMesh(logGeo, toon(0x7b4f2a), track.walls.length);
  const stakeGeo = new THREE.CylinderGeometry(0.08, 0.1, 1.6, 6);
  const stakes = new THREE.InstancedMesh(stakeGeo, toon(0x5a3a1d), track.walls.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const rng = new Rng(21);
  // The collider is taller than the log; sit the log at the bottom of it.
  const drop = (WALL_SOLID_HEIGHT - WALL_HEIGHT) / 2;
  track.walls.forEach((w, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.yaw);
    const s = 0.9 + rng.next() * 0.2;
    m.compose(new THREE.Vector3(w.center.x, w.center.y - drop - 0.1, w.center.z), q, new THREE.Vector3(s, s * 0.9, w.half.z * 2));
    logs.setMatrixAt(i, m);
    const off = new THREE.Vector3(0, 0, w.half.z).applyQuaternion(q);
    m.compose(new THREE.Vector3(w.center.x + off.x, w.center.y - drop + 0.1, w.center.z + off.z), q, new THREE.Vector3(1, 1, 1));
    stakes.setMatrixAt(i, m);
  });
  logs.castShadow = true;
  logs.receiveShadow = true;
  g.add(logs, stakes);
  return g;
}

/** Plank ramps matching the kicker colliders. */
function kickerMeshes(track: Track): THREE.Mesh[] {
  const tex = plankTexture();
  const mat = new THREE.MeshToonMaterial({ map: tex, gradientMap: toon(0).gradientMap, side: THREE.DoubleSide });
  const side = toon(0x6b4524);
  return track.kickers.map((k) => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const steps = 6;
    const span = track.wrap(k.s1 - k.s0);
    for (let i = 0; i <= steps; i++) {
      const s = k.s0 + (span * i) / steps;
      const h = (k.height * i) / steps;
      const smp = track.at(s);
      for (const sd of [-1, 1]) {
        const base = track.pointAt(s, k.lateral + sd * k.halfWidth);
        pos.push(base.x + smp.n.x * h, base.y + smp.n.y * h + 0.03, base.z + smp.n.z * h);
        uv.push(sd < 0 ? 0 : (k.halfWidth * 2) / 4, i / steps);
      }
    }
    for (let i = 0; i < steps; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const top = new THREE.Mesh(geo, mat);
    top.castShadow = true;
    top.receiveShadow = true;

    // Side triangles and the lip face.
    const sides: number[] = [];
    const lip = track.at(k.s1);
    const lo = (s: number, lat: number) => track.pointAt(s, lat);
    for (const sd of [-1, 1]) {
      const lat = k.lateral + sd * k.halfWidth;
      const a = lo(k.s0, lat);
      const b = lo(k.s1, lat);
      sides.push(a.x, a.y, a.z, b.x, b.y, b.z, b.x + lip.n.x * k.height, b.y + lip.n.y * k.height, b.z + lip.n.z * k.height);
    }
    const l = lo(k.s1, k.lateral - k.halfWidth);
    const r = lo(k.s1, k.lateral + k.halfWidth);
    const h = k.height;
    sides.push(l.x, l.y, l.z, r.x, r.y, r.z, l.x, l.y + h, l.z, r.x, r.y, r.z, r.x, r.y + h, r.z, l.x, l.y + h, l.z);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sides, 3));
    sg.computeVertexNormals();
    const sm = new THREE.Mesh(sg, side);
    (sm.material as THREE.Material).side = THREE.DoubleSide;
    top.add(sm);
    return top;
  });
}

/** A river running across the track under each gap. */
function river(track: Track): THREE.Mesh[] {
  const tex = canvasTexture(128, 128, (c) => {
    c.fillStyle = '#2f9fc4';
    c.fillRect(0, 0, 128, 128);
    const rng = new Rng(3);
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.lineWidth = 3;
    for (let i = 0; i < 14; i++) {
      const x = rng.range(0, 128);
      const y = rng.range(0, 128);
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + 8, y - 4, x + 18, y);
      c.stroke();
    }
  });
  tex.repeat.set(4, 30);
  return track.gaps.map((g) => {
    const mid = track.at((g.s0 + g.s1) / 2);
    const len = track.wrap(g.s1 - g.s0) + 6;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(len, 300),
      new THREE.MeshToonMaterial({ map: tex, gradientMap: toon(0).gradientMap, emissive: 0x0b3040 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.atan2(mid.t.x, mid.t.z) + Math.PI / 2;
    mesh.position.set(mid.p.x, -0.42, mid.p.z);
    return mesh;
  });
}

/** Bamboo arch with a banner over the start line. */
function startArch(track: Track): THREE.Group {
  const g = new THREE.Group();
  const k = track.at(0);
  const b = new PartBuilder();
  const bamboo = toon(0xb7c65a);
  const hw = k.halfWidth + 1.5;
  for (const sd of [-1, 1]) {
    b.add(g, GEO.cylinder, bamboo, { pos: [sd * hw, 4, 0], scale: [0.3, 8, 0.3] });
    for (let y = 1; y < 8; y += 1.6) b.add(g, GEO.cylinder, toon(0x8c9a3c), { pos: [sd * hw, y, 0], scale: [0.34, 0.12, 0.34] });
    b.add(g, GEO.sphere, toon(0x3f8a2c), { pos: [sd * hw, 8.4, 0], scale: [1.4, 0.8, 1.4] });
  }
  b.add(g, GEO.cylinder, bamboo, { pos: [0, 7.4, 0], rot: [0, 0, Math.PI / 2], scale: [0.25, hw * 2, 0.25] });
  b.build();
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(hw * 1.6, 1.6),
    new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      map: canvasTexture(512, 96, (c) => {
        c.fillStyle = '#f2c14e';
        c.fillRect(0, 0, 512, 96);
        c.fillStyle = '#3a2412';
        c.font = 'bold 54px "Lilita One", "Arial Black", sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(track.def.name.toUpperCase(), 256, 50);
        for (let x = 0; x < 512; x += 16) {
          c.fillStyle = (x / 16) % 2 ? '#111' : '#fff';
          c.fillRect(x, 0, 16, 8);
          c.fillRect(x + 8 >= 512 ? x : x, 88, 16, 8);
        }
      }),
    }),
  );
  banner.position.set(0, 6.5, 0);
  g.add(banner);
  g.position.set(k.p.x, k.p.y, k.p.z);
  g.rotation.y = Math.atan2(k.t.x, k.t.z) + Math.PI;
  return g;
}

/** Vine-draped arches over the road every so often. */
function vineArches(track: Track): THREE.Group {
  const g = new THREE.Group();
  const b = new PartBuilder();
  const vine = toon(0x2f6b25);
  const leaf = toon(0x4fa83a);
  const flower = toon(0xff5f8f);
  const rng = new Rng(44);
  for (let s = 90; s < track.length - 120; s += 130) {
    if (track.inGap(s) || track.kickerHeight(s, 0) > 0) continue;
    const k = track.at(s);
    const node = new THREE.Group();
    node.position.set(k.p.x, k.p.y, k.p.z);
    node.rotation.y = Math.atan2(k.t.x, k.t.z);
    g.add(node);
    const hw = k.halfWidth + 1.2;
    b.add(node, GEO.torus, vine, { pos: [0, 0, 0], rot: [0, Math.PI / 2, 0], scale: [hw, hw * 0.55, 0.6] });
    for (let i = 0; i < 26; i++) {
      const a = rng.range(0.15, Math.PI - 0.15);
      const x = Math.cos(a) * hw;
      const y = Math.sin(a) * hw * 0.55;
      if (y < 4) continue;
      b.add(node, GEO.sphereLo, rng.next() < 0.12 ? flower : leaf, { pos: [x, y, rng.range(-0.3, 0.3)], scale: [0.5, 0.25, 0.4] });
      // Dangling vines — well above kart height.
      if (rng.next() < 0.3) b.add(node, GEO.cylinder, vine, { pos: [x, y - 0.9, 0], scale: [0.05, 1.8, 0.05] });
    }
  }
  b.build();
  return g;
}

/** Instanced jungle: palms, broadleaf trees, ferns, bushes, rocks, flowers. */
function scenery(track: Track, density: number): THREE.Group {
  const g = new THREE.Group();
  const rng = new Rng(77);
  const protos = {
    palm: proto((b, n) => {
      for (let i = 0; i < 6; i++) b.add(n, GEO.cylinder, toon(i % 2 ? 0x8a5f36 : 0x7a5230), { pos: [Math.sin(i * 0.4) * 0.3, 0.8 + i * 1.5, 0], scale: [0.32 - i * 0.025, 1.6, 0.32 - i * 0.025] });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        b.add(n, GEO.sphere, toon(i % 2 ? 0x3f9a34 : 0x5bb544), { pos: [Math.sin(a) * 1.8 + 0.6, 9.2, Math.cos(a) * 1.8], rot: [Math.cos(a) * 0.5, a, -Math.sin(a) * 0.5], scale: [0.5, 0.12, 2.0] });
      }
      for (let i = 0; i < 3; i++) b.add(n, GEO.sphere, toon(0x6b4a24), { pos: [0.6 + Math.sin(i * 2) * 0.3, 8.8, Math.cos(i * 2) * 0.3], scale: 0.28 });
    }),
    tree: proto((b, n) => {
      b.add(n, GEO.cylinder, toon(0x6e4a2c), { pos: [0, 3, 0], scale: [0.55, 6, 0.55] });
      for (const [x, y, z, s] of [[0, 7.5, 0, 3.2], [1.8, 6.4, 0.8, 2.2], [-1.6, 6.6, -0.6, 2.4], [0.4, 9, -0.6, 2]] as const)
        b.add(n, GEO.sphereLo, toon(y > 8 ? 0x4ea83c : 0x2f7d2a), { pos: [x, y, z], scale: [s, s * 0.8, s] });
    }),
    fern: proto((b, n) => {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.add(n, GEO.cone, toon(i % 2 ? 0x2e8a3a : 0x47a843), { pos: [Math.sin(a) * 0.6, 0.5, Math.cos(a) * 0.6], rot: [Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9], scale: [0.25, 1.4, 0.08] });
      }
    }),
    bush: proto((b, n) => {
      for (const [x, z, s] of [[0, 0, 1.2], [0.9, 0.3, 0.9], [-0.8, -0.2, 1.0]] as const) b.add(n, GEO.sphereLo, toon(0x3c8f30), { pos: [x, s * 0.6, z], scale: [s, s * 0.8, s] });
    }),
    rock: proto((b, n) => {
      b.add(n, GEO.sphereLo, toon(0x8d8a80), { pos: [0, 0.3, 0], rot: [0.3, 0.5, 0.1], scale: [1.2, 0.8, 1.0] });
      b.add(n, GEO.sphereLo, toon(0x5f8f3e), { pos: [0.1, 0.8, 0], scale: [0.8, 0.15, 0.7] });
    }),
    flower: proto((b, n) => {
      b.add(n, GEO.cylinder, toon(0x3f8a2c), { pos: [0, 0.4, 0], scale: [0.04, 0.8, 0.04] });
      b.add(n, GEO.sphereLo, toon(0xff6a3d), { pos: [0, 0.85, 0], scale: [0.25, 0.12, 0.25] });
      b.add(n, GEO.sphereLo, toon(0xffd43a), { pos: [0, 0.9, 0], scale: 0.08 });
    }),
  };
  const counts: Record<keyof typeof protos, number> = { palm: 260, tree: 200, fern: 500, bush: 300, rock: 120, flower: 260 };
  // Band each kind sits in, metres beyond the road edge.
  const bands: Record<keyof typeof protos, [number, number]> = {
    palm: [3, 40], tree: [10, 120], fern: [1.6, 25], bush: [2, 50], rock: [2, 60], flower: [1.4, 12],
  };
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (const kind of Object.keys(protos) as (keyof typeof protos)[]) {
    const placements: THREE.Matrix4[] = [];
    let tries = 0;
    const want = Math.round(counts[kind] * density);
    while (placements.length < want && tries++ < want * 8) {
      const s = rng.range(0, track.length);
      const side = rng.next() < 0.5 ? -1 : 1;
      const k = track.at(s);
      const [lo, hi] = bands[kind];
      const off = k.halfWidth + WALL_THICK + lo + rng.next() ** 1.5 * (hi - lo);
      const p = track.pointAt(s, side * off);
      // Keep clear of every other stretch of road.
      const near = track.project({ x: p.x, y: p.y, z: p.z });
      if (Math.abs(near.lateral) < track.at(near.s).halfWidth + WALL_THICK + lo - 0.1) continue;
      const scale = rng.range(0.75, 1.3);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, Math.PI * 2));
      m.compose(new THREE.Vector3(p.x, -0.5, p.z), q, new THREE.Vector3(scale, scale, scale));
      placements.push(m.clone());
    }
    for (const [mat, geo] of protos[kind]) {
      const inst = new THREE.InstancedMesh(geo, mat, placements.length);
      placements.forEach((pm, i) => inst.setMatrixAt(i, pm));
      inst.castShadow = kind === 'palm' || kind === 'tree';
      g.add(inst);
    }
  }
  return g;
}

/** A water texture: blue with drifting white ripples. */
function waterTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (c) => {
    c.fillStyle = '#3a9fb8';
    c.fillRect(0, 0, 128, 128);
    const rng = new Rng(8);
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.lineWidth = 3;
    for (let i = 0; i < 16; i++) {
      const x = rng.range(0, 128);
      const y = rng.range(0, 128);
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + 6, y - 4, x + 16, y);
      c.stroke();
    }
  });
}

/**
 * A creek winding across the map: a water ribbon along the polyline with
 * muddy banks, just above the jungle floor. Where it crosses the road (which
 * dips to the same level there) the water runs over the road surface.
 */
function stream(path: { x: number; z: number }[]): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(p.x, 0, p.z)));
  const n = 220;
  const pts = curve.getSpacedPoints(n);
  const WATER_Y = -0.36;
  const half = 7;
  const ribbon = (y: number, widen: number): THREE.BufferGeometry => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let along = 0;
    for (let i = 0; i <= n; i++) {
      const p = pts[i]!;
      const t = new THREE.Vector3().subVectors(pts[Math.min(i + 1, n)]!, pts[Math.max(i - 1, 0)]!).normalize();
      const side = new THREE.Vector3(-t.z, 0, t.x);
      // A little width variation so it reads as a natural creek.
      const w = half * widen * (0.85 + 0.15 * Math.sin(i * 0.37));
      if (i > 0) along += p.distanceTo(pts[i - 1]!);
      for (const s of [-1, 1]) {
        pos.push(p.x + side.x * w * s, y, p.z + side.z * w * s);
        uv.push(s < 0 ? 0 : 2, along / 14);
      }
    }
    for (let i = 0; i < n; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  };
  const water = new THREE.Mesh(
    ribbon(WATER_Y, 1),
    new THREE.MeshToonMaterial({
      map: waterTexture(),
      gradientMap: toon(0).gradientMap,
      emissive: 0x0b2a30,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    }),
  );
  water.renderOrder = 1;
  // Muddy banks: a wider, darker ribbon just under the water.
  water.add(
    new THREE.Mesh(
      ribbon(-0.47, 1.35),
      new THREE.MeshToonMaterial({ color: 0x5a4126, gradientMap: toon(0).gradientMap, side: THREE.DoubleSide }),
    ),
  );
  // Mossy stones along the edges.
  const stones = new THREE.InstancedMesh(GEO.sphereLo, toon(0x7f8a6e), 90);
  const rng = new Rng(31);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 90; i++) {
    const p = curve.getPointAt(rng.next());
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(5.5, 8.5);
    const sc = rng.range(0.35, 0.9);
    m.compose(
      new THREE.Vector3(p.x + Math.cos(a) * r, -0.45, p.z + Math.sin(a) * r),
      new THREE.Quaternion(),
      new THREE.Vector3(sc * 1.3, sc * 0.6, sc),
    );
    stones.setMatrixAt(i, m);
  }
  water.add(stones);
  return water;
}

/**
 * Water over the road wherever the sim says the road is wet. The creek ribbon
 * is flat, but the road is banked, so on its own the high side of a crossing
 * would look dry while still dragging at the kart. This sheet follows the
 * road surface exactly over the wet stretch, overlapping the creek either side.
 */
function fords(track: Track): THREE.Mesh[] {
  return track.waters.map((w) => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const span = track.wrap(w.s1 - w.s0);
    const steps = Math.ceil(span);
    for (let i = 0; i <= steps; i++) {
      const s = w.s0 + (span * i) / steps;
      const k = track.at(s);
      const hw = k.halfWidth + WALL_THICK + 1.5;
      for (const side of [-1, 1]) {
        const p = track.pointAt(s, side * hw);
        pos.push(p.x + k.n.x * 0.1, p.y + k.n.y * 0.1, p.z + k.n.z * 0.1);
        uv.push(side < 0 ? 0 : 2, s / 14);
      }
    }
    for (let i = 0; i < steps; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshToonMaterial({
        map: waterTexture(),
        gradientMap: toon(0).gradientMap,
        emissive: 0x0b2a30,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      }),
    );
    mesh.renderOrder = 2;
    return mesh;
  });
}

/**
 * The canopy: giant buttressed trunks lining the course, a closed roof of
 * leaves high overhead, hanging vines, and shafts of sunlight breaking
 * through. All instanced. The leaves cast no shadows — under a closed roof
 * that would black out the road — the light shafts do the dappling instead.
 */
function canopy(track: Track): THREE.Group {
  const g = new THREE.Group();
  const rng = new Rng(57);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  // Leaf roof: clumps on a lattice along and across the course.
  const leafGeo = new THREE.IcosahedronGeometry(1, 0);
  const leafMats = [toon(0x1f5a23), toon(0x2d7230), toon(0x3e8a37)];
  const leaves: THREE.Matrix4[][] = [[], [], []];
  for (let s = 0; s < track.length; s += 5) {
    const k = track.at(s);
    for (let lat = -k.halfWidth - 26; lat <= k.halfWidth + 26; lat += 6.5) {
      const p = track.pointAt(s + rng.range(-2, 2), lat + rng.range(-2, 2));
      const sc = rng.range(4.5, 7.5);
      q.setFromAxisAngle(up, rng.range(0, Math.PI * 2));
      m.compose(new THREE.Vector3(p.x, k.p.y + rng.range(12.5, 16), p.z), q, new THREE.Vector3(sc, sc * 0.45, sc));
      leaves[Math.floor(rng.next() * 3)]!.push(m.clone());
    }
  }
  leaves.forEach((list, i) => {
    const inst = new THREE.InstancedMesh(leafGeo, leafMats[i]!, list.length);
    list.forEach((pm, j) => inst.setMatrixAt(j, pm));
    g.add(inst);
  });

  // Giant trunks holding it up, with buttress roots.
  const b = new PartBuilder();
  const node = new THREE.Object3D();
  b.add(node, GEO.cylinder, toon(0x5b4330), { pos: [0, 8, 0], scale: [1.0, 16, 1.0] });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.add(node, GEO.box, toon(0x4e3927), { pos: [Math.cos(a) * 1.1, 1.2, Math.sin(a) * 1.1], rot: [0, -a, 0.35], scale: [1.6, 2.6, 0.3] });
  }
  b.add(node, GEO.cylinder, toon(0x3f7d2c), { pos: [0, 6, 0], scale: [1.05, 0.8, 1.05] });
  const trunk = b.geometries(node);
  const spots: THREE.Matrix4[] = [];
  for (let s = 0; s < track.length; s += 11) {
    for (const side of [-1, 1]) {
      const k = track.at(s);
      const p = track.pointAt(s + rng.range(-3, 3), side * (k.halfWidth + rng.range(4.5, 11)));
      const near = track.project({ x: p.x, y: p.y, z: p.z });
      if (Math.abs(near.lateral) < track.at(near.s).halfWidth + 3.5) continue;
      const sc = rng.range(0.8, 1.25);
      q.setFromAxisAngle(up, rng.range(0, Math.PI * 2));
      m.compose(new THREE.Vector3(p.x, -0.5, p.z), q, new THREE.Vector3(sc, rng.range(0.85, 1.05), sc));
      spots.push(m.clone());
    }
  }
  for (const [mat, geo] of trunk) {
    const inst = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach((pm, j) => inst.setMatrixAt(j, pm));
    inst.castShadow = true;
    g.add(inst);
  }

  // Hanging vines, well above kart height.
  const vineGeo = new THREE.CylinderGeometry(0.06, 0.04, 1, 5);
  vineGeo.translate(0, -0.5, 0);
  const vines = new THREE.InstancedMesh(vineGeo, toon(0x2f6b25), 420);
  for (let i = 0; i < 420; i++) {
    const s = rng.range(0, track.length);
    const k = track.at(s);
    const p = track.pointAt(s, rng.range(-k.halfWidth - 8, k.halfWidth + 8));
    m.compose(new THREE.Vector3(p.x, k.p.y + 13, p.z), new THREE.Quaternion(), new THREE.Vector3(1, rng.range(4, 8), 1));
    vines.setMatrixAt(i, m);
  }
  g.add(vines);

  // Sunbeams: tall additive cones angled down through gaps in the roof.
  const beamMat = new THREE.MeshBasicMaterial({
    map: canvasTexture(4, 64, (c) => {
      const grad = c.createLinearGradient(0, 0, 0, 64);
      grad.addColorStop(0, 'rgba(255,250,200,0)');
      grad.addColorStop(0.35, 'rgba(255,250,200,0.5)');
      grad.addColorStop(1, 'rgba(255,250,200,0)');
      c.fillStyle = grad;
      c.fillRect(0, 0, 4, 64);
    }),
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const beamGeo = new THREE.CylinderGeometry(1.2, 3.2, 16, 12, 1, true);
  for (let i = 0; i < 34; i++) {
    const s = rng.range(0, track.length);
    const k = track.at(s);
    const p = track.pointAt(s, rng.range(-k.halfWidth, k.halfWidth));
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(p.x + 2, k.p.y + 7, p.z + 1);
    beam.rotation.set(0.18, 0, -0.22);
    g.add(beam);
  }
  return g;
}

function proto(draw: (b: PartBuilder, node: THREE.Object3D) => void): Map<THREE.Material, THREE.BufferGeometry> {
  const b = new PartBuilder();
  const node = new THREE.Object3D();
  draw(b, node);
  return b.geometries(node);
}
