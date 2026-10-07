/**
 * A closed-loop circuit, built from a handful of control points.
 *
 * The control points go through a centripetal Catmull-Rom spline and come out
 * as a table of samples one metre apart. Everything downstream works in
 * that table's coordinate, `s` (metres along the centreline): lap progress,
 * the AI's racing line, pickup rows, respawns, and the geometry both the
 * physics and the renderer build from. One table, so the road the player sees
 * and the road the kart drives on cannot disagree.
 *
 * Corners bank automatically from their curvature — outside edge up — which is
 * most of what makes a twisty kart track feel fast rather than fiddly.
 */

import type { TrackEventDef } from './events.js';
import { type Vec3, add, clamp, cross, dot, length, normalize, scale, sub, v3 } from './math.js';

export interface TrackPoint {
  x: number;
  z: number;
  /** Road height, m. */
  y: number;
  /** Road width, m. Defaults to the track's width. */
  width?: number;
}

/** Where a feature sits: `offset` metres past control point `at`. */
export interface TrackAnchor {
  at: number;
  offset?: number;
}

export interface KickerDef extends TrackAnchor {
  kind: 'kicker';
  /** Ramp length along the road, m. */
  length: number;
  /** Lip height, m. */
  height: number;
  /** Centre of the ramp across the road (+ = right), m. */
  lateral?: number;
  /** Ramp width, m. Defaults to the full road. */
  width?: number;
}

export interface GapDef extends TrackAnchor {
  kind: 'gap';
  /** Length of the missing road, m. A full-width kicker leads into it. */
  length: number;
  rampLength: number;
  rampHeight: number;
}

/** A shallow stream running across the road: drivable, but it drags and loosens grip. */
export interface StreamDef extends TrackAnchor {
  kind: 'stream';
  /** Width of the water along the road, m. */
  width: number;
  /** Angle the stream crosses at, rad from square-on (for the renderer). */
  skew?: number;
}

/** A stretch with no barrier — on one side (−1 left, 1 right) or both (0). Fall off and you respawn. */
export interface OpenDef extends TrackAnchor {
  kind: 'open';
  length: number;
  side?: -1 | 0 | 1;
}

export type FeatureDef = KickerDef | GapDef | StreamDef | OpenDef;

export interface PickupRowDef extends TrackAnchor {
  /** Lateral positions across the road, m (+ = right). */
  lanes: number[];
}

export interface TrackDef {
  id: string;
  name: string;
  width: number;
  points: TrackPoint[];
  /** Control point index the start/finish line sits on. */
  start: number;
  features: FeatureDef[];
  pickups: PickupRowDef[];
  /**
   * Raised high in the air (branches): no banks down to the ground under the
   * road edges — there is nothing under you but a long drop.
   */
  elevated?: boolean;
  /**
   * Point to point instead of a loop. The road runs from the first control
   * point to the last; the start line sits `startOffset` metres in (the grid
   * fills the road behind it) and the finish `finishOffset` from the end.
   */
  open?: { startOffset: number; finishOffset: number };
  /** Lava chases the field down an open track (see sim/lava.ts). */
  lava?: { startBehind: number; delay: number; speed0: number; speedMax: number; accel: number };
  /** Things that happen to the track mid-race (see sim/events.ts). */
  events?: TrackEventDef[];
  /** Ground shaped by a height function (a mountainside), not a flat floor. */
  terrain?: { height: (x: number, z: number) => number; margin: number; spacing: number };
}

export interface Sample {
  s: number;
  p: Vec3;
  /** Unit tangent (follows the slope). */
  t: Vec3;
  /** Unit right across the road, tilted by the bank. */
  r: Vec3;
  /** Road surface normal. */
  n: Vec3;
  halfWidth: number;
  /** Signed horizontal curvature, 1/m: + = turning left. */
  curvature: number;
  /** False over a gap. */
  road: boolean;
}

