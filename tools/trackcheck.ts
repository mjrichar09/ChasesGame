// Quick layout sanity: length, curvature extremes, and the closest approach of
// two stretches of road that are far apart along the lap (overlap check).
import { Track } from '../src/sim/track.js';
import { VINE_VALLEY } from '../src/data/tracks/jungle1.js';
const t = new Track(VINE_VALLEY);
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
