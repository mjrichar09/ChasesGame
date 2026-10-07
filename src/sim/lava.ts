/**
 * The lava front on an escape track.
 *
 * Lava pours out of the crater a moment after GO and chases the field down
 * the road: it starts slow, accelerates to a pace a little under a clean
 * kart's, and never stops. Its front is a single number, `s` along the road;
 * anything behind it that is not in the air is gone (a DNF).
 *
 * Pure function of race time, so a race still replays exactly.
 */

import type { TrackDef } from './track.js';

/** Front position along the road, m, at `raceTime` seconds after GO. */
export function lavaFront(def: TrackDef, startS: number, raceTime: number): number {
  const l = def.lava;
  if (!l) return -Infinity;
  const t = Math.max(0, raceTime - l.delay);
  const tMax = (l.speedMax - l.speed0) / l.accel;
  const run =
    t < tMax
      ? l.speed0 * t + 0.5 * l.accel * t * t
      : l.speed0 * tMax + 0.5 * l.accel * tMax * tMax + l.speedMax * (t - tMax);
  return startS - l.startBehind + run;
}

/** Front speed, m/s, at `raceTime` (for the HUD's "how fast is it coming"). */
export function lavaSpeed(def: TrackDef, raceTime: number): number {
  const l = def.lava;
  if (!l) return 0;
  const t = Math.max(0, raceTime - l.delay);
  return raceTime < l.delay ? 0 : Math.min(l.speedMax, l.speed0 + l.accel * t);
}
