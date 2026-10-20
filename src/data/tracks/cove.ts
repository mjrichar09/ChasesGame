/**
 * Coconut Cove — the fifth circuit, and the one that goes up and down.
 *
 * From a grid on the west cliffs the road climbs through the jungle to a
 * ridge 30-odd metres up, then leaps off it: three treetop platforms in a row,
 * each a drop below the last, standing over a valley of giant trees. Off the
 * last one it swoops down a headland, over a dune jump, onto the sand — and
 * round the curve of a little cove, waves washing across the road — before
 * climbing the cliffs back to the start.
 *
 * The land is a height function (shared by the physics ground and the
 * renderer): hills rising to the north-east, the valley under the treetops,
 * and the cove, a round bay opening south to the sea.
 */
import type { TrackDef } from '../../sim/track.js';

/** Centre and radius of the cove (the beach road runs round its north rim). */
export const COVE = { x: 10, z: -185, r: 85 };

const smooth = (e0: number, e1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Distance from (x, z) to the segment a–b. */
function toSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** The land: hills to the north-east, the treetop valley, the cove and the sea. */
export function coveHeight(x: number, z: number): number {
  // Rising gently inland (north), with a broad hill under the ridge.
  let h = 3 + 0.16 * Math.min(200, Math.max(0, z + 110));
  h += 12 * Math.exp(-((x - 110) ** 2 + (z - 105) ** 2) / (2 * 70 * 70));
  // Rolling lumps so the slopes are not one smooth ramp.
  h += 1.6 * Math.sin(x * 0.045 + z * 0.02) * Math.sin(z * 0.05 - x * 0.012);
  // The valley of giant trees under the platforms: a jungle floor far below,
  // wide enough that the hills either side sit well under the treetops.
  const v = toSegment(x, z, 175, 45, 170, -90);
  h += (1 - h) * (1 - smooth(40, 120, v));
  // The cove and the open sea beyond it: sand at the waterline, then deep.
  const bay = Math.hypot(x - COVE.x, z - COVE.z);
  const sea = Math.max(1 - smooth(COVE.r - 20, COVE.r + 2, bay), 1 - smooth(-265, -225, z));
  const beach = 1 - smooth(COVE.r - 2, COVE.r + 24, bay);
  h += (1.2 - h) * beach * 0.9;
  return h + (-4 - h) * sea;
}

export const COCONUT_COVE: TrackDef = {
  id: 'coconut-cove',
  name: 'Coconut Cove',
  width: 13,
  start: 0,
  terrain: { height: coveHeight, margin: 140, spacing: 6 },
  points: [
    // West cliffs: the grid, climbing north.
    { x: -102, z: -10, y: 7 },
    { x: -92, z: 45, y: 10 },
    { x: -86, z: 94, y: 14.5 },
    { x: 0, z: 110, y: 19.5 },
    { x: 60, z: 124, y: 25 },
    // The ridge.
    { x: 115, z: 120, y: 31 },
    { x: 178, z: 106, y: 34 },
    { x: 172, z: 52, y: 34.5, width: 16 },
    // The treetops: three drops on the way down to the valley's far side.
    { x: 175, z: -12, y: 27.5, width: 16 },
    { x: 171, z: -76, y: 20.5, width: 15 },
    // Down the headland to the sand.
    { x: 168, z: -134, y: 11 },
    { x: 106, z: -132, y: 5 },
    // Round the cove's rim: the beach.
    { x: COVE.x + COVE.r * Math.cos(1.0), z: COVE.z + COVE.r * Math.sin(1.0), y: 1.5, width: 15 },
    { x: COVE.x, z: COVE.z + COVE.r, y: 1.3, width: 16 },
    { x: COVE.x + COVE.r * Math.cos(2.15), z: COVE.z + COVE.r * Math.sin(2.15), y: 1.5, width: 15 },
    // Up the west cliffs to the start.
    { x: -98, z: -112, y: 3.5 },
    { x: -112, z: -64, y: 5.5 },
  ],
  features: [
    // Jumps sit mid-road, clear of the edges: on a full-width ramp a kart
    // already out by the barrier sailed over it. Two on the climb (on the
    // ridge itself, the bend after the crest threw karts off).
    { kind: 'kicker', at: 3, offset: 8, length: 7, height: 1.1, width: 6 },
    { kind: 'kicker', at: 4, offset: 24, length: 6, height: 1.0, width: 6 },
    // The treetops: three platforms, a drop onto each. Railed — a shove or
    // a spin-out up there tipped karts off the side far too often.
    { kind: 'terraces', at: 7, offset: 2, length: 126, count: 3, gap: 0.8 },
    // A narrow switchback down the headland, then a dune to jump onto the beach.
    { kind: 'width', at: 10, offset: -20, length: 30, width: 10 },
    { kind: 'kicker', at: 11, offset: 4, length: 7, height: 1.3, width: 7 },
    // Waves wash across the sand in the middle of the cove. Skim them flat out.
    { kind: 'stream', at: 13, offset: 0, width: 10, skew: 0.35 },
    // A crest on the cliff climb.
    { kind: 'kicker', at: 16, offset: 10, length: 6, height: 1.0, width: 6 },
  ],
  pickups: [
    { at: 1, offset: 10, lanes: [-3.5, 0, 3.5] },
    { at: 4, offset: 0, lanes: [-3.5, 0, 3.5] },
    { at: 6, offset: 0, lanes: [-3.5, 0, 3.5] },
    // On the middle treetop, well past where karts land.
    { at: 8, offset: 8, lanes: [-4.5, 0, 4.5] },
    { at: 11, offset: 20, lanes: [-3.5, 0, 3.5] },
    { at: 14, offset: 10, lanes: [-3.5, 0, 3.5] },
  ],
};
