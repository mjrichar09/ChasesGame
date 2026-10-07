// Dev helper: teleport the player to a spot on a track (with events forced to lap 1)
// and screenshot it. Needs `npm run dev`.
// Usage: npx tsx tools/spot.ts <trackIndex> <s> [lateral] [tag] [--still] [--back]
// Teleport the player (autopilot) to just before a spot and screenshot it.
import { chromium } from '@playwright/test';
const [track, s, lat, tag] = [Number(process.argv[2]), Number(process.argv[3]), Number(process.argv[4] ?? 0), process.argv[5] ?? 'spot'];
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(process.argv.includes('--still') ? 'http://localhost:5174/?eventlap=1' : 'http://localhost:5174/?autopilot&eventlap=1');
await p.click('.go');
await p.click(`.track[data-t="${track}"]`);
await p.waitForTimeout(2500);
await p.click('.select .go', { timeout: 120000 });
await p.waitForTimeout(process.argv.includes('--still') ? 20000 : 12000);
await p.evaluate(([s, lat]) => {
  const g = (window as any).__game;
  const sim = g.sim;
  const i = g.player;
  const k = sim.track.at(s);
  const pos = sim.track.pointAt(s, lat);
  const yaw = Math.atan2(k.t.x, k.t.z);
  sim.karts[i].place({ x: pos.x, y: pos.y + 1.2, z: pos.z }, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
  sim.progress[i].s = sim.track.wrap(s);
  sim.progress[i].safeS = sim.progress[i].s;
  g.cam.cut();
}, [s, lat]);
const back = process.argv.includes('--back');
if (back) await p.keyboard.down('KeyC');
for (let n = 0; n < 4; n++) {
  await p.waitForTimeout(n === 0 ? 300 : 1200);
  await p.screenshot({ path: `shots/${tag}-${n}.png` });
}
console.log('errors', errors.length ? errors : 'none');
await b.close();
