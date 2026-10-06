// Quick layout sanity: length, curvature extremes, and the closest approach of
// two stretches of road that are far apart along the lap (overlap check).
import { Track } from '../src/sim/track.js';
import { TRACKS } from '../src/data/tracks/index.js';
for (const def of TRACKS) { const t = new Track(def); console.log('==', def.name);
console.log('length', t.length.toFixed(0), 'samples', t.samples.length);
let minR = Infinity;
for (const s of t.samples) minR = Math.min(minR, 1 / Math.max(Math.abs(s.curvature), 1e-6));
console.log('tightest radius', minR.toFixed(1));
let worst = Infinity, at = [0, 0];
for (let i = 0; i < t.samples.length; i += 2) for (let j = i + 60; j < t.samples.length; j += 2) {
  if (t.samples.length - (j - i) < 60) continue;
  const a = t.samples[i]!.p, b = t.samples[j]!.p;
  const d = Math.hypot(a.x - b.x, a.z - b.z);
  if (d < worst) { worst = d; at = [i, j]; }
}
console.log('closest separate stretches', worst.toFixed(1), 'm at s', at);
console.log('kickers', t.kickers.map(k => k.s0.toFixed(0)).join(' '), 'gaps', t.gaps.map(g => g.s0.toFixed(0)));
console.log('pickups', t.pickups.length, 'walls', t.walls.length);
}
// Inner-edge clearance: raw (unsmoothed) radius minus half width, worst spots.
for (const def of TRACKS) {
  const t = new Track(def);
  const n = t.samples.length;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = t.samples[(i - 3 + n) % n]!.p, b = t.samples[i]!.p, c = t.samples[(i + 3) % n]!.p;
    const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z), ca = Math.hypot(a.x - c.x, a.z - c.z);
    const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
    const r = area > 1e-6 ? (ab * bc * ca) / (4 * area) : Infinity;
    const clear = r - t.samples[i]!.halfWidth;
    if (clear < 6) out.push(`s${i}:r${r.toFixed(1)}/clear${clear.toFixed(1)}`);
  }
  console.log(def.name, 'inner clearance < 6 m:', out.filter((_, j) => j % 3 === 0).join(' ') || 'none');
}
