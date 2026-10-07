/**
 * A jungle that changes during the race.
 *
 * Each track can carry events that fire when the race leader starts a given
 * lap, so they hit the whole field mid-race and every race replays exactly:
 *
 * - **treefall** — a huge tree beside the road creaks for a lap, then crashes
 *   across it. Its trunk is a bump you jump; its leafy crown chokes one half
 *   of the road (heavy drag), so you pick the clear side.
 * - **flood** — the creek rises: every ford widens and pulls harder, and the
 *   current shoves karts downstream. It rises once per stage (lap).
 * - **snap** — a branch cracks (a lap of warning), then breaks: the road there
 *   becomes a gap, and the broken stub tilts up into a launch ramp.
 *
 * This file holds the definitions and the timing; `RaceSim` applies the
 * physical changes (it owns the colliders), and the renderer reads the state.
 */

import type { TrackAnchor } from './track.js';

export type TrackEventDef =
  | (TrackAnchor & { kind: 'treefall'; lap: number; /** Side the crown lands on (−1 left, 1 right). */ blocked: -1 | 1 })
  | { kind: 'flood'; lap: number; /** Metres each ford widens per stage. */ grow: number; /** Push downstream, m/s² per stage. */ current: number; stages: number }
  | (TrackAnchor & { kind: 'snap'; lap: number; length: number; rampLength: number; rampHeight: number });

export type EventPhase = 'idle' | 'warning' | 'active';

export interface EventState {
  def: TrackEventDef;
  phase: EventPhase;
  /** Seconds since it went active (or since warning began). */
  t: number;
  /** Flood stage reached (1 at the first trigger lap). */
  stage: number;
}

/** Tree geometry relative to its anchor `s`: where the trunk crosses and the crown lies. */
export const TREE = {
  /** The trunk falls diagonally: from `s` on one side to `s + slant` on the other. */
  slant: 9,
  trunkHeight: 0.75,
  trunkWidth: 2.6,
  /** The crown covers this stretch of road (from `s`), on the blocked half. */
  crownFrom: 4,
  crownTo: 22,
  /** Drag in the crown, fraction of speed per second, and grip kept. */
  drag: 1.6,
  grip: 0.85,
};

/**
 * Advance every event's phase from the leader's lap. `leaderLaps` is laps
 * completed by the race leader (0 on lap 1). Returns the events that just
 * changed (went active, or a flood rose a stage), for the race to apply.
 */
export function stepEvents(states: EventState[], leaderLaps: number, dt: number): EventState[] {
  const fired: EventState[] = [];
  for (const e of states) {
    e.t += dt;
    const onLap = leaderLaps + 1;
    if (e.def.kind === 'flood') {
      const stage = Math.min(e.def.stages, Math.max(0, onLap - e.def.lap + 1));
      if (stage > e.stage) {
        e.stage = stage;
        e.phase = 'active';
        e.t = 0;
        fired.push(e);
      }
      continue;
    }
    if (e.phase === 'idle' && onLap >= e.def.lap - 1) {
      e.phase = 'warning';
      e.t = 0;
    }
    if (e.phase === 'warning' && onLap >= e.def.lap) {
      e.phase = 'active';
      e.t = 0;
      fired.push(e);
    }
  }
  return fired;
}
