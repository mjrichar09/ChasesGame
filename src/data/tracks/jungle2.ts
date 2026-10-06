/**
 * Canopy Creek — the second circuit.
 *
 * Down on the jungle floor under a full canopy. A stream wanders through the
 * middle of the course and the road fords it twice: fast in, slow through
 * the water, spray everywhere. Tighter than Vine Valley — a chicane, two
 * hairpins and a square turn all want the brakes — with kickers on the
 * straights between them.
 */
import type { TrackDef } from '../../sim/track.js';

/** Where the stream runs, for the renderer: a meandering line across the map. */
export const CANOPY_STREAM: { x: number; z: number }[] = [
  { x: 92, z: 260 },
  { x: 104, z: 170 },
  { x: 100, z: 112 },
  { x: 88, z: 40 },
  { x: 104, z: -30 },
  { x: 100, z: -78 },
  { x: 110, z: -160 },
  { x: 98, z: -260 },
];

export const CANOPY_CREEK: TrackDef = {
  id: 'canopy-creek',
  name: 'Canopy Creek',
  width: 14,
  start: 1,
  points: [
    { x: 0, z: -45, y: 1 },
    { x: 0, z: 30, y: 1 },
    { x: 0, z: 82, y: 1.5 },
    { x: 18, z: 110, y: 1 },
    { x: 60, z: 114, y: 0 },
    { x: 100, z: 112, y: -0.45 },
    { x: 140, z: 116, y: 0.5 },
    { x: 178, z: 104, y: 2 },
    { x: 190, z: 70, y: 2.5, width: 12 },
    { x: 174, z: 49, y: 2.5, width: 12 },
    { x: 190, z: 28, y: 2.5, width: 12 },
    { x: 196, z: -20, y: 3 },
    { x: 182, z: -62, y: 2.5, width: 12 },
    { x: 148, z: -66, y: 1.5 },
    { x: 100, z: -78, y: -0.45 },
    { x: 76, z: -82, y: 0 },
    { x: 47, z: -30, y: 0.6, width: 13 },
    { x: 18, z: -72, y: 0.9 },
    { x: 22, z: -120, y: 1, width: 13 },
    { x: -6, z: -116, y: 1 },
  ],
  features: [
    { kind: 'kicker', at: 2, offset: -26, length: 6, height: 1.1 },
    { kind: 'stream', at: 5, width: 12, skew: 0.1 },
    { kind: 'kicker', at: 6, offset: 14, length: 6, height: 1.0, lateral: -3.5, width: 5 },
    { kind: 'kicker', at: 6, offset: 14, length: 6, height: 1.0, lateral: 3.5, width: 5 },
    { kind: 'kicker', at: 4, offset: -12, length: 7, height: 1.2 },
    { kind: 'stream', at: 14, width: 12, skew: -0.15 },
    { kind: 'kicker', at: 0, offset: 20, length: 7, height: 1.2 },
  ],
  pickups: [
    { at: 1, offset: 20, lanes: [-4.5, -1.5, 1.5, 4.5] },
    { at: 4, offset: -8, lanes: [-4, 0, 4] },
    { at: 7, offset: -8, lanes: [-4.5, -1.5, 1.5, 4.5] },
    { at: 11, offset: 8, lanes: [-4, 0, 4] },
    { at: 15, offset: 6, lanes: [-4, 0, 4] },
    { at: 19, offset: 10, lanes: [-4.5, -1.5, 1.5, 4.5] },
  ],
};
