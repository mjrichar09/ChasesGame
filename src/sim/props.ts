/**
 * Where the trees stand. The renderer draws them here and the race gives
 * each one a solid trunk (and leafy crown), so the tree you see is the tree
 * you hit — a parrot can't carry you through a palm.
 *
 * Placements are seeded, so every run (and every client) gets the same
 * forest.
 */

import { Rng } from './rng.js';
import { type Track, WALL_THICK } from './track.js';

/** One prop: position on the ground, turn about the vertical, and size. */
export interface Placement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  /** Height stretch (canopy trunks), 1 for the rest. */
  sy: number;
}

export type SceneryKind = 'palm' | 'tree' | 'fern' | 'bush' | 'rock' | 'flower';

/** A giant tree on the branches track: a trunk and a few crown clumps. */
export interface GiantTree {
  x: number;
  z: number;
  /** Top of the trunk, m. */
  top: number;
  r: number;
  crowns: { x: number; y: number; z: number; scale: number }[];
}

/** Something solid: a vertical cylinder or a ball. */
export type Solid =
  | { kind: 'trunk'; x: number; z: number; y0: number; y1: number; r: number }
  | { kind: 'ball'; x: number; y: number; z: number; r: number };

export interface Props {
  scenery: Record<SceneryKind, Placement[]>;
  /** Giant trunks holding up the canopy. */
  canopyTrunks: Placement[];
  giants: GiantTree[];
}

/** What a track grows (a slice of its look). */
export interface PropLook {
  scenery: number;
  canopy?: boolean;
  branches?: boolean;
}

const COUNTS: Record<SceneryKind, number> = { palm: 260, tree: 200, fern: 500, bush: 300, rock: 120, flower: 260 };
/** Band each kind sits in, metres beyond the road edge. */
const BANDS: Record<SceneryKind, [number, number]> = {
  palm: [3, 40], tree: [10, 120], fern: [1.6, 25], bush: [2, 50], rock: [2, 60], flower: [1.4, 12],
};

export function buildProps(track: Track, look: PropLook, heightAt: (x: number, z: number) => number): Props {
  return {
    scenery: look.scenery > 0 ? scenery(track, look.scenery, heightAt) : { palm: [], tree: [], fern: [], bush: [], rock: [], flower: [] },
    canopyTrunks: look.canopy ? canopyTrunks(track) : [],
    giants: look.branches ? giants(track) : [],
  };
}

function scenery(track: Track, density: number, heightAt: (x: number, z: number) => number): Record<SceneryKind, Placement[]> {
  const rng = new Rng(77);
  const out = {} as Record<SceneryKind, Placement[]>;
  for (const kind of Object.keys(COUNTS) as SceneryKind[]) {
    const list: Placement[] = [];
    let tries = 0;
    const want = Math.round(COUNTS[kind] * density);
    while (list.length < want && tries++ < want * 8) {
      const s = rng.range(0, track.length);
      const side = rng.next() < 0.5 ? -1 : 1;
      const k = track.at(s);
      const [lo, hi] = BANDS[kind];
      const off = k.halfWidth + WALL_THICK + lo + rng.next() ** 1.5 * (hi - lo);
      const p = track.pointAt(s, side * off);
      // Keep clear of every other stretch of road.
      const near = track.project({ x: p.x, y: p.y, z: p.z });
      if (Math.abs(near.lateral) < track.at(near.s).halfWidth + WALL_THICK + lo - 0.1) continue;
      const scale = rng.range(0.75, 1.3);
      const y = heightAt(p.x, p.z);
      // Nothing grows on the bare rock and ash near a summit.
      if (y > 70) continue;
      list.push({ x: p.x, y, z: p.z, yaw: rng.range(0, Math.PI * 2), scale, sy: 1 });
    }
    out[kind] = list;
  }
  return out;
}

function canopyTrunks(track: Track): Placement[] {
  const rng = new Rng(57);
  const out: Placement[] = [];
  for (let s = 0; s < track.length; s += 11) {
    for (const side of [-1, 1]) {
      const k = track.at(s);
      const p = track.pointAt(s + rng.range(-3, 3), side * (k.halfWidth + rng.range(4.5, 11)));
      const near = track.project({ x: p.x, y: p.y, z: p.z });
      if (Math.abs(near.lateral) < track.at(near.s).halfWidth + 3.5) continue;
      const scale = rng.range(0.8, 1.25);
      out.push({ x: p.x, y: -0.5, z: p.z, yaw: rng.range(0, Math.PI * 2), scale, sy: rng.range(0.85, 1.05) });
    }
  }
  return out;
}