export interface Kicker {
  s0: number;
  s1: number;
  height: number;
  lateral: number;
  halfWidth: number;
}

export interface Gap {
  s0: number;
  s1: number;
}

export interface Water {
  s0: number;
  s1: number;
  skew: number;
  /** The width it was built with; floods grow `s0`/`s1` from it. */
  base: [number, number];
}

export interface Wall {
  /** Where along the road this barrier segment starts. */
  s: number;
  /** Centre, half extents and yaw of a cuboid along the road edge. */
  center: Vec3;
  half: Vec3;
  yaw: number;
  side: -1 | 1;
}

export interface Pickup {
  s: number;
  lateral: number;
  pos: Vec3;
}

/**
 * A branch's cross-section is a superellipse |x/a|^n + |y/b|^n = 1 sized to
 * the road: a little wider than the road, a bit less tall than wide. The top
 * of it is the road; the rest is drawn as the branch.
 */
export const BRANCH_N = 6;
export function branchProfile(halfWidth: number): { a: number; b: number } {
  return { a: halfWidth * 1.22, b: halfWidth * 0.6 };
}

/** Metres between samples. */
export const DS = 1;
const MAX_BANK = 0.28;
/** Bank per unit curvature (rad · m). */
const BANK_GAIN = 9;
/** Visible log height, m. */
export const WALL_HEIGHT = 1.1;
/** Collision height, m — taller than the logs so a bouncing kart cannot hop them. */
export const WALL_SOLID_HEIGHT = 1.6;
export const WALL_THICK = 0.6;

export class Track {
  readonly def: TrackDef;
  readonly samples: Sample[];
  readonly length: number;
  readonly kickers: Kicker[] = [];
  readonly gaps: Gap[] = [];
  readonly waters: Water[] = [];
  /** Stretches with no barrier on a side. */
  readonly opens: { s0: number; s1: number; side: -1 | 0 | 1 }[] = [];
  readonly walls: Wall[] = [];
  readonly pickups: Pickup[] = [];
  /** Stretches of half-road choked by a fallen tree's crown (set mid-race). */
  readonly brush: { s0: number; s1: number; side: -1 | 1 }[] = [];
  /** `s` of each control point, before the start offset is applied. */
  private readonly pointS: number[];
  /** A loop (laps) or point to point. */
  readonly closed: boolean;
  /** Where the race starts and finishes, in `s`. A loop starts and ends at 0. */
  readonly startS: number;
  readonly finishS: number;

  constructor(def: TrackDef) {
    this.def = def;
    this.closed = !def.open;
    const { samples, pointS } = buildSamples(def);
    this.samples = samples;
    this.pointS = pointS;
    this.length = samples.length * DS;
    this.startS = def.open ? def.open.startOffset : 0;
    this.finishS = def.open ? this.length - def.open.finishOffset : this.length;

    for (const f of def.features) {
      const s = this.anchor(f);
      if (f.kind === 'open') {
        this.opens.push({ s0: s, s1: s + f.length, side: f.side ?? 0 });
        continue;
      }
      if (f.kind === 'stream') {
        this.waters.push({ s0: s - f.width / 2, s1: s + f.width / 2, skew: f.skew ?? 0, base: [s - f.width / 2, s + f.width / 2] });
      } else if (f.kind === 'kicker') {
        const hw = (f.width ?? def.width) / 2;
        this.kickers.push({ s0: s, s1: s + f.length, height: f.height, lateral: f.lateral ?? 0, halfWidth: hw });
      } else {
        // The take-off ramp ends where the road does.
        this.kickers.push({ s0: s - f.rampLength, s1: s, height: f.rampHeight, lateral: 0, halfWidth: def.width / 2 });
        this.gaps.push({ s0: s, s1: s + f.length });
      }
    }
    for (const sample of this.samples) sample.road = !this.inGap(sample.s);

    for (const row of def.pickups) {
      const s = this.anchor(row);
      for (const lateral of row.lanes) {
        this.pickups.push({ s, lateral, pos: add(this.pointAt(s, lateral), v3(0, 1.1 - this.surfaceDrop(lateral), 0)) });
      }
    }
    this.buildWalls();
  }

