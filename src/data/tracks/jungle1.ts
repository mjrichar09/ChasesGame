/**
 * Vine Valley — the first circuit.
 *
 * A long start straight, a kicker-strewn sweeper, a hairpin, an S through the
 * ferns, a climb to the river gap, then a twisty run home. Coordinates are
 * metres; the start straight runs along +Z.
 */
import type { TrackDef } from '../../sim/track.js';

export const VINE_VALLEY: TrackDef = {
  id: 'vine-valley',
  name: 'Vine Valley',
  width: 15,
  start: 1,
  points: [
    { x: 0, z: -90, y: 1 },
    { x: 0, z: 0, y: 1 },
    { x: 3, z: 78, y: 2 },
    { x: 30, z: 102, y: 3 },
    { x: 100, z: 98, y: 4 },
    { x: 140, z: 60, y: 4 },
    { x: 133, z: 10, y: 3.5 },
    { x: 88, z: 24, y: 3 },
    { x: 66, z: -18, y: 3.5 },
    { x: 100, z: -55, y: 5.5 },
    { x: 160, z: -58, y: 7 },
    { x: 215, z: -68, y: 6 },
    { x: 262, z: -92, y: 4, width: 13 },
    { x: 236, z: -150, y: 3 },
    { x: 165, z: -168, y: 2 },
    { x: 125, z: -135, y: 2 },
    { x: 82, z: -158, y: 1.5 },
    { x: 30, z: -190, y: 1, width: 13 },
    { x: 0, z: -162, y: 1 },
  ],
  features: [
    // Twin kickers on the opening sweeper — pick a side.
    { kind: 'kicker', at: 2, offset: -18, length: 6, height: 1.1, lateral: -4, width: 5 },
    { kind: 'kicker', at: 2, offset: -18, length: 6, height: 1.1, lateral: 4, width: 5 },
    // Full-width hop on the top straight.
    { kind: 'kicker', at: 4, offset: -30, length: 7, height: 1.0 },
    // Centre kicker out of the hairpin.
    { kind: 'kicker', at: 7, offset: -4, length: 5, height: 0.9, width: 6 },
    // The river gap.
    { kind: 'gap', at: 10, offset: -6, length: 13, rampLength: 9, rampHeight: 1.6 },
    // Big launch down the back straight, after the hairpin.
    { kind: 'kicker', at: 13, offset: -28, length: 8, height: 1.5 },
    // Staggered pair in the closing esses.
    { kind: 'kicker', at: 15, offset: -6, length: 5, height: 1.0, lateral: 4, width: 6 },
    { kind: 'kicker', at: 16, offset: -2, length: 5, height: 1.0, lateral: -4, width: 6 },
    // A last hop onto the start straight.
    { kind: 'kicker', at: 0, offset: 10, length: 7, height: 1.2 },
  ],
  pickups: [
    { at: 1, offset: 20, lanes: [-5, -1.7, 1.7, 5] },
    { at: 5, offset: 0, lanes: [-4.5, 0, 4.5] },
    { at: 9, offset: -10, lanes: [-5, -1.7, 1.7, 5] },
    { at: 12, offset: -20, lanes: [-4.5, 0, 4.5] },
    { at: 15, offset: 14, lanes: [-5, -1.7, 1.7, 5] },
    { at: 18, offset: 20, lanes: [-4.5, 0, 4.5] },
  ],
};
