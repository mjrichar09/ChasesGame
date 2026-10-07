// Does the track make you slow down? One kart, no items, one lap, driven by
// the AI at different levels of corner commitment. `flat` never lifts. If
// flat-out is as quick as the careful lines, corners do not demand braking.
// Usage: npm run braking -- [--track=id]
import { initPhysics } from '../src/sim/race.js';
import { RaceSim } from '../src/sim/race.js';
import { AiDriver, personality } from '../src/sim/driver.js';
import { TRACKS } from '../src/data/tracks/index.js';

const id = process.argv.find((a) => a.startsWith('--track='))?.split('=')[1];
const defs = id ? TRACKS.filter((t) => t.id === id) : TRACKS;
await initPhysics();

for (const def of defs) {
  console.log(`\n${def.name}`);
  for (const grip of [12, 15, 18, 22, 28, 9999]) {
    const sim = new RaceSim({ ...def, pickups: [] }, { karts: 1, laps: 1, seed: 1 });
    const me = { ...personality(sim.rng, 0, 1), lane: 0, weave: 0, skill: 1, cornerGrip: grip, steerNoise: 0, mistakes: 0 };
    const ai = new AiDriver(me);
    const kart = sim.karts[0]!;
    const pr = sim.progress[0]!;
    let wall = 0;
    let braking = 0;
    let slide = 0;
    for (let i = 0; i < 120 * 180 && pr.finishTime === null; i++) {
      const input = ai.drive(sim.dt, kart, pr, sim.track, sim.karts, sim.items, null);
      sim.step([input]);
      if (sim.phase !== 'racing') continue;
      const k = sim.track.at(pr.s);
      if (Math.abs(pr.lateral) > k.halfWidth - 1.0) wall += sim.dt;
      if (input.brake > 0) braking += sim.dt;
      const v = kart.velocity;
      const side = Math.abs(v.x * kart.right.x + v.z * kart.right.z);
      if (side > 4) slide += sim.dt;
    }
    const label = grip > 1000 ? 'flat' : `grip ${grip}`;
    console.log(
      `  ${label.padEnd(8)} lap ${pr.finishTime?.toFixed(1) ?? 'DNF'}  on-wall ${wall.toFixed(1)}s  braking ${braking.toFixed(1)}s  sliding ${slide.toFixed(1)}s  respawns ${pr.respawns}`,
    );
    sim.free();
  }
}
