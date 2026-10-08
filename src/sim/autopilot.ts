/**
 * Run a whole race with every kart on AI — the headless harness behind the
 * tests and `npm run telemetry`. Lives in sim/ because it is pure sim.
 */
import type { TrackDef } from './track.js';
import { AiDriver, personality } from './driver.js';
import { RaceSim, type RaceOptions } from './race.js';
import type { DriverInput } from './input.js';

export interface AutoRace {
  sim: RaceSim;
  drivers: AiDriver[];
  /** Advance one step; returns the inputs used. */
  step(): DriverInput[];
}

export function autoRace(def: TrackDef, opts: RaceOptions = {}): AutoRace {
  const sim = new RaceSim(def, opts);
  const drivers = sim.karts.map((k) => new AiDriver(personality(sim.rng, k.index)));
  return {
    sim,
    drivers,
    step() {
      const inputs = sim.karts.map((k) =>
        drivers[k.index]!.drive(sim.dt, k, sim.progress[k.index]!, sim.track, sim.karts, sim.items, null, sim),
      );
      sim.step(inputs);
      return inputs;
    },
  };
}
