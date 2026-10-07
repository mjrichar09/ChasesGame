// Headless AI race: lap times, respawns, airtime and suspension use.
// Usage: npm run telemetry -- [--seed=N] [--laps=N] [--track=id]
import { initPhysics } from '../src/sim/race.js';
import { autoRace } from '../src/sim/autopilot.js';
import { TRACKS } from '../src/data/tracks/index.js';
import { KART } from '../src/data/tuning.js';

const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
await initPhysics();
const trackId = process.argv.find((a) => a.startsWith('--track='))?.split('=')[1];
const def = TRACKS.find((t) => t.id === trackId) ?? TRACKS[0]!;
console.log(def.name);
const race = autoRace(def, { seed: arg('seed', 1), laps: arg('laps', 3) });
const { sim } = race;
const maxSteps = 60 * 8 * sim.laps * 120;
let maxComp = 0, bottomOuts = 0, airSteps = 0, longestAir = 0, maxSpeed = 0, pickups = 0, boosts = 0, hits = 0, whacks = 0;
const where: Record<string, number> = {};
// Where each kart's time goes: spun out, wobbling (whacked/bonked), wading, crawling.
const lost = sim.karts.map(() => ({ spin: 0, wobble: 0, wet: 0, slow: 0 }));
// Parrot flights: lap distance gained over the flight's 6 s (+ landing), per flight.
const flights: { kart: number; start: number; t0: number; done?: number }[] = [];
for (let i = 0; i < maxSteps && !sim.allFinished; i++) {
  race.step();
  for (const k of sim.karts) {
    for (const w of k.wheels) { maxComp = Math.max(maxComp, w.compression); if (w.compression > KART.maxTravel) bottomOuts++; }
    if (k.grounded === 0) airSteps++;
    longestAir = Math.max(longestAir, k.airTime);
    maxSpeed = Math.max(maxSpeed, k.forwardSpeed);
    if (sim.phase !== 'racing' || sim.progress[k.index]!.finishTime !== null) continue;
    const l = lost[k.index]!;
    if (k.spinning) l.spin += sim.dt;
    if (k.wobbleTime > 0) l.wobble += sim.dt;
    if (k.wet) l.wet += sim.dt;
    if (Math.abs(k.forwardSpeed) < 5) l.slow += sim.dt;
  }
  for (const e of sim.items.events) {
    if (e.type === 'parrot') flights.push({ kart: e.kart, start: sim.progress[e.kart]!.dist, t0: sim.raceTime });
    if (e.type === 'pickup') pickups++; else if (e.type === 'boost') boosts++; else if (e.type === 'peelHit') hits++; else if (e.type === 'whack') whacks++;
  }
  sim.items.events = [];
  for (const f of flights) if (f.done === undefined && sim.raceTime - f.t0 >= 7) f.done = sim.progress[f.kart]!.dist - f.start;
  for (const r of sim.respawned) { const b = `${Math.round(sim.progress[r]!.s / 25) * 25}:${sim.progress[r]!.lastRespawn}`; where[b] = (where[b] ?? 0) + 1; }
}
console.log(`time ${sim.raceTime.toFixed(1)}s  finished ${sim.finishOrder.length}/${sim.karts.length}`);
for (const i of sim.standings()) {
  const p = sim.progress[i]!;
  const l = lost[i]!;
  console.log(`  #${i} lvl ${race.drivers[i]!.me.level.toFixed(2)} ${p.dnf ? "TOASTED" : p.finishTime?.toFixed(1) ?? "DNF"}  laps ${p.lapTimes.map((t) => t.toFixed(1)).join(' / ')}  respawns ${p.respawns}  spin ${l.spin.toFixed(0)}s wobble ${l.wobble.toFixed(0)}s wet ${l.wet.toFixed(0)}s crawl ${l.slow.toFixed(0)}s`);
}
console.log(`max speed ${maxSpeed.toFixed(1)} m/s  max compression ${maxComp.toFixed(2)} m  bottom-out steps ${bottomOuts}`);
console.log(`airtime ${(airSteps / 120 / sim.karts.length).toFixed(1)} s/kart  longest ${longestAir.toFixed(2)} s`);
console.log(`pickups ${pickups} boosts ${boosts} peel hits ${hits} whacks ${whacks}`);
console.log('respawns by s', where);
const gains = flights.filter((f) => f.done !== undefined).map((f) => f.done!);
console.log(`parrot flights ${flights.length}  lap metres gained in 7 s: ${gains.map((g) => g.toFixed(0)).join(' ')}  (driving covers ~${(7 * 24).toFixed(0)})`);
