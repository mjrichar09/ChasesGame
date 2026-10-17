import { describe, expect, it } from 'vitest';
import { TRACKS } from '../src/data/tracks/index.js';
import { Track, WALL_THICK } from '../src/sim/track.js';
import type { TrackDef } from '../src/sim/track.js';

/** Road layouts with narrow and wide stretches still have to fit together. */
describe.each(TRACKS.map((t) => [t.name, t] as const))('%s layout', (_name, def: TrackDef) => {
  const track = new Track(def);

  it('keeps every part-width ramp on the road', () => {
    for (const k of track.kickers) {
      if (k.full) continue;
      const span = track.wrap(k.s1 - k.s0);
      for (let d = 0; d <= span; d += 1) {
        const hw = track.at(k.s0 + d).halfWidth;
        expect(Math.abs(k.lateral) + k.halfWidth, `ramp at s ${k.s0.toFixed(0)}`).toBeLessThanOrEqual(hw + 0.01);
      }
    }
  });

  it('keeps every pickup on the road, clear of the barrier', () => {
    for (const p of track.pickups) {
      expect(Math.abs(p.lateral), `pickup at s ${p.s.toFixed(0)}`).toBeLessThanOrEqual(track.at(p.s).halfWidth - 1);
    }
  });

  it('never lets two separate stretches of road overlap', () => {
    const n = track.samples.length;
    let worst = Infinity;
    let where = '';
    for (let i = 0; i < n; i += 2) {
      for (let j = i + 80; j < n; j += 2) {
        if (track.closed && n - (j - i) < 80) continue;
        const a = track.samples[i]!;
        const b = track.samples[j]!;
        // Branches cross over and under each other: only the same level counts.
        if (Math.abs(a.p.y - b.p.y) > 4) continue;
        const gap = Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z) - a.halfWidth - b.halfWidth - 2 * WALL_THICK;
        if (gap < worst) {
          worst = gap;
          where = `s ${i} and ${j}`;
        }
      }
    }
    expect(worst, `closest edges at ${where}`).toBeGreaterThan(1);
  });

  it('varies its width: somewhere narrow, somewhere wide', () => {
    const widths = track.samples.map((s) => s.halfWidth * 2);
    const base = track.def.width;
    expect(Math.min(...widths)).toBeLessThan(base * 0.8);
    expect(Math.max(...widths)).toBeGreaterThan(base * 1.15);
  });
});
