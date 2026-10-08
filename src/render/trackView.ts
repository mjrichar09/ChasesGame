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
import type { EventState } from '../sim/events.js';
import { TREE } from '../sim/events.js';
import { buildTerrain, terrainHeight } from '../sim/terrain.js';
import { type VolcanoView, buildVolcanoView } from './volcanoView.js';
import { type Sky, roadsideTufts, skyDressing } from './polish.js';
import { BRANCH_N, type Track, WALL_HEIGHT, WALL_SOLID_HEIGHT, WALL_THICK, type Water, branchProfile } from '../sim/track.js';
import { GEO, PartBuilder, toon } from './toon.js';

export interface TrackView {
  group: THREE.Group;
  /**
   * Animated each frame (water, lava, mid-race events). `lavaFront` is −∞
   * without lava; `events` and `waters` are the live sim's, during a race.
   */
  update(time: number, lavaFront: number, events?: readonly EventState[], waters?: readonly Water[]): void;
  /** The crater, on volcano tracks (for eruption effects). */
  crater?: THREE.Vector3;
  /** Clouds and sun, to keep centred on the camera. */
  sky?: Sky;
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

/** The top of a branch: bark ridges running along it, moss at the edges. */
function barkTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (c) => {
    c.fillStyle = '#8a6440';
    c.fillRect(0, 0, 256, 256);
    const rng = new Rng(13);
    for (let i = 0; i < 70; i++) {
      const x = rng.range(20, 236);
      const w = rng.range(3, 9);
      c.fillStyle = rng.next() < 0.5 ? '#6e4c2e' : '#9c7550';
      c.fillRect(x, 0, w, 256);
    }
    for (let i = 0; i < 40; i++) {
      c.fillStyle = 'rgba(60,38,20,0.6)';
      c.fillRect(rng.range(20, 236), rng.range(0, 256), rng.range(6, 18), 3);
    }
    for (const [x0, dir] of [[0, 1], [256, -1]] as const) {
      for (let i = 0; i < 260; i++) {
        const d = rng.next() ** 2 * 30;
        c.fillStyle = rng.next() < 0.5 ? '#5e8f3a' : '#4b7a2e';
        c.fillRect(x0 + dir * d - 2, rng.range(0, 256), 5, rng.range(4, 10));
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
  if (!look.branches) group.add(roadMesh(track, look.road));
  else group.add(startLine(track));
  if (!track.def.elevated) group.add(skirtMesh(track));
  // Shaped ground (a volcano) replaces the flat jungle floor.
  const terrain = buildTerrain(track);
  let volcano: VolcanoView | null = null;
  if (terrain) {
    volcano = buildVolcanoView(track, terrain);
    group.add(volcano.group);
  } else group.add(ground(look.ground));
  const heightAt = (x: number, z: number) => {
    if (!terrain) return -0.5;
    const h = terrainHeight(terrain, x, z);
    return Number.isNaN(h) ? -0.5 : h;
  };
  const barriers = look.barrier === 'vines' ? vineRails(track) : walls(track);
  group.add(barriers);
  for (const k of kickerMeshes(track)) group.add(k);
  if (look.branches) group.add(branchesAndTrees(track));
  // Mid-race events: each builds its own pieces and animates from the sim's state.
  const eventViews = (track.def.events ?? []).map((def, i) => {
    if (def.kind === 'treefall') return fallingTree(track, def);
    if (def.kind === 'snap') return snappingBranch(track, i, barriers);
    return null;
  });
  for (const v of eventViews) if (v) group.add(v.group);
  const water = look.riverUnderGaps ? river(track) : [];
  if (look.gapLava) for (const f of fissures(track)) group.add(f);
  const creek = look.stream ? stream(look.stream) : null;
  if (creek) water.push(creek.mesh);
  const fordViews = fords(track);
  for (const f of fordViews) water.push(f.mesh);
  for (const w of water) group.add(w);
  group.add(startArch(track, track.startS, track.def.name.toUpperCase()));
  if (!track.closed) group.add(startArch(track, track.finishS, 'SAFE ZONE', heightAt));
  if (look.vineArches) group.add(vineArches(track));
  if (look.canopy) group.add(canopy(track));
  if (look.scenery > 0) group.add(scenery(track, look.scenery, heightAt));
  if (look.tufts) group.add(roadsideTufts(track));
  const sky = look.clouds !== undefined ? skyDressing(look.clouds, look.sunGlow ?? 0xffffff, new THREE.Vector3(60, 90, 30)) : undefined;
  if (sky) group.add(sky.group);

  return {
    group,
    crater: volcano?.crater,
    sky,
    update(time: number, lavaFront: number, events?: readonly EventState[], waters?: readonly Water[]) {
      for (const w of water) {
        const mat = w.material as THREE.MeshToonMaterial;
        if (mat.map) mat.map.offset.set(time * 0.05, time * 0.2);
      }
      volcano?.update(lavaFront, time);
      eventViews.forEach((v, i) => v?.update(events?.[i] ?? null, time));
      // Floods: fords follow the sim's widths; the creek swells and rises with them.
      const live = waters ?? track.waters.map((w) => ({ ...w, s0: w.base[0], s1: w.base[1] }));
      fordViews.forEach((f, i) => {
        const w = live[i];
        if (w) f.set(w.s0, w.s1);
      });
      if (creek) {
        const w = live[0];
        const grow = w ? (w.s1 - w.s0) / (w.base[1] - w.base[0]) : 1;
        creek.swell(grow);
      }
    },
  };
}

/** Road surface with UVs: u across the road, v along it. */
function roadMesh(track: Track, surface: 'dirt' | 'bark'): THREE.Mesh {
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
  const tex = surface === 'bark' ? barkTexture() : roadTexture();
  tex.repeat.set(1, 1);
  const mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ map: tex, gradientMap: toon(0).gradientMap }));
  mesh.receiveShadow = true;
  mesh.add(startLine(track));
  return mesh;
}