  /** `s` of an anchor, measured from the start line. */
  anchor(a: TrackAnchor): number {
    return this.wrap((this.pointS[a.at] ?? 0) + (a.offset ?? 0));
  }

  /** Onto the road: round the loop, or clamped to the ends of an open track. */
  wrap(s: number): number {
    const l = this.length;
    if (!this.closed) return clamp(s, 0, l - 1e-6);
    return ((s % l) + l) % l;
  }

  /** A sample index, wrapped on a loop or clamped on an open track. */
  private idx(i: number): number {
    const n = this.samples.length;
    return this.closed ? ((i % n) + n) % n : clamp(i, 0, n - 1);
  }

  /** Interpolated sample at arc length `s`. */
  at(s: number): Sample {
    const w = this.wrap(s);
    const i = Math.floor(w / DS);
    const f = w / DS - i;
    const a = this.samples[this.idx(i)]!;
    const b = this.samples[this.idx(i + 1)]!;
    const mix = (u: Vec3, v: Vec3) => v3(u.x + (v.x - u.x) * f, u.y + (v.y - u.y) * f, u.z + (v.z - u.z) * f);
    return {
      s: w,
      p: mix(a.p, b.p),
      t: normalize(mix(a.t, b.t)),
      r: normalize(mix(a.r, b.r)),
      n: normalize(mix(a.n, b.n)),
      halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * f,
      curvature: a.curvature + (b.curvature - a.curvature) * f,
      road: a.road && b.road,
    };
  }

  /** World position on the road surface at `s`, `lateral` metres right of centre. */
  pointAt(s: number, lateral: number): Vec3 {
    const k = this.at(s);
    return add(k.p, scale(k.r, lateral));
  }

  /**
   * How far the road surface drops below the centreline at `lateral` metres
   * from it. Flat (0) on ordinary tracks. On branches the road is the top of
   * a rounded cross-section — a superellipse — so it falls away toward the
   * edges and you can feel you are driving on top of a branch.
   */
  surfaceDrop(lateral: number, halfWidth = this.def.width / 2): number {
    if (!this.def.elevated) return 0;
    const { a, b } = branchProfile(halfWidth);
    const u = Math.min(1, Math.abs(lateral) / a);
    return b - b * Math.pow(1 - Math.pow(u, BRANCH_N), 1 / BRANCH_N);
  }

  /** True where the barrier on `side` is missing. */
  isOpen(s: number, side: -1 | 1): boolean {
    const w = this.wrap(s);
    return this.opens.some((o) => (o.side === 0 || o.side === side) && this.between(w, o.s0, o.s1));
  }

  /** True where (s, lateral) is inside a fallen tree's crown. */
  inBrush(s: number, lateral: number): boolean {
    return this.brush.some((b) => this.between(this.wrap(s), b.s0, b.s1) && lateral * b.side > -1);
  }

  /** Stretches that will snap mid-race: the renderer draws them as separate pieces. */
  snapRanges(): { s0: number; s1: number; ramp: [number, number] }[] {
    return (this.def.events ?? [])
      .filter((e) => e.kind === 'snap')
      .map((e) => {
        const s = this.anchor(e as TrackAnchor);
        const f = e as { rampLength: number; length: number };
        return { s0: s + f.rampLength, s1: s + f.rampLength + f.length, ramp: [s, s + f.rampLength] as [number, number] };
      });
  }

  inWater(s: number): boolean {
    const w = this.wrap(s);
    return this.waters.some((r) => this.between(w, r.s0, r.s1));
  }

  inGap(s: number): boolean {
    const w = this.wrap(s);
    return this.gaps.some((g) => this.between(w, g.s0, g.s1));
  }

