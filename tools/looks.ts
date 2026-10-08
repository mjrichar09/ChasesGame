// Before/after look check: a fixed moment on each track, from the chase cam.
// Usage: npx tsx tools/looks.ts <tag>   (needs `npm run dev`)
import { chromium } from '@playwright/test';
const tag = process.argv[2] ?? 'look';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const track of [0, 1, 2, 3]) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.goto('http://localhost:5174/?autopilot');
  await p.click('.go');
  await p.click(`.track[data-t="${track}"]`);
  await p.waitForTimeout(1500);
  if (track === 0) await p.screenshot({ path: `shots/${tag}-menu.png` });
  await p.click('.select .go', { timeout: 120000 });
  for (let i = 0; i < 200; i++) {
    const t = (await p.evaluate('window.__game.sim ? window.__game.sim.raceTime : 0')) as number;
    if (t > 6) break;
    await p.waitForTimeout(400);
  }
  await p.screenshot({ path: `shots/${tag}-t${track}.png` });
  await p.close();
}
await b.close();
