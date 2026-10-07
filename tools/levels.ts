// Solo lap time by AI level (no items, no traffic): does skill show? 
// Usage: npm run levels -- [--track=id]
import { initPhysics, RaceSim } from '../src/sim/race.js';
import { AiDriver, personality } from '../src/sim/driver.js';
import { TRACKS } from '../src/data/tracks/index.js';
import { Rng } from '../src/sim/rng.js';
const id = process.argv.find((a) => a.startsWith('--track='))?.split('=')[1];
await initPhysics();
for (const def of id ? TRACKS.filter((t) => t.id === id) : TRACKS) {
  const row: string[] = [];
  for (const level of [0, 0.25, 0.5, 0.75, 1]) {
    const times: number[] = [];
    for (const seed of [1, 2, 3]) {
      const sim = new RaceSim({ ...def, pickups: [], lava: undefined }, { karts: 1, laps: 1, seed });
      const ai = new AiDriver(personality(new Rng(seed * 31), 0, level));
      const k = sim.karts[0]!;
      const pr = sim.progress[0]!;
      for (let i = 0; i < 120 * 200 && pr.finishTime === null; i++) sim.step([ai.drive(sim.dt, k, pr, sim.track, sim.karts, sim.items, null)]);
      times.push(pr.finishTime ?? 999);
      sim.free();
    }
    row.push(`L${level}: ${(times.reduce((a, b) => a + b) / times.length).toFixed(1)}s`);
  }
  console.log(def.name.padEnd(16), row.join('  '));
}