  /** True when `s` lies in [a, b) going forward, allowing for the wrap. */
  between(s: number, a: number, b: number): boolean {
    if (!this.closed) return s >= a && s < b;
    const span = this.wrap(b - a);
    return this.wrap(s - a) < span;
  }

  /** Signed forward distance from `a` to `b`, in (-L/2, L/2] on a loop. */
  delta(a: number, b: number): number {
    if (!this.closed) return b - a;
    let d = this.wrap(b - a);
    if (d > this.length / 2) d -= this.length;
    return d;
  }

  /**
   * Project a world position onto the centreline, searching near `hint` (the
   * last known `s`) so a lap of overlapping-in-plan road never jumps sections.
   * Pass `hint < 0` for a full search.
   */
  project(pos: Vec3, hint = -1): { s: number; lateral: number; height: number } {
    const n = this.samples.length;
    let best = 0;
    let bestD = Infinity;
    const scan = (i: number) => {
      const k = this.samples[this.idx(i)]!;
      const dx = pos.x - k.p.x;
      const dz = pos.z - k.p.z;
      const dy = (pos.y - k.p.y) * 0.5;
      const d = dx * dx + dz * dz + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = this.idx(i);
      }
    };
    if (hint < 0) for (let i = 0; i < n; i++) scan(i);
    else {
      const c = Math.round(hint / DS);
      for (let i = c - 40; i <= c + 40; i++) scan(i);
    }
    // Refine within the neighbouring segment.
    const k = this.samples[best]!;
    const along = dot(sub(pos, k.p), k.t);
    const s = this.wrap(best * DS + clamp(along, -DS, DS));
    const fine = this.at(s);
    const rel = sub(pos, fine.p);
    return { s, lateral: dot(rel, fine.r), height: dot(rel, fine.n) };
  }

  /** Height of the kicker surface above the road at (s, lateral), 0 off-ramp. */
  kickerHeight(s: number, lateral: number): number {
    let h = 0;
    for (const k of this.kickers) {
      if (!this.between(s, k.s0, k.s1)) continue;
      if (Math.abs(lateral - k.lateral) > k.halfWidth) continue;
      const f = this.wrap(s - k.s0) / this.wrap(k.s1 - k.s0);
      h = Math.max(h, k.height * f);
    }
    return h;
  }

  /**
   * Low barriers along both edges — logs in the render — broken at gaps.
   *
   * Each barrier is a run of straight boxes. On the inside of a tight corner a
   * 4 m box is a chord that cuts across the road (a hairpin's inner edge can
   * have a radius under a metre), so segments shrink there to follow the curve.
   */
  private buildWalls(): void {
    for (const side of [-1, 1] as const) {
      let s = 0;
      while (s < this.length) {
        const k = this.at(s);
        // + curvature turns left, so the left (-1) side is the inside.
        const inside = Math.sign(k.curvature) === -side;
        const innerR = 1 / Math.max(Math.abs(k.curvature), 1e-4) - k.halfWidth;
        const seg = inside ? clamp(innerR * 0.5, 0.5, 4) : 4;
        const next = s + seg;
        if (!this.inGap(s) && !this.inGap(next) && !this.isOpen(s, side) && !this.isOpen(next, side)) {
          const latA = side * (k.halfWidth + WALL_THICK / 2);
          const latB = side * (this.at(next).halfWidth + WALL_THICK / 2);
          const a = add(this.pointAt(s, latA), v3(0, -this.surfaceDrop(latA, k.halfWidth), 0));
          const b = add(this.pointAt(next, latB), v3(0, -this.surfaceDrop(latB, this.at(next).halfWidth), 0));
          const mid = scale(add(a, b), 0.5);
          const d = sub(b, a);
          const len = Math.hypot(d.x, d.z);
          this.walls.push({
            s,
            center: add(mid, v3(0, WALL_SOLID_HEIGHT / 2 - 0.15, 0)),
            // A little overlap so there are no seams to snag on.
            half: v3(WALL_THICK / 2, WALL_SOLID_HEIGHT / 2 + 0.15, len / 2 + Math.min(0.3, seg * 0.1)),
            yaw: Math.atan2(d.x, d.z),
            side,
          });
        }
        s = next;
      }
    }
  }

  /**
   * The road as a triangle mesh: top surface (kickers excluded — they are their
   * own solids) plus skirts down to the ground so a raised section reads as an
   * embankment rather than a floating ribbon.
   */
  roadMesh(): { vertices: Float32Array; indices: Uint32Array } {
    const verts: number[] = [];
    const idx: number[] = [];
    const n = this.samples.length;
    const push = (v: Vec3) => {
      verts.push(v.x, v.y, v.z);
      return verts.length / 3 - 1;
    };
    if (this.def.elevated) return this.crownedMesh();
    for (let i = 0; i < (this.closed ? n : n - 1); i++) {
      const a = this.samples[i]!;
      const b = this.samples[(i + 1) % n]!;
      if (!a.road || !b.road) continue;
      const al = add(a.p, scale(a.r, -a.halfWidth - WALL_THICK));
      const ar = add(a.p, scale(a.r, a.halfWidth + WALL_THICK));
      const bl = add(b.p, scale(b.r, -b.halfWidth - WALL_THICK));
      const br = add(b.p, scale(b.r, b.halfWidth + WALL_THICK));
      const i0 = push(al);
      const i1 = push(ar);
      const i2 = push(bl);
      const i3 = push(br);
      // Wound so the face normal points up (right is -X when facing +Z).
      idx.push(i0, i1, i2, i1, i3, i2);
      // Skirts to the ground.
      for (const [top0, top1, flip] of [
        [al, bl, false],
        [ar, br, true],
      ] as const) {
        if (this.def.elevated || this.def.terrain || (top0.y < 0.05 && top1.y < 0.05)) continue;
        const j0 = push(top0);
        const j1 = push(top1);
        const j2 = push(v3(top0.x, -0.5, top0.z));
        const j3 = push(v3(top1.x, -0.5, top1.z));
        // Facing outward from the road.
        if (flip) idx.push(j0, j2, j1, j1, j2, j3);
        else idx.push(j0, j1, j2, j1, j3, j2);
      }
    }
    return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
  }

  /** The road of a branch track: crowned across, no skirts. */
  private crownedMesh(): { vertices: Float32Array; indices: Uint32Array } {
    const COLS = 10;
    const verts: number[] = [];
    const idx: number[] = [];
    const n = this.samples.length;
    const row = (k: Sample) => {
      const start = verts.length / 3;
      const edge = k.halfWidth + WALL_THICK;
      for (let j = 0; j <= COLS; j++) {
        const lat = -edge + (2 * edge * j) / COLS;
        const p = add(k.p, scale(k.r, lat));
        verts.push(p.x, p.y - this.surfaceDrop(lat, k.halfWidth), p.z);
      }
      return start;
    };
    for (let i = 0; i < (this.closed ? n : n - 1); i++) {
      const a = this.samples[i]!;
      const b = this.samples[(i + 1) % n]!;
      if (!a.road || !b.road) continue;
      const ra = row(a);
      const rb = row(b);
      for (let j = 0; j < COLS; j++) {
        // Wound so the face normal points up (right is -X when facing +Z).
        idx.push(ra + j, ra + j + 1, rb + j, ra + j + 1, rb + j + 1, rb + j);
      }
    }
    return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
  }

  /** Each kicker as a convex point cloud (a wedge sitting on the road). */
  kickerHulls(): Float32Array[] {
    return this.kickers.map((k) => {
      const pts: number[] = [];
      const steps = 4;
      const span = this.wrap(k.s1 - k.s0);
      for (let i = 0; i <= steps; i++) {
        const s = k.s0 + (span * i) / steps;
        const h = (k.height * i) / steps;
        const smp = this.at(s);
        for (const side of [-1, 1]) {
          const lat = k.lateral + side * k.halfWidth;
          const base = add(this.pointAt(s, lat), v3(0, -this.surfaceDrop(lat, smp.halfWidth), 0));
          // Sink the base a little so the ramp's leading edge is flush, not a step.
          pts.push(base.x - smp.n.x * 0.15, base.y - smp.n.y * 0.15, base.z - smp.n.z * 0.15);
          pts.push(base.x + smp.n.x * h, base.y + smp.n.y * h, base.z + smp.n.z * h);
        }
      }
      // The back face drops vertically to the road at the lip.
      return new Float32Array(pts);
    });
  }
}