/** A trunk at each end of every gap (the branches grow from them) and at intervals, off to the outside. */
function giants(track: Track): GiantTree[] {
  const rng = new Rng(71);
  const spots: Omit<GiantTree, 'crowns'>[] = [];
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
  return spots.map((t) => {
    const crowns = [];
    for (let c = 0; c < 6; c++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0, 7);
      const scale = rng.range(5, 8.5);
      crowns.push({ x: t.x + Math.cos(a) * d, y: t.top + rng.range(-1, 3), z: t.z + Math.sin(a) * d, scale });
    }
    return { ...t, crowns };
  });
}

/**
 * The solid parts, sized to the drawn models: trunks as cylinders, leafy
 * crowns as balls. Ferns, bushes, rocks and flowers stay soft.
 */
export function propSolids(props: Props): Solid[] {
  const out: Solid[] = [];
  for (const p of props.scenery.palm) {
    const sc = p.scale;
    out.push({ kind: 'trunk', x: p.x, z: p.z, y0: p.y, y1: p.y + 9 * sc, r: 0.32 * sc });
    // The frond tuft sits a little off the trunk (the palm leans).
    out.push({ kind: 'ball', x: p.x + Math.cos(p.yaw) * 0.6 * sc, y: p.y + 9.1 * sc, z: p.z - Math.sin(p.yaw) * 0.6 * sc, r: 1.5 * sc });
  }
  for (const p of props.scenery.tree) {
    const sc = p.scale;
    out.push({ kind: 'trunk', x: p.x, z: p.z, y0: p.y, y1: p.y + 6 * sc, r: 0.55 * sc });
    out.push({ kind: 'ball', x: p.x, y: p.y + 7.4 * sc, z: p.z, r: 2.9 * sc });
  }
  for (const p of props.canopyTrunks) {
    out.push({ kind: 'trunk', x: p.x, z: p.z, y0: p.y, y1: p.y + 16 * p.sy, r: 1.0 * p.scale });
  }
  for (const t of props.giants) {
    // A touch inside the drawn bark: the gap-end trunks stand right at the road's edge.
    out.push({ kind: 'trunk', x: t.x, z: t.z, y0: -0.5, y1: t.top, r: 0.9 * t.r });
    for (const c of t.crowns) out.push({ kind: 'ball', x: c.x, y: c.y, z: c.z, r: c.scale * 0.65 });
  }
  return out;
}

/**
 * Solids baked into one triangle mesh: trunks as octagonal prisms, crowns as
 * squashed-octagon "balls". One trimesh collider instead of hundreds of
 * shapes — Rapier's per-step cost grows with the collider count.
 */
export function solidsMesh(solids: Solid[]): { vertices: Float32Array; indices: Uint32Array } {
  const v: number[] = [];
  const idx: number[] = [];
  const N = 8;
  const ring = (cx: number, y: number, cz: number, r: number) => {
    const base = v.length / 3;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      v.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
    }
    return base;
  };
  const point = (x: number, y: number, z: number) => {
    v.push(x, y, z);
    return v.length / 3 - 1;
  };
  const band = (lo: number, hi: number) => {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      idx.push(lo + i, hi + i, lo + j, lo + j, hi + i, hi + j);
    }
  };
  const fan = (center: number, rim: number, up: boolean) => {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      if (up) idx.push(center, rim + j, rim + i);
      else idx.push(center, rim + i, rim + j);
    }
  };
  for (const s of solids) {
    if (s.kind === 'trunk') {
      const lo = ring(s.x, s.y0, s.z, s.r);
      const hi = ring(s.x, s.y1, s.z, s.r);
      band(lo, hi);
      fan(point(s.x, s.y1, s.z), hi, true);
      fan(point(s.x, s.y0, s.z), lo, false);
    } else {
      // Two rings at ±0.5r and caps: close enough to a ball for bumping into.
      const lo = ring(s.x, s.y - s.r * 0.5, s.z, s.r * 0.87);
      const hi = ring(s.x, s.y + s.r * 0.5, s.z, s.r * 0.87);
      band(lo, hi);
      fan(point(s.x, s.y + s.r, s.z), hi, true);
      fan(point(s.x, s.y - s.r, s.z), lo, false);
    }
  }
  return { vertices: new Float32Array(v), indices: new Uint32Array(idx) };
}
