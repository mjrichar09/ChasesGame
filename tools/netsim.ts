// Headless online race: a host and N players over simulated links, everyone on autopilot.
// Reports finish order (host vs each phone), how far the host's copy of each player's
// kart trails the real one, bandwidth, respawns and AI takeovers.
// Usage: npm run netsim -- [--players=3] [--profile=lan|wifi|4g|bad] [--laps=1] [--track=0] [--seed=1] [--away=1]
//   --away=N: player N's phone "locks" for 5 s mid-race (the AI should take over and hand back).
import { initPhysics } from '../src/sim/race.js';
import { netRace } from '../src/net/harness.js';
import { PROFILES } from '../src/net/link.js';
import { TRACKS } from '../src/data/tracks/index.js';

const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
await initPhysics();
const players = Number(arg('players', '3'));
const profileName = arg('profile', '4g');
const profile = PROFILES[profileName]!;
const track = Number(arg('track', '0'));
const away = Number(arg('away', '0'));
const net = netRace(players, profile, { laps: Number(arg('laps', '1')), track }, Number(arg('seed', '1')));
const { host, clients } = net;
const sim = host.race!.sim;
console.log(`${TRACKS[track]!.name}: host + ${players} players on '${profileName}' (${profile.latency * 1000} ms ±${profile.jitter * 1000}, ${profile.loss * 100}% loss)`);

const err: number[] = [];
let takeovers = 0;
let steps = 0;
const wall = performance.now();
const limit = 120 * 60 * 4 * sim.laps;
while (steps < limit) {
  // One phone goes quiet for 5 s, a third of the way in.
  const t = sim.raceTime;
  const asleep = away > 0 && t > 20 && t < 25 ? away - 1 : -1;
  host.step(null);
  clients.forEach((c, i) => {
    if (i !== asleep) c.step(null);
  });
  net.clock.advance(1 / 120);
  sim.items.events = [];
  for (const c of clients) if (c.race) c.race.sim.items.events = [];
  steps++;
  for (const p of host.players) if (p.away) takeovers++;
  // How far behind the real kart (on its phone) the host's copy is.
  if (steps % 12 === 0 && sim.phase === 'racing') {
    clients.forEach((c, i) => {
      if (!c.race || i === asleep) return;
      const mine = c.race.sim.karts[c.race.own]!;
      const theirs = sim.karts[c.race.own]!;
      // (Skip the moment of a respawn: the phone has moved the kart, the host hears a moment later.)
      if (mine.out || theirs.out || !theirs.proxy || c.race.sim.progress[c.race.own]!.respawns !== sim.progress[c.race.own]!.respawns) return;
      const a = mine.position;
      const b = theirs.position;
      const e = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      err.push(e);
      if (e > 8 && process.argv.includes('--why')) console.log(`  t=${sim.raceTime.toFixed(2)} kart ${c.race.own} off by ${e.toFixed(1)} m  flying ${mine.flying}/${theirs.flying} respawns ${c.race.sim.progress[c.race.own]!.respawns}/${sim.progress[c.race.own]!.respawns} speed ${mine.forwardSpeed.toFixed(0)}`);
    });
  }
  const done = sim.allFinished || (sim.raceTime > 5 && sim.progress.filter((p) => p.finishTime !== null || p.dnf).length === sim.karts.length);
  if (done) break;
}
const secs = steps / 120;
err.sort((a, b) => a - b);
const pct = (p: number) => (err[Math.floor((err.length - 1) * p)] ?? 0).toFixed(2);
console.log(`race time ${sim.raceTime.toFixed(1)} s  (ran in ${((performance.now() - wall) / 1000).toFixed(1)} s)`);
const names = host.race!.config.names;
console.log('host order:   ' + sim.standings().map((i) => `${names[i] || 'ai'}#${i}`).join(' '));
for (const c of clients) {
  const cs = c.race!.sim;
  console.log(`${names[c.race!.own]} sees:     ` + cs.standings().map((i) => `${names[i] || 'ai'}#${i}`).join(' ') + `   rtt ${(c.rtt * 1000).toFixed(0)} ms`);
}
for (let i = 0; i < sim.karts.length; i++) {
  const p = sim.progress[i]!;
  console.log(`  #${i} ${(names[i] || 'ai').padEnd(5)} ${p.dnf ? 'TOASTED' : p.finishTime?.toFixed(1) ?? 'DNF'}  respawns ${p.respawns}`);
}
console.log(`host copy of player karts: off by median ${pct(0.5)} m, 95% ${pct(0.95)} m, max ${pct(1)} m`);
console.log(`bandwidth: host upload ${(net.bytes.down / secs / 1024).toFixed(1)} KB/s total (${(net.bytes.down / secs / 1024 / players).toFixed(1)} per player), each player upload ${(net.bytes.up / secs / 1024 / players).toFixed(1)} KB/s`);
console.log(`AI takeover steps: ${takeovers}`);