/** Inside-edge clearance every corner keeps, m. */
const MIN_INNER_RADIUS = 2.5;

/**
 * Round off any corner tighter than the road can take.
 *
 * Where the centreline radius drops below half the road width, the road's
 * inside edge folds back on itself: the barrier boxes there end up poking
 * across the road and karts jam on them. A sharp apex in the control points
 * (or a spline overshooting one) does exactly that, so rather than trusting
 * every track's points, the samples are relaxed — each too-tight sample eased
 * toward its neighbours' midpoint — until the radius everywhere is at least
 * half the width plus `MIN_INNER_RADIUS`. Heights are left alone.
 */
function relaxTightCorners(raw: { p: Vec3; w: number }[], closed: boolean): void {
  const n = raw.length;
  const at = (i: number) => raw[closed ? ((i % n) + n) % n : clamp(i, 0, n - 1)]!;
  const radius = (i: number): number => {
    const a = at(i - 3).p;
    const b = raw[i]!.p;
    const c = at(i + 3).p;
    const ab = Math.hypot(b.x - a.x, b.z - a.z);
    const bc = Math.hypot(c.x - b.x, c.z - b.z);
    const ca = Math.hypot(a.x - c.x, a.z - c.z);
    const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
    return area > 1e-9 ? (ab * bc * ca) / (4 * area) : Infinity;
  };
  for (let pass = 0; pass < 400; pass++) {
    let moved = false;
    for (let i = closed ? 0 : 4; i < (closed ? n : n - 4); i++) {
      if (radius(i) >= raw[i]!.w / 2 + MIN_INNER_RADIUS) continue;
      // Ease a small neighbourhood so the fix spreads rather than kinking.
      for (let k = -2; k <= 2; k++) {
        const j = closed ? (i + k + n) % n : clamp(i + k, 1, n - 2);
        const prev = at(j - 1).p;
        const next = at(j + 1).p;
        const p = raw[j]!.p;
        const w = 0.35 * (1 - Math.abs(k) * 0.3);
        p.x += ((prev.x + next.x) / 2 - p.x) * w;
        p.z += ((prev.z + next.z) / 2 - p.z) * w;
      }
      moved = true;
    }
    if (!moved) break;
  }
}

