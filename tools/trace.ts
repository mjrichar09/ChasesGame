// Trace one AI kart alone around a lap: s, speed, height above road, wheels down.
import { initPhysics } from '../src/sim/race.js';
import { autoRace } from '../src/sim/autopilot.js';
import { VINE_VALLEY } from '../src/data/tracks/jungle1.js';
await initPhysics();
const from = Number(process.argv[2] ?? 0), to = Number(process.argv[3] ?? 2000), every = Number(process.argv[4] ?? 30);
const race = autoRace(VINE_VALLEY, { seed: 1, laps: 1, karts: 1 });
const { sim } = race; const k = sim.karts[0]!; const p = sim.progress[0]!;
for (let i = 0; i < 120 * 120 && !sim.allFinished; i++) {
  const inp = race.step();
  if (sim.respawned.length) console.log(`  RESPAWN at step ${i} s=${p.s.toFixed(0)}`);
  if (i % every === 0 && p.dist >= from && p.dist <= to) {
    const smp = sim.track.at(p.s); const pos = k.position;
    console.log(`t=${(i/120).toFixed(2)} d=${p.dist.toFixed(0)} lat=${p.lateral.toFixed(1)} v=${k.forwardSpeed.toFixed(1)} h=${(pos.y - smp.p.y).toFixed(2)} up=${k.up.y.toFixed(2)} g=${k.grounded} comp=${k.wheels.map(w=>w.compression.toFixed(2)).join(',')} thr=${inp[0]!.throttle} br=${inp[0]!.brake.toFixed(1)} st=${inp[0]!.steer.toFixed(2)}`);
  }
}
console.log('finish', p.finishTime, 'respawns', p.respawns);
