/**
 * Lava Run's set-pieces: the mountain, the sea, the lava, the crater, the huts.
 *
 * - **Terrain** is the sim's terrain grid, coloured by height: black rock at
 *   the summit, ash, then jungle green, then sand at the shore.
 * - **Lava** is one long strip draped over the road and its banks for the
 *   whole course. A shader cuts it off at the sim's lava front each frame, so
 *   the flow on screen is exactly the flow that kills. The front edge glows
 *   hottest; behind it the crust churns.
 * - **Huts** line the road, thicker toward the village at the bottom; the
 *   lava chars them as it passes.
 */

import * as THREE from 'three';
import { Rng } from '../sim/rng.js';
import { type Terrain, terrainHeight } from '../sim/terrain.js';
import type { Track } from '../sim/track.js';
import { radialTexture } from './itemsView.js';
import { GEO, PartBuilder, toon } from './toon.js';

export interface VolcanoView {
  group: THREE.Group;
  /** Lava front (sim `s`), time, and where the crater is for effects. */
  update(front: number, time: number): void;
  crater: THREE.Vector3;
}

export function buildVolcanoView(track: Track, terrain: Terrain): VolcanoView {
  const group = new THREE.Group();
  group.add(terrainMesh(terrain));
  group.add(ocean(terrain));
  const lava = lavaStrip(track, terrain);
  group.add(lava.mesh);
  const crater = craterAndSmoke(track, terrain);
  group.add(crater.group);
  const huts = hutRow(track, terrain);
  group.add(huts.group);
  return {
    group,
    crater: crater.at,
    update(front: number, time: number) {
      lava.uniforms.front!.value = front;
      lava.uniforms.time!.value = time;
      crater.update(time);
      huts.update(front, time);
    },
  };
}

function terrainMesh(t: Terrain): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(t.vertices, 3));
  geo.setIndex(new THREE.BufferAttribute(t.indices, 1));
  geo.computeVertexNormals();
  const colors = new Float32Array(t.vertices.length);
  const c = new THREE.Color();
  const rock = new THREE.Color(0x2e2624);
  const ash = new THREE.Color(0x6b5a4c);
  const green = new THREE.Color(0x4f7a34);
  const sand = new THREE.Color(0xd8c38f);
  const normals = geo.attributes.normal as THREE.BufferAttribute;
  const rng = new Rng(17);
  for (let i = 0; i < t.vertices.length / 3; i++) {
    const y = t.vertices[i * 3 + 1]!;
    if (y > 95) c.copy(ash).lerp(rock, Math.min(1, (y - 95) / 30));
    else if (y > 45) c.copy(green).lerp(ash, (y - 45) / 50);
    else if (y > 3) c.copy(green);
    else c.copy(sand).lerp(green, Math.max(0, y / 3));
    // Steep ground shows bare rock; a little noise so it is not banded.
    const steep = 1 - normals.getY(i);
    c.lerp(rock, Math.min(0.6, steep * 1.4));
    c.offsetHSL(0, 0, rng.range(-0.03, 0.03));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toon(0).gradientMap }));
  mesh.receiveShadow = true;
  return mesh;
}

