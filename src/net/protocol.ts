/**
 * The online game's messages and the race setup every phone builds the same.
 *
 * A room is hosted on one player's phone. Everyone else joins with its
 * four-digit code. The host's phone runs the official race (see net/host.ts),
 * fills empty grid slots with AI gorillas, and tells each player which kart
 * is theirs. Because the sim is a pure function of the race config, every
 * phone builds an identical track, grid and item layout from `RaceConfig`
 * alone — only what changes during the race is sent.
 */

import { GORILLAS } from '../data/gorillas.js';
import { TRACKS } from '../data/tracks/index.js';
import { RACE } from '../data/tuning.js';
import { AiDriver, type Difficulty, fieldLevels, personality } from '../sim/driver.js';
import type { ItemEvent } from '../sim/items.js';
import { RaceSim, type Role } from '../sim/race.js';
import { Rng } from '../sim/rng.js';
import { MOVES } from '../sim/swagger.js';

/** Bumped whenever a message or the sim changes in a way older phones can't follow. */
export const PROTOCOL = 4;
export const MAX_PLAYERS = RACE.karts;
/** Sim steps between snapshots (120 Hz / 6 = 20 Hz). */
export const SNAPSHOT_EVERY = 6;
/** Sim steps between a player's reports (60 Hz). */
export const REPORT_EVERY = 2;
/** The host hands a silent player's kart to the AI after this long, s. */
export const AWAY_AFTER = 1.5;
/** Players draw other karts this far in the past, s, between two snapshots. */
export const INTERP_DELAY = 0.12;

export interface Settings {
  track: number;
  laps: number;
  difficulty: Difficulty;
  swagger: boolean;
}

export const DEFAULT_SETTINGS: Settings = { track: 0, laps: RACE.laps, difficulty: 'normal', swagger: true };

export interface Seat {
  /** 'host' for the host's own seat, otherwise the player's link id. */
  id: string;
  name: string;
  /** Index into GORILLAS. */
  gorilla: number;
}

export interface RaceConfig {
  seed: number;
  track: number;
  laps: number;
  swagger: boolean;
  difficulty: Difficulty;
  /** Gorilla (index into GORILLAS) in each grid slot. */
  roster: number[];
  /** Name per grid slot ('' for AI). */
  names: string[];
}

export type ToHost =
  | { t: 'hello'; v: number; name: string; gorilla: number }
  | { t: 'pick'; gorilla: number }
  /** "My kart hit this peel." */
  | { t: 'peel'; id: number }
  | { t: 'ping'; at: number };

export type ToPlayer =
  | { t: 'reject'; why: string }
  | { t: 'room'; you: string; seats: Seat[]; settings: Settings; racing: boolean }
  | { t: 'start'; race: RaceConfig; you: number }
  | { t: 'events'; list: ItemEvent[] }
  | { t: 'pong'; at: number }
  | { t: 'back' };

/** Names: short and printable. */
export function cleanName(name: unknown): string {
  const s = typeof name === 'string' ? name : '';
  return s.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 12) || 'Gorilla';
}

/**
 * The grid for a race: humans in random slots with their gorillas, AI
 * gorillas (the ones nobody picked) in the rest.
 */
export function makeRaceConfig(seats: readonly Seat[], settings: Settings, seed: number): { config: RaceConfig; slots: number[] } {
  const rng = new Rng(seed);
  const slots = Array.from({ length: RACE.karts }, (_, i) => i);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [slots[i], slots[j]] = [slots[j]!, slots[i]!];
  }
  const roster: number[] = new Array(RACE.karts).fill(-1);
  const names: string[] = new Array(RACE.karts).fill('');
  const human = seats.slice(0, RACE.karts);
  human.forEach((seat, i) => {
    roster[slots[i]!] = seat.gorilla;
    names[slots[i]!] = seat.name;
  });
  const free = GORILLAS.map((_, g) => g).filter((g) => !roster.includes(g));
  for (let i = 0; i < roster.length; i++) if (roster[i] === -1) roster[i] = free.shift() ?? i % GORILLAS.length;
  return {
    config: { seed, track: settings.track, laps: settings.laps, swagger: settings.swagger, difficulty: settings.difficulty, roster, names },
    slots: slots.slice(0, human.length),
  };
}

/** Build the race (and a driver per kart, for AI slots and for away players) from a config. */
export function buildRace(config: RaceConfig, role: Role, own = -1): { sim: RaceSim; drivers: AiDriver[] } {
  const def = TRACKS[config.track] ?? TRACKS[0]!;
  const sim = new RaceSim(def, {
    seed: config.seed,
    laps: config.laps,
    swagger: config.swagger,
    moves: config.roster.map((g) => MOVES[g]!),
    role,
    own,
  });
  const humans = config.names.map((n) => n !== '');
  const levels = fieldLevels(config.difficulty, humans.filter((h) => !h).length, new Rng(config.seed + 7));
  let next = 0;
  // Players' karts get a decent driver for when they are away (or finished).
  const drivers = sim.karts.map((k) => new AiDriver(personality(sim.rng, k.index, humans[k.index] ? 0.7 : levels[next++]!)));
  return { sim, drivers };
}
