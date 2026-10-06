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

export type FeatureDef = KickerDef | GapDef | StreamDef;

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
}

export interface Wall {
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
  readonly walls: Wall[] = [];
  readonly pickups: Pickup[] = [];
  /** `s` of each control point, before the start offset is applied. */
  private readonly pointS: number[];

  constructor(def: TrackDef) {
    this.def = def;
    const { samples, pointS } = buildSamples(def);
    this.samples = samples;
    this.pointS = pointS;
    this.length = samples.length * DS;

    for (const f of def.features) {
      const s = this.anchor(f);
      if (f.kind === 'stream') {
        this.waters.push({ s0: s - f.width / 2, s1: s + f.width / 2, skew: f.skew ?? 0 });
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
        this.pickups.push({ s, lateral, pos: add(this.pointAt(s, lateral), v3(0, 1.1, 0)) });
      }
    }
    this.buildWalls();
  }

  /** `s` of an anchor, measured from the start line. */
  anchor(a: TrackAnchor): number {
    return this.wrap((this.pointS[a.at] ?? 0) + (a.offset ?? 0));
  }

  wrap(s: number): number {
    const l = this.length;
    return ((s % l) + l) % l;
  }

  /** Interpolated sample at arc length `s`. */
  at(s: number): Sample {
    const w = this.wrap(s);
    const i = Math.floor(w / DS);
    const f = w / DS - i;
    const a = this.samples[i % this.samples.length]!;
    const b = this.samples[(i + 1) % this.samples.length]!;
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
    const span = this.wrap(b - a);
    return this.wrap(s - a) < span;
  }

  /** Signed forward distance from `a` to `b`, in (-L/2, L/2]. */
  delta(a: number, b: number): number {
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
      const k = this.samples[((i % n) + n) % n]!;
      const dx = pos.x - k.p.x;
      const dz = pos.z - k.p.z;
      const dy = (pos.y - k.p.y) * 0.5;
      const d = dx * dx + dz * dz + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = ((i % n) + n) % n;
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
        if (!this.inGap(s) && !this.inGap(next)) {
          const a = this.pointAt(s, side * (k.halfWidth + WALL_THICK / 2));
          const b = this.pointAt(next, side * (this.at(next).halfWidth + WALL_THICK / 2));
          const mid = scale(add(a, b), 0.5);
          const d = sub(b, a);
          const len = Math.hypot(d.x, d.z);
          this.walls.push({
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
    for (let i = 0; i < n; i++) {
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
        if (top0.y < 0.05 && top1.y < 0.05) continue;
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
          const base = this.pointAt(s, k.lateral + side * k.halfWidth);
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
function relaxTightCorners(raw: { p: Vec3; w: number }[]): void {
  const n = raw.length;
  const radius = (i: number): number => {
    const a = raw[(i - 3 + n) % n]!.p;
    const b = raw[i]!.p;
    const c = raw[(i + 3) % n]!.p;
    const ab = Math.hypot(b.x - a.x, b.z - a.z);
    const bc = Math.hypot(c.x - b.x, c.z - b.z);
    const ca = Math.hypot(a.x - c.x, a.z - c.z);
    const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
    return area > 1e-9 ? (ab * bc * ca) / (4 * area) : Infinity;
  };
  for (let pass = 0; pass < 400; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      if (radius(i) >= raw[i]!.w / 2 + MIN_INNER_RADIUS) continue;
      // Ease a small neighbourhood so the fix spreads rather than kinking.
      for (let k = -2; k <= 2; k++) {
        const j = (i + k + n) % n;
        const prev = raw[(j - 1 + n) % n]!.p;
        const next = raw[(j + 1) % n]!.p;
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
  const get = <T>(arr: T[], i: number) => arr[((i % n) + n) % n]!;

  // Dense polyline with cumulative length, starting at the start point.
  const dense: { p: Vec3; w: number }[] = [];
  const densePointIndex: number[] = [];
  const SUB = 60;
  for (let k = 0; k < n; k++) {
    const i = def.start + k;
    densePointIndex.push(dense.length);
    for (let j = 0; j < SUB; j++) {
      const t = j / SUB;
      dense.push({
        p: catmull(get(pts, i - 1), get(pts, i), get(pts, i + 1), get(pts, i + 2), t),
        w: get(widths, i) + (get(widths, i + 1) - get(widths, i)) * (t * t * (3 - 2 * t)),
      });
    }
  }
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    cum.push(cum[i - 1]! + length(sub(dense[i % dense.length]!.p, dense[i - 1]!.p)));
  }
  const total = cum[dense.length]!;
  const count = Math.round(total / DS);
  const scaleS = total / count;

  const pointS: number[] = new Array(n).fill(0);
  densePointIndex.forEach((di, k) => {
    pointS[(def.start + k) % n] = (cum[di]! / total) * count * DS;
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
  relaxTightCorners(raw);

  const up = v3(0, 1, 0);
  const tangents = raw.map((_, i) => normalize(sub(raw[(i + 1) % count]!.p, raw[(i - 1 + count) % count]!.p)));
  const curv = tangents.map((t, i) => {
    const t2 = tangents[(i + 1) % count]!;
    const h1 = normalize(v3(t.x, 0, t.z));
    const h2 = normalize(v3(t2.x, 0, t2.z));
    return cross(h1, h2).y / DS;
  });
  // Smooth curvature so the bank eases in rather than snapping.
  const smooth = curv.map((_, i) => {
    let sum = 0;
    const R = 8;
    for (let k = -R; k <= R; k++) sum += curv[(i + k + count) % count]!;
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
