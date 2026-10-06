/**
 * How each circuit looks: sky, fog, light, and which set-pieces it has.
 *
 * Kept apart from the `TrackDef`s because none of this touches the sim — it
 * is read only by the renderer and the menu.
 */

import { CANOPY_STREAM } from './jungle2.js';

export interface TrackLook {
  /** Shown on the track-select button. */
  blurb: string;
  skyTop: number;
  skyHorizon: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sun: number;
  sunIntensity: number;
  /** Ground texture base colour. */
  ground: string;
  /** A closed roof of leaves over the whole course. */
  canopy: boolean;
  /** Vine arches over the road (open-sky tracks). */
  vineArches: boolean;
  /** A stream winding across the map, as a polyline on the ground. */
  stream?: { x: number; z: number }[];
  /** Multiplier on the scenery counts. */
  scenery: number;
}

export const LOOKS: Record<string, TrackLook> = {
  'vine-valley': {
    blurb: 'Sunny, fast, a river gap to clear.',
    skyTop: 0x58b4e8,
    skyHorizon: 0xd9f0d0,
    fog: 0xbfe3c8,
    fogNear: 70,
    fogFar: 300,
    hemiSky: 0xfff4d6,
    hemiGround: 0x3f6b2a,
    hemiIntensity: 1.4,
    sun: 0xfff0c8,
    sunIntensity: 2.2,
    ground: '#3f7f2f',
    canopy: false,
    vineArches: true,
    scenery: 1,
  },
  'canopy-creek': {
    blurb: 'Deep under the canopy. Tight turns, a creek to ford.',
    skyTop: 0x1f4a2a,
    skyHorizon: 0x5d8a52,
    fog: 0x3f6a3c,
    fogNear: 25,
    fogFar: 150,
    hemiSky: 0xcfe8a8,
    hemiGround: 0x22381a,
    hemiIntensity: 1.25,
    sun: 0xfff2b0,
    sunIntensity: 1.1,
    ground: '#2f5e26',
    canopy: true,
    vineArches: false,
    stream: CANOPY_STREAM,
    scenery: 1.2,
  },
};
