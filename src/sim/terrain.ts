/**
 * Shaped ground for tracks that need it (a volcano's flank).
 *
 * A grid over the course: far from the road the ground follows the track's
 * own height function; near it, it eases into a shelf just under the road, so
 * the road reads as cut into the mountain (or built up on it) with no cliff
 * and no seam. The same grid is the physics ground and the drawn ground, and
 * `heightAt` lets the renderer stand huts and trees on it.
 */

import type { Track } from './track.js';

export interface Terrain {
  x0: number;
  z0: number;
  dx: number;
  nx: number;
  nz: number;
  /** Row-major: heights[iz * nx + ix]. */
  heights: Float32Array;
  vertices: Float32Array;
  indices: Uint32Array;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function buildTerrain(track: Track): Terrain | null {
  const def = track.def.terrain;
  if (!def) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of track.samples) {
    minX = Math.min(minX, s.p.x);
    maxX = Math.max(maxX, s.p.x);
    minZ = Math.min(minZ, s.p.z);
    maxZ = Math.max(maxZ, s.p.z);
  }
  const dx = def.spacing;
  const x0 = Math.floor((minX - def.margin) / dx) * dx;
  const z0 = Math.floor((minZ - def.margin) / dx) * dx;
  const nx = Math.ceil((maxX + def.margin - x0) / dx) + 1;
  const nz = Math.ceil((maxZ + def.margin - z0) / dx) + 1;
  const heights = new Float32Array(nx * nz);
  // Every other sample is plenty for "nearest road".
  const road = track.samples.filter((_, i) => i % 2 === 0);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = x0 + ix * dx;
      const z = z0 + iz * dx;
      let best = Infinity;
      let roadY = 0;
      let hw = 6;
      let onRoad = true;
      for (const s of road) {
        const d = (s.p.x - x) ** 2 + (s.p.z - z) ** 2;
        if (d < best) {
          best = d;
          roadY = s.p.y;
          hw = s.halfWidth;
          onRoad = s.road;
        }
      }
      const d = Math.sqrt(best);
      const natural = def.height(x, z);
      // A shelf just under the road out to the barriers, easing into the mountain.
      // Under a gap in the road the ground falls away into a deep fissure.
      const shelf = onRoad ? roadY - 0.7 : roadY - 12;
      const w = smooth(hw + 2, hw + 24, d);
      heights[iz * nx + ix] = shelf + (natural - shelf) * w;
    }
  }
  const vertices = new Float32Array(nx * nz * 3);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      vertices[i * 3] = x0 + ix * dx;
      vertices[i * 3 + 1] = heights[i]!;
      vertices[i * 3 + 2] = z0 + iz * dx;
    }
  }
  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iz * nx + ix;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // Up-facing: (a, c, b) and (b, c, d) with +Z rows.
      indices.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  return { x0, z0, dx, nx, nz, heights, vertices, indices };
}

/** Ground height at (x, z), bilinear; NaN outside the grid. */
export function terrainHeight(t: Terrain, x: number, z: number): number {
  const fx = (x - t.x0) / t.dx;
  const fz = (z - t.z0) / t.dx;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  if (ix < 0 || iz < 0 || ix >= t.nx - 1 || iz >= t.nz - 1) return NaN;
  const u = fx - ix;
  const v = fz - iz;
  const h = (i: number, j: number) => t.heights[j * t.nx + i]!;
  return (h(ix, iz) * (1 - u) + h(ix + 1, iz) * u) * (1 - v) + (h(ix, iz + 1) * (1 - u) + h(ix + 1, iz + 1) * u) * v;
}