/** Checkered start line, built straight from track points (following any crown). */
function startLine(track: Track): THREE.Mesh {

  const hw0 = track.samples[0]!.halfWidth;
  const corners = [
    [-1.2, -hw0],
    [-1.2, hw0],
    [1.2, -hw0],
    [1.2, hw0],
  ].map(([s, l]) => {
    const p = track.pointAt(s!, l!);
    p.y -= track.surfaceDrop(l!);
    return p;
  });
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
  return line;
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
        const lat = k.lateral + sd * k.halfWidth;
        const base = track.pointAt(s, lat);
        base.y -= track.surfaceDrop(lat, smp.halfWidth);
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
    const lo = (s: number, lat: number) => {
      const p = track.pointAt(s, lat);
      p.y -= track.surfaceDrop(lat, track.at(s).halfWidth);
      return p;
    };
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
function startArch(
  track: Track,
  s: number,
  text: string,
  heightAt: (x: number, z: number) => number = () => -0.5,
): THREE.Group {
  const g = new THREE.Group();
  const k = track.at(s);
  void heightAt;
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
        c.fillText(text, 256, 50);
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
function scenery(track: Track, density: number, heightAt: (x: number, z: number) => number): THREE.Group {
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
      const y = heightAt(p.x, p.z);
      // Nothing grows on the bare rock and ash near a summit.
      if (y > 70) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, Math.PI * 2));
      m.compose(new THREE.Vector3(p.x, y, p.z), q, new THREE.Vector3(scale, scale, scale));
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
function stream(path: { x: number; z: number }[]): { mesh: THREE.Mesh; swell(grow: number): void } {
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
  let swollen = 1;
  return {
    mesh: water,
    swell(grow: number) {
      // Ease toward the flood's width; a little higher as it widens.
      const next = swollen + (grow - swollen) * 0.04;
      if (Math.abs(next - swollen) < 0.003) return;
      swollen = next;
      water.geometry.dispose();
      water.geometry = ribbon(WATER_Y + (swollen - 1) * 0.12, Math.min(2.4, 1 + (swollen - 1) * 0.7));
    },
  };
}

/**
 * Water over the road wherever the sim says the road is wet. The creek ribbon
 * is flat, but the road is banked, so on its own the high side of a crossing
 * would look dry while still dragging at the kart. This sheet follows the
 * road surface exactly over the wet stretch, overlapping the creek either side.
 */
function fords(track: Track): { mesh: THREE.Mesh; set(s0: number, s1: number): void }[] {
  const geometry = (s0: number, s1: number) => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const span = track.wrap(s1 - s0);
    const steps = Math.ceil(span);
    for (let i = 0; i <= steps; i++) {
      const s = s0 + (span * i) / steps;
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
    return geo;
  };
  return track.waters.map((w) => {
    const mesh = new THREE.Mesh(
      geometry(w.s0, w.s1),
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
    let built = [w.s0, w.s1];
    return {
      mesh,
      set(s0: number, s1: number) {
        // The sim's water jumps a stage; ease the drawn water up to it.
        const t0 = built[0]! + (s0 - built[0]!) * 0.04;
        const t1 = built[1]! + (s1 - built[1]!) * 0.04;
        if (Math.abs(t0 - built[0]!) + Math.abs(t1 - built[1]!) < 0.02) return;
        built = [t0, t1];
        mesh.geometry.dispose();
        mesh.geometry = geometry(t0, t1);
      },
    };
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

/** Vine ropes strung between wooden posts, along every barrier segment. */
function vineRails(track: Track): THREE.Group {
  const g = new THREE.Group();
  const n = track.walls.length;
  // Twig stubs rather than posts: knobbly, tapering, a little off true.
  const postGeo = new THREE.CylinderGeometry(0.05, 0.16, 1.5, 5);
  const ropeGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 5);
  ropeGeo.rotateX(Math.PI / 2);
  const posts = new THREE.InstancedMesh(postGeo, toon(0x6b4524), n);
  const ropes = new THREE.InstancedMesh(ropeGeo, toon(0x3f7d2c), n * 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const drop = (WALL_SOLID_HEIGHT - WALL_HEIGHT) / 2;
  track.walls.forEach((w, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.yaw);
    const base = w.center.y - w.half.y + 0.15;
    const off = new THREE.Vector3(0, 0, w.half.z).applyQuaternion(q);
    const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler(((i * 37) % 7) * 0.04 - 0.12, 0, ((i * 53) % 5) * 0.05 - 0.1));
    m.compose(new THREE.Vector3(w.center.x + off.x, base + 0.65, w.center.z + off.z), q.clone().multiply(lean), new THREE.Vector3(1, 1, 1));
    posts.setMatrixAt(i, m);
    for (let k = 0; k < 2; k++) {
      // Sagging a touch: the lower rope a little lower in the middle.
      const y = base + (k === 0 ? 1.05 : 0.55) - drop * 0;
      m.compose(new THREE.Vector3(w.center.x, y, w.center.z), q, new THREE.Vector3(1, 1, w.half.z * 2));
      ropes.setMatrixAt(i * 2 + k, m);
    }
  });
  g.add(posts, ropes);
  return g;
}

/**
 * The treetop world: a round branch under every stretch of road (breaking at
 * the gaps, where it meets a trunk), giant trees with leafy crowns, and a
 * rolling sea of treetops far below that hides the ground.
 */
function branchesAndTrees(track: Track): THREE.Group {
  const g = new THREE.Group();
  const rng = new Rng(71);
  const bark = new THREE.MeshToonMaterial({ map: barkTexture(), gradientMap: toon(0).gradientMap });
  (bark.map as THREE.Texture).repeat.set(3, 1);

  // Branches: the road's own cross-section, swept along every unbroken run.
  for (const run of roadRuns(track)) g.add(branchMesh(track, run, bark));
  g.add(branchDetails(track, rng));

  // Giant trees: a trunk at each end of every gap (the branches grow from
  // them) and at intervals along the course, off to the outside.
  const trunkGeo = new THREE.CylinderGeometry(1, 1.25, 1, 14);
  trunkGeo.translate(0, 0.5, 0);
  const crown = new THREE.IcosahedronGeometry(1, 1);
  const crownMats = [toon(0x2f7d2a), toon(0x3f9a34), toon(0x4fae3a)];
  const spots: { x: number; z: number; top: number; r: number }[] = [];
  for (const gap of track.gaps) {
    for (const s of [gap.s0 - 2, gap.s1 + 2]) {
      const k = track.at(s);
      const side = s === gap.s0 - 2 ? 1 : -1;
      const p = track.pointAt(s, side * (k.halfWidth + 3.2));
      spots.push({ x: p.x, z: p.z, top: k.p.y + 16, r: 3.4 });
    }
  }
  for (let s = 20; s < track.length; s += 75) {
    if (track.inGap(s)) continue;
    const k = track.at(s);
    const side = k.curvature >= 0 ? 1 : -1; // outside of the bend
    const p = track.pointAt(s, side * (k.halfWidth + rng.range(5, 9)));
    const near = track.project({ x: p.x, y: p.y, z: p.z });
    if (Math.abs(near.lateral) < track.at(near.s).halfWidth + 3.5) continue;
    spots.push({ x: p.x, z: p.z, top: k.p.y + rng.range(14, 20), r: rng.range(2.6, 3.6) });
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const trunks = new THREE.InstancedMesh(trunkGeo, toon(0x5b4330), spots.length);
  const crowns: THREE.Matrix4[][] = [[], [], []];
  spots.forEach((t, i) => {
    m.compose(new THREE.Vector3(t.x, -0.5, t.z), q, new THREE.Vector3(t.r, t.top + 0.5, t.r));
    trunks.setMatrixAt(i, m);
    for (let c = 0; c < 6; c++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0, 7);
      const sc = rng.range(5, 8.5);
      m.compose(new THREE.Vector3(t.x + Math.cos(a) * d, t.top + rng.range(-1, 3), t.z + Math.sin(a) * d), q, new THREE.Vector3(sc, sc * 0.6, sc));
      crowns[c % 3]!.push(m.clone());
    }
  });
  trunks.castShadow = true;
  g.add(trunks);
  crowns.forEach((list, i) => {
    const inst = new THREE.InstancedMesh(crown, crownMats[i]!, list.length);
    list.forEach((pm, j) => inst.setMatrixAt(j, pm));
    inst.castShadow = true;
    g.add(inst);
  });

  // The sea of treetops below.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let lowY = Infinity;
  for (const s of track.samples) {
    minX = Math.min(minX, s.p.x);
    maxX = Math.max(maxX, s.p.x);
    minZ = Math.min(minZ, s.p.z);
    maxZ = Math.max(maxZ, s.p.z);
    lowY = Math.min(lowY, s.p.y);
  }
  const sea: THREE.Matrix4[][] = [[], [], []];
  const pad = 260;
  for (let x = minX - pad; x < maxX + pad; x += 15) {
    for (let z = minZ - pad; z < maxZ + pad; z += 15) {
      const sc = rng.range(7, 12);
      m.compose(
        new THREE.Vector3(x + rng.range(-6, 6), lowY - rng.range(12, 18), z + rng.range(-6, 6)),
        q,
        new THREE.Vector3(sc, sc * 0.55, sc),
      );
      sea[Math.floor(rng.next() * 3)]!.push(m.clone());
    }
  }
  const seaMats = [toon(0x2a6a26), toon(0x347d2c), toon(0x3f8f34)];
  sea.forEach((list, i) => {
    const inst = new THREE.InstancedMesh(crown, seaMats[i]!, list.length);
    list.forEach((pm, j) => inst.setMatrixAt(j, pm));
    g.add(inst);
  });
  return g;
}

/** Unbroken runs of road as [firstSample, count] (a closed loop is one run). */
function roadRuns(track: Track): [number, number][] {
  const n = track.samples.length;
  // Pieces that will snap off are their own meshes, so the main runs skip them.
  const cuts = track.snapRanges();
  const road = (i: number) => track.samples[i]!.road && !cuts.some((c) => track.between(i, c.s0, c.s1));
  const startAt = track.samples.findIndex((_, i) => road(i) && !road((i - 1 + n) % n));
  if (startAt < 0) return [[0, n + 1]];
  const runs: [number, number][] = [];
  let first = -1;
  for (let k = 0; k <= n; k++) {
    const i = (startAt + k) % n;
    const on = road(i) && k < n;
    if (on && first < 0) first = k;
    if (!on && first >= 0) {
      runs.push([(startAt + first) % n, k - first]);
      first = -1;
    }
  }
  return runs;
}

/**
 * One branch: the superellipse cross-section from `track.surfaceDrop` swept
 * along the samples, so its top is exactly the road the karts drive on.
 * Rounded caps close the ends where the branch meets a gap.
 */
function branchMesh(track: Track, [first, count]: [number, number], bark: THREE.Material): THREE.Mesh {
  const SEG = 28;
  const n = track.samples.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < count; k++) {
    const smp = track.samples[(first + k) % n]!;
    const { a, b } = branchProfile(smp.halfWidth);
    for (let j = 0; j <= SEG; j++) {
      const th = (j / SEG) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / BRANCH_N);
      const y = b * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / BRANCH_N) - b;
      pos.push(smp.p.x + smp.r.x * x + smp.n.x * y, smp.p.y + smp.r.y * x + smp.n.y * y, smp.p.z + smp.r.z * x + smp.n.z * y);
      uv.push((j / SEG) * 6, (first + k) / 7);
    }
  }
  const ring = SEG + 1;
  for (let k = 0; k < count - 1; k++) {
    for (let j = 0; j < SEG; j++) {
      const i0 = k * ring + j;
      idx.push(i0, i0 + ring, i0 + 1, i0 + 1, i0 + ring, i0 + ring + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, bark);
  (mesh.material as THREE.Material).side = THREE.DoubleSide;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Rounded ends where the branch meets a real gap (not where a piece is cut out to snap later).
  if (count < n) {
    for (const k of [0, count - 1]) {
      const smp = track.samples[(first + k) % n]!;
      const beyond = track.samples[(first + (k === 0 ? -1 : count) + n) % n]!;
      if (beyond.road) continue;
      const { a, b } = branchProfile(smp.halfWidth);
      const cap = new THREE.Mesh(GEO.sphere, bark);
      cap.scale.set(a, b, a * 0.5);
      cap.position.set(smp.p.x - smp.n.x * b, smp.p.y - smp.n.y * b, smp.p.z - smp.n.z * b);
      cap.lookAt(cap.position.x + smp.t.x, cap.position.y + smp.t.y, cap.position.z + smp.t.z);
      mesh.add(cap);
      cap.position.sub(mesh.position);
    }
  }
  return mesh;
}

/**
 * What makes a branch read as a branch: side shoots reaching out with leaf
 * clusters, moss along the top edges, shelf fungus and knots on the flanks.
 */
function branchDetails(track: Track, rng: Rng): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const shoots: THREE.Matrix4[] = [];
  const leafSpots: THREE.Matrix4[][] = [[], [], []];
  const moss: THREE.Matrix4[] = [];
  const fungus: THREE.Matrix4[] = [];
  const knots: THREE.Matrix4[] = [];
  const at = (s: number, lat: number, down: number) => {
    const k = track.at(s);
    const p = track.pointAt(s, lat);
    return new THREE.Vector3(p.x - k.n.x * down, p.y - k.n.y * down, p.z - k.n.z * down);
  };
  for (let s = 6; s < track.length; s += 4) {
    if (track.inGap(s) || track.inGap(s + 6) || track.inGap(s - 6)) continue;
    const k = track.at(s);
    const { a, b } = branchProfile(k.halfWidth);
    const yaw = Math.atan2(k.t.x, k.t.z);
    // Side shoots every so often, alternating, angled out, up and forward.
    if (rng.next() < 0.28) {
      const side = rng.next() < 0.5 ? -1 : 1;
      const root = at(s, side * a * 0.92, b * 0.75);
      const len = rng.range(5, 11);
      e.set(0, yaw, 0);
      q.setFromEuler(e);
      const out = new THREE.Vector3(side * -1, 0, 0).applyQuaternion(q); // kart frame: +X is left
      const dir = out.clone().multiplyScalar(1).add(new THREE.Vector3(0, rng.range(0.25, 0.8), 0)).add(new THREE.Vector3(k.t.x, 0, k.t.z).multiplyScalar(rng.range(-0.3, 0.6))).normalize();
      const thick = rng.range(0.45, 0.85);
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      m.compose(root.clone().addScaledVector(dir, len / 2), q, new THREE.Vector3(thick, len, thick));
      shoots.push(m.clone());
      const tip = root.clone().addScaledVector(dir, len);
      for (let c = 0; c < 4; c++) {
        const sc = rng.range(1.4, 2.6);
        m.compose(tip.clone().add(new THREE.Vector3(rng.range(-1.5, 1.5), rng.range(-0.5, 1.5), rng.range(-1.5, 1.5))), q, new THREE.Vector3(sc, sc * 0.7, sc));
        leafSpots[c % 3]!.push(m.clone());
      }
    }
    // Moss along the top edges, outside the railing.
    for (const side of [-1, 1]) {
      if (rng.next() < 0.55) {
        const p = at(s + rng.range(-1.5, 1.5), side * (k.halfWidth + WALL_THICK + 0.3), track.surfaceDrop(k.halfWidth + WALL_THICK + 0.3, k.halfWidth) - 0.05);
        const sc = rng.range(0.7, 1.4);
        m.compose(p, new THREE.Quaternion(), new THREE.Vector3(sc * 1.4, sc * 0.25, sc));
        moss.push(m.clone());
      }
    }
    // Shelf fungus and knots on the flanks.
    if (rng.next() < 0.12) {
      const side = rng.next() < 0.5 ? -1 : 1;
      const p = at(s, side * a * 0.98, b * rng.range(0.6, 1.1));
      const sc = rng.range(0.6, 1.1);
      m.compose(p, new THREE.Quaternion(), new THREE.Vector3(sc * 1.2, sc * 0.22, sc * 1.2));
      fungus.push(m.clone());
    }
    if (rng.next() < 0.1) {
      const side = rng.next() < 0.5 ? -1 : 1;
      const p = at(s, side * a * 0.9, b * rng.range(0.4, 1.4));
      const sc = rng.range(0.8, 1.6);
      m.compose(p, new THREE.Quaternion(), new THREE.Vector3(sc, sc * 0.8, sc));
      knots.push(m.clone());
    }
  }
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], shadow = false) => {
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((pm, i) => inst.setMatrixAt(i, pm));
    inst.castShadow = shadow;
    g.add(inst);
  };
  const shootGeo = new THREE.CylinderGeometry(0.55, 1, 1, 8);
  add(shootGeo, toon(0x6e4c2e), shoots, true);
  const leafGeo = new THREE.IcosahedronGeometry(1, 0);
  [toon(0x2f7d2a), toon(0x3f9a34), toon(0x5bb544)].forEach((mat, i) => add(leafGeo, mat, leafSpots[i]!, true));
  add(GEO.sphereLo, toon(0x5e8f3a), moss);
  add(GEO.sphere, toon(0xd9b98a), fungus);
  add(GEO.sphereLo, toon(0x5a3d22), knots);
  return g;
}

