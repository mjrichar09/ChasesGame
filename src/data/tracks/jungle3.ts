/**
 * Treetop Tangle — the third circuit.
 *
 * Raced along the branches of giant trees, thirty metres up. The branches
 * climb and dip between trunks; twice the course leaps a gap from one tree
 * to the next, and on the bare stretches there is no railing — only the
 * drop. A parrot here is worth its weight in bananas: the infield is all air,
 * and branches that are far apart by road are close as the bird flies.
 */
import type { TrackDef } from '../../sim/track.js';

export const TREETOP_TANGLE: TrackDef = {
  id: 'treetop-tangle',
  name: 'Treetop Tangle',
  width: 11,
  start: 1,
  elevated: true,
  points: [
    { x: 0, z: -60, y: 24 },
    { x: 0, z: 10, y: 25 },
    { x: 5, z: 62, y: 26 },
    { x: 34, z: 92, y: 28 },
    { x: 85, z: 98, y: 31, width: 13 },
    { x: 126, z: 82, y: 28.5, width: 13 },
    { x: 128, z: 26, y: 28, width: 10 },
    { x: 96, z: 2, y: 26 },
    { x: 66, z: 28, y: 25, width: 10 },
    { x: 42, z: -8, y: 24 },
    { x: 58, z: -52, y: 22, width: 9.5 },
    { x: 106, z: -62, y: 24, width: 9.5 },
    { x: 152, z: -42, y: 27 },
    { x: 178, z: -84, y: 30 },
    { x: 152, z: -128, y: 32 },
    { x: 100, z: -136, y: 30, width: 13 },
    { x: 54, z: -126, y: 27, width: 11 },
    { x: 22, z: -124, y: 25 },
    { x: -6, z: -98, y: 24 },
  ],
  features: [
    // Tree-to-tree leaps.
    { kind: 'gap', at: 4, offset: 10, length: 9, rampLength: 9, rampHeight: 1.9 },
    { kind: 'gap', at: 14, offset: 32, length: 9, rampLength: 9, rampHeight: 1.9 },
    // Bare branches: no railing.
    { kind: 'open', at: 10, offset: 4, length: 46, side: 0 },
    { kind: 'open', at: 17, offset: 12, length: 24, side: -1 },
    { kind: 'open', at: 7, offset: -12, length: 20, side: 1 },
    // Knots and burls to launch off.
    { kind: 'kicker', at: 2, offset: -24, length: 6, height: 1.1 },
    { kind: 'kicker', at: 9, offset: -14, length: 5, height: 0.9, lateral: -2.5, width: 4.5 },
    { kind: 'kicker', at: 9, offset: -14, length: 5, height: 0.9, lateral: 2.5, width: 4.5 },
    { kind: 'kicker', at: 11, offset: 8, length: 7, height: 1.2 },
    { kind: 'kicker', at: 0, offset: 18, length: 6, height: 1.1 },
  ],
  // SNAP! A branch on the opening straight cracks on lap 2 and breaks as the
  // leader starts lap 3: a new gap, with the broken stub as the ramp.
  events: [{ kind: 'snap', at: 2, offset: 25, lap: 3, length: 9, rampLength: 9, rampHeight: 1.8 }],
  pickups: [
    { at: 1, offset: 22, lanes: [-3.5, 0, 3.5] },
    { at: 5, offset: -10, lanes: [-3.5, 0, 3.5] },
    { at: 9, offset: 10, lanes: [-3, 0, 3] },
    { at: 12, offset: 8, lanes: [-3.5, 0, 3.5] },
    { at: 16, offset: -14, lanes: [-3, 0, 3] },
    { at: 0, offset: -2, lanes: [-3.5, 0, 3.5] },
  ],
};