function ocean(t: Terrain): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshToonMaterial({ color: 0x2f8fb8, gradientMap: toon(0).gradientMap, emissive: 0x061c28 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(t.x0 + (t.nx * t.dx) / 2, 0.4, t.z0 + (t.nz * t.dx) / 2);
  return mesh;
}

/** The lava flow along the course, cut off at the front by a shader. */
function lavaStrip(track: Track, terrain: Terrain): { mesh: THREE.Mesh; uniforms: Record<string, THREE.IUniform> } {
  const COLS = 14;
  const pos: number[] = [];
  const along: number[] = [];
  const across: number[] = [];
  const idx: number[] = [];
  const n = track.samples.length;
  for (let i = 0; i < n; i++) {
    const k = track.samples[i]!;
    const spread = k.halfWidth + 14;
    for (let j = 0; j <= COLS; j++) {
      const lat = -spread + (2 * spread * j) / COLS;
      const p = track.pointAt(k.s, lat);
      // On the road: just over it. Beyond: over the ground, but never far
      // below the road (it spills down the slope, it does not hang in the air).
      let y = p.y + 0.3;
      if (Math.abs(lat) > k.halfWidth + 0.6) {
        const g = terrainHeight(terrain, p.x, p.z);
        y = Number.isNaN(g) ? p.y + 0.3 : Math.max(g + 0.25, Math.min(p.y + 0.3, g + 3));
      }
      pos.push(p.x, y, p.z);
      along.push(k.s);
      across.push(Math.abs(lat) / spread);
    }
  }
  const row = COLS + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < COLS; j++) {
      const a = i * row + j;
      idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  geo.setAttribute('across', new THREE.Float32BufferAttribute(across, 1));
  geo.setIndex(idx);
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { front: { value: -1e9 }, time: { value: 0 } },
  ]) as Record<string, THREE.IUniform>;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float along;
      attribute float across;
      varying float vAlong;
      varying float vAcross;
      #include <fog_pars_vertex>
      void main() {
        vAlong = along;
        vAcross = across;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float front;
      uniform float time;
      varying float vAlong;
      varying float vAcross;
      #include <fog_pars_fragment>
      void main() {
        float behind = front - vAlong;
        // The flow front bulges forward in the middle.
        float edge = behind + (1.0 - vAcross * vAcross) * 4.0;
        if (edge < 0.0) discard;
        // Churning crust: a few moving waves, sharpened into cracks.
        float w = sin(vAlong * 0.23 - time * 2.1 + vAcross * 7.0) + sin(vAlong * 0.09 + time * 1.3 - vAcross * 11.0) + sin((vAlong + vAcross * 30.0) * 0.5 - time * 3.7) * 0.5;
        float crack = smoothstep(0.6, 1.6, abs(w));
        vec3 crust = vec3(0.18, 0.03, 0.02);
        vec3 molten = vec3(1.0, 0.42, 0.06);
        vec3 col = mix(molten, crust, crack * smoothstep(0.0, 40.0, behind));
        // The leading edge is white-hot.
        col = mix(vec3(1.0, 0.9, 0.45), col, smoothstep(0.0, 8.0, edge));
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

/** The crater: a glowing lava lake and a column of smoke billowing out. */
function craterAndSmoke(track: Track, terrain: Terrain): { group: THREE.Group; at: THREE.Vector3; update(time: number): void } {
  const g = new THREE.Group();
  const h = terrainHeight(terrain, 0, 0);
  const at = new THREE.Vector3(0, Number.isNaN(h) ? track.samples[0]!.p.y + 20 : h + 1.5, 0);
  const lake = new THREE.Mesh(new THREE.CircleGeometry(30, 32), new THREE.MeshBasicMaterial({ color: 0xff6a1a, fog: false }));
  lake.rotation.x = -Math.PI / 2;
  lake.position.copy(at);
  g.add(lake);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshBasicMaterial({ map: radialTexture(), color: 0xff5a10, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.copy(at).y += 2;
  g.add(glow);
  // Smoke: big soft puffs rising in a loop, darker as they climb.
  const puffMat = new THREE.SpriteMaterial({ map: radialTexture(), color: 0x3a3330, transparent: true, depthWrite: false, opacity: 0.85 });
  const puffs: { sprite: THREE.Sprite; phase: number; drift: number }[] = [];
  for (let i = 0; i < 26; i++) {
    const sprite = new THREE.Sprite(puffMat.clone());
    g.add(sprite);
    puffs.push({ sprite, phase: i / 26, drift: (i % 5) - 2 });
  }
  const light = new THREE.PointLight(0xff5a10, 2500, 220, 1.6);
  light.position.copy(at).y += 12;
  g.add(light);
  return {
    group: g,
    at,
    update(time: number) {
      for (const p of puffs) {
        const t = (time * 0.05 + p.phase) % 1;
        p.sprite.position.set(at.x + p.drift * 6 + t * 40, at.y + 10 + t * 170, at.z + Math.sin(p.phase * 20) * 12 + t * 20);
        const size = 30 + t * 90;
        p.sprite.scale.set(size, size, 1);
        (p.sprite.material as THREE.SpriteMaterial).opacity = 0.8 * Math.min(1, t * 6) * (1 - t);
      }
      light.intensity = 2200 + Math.sin(time * 7) * 300 + Math.sin(time * 13) * 200;
    },
  };
}

/** Thatched huts along the road; the lava chars them as it goes by. */
function hutRow(track: Track, terrain: Terrain): { group: THREE.Group; update(front: number, time: number): void } {
  const g = new THREE.Group();
  const rng = new Rng(91);
  const proto = (wall: number, roof: number) => {
    const b = new PartBuilder();
    const node = new THREE.Object3D();
    b.add(node, GEO.cylinder, toon(wall), { pos: [0, 1.3, 0], scale: [2.2, 2.6, 2.2] });
    b.add(node, GEO.cone, toon(roof), { pos: [0, 3.6, 0], scale: [3.1, 2.4, 3.1] });
    b.add(node, GEO.box, toon(0x2a1a0e), { pos: [0, 0.9, 2.15], scale: [0.9, 1.6, 0.2] });
    b.add(node, GEO.cylinder, toon(0x7a5230), { pos: [0, 4.9, 0], scale: [0.12, 0.6, 0.12] });
    return b.geometries(node);
  };
  const fresh = proto(0xc9a06a, 0xe0c060);
  const burnt = proto(0x3a2a22, 0x2a1d18);
  const huts: { s: number; m: THREE.Matrix4 }[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let s = track.startS + 40; s < track.length - 20; s += rng.range(12, 34)) {
    // More huts toward the village at the bottom.
    const village = s / track.length;
    if (rng.next() > 0.35 + village * 0.6) continue;
    const k = track.at(s);
    if (!k.road) continue;
    const side = rng.next() < 0.5 ? -1 : 1;
    const p = track.pointAt(s, side * (k.halfWidth + rng.range(5, 12)));
    const near = track.project({ x: p.x, y: p.y, z: p.z });
    if (Math.abs(near.lateral) < track.at(near.s).halfWidth + 3.5) continue;
    const y = terrainHeight(terrain, p.x, p.z);
    if (Number.isNaN(y)) continue;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(k.p.x - p.x, k.p.z - p.z));
    m.compose(new THREE.Vector3(p.x, y - 0.2, p.z), q, new THREE.Vector3(1, 1, 1).multiplyScalar(rng.range(0.8, 1.2)));
    huts.push({ s, m: m.clone() });
  }
  const make = (geos: Map<THREE.Material, THREE.BufferGeometry>) =>
    [...geos].map(([mat, geo]) => {
      const inst = new THREE.InstancedMesh(geo, mat, huts.length);
      inst.castShadow = true;
      g.add(inst);
      return inst;
    });
  const freshMeshes = make(fresh);
  const burntMeshes = make(burnt);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  let charred = -1;
  const place = (n: number) => {
    huts.forEach((h, i) => {
      for (const inst of freshMeshes) inst.setMatrixAt(i, i < n ? hidden : h.m);
      for (const inst of burntMeshes) inst.setMatrixAt(i, i < n ? h.m : hidden);
    });
    for (const inst of [...freshMeshes, ...burntMeshes]) inst.instanceMatrix.needsUpdate = true;
  };
  place(0);
  return {
    group: g,
    update(front: number) {
      // Huts are in course order, so "charred" is just a count.
      let n = 0;
      while (n < huts.length && huts[n]!.s < front - 6) n++;
      if (n !== charred) {
        charred = n;
        place(n);
      }
    },
  };
}
