/**
 * Finishing touches that make the cartoon read better.
 *
 * - **Rim light** on characters: a warm edge highlight so dark gorillas pop
 *   off a brown road.
 * - **Outlines** (desktop): an inverted-hull ink line around karts and gorillas.
 * - **Contact shadows**: a soft dark blob under every kart, on every device —
 *   phones have no shadow maps, and without it karts float.
 * - **Sky dressing**: drifting cartoon clouds and a glowing sun.
 * - **Roadside tufts**: grass and little flowers along the road's edges.
 */

import * as THREE from 'three';
import { Rng } from '../sim/rng.js';
import type { Track } from '../sim/track.js';
import { radialTexture } from './itemsView.js';
import { toon } from './toon.js';

// ------------------------------------------------------------------ rim light

const rimCache = new Map<THREE.Material, THREE.Material>();

/** A rim-lit copy of a toon material (cached, so karts share them). */
function rimmed(mat: THREE.Material): THREE.Material {
  const hit = rimCache.get(mat);
  if (hit) return hit;
  if (!(mat instanceof THREE.MeshToonMaterial)) return mat;
  const m = mat.clone();
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float rimF = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
      outgoingLight += vec3(1.0, 0.93, 0.78) * smoothstep(0.55, 0.95, rimF) * 0.38;
      #include <opaque_fragment>`,
    );
  };
  m.customProgramCacheKey = () => 'rim';
  rimCache.set(mat, m);
  return m;
}

/** Give every toon mesh under `root` a rim light. */
export function rimLight(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) return;
    if (Array.isArray(mesh.material)) return;
    mesh.material = rimmed(mesh.material);
  });
}

// ------------------------------------------------------------------ outlines

let outlineMat: THREE.ShaderMaterial | null = null;
function inkMaterial(): THREE.ShaderMaterial {
  if (outlineMat) return outlineMat;
  outlineMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { width: { value: 0.035 }, ink: { value: new THREE.Color(0x1a1009) } }]),
    side: THREE.BackSide,
    fog: true,
    vertexShader: /* glsl */ `
      uniform float width;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position + normal * width;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 ink;
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = vec4(ink, 1.0);
        #include <fog_fragment>
      }`,
  });
  return outlineMat;
}

/** Ink outlines around every mesh under `root` (skips transparent ones). */
export function outline(root: THREE.Object3D): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.ink || (mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) return;
    const mat = mesh.material as THREE.Material;
    if (Array.isArray(mat) || mat.transparent || !(mat instanceof THREE.MeshToonMaterial)) return;
    meshes.push(mesh);
  });
  for (const mesh of meshes) {
    const ink = new THREE.Mesh(mesh.geometry, inkMaterial());
    ink.userData.ink = true;
    ink.castShadow = false;
    ink.renderOrder = -1;
    mesh.add(ink);
  }
}

// ------------------------------------------------------------------ contact shadow

let shadowTex: THREE.Texture | null = null;
/** A soft dark blob that lies on the ground under a kart. */
export function contactShadow(): THREE.Mesh {
  if (!shadowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.7)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3.3, 4.4),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  mesh.renderOrder = 1;
  return mesh;
}

// ------------------------------------------------------------------ sky

function cloudTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  const rng = new Rng(4);
  for (let i = 0; i < 9; i++) {
    const x = 50 + i * 20 + rng.range(-8, 8);
    const y = 78 - Math.sin((i / 8) * Math.PI) * 26 + rng.range(-5, 5);
    const r = 26 + Math.sin((i / 8) * Math.PI) * 18;
    const grad = g.createRadialGradient(x, y - r * 0.3, r * 0.2, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.75, 'rgba(240,244,250,0.95)');
    grad.addColorStop(1, 'rgba(225,232,242,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // A flat, slightly shaded base.
  g.globalCompositeOperation = 'source-atop';
  const shade = g.createLinearGradient(0, 40, 0, 128);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(120,140,170,0.35)');
  g.fillStyle = shade;
  g.fillRect(0, 0, 256, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface Sky {
  group: THREE.Group;
  update(time: number, camera: THREE.Camera): void;
}

/** Puffy clouds around the horizon and a glowing sun, tinted for the track. */
export function skyDressing(tint: number, sunColor: number, sunDir: THREE.Vector3): Sky {
  const group = new THREE.Group();
  const tex = cloudTexture();
  const rng = new Rng(12);
  const clouds: THREE.Sprite[] = [];
  for (let i = 0; i < 26; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, color: tint, transparent: true, fog: false, depthWrite: false });
    const s = new THREE.Sprite(mat);
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(520, 720);
    s.position.set(Math.cos(a) * r, rng.range(110, 230), Math.sin(a) * r);
    const w = rng.range(140, 260);
    s.scale.set(w, w * 0.5, 1);
    group.add(s);
    clouds.push(s);
  }
  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: radialTexture(), color: sunColor, transparent: true, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }),
  );
  sun.position.copy(sunDir.clone().normalize().multiplyScalar(700));
  sun.scale.set(260, 260, 1);
  group.add(sun);
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }));
  core.position.copy(sun.position);
  core.scale.set(70, 70, 1);
  group.add(core);
  return {
    group,
    update(time: number, camera: THREE.Camera) {
      // The sky travels with the camera; clouds drift slowly round it.
      group.position.copy(camera.position);
      group.rotation.y = time * 0.004;
    },
  };
}

// ------------------------------------------------------------------ roadside

/** Grass tufts and small flowers along both edges of the road, at the barrier's foot. */
export function roadsideTufts(track: Track, density = 1): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.ConeGeometry(0.06, 0.55, 3);
  blade.translate(0, 0.27, 0);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const b = blade.clone();
    b.rotateZ((i - 2) * 0.22);
    b.rotateY((i / 5) * Math.PI * 2);
    b.translate(Math.cos(i * 1.3) * 0.08, 0, Math.sin(i * 1.3) * 0.08);
    parts.push(b);
  }
  const tuftGeo = mergeSimple(parts);
  const grass = toon(0x5e9f3a);
  const flowerGeo = new THREE.SphereGeometry(0.12, 6, 4);
  const flowerMats = [toon(0xffd43a), toon(0xff7fb0), toon(0xffffff)];
  const rng = new Rng(55);
  const tufts: THREE.Matrix4[] = [];
  const flowers: THREE.Matrix4[][] = [[], [], []];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let s = 0; s < track.length; s += 0.7 / density) {
    const k = track.at(s);
    if (!k.road) continue;
    for (const side of [-1, 1]) {
      if (rng.next() < 0.35) continue;
      const lat = side * (k.halfWidth - rng.range(0.05, 0.6));
      const p = track.pointAt(s + rng.range(-0.3, 0.3), lat);
      const y = p.y - track.surfaceDrop(lat, k.halfWidth) + track.kickerHeight(s, lat);
      if (track.kickerHeight(s, lat) > 0) continue;
      const sc = rng.range(0.7, 1.4);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, Math.PI * 2));
      m.compose(new THREE.Vector3(p.x, y, p.z), q, new THREE.Vector3(sc, sc, sc));
      tufts.push(m.clone());
      if (rng.next() < 0.12) {
        m.compose(new THREE.Vector3(p.x, y + 0.5 * sc, p.z), q, new THREE.Vector3(1, 1, 1));
        flowers[Math.floor(rng.next() * 3)]!.push(m.clone());
      }
    }
  }
  const inst = new THREE.InstancedMesh(tuftGeo, grass, tufts.length);
  tufts.forEach((tm, i) => inst.setMatrixAt(i, tm));
  g.add(inst);
  flowers.forEach((list, i) => {
    if (!list.length) return;
    const fi = new THREE.InstancedMesh(flowerGeo, flowerMats[i]!, list.length);
    list.forEach((tm, j) => fi.setMatrixAt(j, tm));
    g.add(fi);
  });
  return g;
}

/** Merge geometries that share attributes (position + normal) into one. */
function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...(g.attributes.position!.array as Float32Array));
    nor.push(...(g.attributes.normal!.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
