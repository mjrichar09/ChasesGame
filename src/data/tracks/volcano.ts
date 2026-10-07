/**
 * Lava Run — escape the erupting volcano.
 *
 * Point to point, top to bottom: the road starts just under the crater and
 * spirals down the mountain to the village on the shore, twisting through
 * switchback S-bends. Lava pours out of the crater a moment after GO and
 * chases the field all the way down; it is a little slower than a clean kart
 * but much faster than one that spins, falls or stops. Caught is out.
 *
 * The mountain is a height function (shared by the road's control points,
 * the physics ground and the renderer), so the road always sits on it.
 */
import type { TrackDef, TrackPoint } from '../../sim/track.js';

const PEAK = 150;
const CRATER = 42;

/** The volcano: a cone with a crater on top and ridges down its flanks. */
export function volcanoHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const a = Math.atan2(z, x);
  const flank = PEAK * Math.pow(Math.max(0, 1 - Math.max(0, r - CRATER) / 640), 1.25);
  const ridges = 3.2 * Math.sin(a * 7 + r * 0.025) * Math.min(1, r / 180) * Math.min(1, Math.max(0, (560 - r) / 120));
  const crater = r < CRATER ? -Math.pow(1 - r / CRATER, 0.7) * 28 : 0;
  return flank + ridges + crater - 0.5;
}

/** Where the road goes: spiralling outward (so always downhill) with S-bends. */
function route(): TrackPoint[] {
  // Angle and radius wiggles per point. Angle wiggles stay well under the
  // angle step so the road never doubles back; radius wiggles swing it in and
  // out across the slope, which is what makes the S-bends and tighter turns.
  const aw = [0, 0.02, -0.02, 0.06, -0.1, 0.08, -0.06, 0.1, -0.06, 0.05, -0.05, 0.06, -0.05, 0.05, -0.06, 0.05, -0.05, 0.06, -0.04, 0.05, 0, 0, 0];
  const rw = [0, 2, -3, 8, -12, 10, -8, 14, -18, 20, -22, 18, -20, 22, -18, 20, -22, 16, -14, 10, 0, 0, 0];
  const pts: TrackPoint[] = [];
  let th = 0.6;
  for (let i = 0; i < aw.length; i++) {
    // Big angle steps near the top, smaller and twistier lower down.
    if (i > 0) th += i <= 8 ? 0.3 : 0.15;
    const r = 80 + i * 19 + rw[i]!;
    const x = Math.cos(th + aw[i]!) * r;
    const z = Math.sin(th + aw[i]!) * r;
    pts.push({ x, z, y: volcanoHeight(x, z) + 0.6 });
  }
  return pts;
}

export const LAVA_RUN: TrackDef = {
  id: 'lava-run',
  name: 'Lava Run',
  width: 13,
  start: 0,
  open: { startOffset: 48, finishOffset: 45 },
  lava: { startBehind: 110, delay: 2, speed0: 8, speedMax: 15, accel: 0.5 },
  terrain: { height: volcanoHeight, margin: 150, spacing: 6 },
  points: route(),
  features: [
    { kind: 'kicker', at: 4, offset: 10, length: 7, height: 1.2 },
    { kind: 'kicker', at: 6, offset: 10, length: 6, height: 1.0, lateral: -3.5, width: 5 },
    { kind: 'kicker', at: 6, offset: 10, length: 6, height: 1.0, lateral: 3.5, width: 5 },
    // A lava fissure across the road: clear it or you are toast.
    { kind: 'gap', at: 10, offset: 30, length: 9, rampLength: 9, rampHeight: 1.8 },
    { kind: 'kicker', at: 12, offset: 22, length: 7, height: 1.3 },
    { kind: 'kicker', at: 16, offset: 24, length: 6, height: 1.1 },
    { kind: 'kicker', at: 19, offset: 10, length: 7, height: 1.2 },
  ],
  pickups: [
    { at: 1, offset: 30, lanes: [-4, 0, 4] },
    { at: 4, offset: 0, lanes: [-4.5, -1.5, 1.5, 4.5] },
    { at: 8, offset: 0, lanes: [-4, 0, 4] },
    { at: 12, offset: 0, lanes: [-4.5, -1.5, 1.5, 4.5] },
    { at: 15, offset: 10, lanes: [-4, 0, 4] },
    { at: 17, offset: 0, lanes: [-4.5, -1.5, 1.5, 4.5] },
    { at: 20, offset: 0, lanes: [-4, 0, 4] },
  ],
};