/** Centripetal Catmull-Rom between p1 and p2. */
function catmull(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const alpha = 0.5;
  const tj = (ti: number, a: Vec3, b: Vec3) => ti + Math.pow(Math.max(length(sub(b, a)), 1e-4), alpha);
  const t0 = 0;
  const t1 = tj(t0, p0, p1);
  const t2 = tj(t1, p1, p2);
  const t3 = tj(t2, p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerpP = (a: Vec3, b: Vec3, ta: number, tb: number) =>
    add(scale(a, (tb - u) / (tb - ta)), scale(b, (u - ta) / (tb - ta)));
  const a1 = lerpP(p0, p1, t0, t1);
  const a2 = lerpP(p1, p2, t1, t2);
  const a3 = lerpP(p2, p3, t2, t3);
  const b1 = lerpP(a1, a2, t0, t2);
  const b2 = lerpP(a2, a3, t1, t3);
  return lerpP(b1, b2, t1, t2);
}

function buildSamples(def: TrackDef): { samples: Sample[]; pointS: number[] } {
  const pts = def.points.map((p) => v3(p.x, p.y, p.z));
  const widths = def.points.map((p) => p.width ?? def.width);
  const n = pts.length;
  const closed = !def.open;
  const get = <T>(arr: T[], i: number) => arr[closed ? ((i % n) + n) % n : clamp(i, 0, n - 1)]!;

  // Dense polyline with cumulative length, starting at the start point.
  const dense: { p: Vec3; w: number }[] = [];
  const densePointIndex: number[] = [];
  const SUB = 60;
  // A loop has a segment per point (the last closes back to the first); an
  // open road runs point 0 to the last, then ends on that point.
  const first = closed ? def.start : 0;
  const segments = closed ? n : n - 1;
  for (let k = 0; k < segments; k++) {
    const i = first + k;
    densePointIndex.push(dense.length);
    for (let j = 0; j < SUB; j++) {
      const t = j / SUB;
      dense.push({
        p: catmull(get(pts, i - 1), get(pts, i), get(pts, i + 1), get(pts, i + 2), t),
        w: get(widths, i) + (get(widths, i + 1) - get(widths, i)) * (t * t * (3 - 2 * t)),
      });
    }
  }
  if (!closed) {
    densePointIndex.push(dense.length);
    dense.push({ p: pts[n - 1]!, w: widths[n - 1]! });
  }
  const cum = [0];
  const ends = closed ? dense.length : dense.length - 1;
  for (let i = 1; i <= ends; i++) {
    cum.push(cum[i - 1]! + length(sub(dense[i % dense.length]!.p, dense[i - 1]!.p)));
  }
  const total = cum[ends]!;
  const count = Math.round(total / DS);
  const scaleS = total / count;

  const pointS: number[] = new Array(n).fill(0);
  densePointIndex.forEach((di, k) => {
    pointS[(first + k) % n] = (cum[di]! / total) * count * DS;
  });

  // Resample at uniform arc length.
  const raw: { p: Vec3; w: number }[] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const target = i * scaleS;
    while (cum[j + 1]! < target) j++;
    const f = (target - cum[j]!) / (cum[j + 1]! - cum[j]! || 1);
    const a = dense[j]!;
    const b = dense[(j + 1) % dense.length]!;
    raw.push({ p: add(a.p, scale(sub(b.p, a.p), f)), w: a.w + (b.w - a.w) * f });
  }
  relaxTightCorners(raw, !def.open);

  const up = v3(0, 1, 0);
  const wrapI = (i: number) => (closed ? ((i % count) + count) % count : clamp(i, 0, count - 1));
  const tangents = raw.map((_, i) => normalize(sub(raw[wrapI(i + 1)]!.p, raw[wrapI(i - 1)]!.p)));
  const curv = tangents.map((t, i) => {
    const t2 = tangents[wrapI(i + 1)]!;
    const h1 = normalize(v3(t.x, 0, t.z));
    const h2 = normalize(v3(t2.x, 0, t2.z));
    return cross(h1, h2).y / DS;
  });
  // Smooth curvature so the bank eases in rather than snapping.
  const smooth = curv.map((_, i) => {
    let sum = 0;
    const R = 8;
    for (let k = -R; k <= R; k++) sum += curv[wrapI(i + k)]!;
    return sum / (2 * R + 1);
  });

  const samples: Sample[] = raw.map((r, i) => {
    const t = tangents[i]!;
    const flatRight = normalize(cross(t, up));
    // Left turn (+k): right edge rises, i.e. the outside of the corner is up.
    const bank = clamp(smooth[i]! * BANK_GAIN, -MAX_BANK, MAX_BANK);
    const right = normalize(add(scale(flatRight, Math.cos(bank)), scale(up, Math.sin(bank))));
    return {
      s: i * DS,
      p: r.p,
      t,
      r: right,
      n: normalize(cross(right, t)),
      halfWidth: r.w / 2,
      curvature: smooth[i]!,
      road: true,
    };
  });
  return { samples, pointS };
}
