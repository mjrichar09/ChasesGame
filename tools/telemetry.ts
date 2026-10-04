// Headless AI race: lap times, respawns, airtime and suspension use.
// Usage: npm run telemetry -- [--seed=N] [--laps=N]
import { initPhysics } from '../src/sim/race.js';
import { autoRace } from '../src/sim/autopilot.js';
import { VINE_VALLEY } from '../src/data/tracks/jungle1.js';
import { KART } from '../src/data/tuning.js';

const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
await initPhysics();
const race = autoRace(VINE_VALLEY, { seed: arg('seed', 1), laps: arg('laps', 3) });
const { sim } = race;
const maxSteps = 60 * 8 * sim.laps * 120;
let maxComp = 0, bottomOuts = 0, airSteps = 0, longestAir = 0, maxSpeed = 0, pickups = 0, boosts = 0, hits = 0, whacks = 0;
const where: Record<string, number> = {};
for (let i = 0; i < maxSteps && !sim.allFinished; i++) {
  race.step();
  for (const k of sim.karts) {
    for (const w of k.wheels) { maxComp = Math.max(maxComp, w.compression); if (w.compression > KART.maxTravel) bottomOuts++; }
    if (k.grounded === 0) airSteps++;
    longestAir = Math.max(longestAir, k.airTime);
    maxSpeed = Math.max(maxSpeed, k.forwardSpeed);
  }
  for (const e of sim.items.events) {
    if (e.type === 'pickup') pickups++; else if (e.type === 'boost') boosts++; else if (e.type === 'peelHit') hits++; else if (e.type === 'whack') whacks++;
  }
  sim.items.events = [];
  for (const r of sim.respawned) { const b = `${Math.round(sim.progress[r]!.s / 25) * 25}:${sim.progress[r]!.lastRespawn}`; where[b] = (where[b] ?? 0) + 1; }
}
console.log(`time ${sim.raceTime.toFixed(1)}s  finished ${sim.finishOrder.length}/${sim.karts.length}`);
for (const i of sim.standings()) {
  const p = sim.progress[i]!;
  console.log(`  #${i} ${p.finishTime?.toFixed(1) ?? 'DNF'}  laps ${p.lapTimes.map((t) => t.toFixed(1)).join(' / ')}  respawns ${p.respawns}  power ${sim.karts[i]!.power.toFixed(2)}`);
}
console.log(`max speed ${maxSpeed.toFixed(1)} m/s  max compression ${maxComp.toFixed(2)} m  bottom-out steps ${bottomOuts}`);
console.log(`airtime ${(airSteps / 120 / sim.karts.length).toFixed(1)} s/kart  longest ${longestAir.toFixed(2)} s`);
console.log(`pickups ${pickups} boosts ${boosts} peel hits ${hits} whacks ${whacks}`);
console.log('respawns by s', where);
