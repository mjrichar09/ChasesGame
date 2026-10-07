import { initPhysics } from '../src/sim/race.js';
import { autoRace } from '../src/sim/autopilot.js';
import { TREETOP_TANGLE } from '../src/data/tracks/jungle3.js';
await initPhysics();
const r = autoRace(TREETOP_TANGLE, { seed: 1 });
const { sim } = r;
const gaps = sim.track.gaps;
const pending: { k: number; g: number; v: number; lat: number; t: number }[] = [];
const out: Record<string, { made: number; fell: number; vs: string[] }> = {};
let prevS = sim.progress.map((p) => p.s);
for (let i = 0; i < 120 * 250 && !sim.allFinished; i++) {
  r.step(); sim.items.events = [];
  sim.karts.forEach((k, j) => {
    const p = sim.progress[j]!;
    gaps.forEach((g, gi) => {
      if (sim.track.between(g.s0, prevS[j]!, p.s) && sim.track.delta(prevS[j]!, p.s) > 0 && !k.flying)
        pending.push({ k: j, g: gi, v: k.forwardSpeed, lat: p.lateral, t: sim.raceTime });
    });
  });
  for (const j of sim.respawned) {
    const idx = pending.findIndex((q) => q.k === j && sim.raceTime - q.t < 4);
    if (idx >= 0) { const q = pending.splice(idx, 1)[0]!; const o = (out[q.g] ??= { made: 0, fell: 0, vs: [] }); o.fell++; o.vs.push(`F${q.v.toFixed(0)}/${q.lat.toFixed(1)}`); }
  }
  for (let n = pending.length - 1; n >= 0; n--) if (sim.raceTime - pending[n]!.t >= 4) { const q = pending.splice(n, 1)[0]!; const o = (out[q.g] ??= { made: 0, fell: 0, vs: [] }); o.made++; o.vs.push(`${q.v.toFixed(0)}/${q.lat.toFixed(1)}`); }
  prevS = sim.progress.map((p) => p.s);
}
console.log(JSON.stringify(out, null, 0));