/** A glowing lava fissure under each road gap. */
function fissures(track: Track): THREE.Mesh[] {
  return track.gaps.map((gap) => {
    const mid = track.at((gap.s0 + gap.s1) / 2);
    const len = track.wrap(gap.s1 - gap.s0) + 4;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(mid.halfWidth * 2 + 30, 1, len),
      new THREE.MeshBasicMaterial({ color: 0xff6a1a }),
    );
    mesh.position.set(mid.p.x, mid.p.y - 4.5, mid.p.z);
    mesh.rotation.y = Math.atan2(mid.t.x, mid.t.z);
    const glow = new THREE.PointLight(0xff5a10, 600, 40, 1.8);
    glow.position.set(0, 3, 0);
    mesh.add(glow);
    return mesh;
  });
}

/**
 * TIMBER! A giant tree by the road: creaks and sways while the event is a
 * warning, crashes across the road when it goes active, leaving its trunk
 * lying where the sim's bump is and its crown heaped over the blocked half.
 */
function fallingTree(track: Track, def: Extract<NonNullable<Track['def']['events']>[number], { kind: 'treefall' }>) {
  const g = new THREE.Group();
  const s = track.anchor(def);
  const k = track.at(s);
  const a = track.pointAt(s, -def.blocked * (k.halfWidth + 2));
  const b = track.pointAt(s + TREE.slant, def.blocked * (k.halfWidth + 2));
  // Pivot just above the road, so the fallen trunk lies on it where the sim's bump is.
  const base = new THREE.Vector3(a.x, a.y + 0.25, a.z).addScaledVector(
    new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize(),
    -2.5,
  );
  const lie = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
  const fall = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), lie);

  // The tree: trunk up +Y from the pivot, crown at the top.
  const tree = new THREE.Group();
  tree.position.copy(base);
  g.add(tree);
  const bd = new PartBuilder();
  const LEN = 26;
  bd.add(tree, GEO.cylinder, toon(0x5b4330), { pos: [0, LEN / 2, 0], scale: [0.85, LEN, 0.85] });
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2;
    bd.add(tree, GEO.box, toon(0x4e3927), { pos: [Math.cos(ang) * 0.9, 0.8, Math.sin(ang) * 0.9], rot: [0, -ang, 0.35], scale: [1.3, 1.8, 0.25] });
  }
  for (const [x, y, z, r] of [[0, LEN, 0, 4.2], [2.6, LEN - 2.5, 1, 3.2], [-2.4, LEN - 2, -1, 3.4], [0.5, LEN + 2.4, -1.5, 3]] as const)
    bd.add(tree, GEO.sphereLo, toon(y > LEN ? 0x4ea83c : 0x2f7d2a), { pos: [x, y, z], scale: [r, r * 0.8, r] });
  bd.build();

  // What the crown leaves on the road: branches and leaves over the blocked half.
  const debris = new THREE.Group();
  g.add(debris);
  const dd = new PartBuilder();
  const rng = new Rng(123);
  for (let d = TREE.crownFrom; d < TREE.crownTo; d += 1.6) {
    for (let j = 0; j < 2; j++) {
      const lat = def.blocked * rng.range(-0.5, k.halfWidth + 1);
      const p = track.pointAt(s + d + rng.range(-0.6, 0.6), lat);
      const sc = rng.range(1.0, 1.9);
      dd.add(debris, GEO.sphereLo, toon(rng.next() < 0.5 ? 0x2f7d2a : 0x4ea83c), { pos: [p.x, p.y + sc * 0.35, p.z], scale: [sc * 1.2, sc * 0.6, sc] });
      if (rng.next() < 0.4) dd.add(debris, GEO.cylinder, toon(0x6e4c2e), { pos: [p.x, p.y + 0.3, p.z], rot: [Math.PI / 2, rng.range(0, 3), 0.3], scale: [0.18, rng.range(2, 4), 0.18] });
    }
  }
  dd.build();
  debris.visible = false;

  return {
    group: g,
    update(e: EventState | null, time: number) {
      if (!e || e.phase === 'idle') {
        tree.quaternion.identity();
        debris.visible = false;
        return;
      }
      if (e.phase === 'warning') {
        // Creaking: an uneasy sway that grows.
        const sway = Math.sin(time * 1.6) * 0.012 + Math.sin(time * 4.3) * 0.006 * Math.min(1, e.t / 30);
        tree.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), sway);
        debris.visible = false;
        return;
      }
      // Falling: accelerating over about a second and a quarter, then a little bounce.
      const t = e.t;
      const f = Math.min(1, 0.65 * t * t);
      const bounce = f >= 1 ? Math.max(0, Math.sin((t - 1.24) * 9) * Math.exp(-(t - 1.24) * 4) * 0.04) : 0;
      tree.quaternion.slerpQuaternions(new THREE.Quaternion(), fall, f - bounce);
      debris.visible = f >= 1;
    },
  };
}

