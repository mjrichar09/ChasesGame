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
  /** Road surface: packed dirt, or the bark deck of a branch. */
  road: 'dirt' | 'bark';
  /** Barriers: logs, or vine ropes on posts. */
  barrier: 'logs' | 'vines';
  /** Water under the road gaps (a river), or nothing (a long drop). */
  riverUnderGaps: boolean;
  /** Branches under the road, giant trees, and a sea of treetops below. */
  branches: boolean;
  /** Glowing lava down in the road gaps (a fissure) instead of water. */
  gapLava?: boolean;
  /** Cloud tint and sun glow colour, for open skies (omit under a canopy). */
  clouds?: number;
  sunGlow?: number;
  /** Grass tufts along the road's edges. */
  tufts?: boolean;
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
    road: 'dirt',
    barrier: 'logs',
    riverUnderGaps: true,
    branches: false,
    clouds: 0xffffff,
    sunGlow: 0xfff0b0,
    tufts: true,
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
    road: 'dirt',
    barrier: 'logs',
    riverUnderGaps: true,
    branches: false,
    tufts: true,
  },
  'treetop-tangle': {
    blurb: 'Thirty metres up, along the branches. Mind the drop.',
    skyTop: 0x3f9fe0,
    skyHorizon: 0xe2f4f2,
    fog: 0xcfe9ea,
    fogNear: 90,
    fogFar: 420,
    hemiSky: 0xfff6dc,
    hemiGround: 0x4f7a34,
    hemiIntensity: 1.35,
    sun: 0xfff0c8,
    sunIntensity: 2.3,
    ground: '#2a4f22',
    canopy: false,
    vineArches: false,
    scenery: 0,
    road: 'bark',
    barrier: 'vines',
    riverUnderGaps: false,
    branches: true,
    clouds: 0xffffff,
    sunGlow: 0xfff0b0,
  },
  'lava-run': {
    blurb: 'The volcano is erupting. Get down the mountain before the lava does.',
    skyTop: 0x3a1f22,
    skyHorizon: 0xd0703a,
    fog: 0x8a5038,
    fogNear: 70,
    fogFar: 420,
    hemiSky: 0xffd0a8,
    hemiGround: 0x3a2a20,
    hemiIntensity: 1.15,
    sun: 0xffb070,
    sunIntensity: 1.7,
    ground: '#3f5a2a',
    canopy: false,
    vineArches: false,
    scenery: 0.45,
    road: 'dirt',
    barrier: 'logs',
    riverUnderGaps: false,
    branches: false,
    gapLava: true,
    clouds: 0x6a4a44,
    sunGlow: 0xff7a30,
    tufts: true,
  },
};
