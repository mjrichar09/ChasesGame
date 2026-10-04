/**
 * Cartoon shading and a mesh-merging builder for procedural models.
 *
 * Everything in the game is toon-shaded: a three-step light ramp gives the
 * flat, bold, Saturday-morning look. Materials are cached by colour so eight
 * karts and a jungle full of props share a handful of them.
 *
 * `PartBuilder` lets a model be described as dozens of primitives (spheres,
 * capsules, boxes) while rendering as a few meshes: parts are grouped by the
 * node they move with and by material, then merged. A gorilla is ~40
 * primitives but only ~8 draw calls.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let ramp: THREE.DataTexture | null = null;

/** Three-band light ramp shared by every toon material. */
export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  const data = new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

const cache = new Map<string, THREE.Material>();

export function toon(color: number, opts: { emissive?: number; transparent?: boolean; opacity?: number } = {}): THREE.MeshToonMaterial {
  const key = `${color}/${opts.emissive ?? 0}/${opts.opacity ?? 1}`;
  let m = cache.get(key) as THREE.MeshToonMaterial | undefined;
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color,
      gradientMap: toonRamp(),
      emissive: opts.emissive ?? 0x000000,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
    });
    cache.set(key, m);
  }
  return m;
}

/** Shared unit primitives, transformed per part. */
export const GEO = {
  sphere: new THREE.SphereGeometry(1, 14, 10),
  sphereLo: new THREE.SphereGeometry(1, 8, 6),
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 12),
  cone: new THREE.ConeGeometry(1, 1, 10),
  torus: new THREE.TorusGeometry(1, 0.25, 8, 20),
  capsule: new THREE.CapsuleGeometry(1, 1, 4, 10),
};

export interface PartOpts {
  pos?: [number, number, number];
  /** Euler rotation, radians (XYZ). */
  rot?: [number, number, number];
  scale?: [number, number, number] | number;
}

/** Collects primitives per (node, material) and merges them. */
export class PartBuilder {
  private readonly parts = new Map<THREE.Object3D, Map<THREE.Material, THREE.BufferGeometry[]>>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  add(node: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, o: PartOpts = {}): void {
    const s = o.scale ?? 1;
    const sv = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s);
    this.e.set(...(o.rot ?? [0, 0, 0]));
    this.q.setFromEuler(this.e);
    this.m.compose(new THREE.Vector3(...(o.pos ?? [0, 0, 0])), this.q, sv);
    const g = geo.clone().applyMatrix4(this.m);
    // Merged geometries must agree on attributes; primitives without uvs get none.
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (g.index) {
      const ng = g.toNonIndexed();
      g.dispose();
      this.push(node, mat, ng);
    } else this.push(node, mat, g);
  }

  private push(node: THREE.Object3D, mat: THREE.Material, g: THREE.BufferGeometry): void {
    let byMat = this.parts.get(node);
    if (!byMat) this.parts.set(node, (byMat = new Map()));
    const list = byMat.get(mat) ?? [];
    list.push(g);
    byMat.set(mat, list);
  }

  /**
   * Merge everything added to `node` into one geometry per material, without
   * creating meshes — for prototypes that become InstancedMeshes.
   */
  geometries(node: THREE.Object3D): Map<THREE.Material, THREE.BufferGeometry> {
    const out = new Map<THREE.Material, THREE.BufferGeometry>();
    const byMat = this.parts.get(node);
    if (!byMat) return out;
    for (const [mat, geos] of byMat) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (merged) out.set(mat, merged);
    }
    this.parts.delete(node);
    return out;
  }

  /** Merge everything into meshes parented to their nodes. */
  build(castShadow = true): void {
    for (const [node, byMat] of this.parts) {
      for (const [mat, geos] of byMat) {
        const merged = mergeGeometries(geos, false);
        for (const g of geos) g.dispose();
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = castShadow;
        mesh.receiveShadow = false;
        node.add(mesh);
      }
    }
    this.parts.clear();
  }
}