/**
 * SNAP! The stretch of branch that breaks mid-race, drawn as its own piece:
 * cracks open across it during the warning (and it sags), then it falls away.
 * The broken stub — a bark ramp — appears, and the barrier over the drop goes.
 */
function snappingBranch(track: Track, index: number, barriers: THREE.Object3D) {
  const g = new THREE.Group();
  const range = track.snapRanges()[0]!;
  const def = track.def.events![index] as { rampHeight: number };
  const n = track.samples.length;
  const i0 = Math.ceil(range.s0);
  const count = Math.max(2, Math.floor(range.s1) - i0 + 2);
  const bark = new THREE.MeshToonMaterial({ map: barkTexture(), gradientMap: toon(0).gradientMap });
  (bark.map as THREE.Texture).repeat.set(3, 1);
  const piece = branchMesh(track, [i0 % n, count], bark);
  // Cracks: dark jagged slashes across the top, revealed during the warning.
  const cracks = new THREE.Group();
  const cb = new PartBuilder();
  for (const f of [0.15, 0.55, 0.9]) {
    const s = range.s0 + (range.s1 - range.s0) * f;
    const smp = track.at(s);
    for (let j = -2; j <= 2; j++) {
      const p = track.pointAt(s + (j % 2) * 0.4, j * smp.halfWidth * 0.32);
      cb.add(cracks, GEO.box, toon(0x1a1009), { pos: [p.x, p.y + 0.04, p.z], rot: [0, Math.atan2(smp.t.x, smp.t.z) + j * 0.5, 0], scale: [0.12, 0.06, 2.2] });
    }
  }
  cb.build(false);
  cracks.visible = false;
  piece.add(cracks);
  g.add(piece);
  // The stub ramp: a bark wedge that tips up where the branch broke.
  const ramp = new THREE.Group();
  const rb = new PartBuilder();
  const [r0, r1] = range.ramp;
  for (let s = r0; s < r1; s += 1) {
    const smp = track.at(s);
    const h = (def.rampHeight * (s - r0)) / (r1 - r0);
    const p = track.pointAt(s + 0.5, 0);
    rb.add(ramp, GEO.box, toon(0x7a5532), {
      pos: [p.x, p.y + h / 2 + 0.05, p.z],
      rot: [0, Math.atan2(smp.t.x, smp.t.z), 0],
      scale: [smp.halfWidth * 2, h + 0.1, 1.02],
    });
  }
  rb.build();
  ramp.visible = false;
  g.add(ramp);
  const mid = track.at((range.s0 + range.s1) / 2);
  const hideBarriers = () => {
    for (const inst of barriers.children) {
      if (!(inst instanceof THREE.InstancedMesh)) continue;
      const per = inst.count / track.walls.length;
      track.walls.forEach((w, wi) => {
        if (track.between(w.s, range.s0 - 2, range.s1 + 2) || track.between(w.s + 2, range.s0, range.s1)) {
          for (let k = 0; k < per; k++) inst.setMatrixAt(wi * per + k, new THREE.Matrix4().makeScale(0, 0, 0));
        }
      });
      inst.instanceMatrix.needsUpdate = true;
    }
  };
  let broken = false;
  return {
    group: g,
    update(e: EventState | null, time: number) {
      const phase = e?.phase ?? 'idle';
      cracks.visible = phase === 'warning';
      if (phase === 'idle') {
        piece.position.set(0, 0, 0);
        piece.rotation.set(0, 0, 0);
        piece.visible = true;
        ramp.visible = false;
        return;
      }
      if (phase === 'warning') {
        // Sagging, with a nervous shiver.
        piece.position.set(0, -0.12 - Math.sin(time * 9) * 0.015, 0);
        return;
      }
      if (!broken) {
        broken = true;
        hideBarriers();
      }
      ramp.visible = true;
      // Falling away: drop and tumble, gone after a few seconds.
      const t = e!.t;
      piece.position.set(0, -0.5 * 16 * t * t, 0);
      piece.visible = t < 3;
      piece.rotation.set(0, 0, 0);
      piece.rotateOnWorldAxis(new THREE.Vector3(mid.t.x, 0, mid.t.z).normalize(), t * 0.6);
    },
  };
}

function proto(draw: (b: PartBuilder, node: THREE.Object3D) => void): Map<THREE.Material, THREE.BufferGeometry> {
  const b = new PartBuilder();
  const node = new THREE.Object3D();
  draw(b, node);
  return b.geometries(node);
}
