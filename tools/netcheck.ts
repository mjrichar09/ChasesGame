// An online race in headless Chromium: one page hosts, another joins by code over
// real WebRTC, both on autopilot, through to the results screen. Phone-sized pages
// (SwiftShader is slow with desktop post-processing).
// Needs `npm run dev` and `npm run peer` (a local signalling server) running.
// Usage: npx tsx tools/netcheck.ts [baseUrl] [--players=2]   (CHROMIUM=path for a non-Playwright Chromium)
import { chromium, type Page } from '@playwright/test';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5174/';
const players = Number(process.argv.find((a) => a.startsWith('--players='))?.split('=')[1] ?? 2);
// CHROMIUM=/path/to/chrome uses a browser other than Playwright's own download.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors: string[] = [];
const phone = { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 };

async function open(name: string, query: string): Promise<Page> {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`);
  });
  // (Don't wait for 'load': web fonts can be slow, and the other page is busy rendering.)
  await page.goto(`${base}?peer=localhost:9000&laps=1&autopilot${query}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('.menu .panel', { timeout: 120_000 });
  return page;
}

const host = await open('host', '');
await host.click('.online');
await host.fill('.player-name', 'Hosty');
await host.click('.host');
await host.waitForSelector('.room-code b', { timeout: 20_000 });
const code = (await host.locator('.room-code b').innerText()).trim();
console.log('room', code);

const guests: Page[] = [];
for (let i = 0; i < players - 1; i++) {
  const g = await open(`guest${i}`, `&room=${code}`);
  await g.fill('.player-name', `Guest${i}`);
  await g.click('.join');
  await g.waitForSelector('.room .waiting', { timeout: 30_000 });
  guests.push(g);
}
await host.waitForFunction((n) => document.querySelectorAll('.room-players .chip:not(.ai)').length === n, players, { timeout: 20_000 });
// A guest picks another gorilla; the host sees it taken.
await guests[0]!.click('.card[data-i="5"]');
await host.waitForSelector('.card.taken[data-i="5"]', { timeout: 10_000 });
await host.screenshot({ path: 'shots/net-room-host.png' });
await guests[0]!.screenshot({ path: 'shots/net-room-guest.png' });

await host.click('.room .go');
await guests[0]!.waitForSelector('.hud', { state: 'visible', timeout: 30_000 });
await host.waitForTimeout(8000);
await host.screenshot({ path: 'shots/net-race-host.png' });
await guests[0]!.screenshot({ path: 'shots/net-race-guest.png' });

const all = [host, ...guests];
// Progress every 20 s: race clock, lap and any waiting banner, per page.
const watch = setInterval(() => {
  void Promise.all(
    all.map((p) =>
      p.evaluate(() => {
        const g = (window as unknown as { __game?: { sim?: { clock: number; progress: { dist: number; lap: number }[] } | null } }).__game;
        const badge = document.querySelector('.net-badge')?.textContent ?? '';
        const sim = g?.sim;
        return sim ? `clock ${sim.clock.toFixed(1)} dist ${sim.progress.map((q) => q.dist.toFixed(0)).join(',')} [${badge}]` : `no race [${badge}]`;
      }).catch(() => 'gone'),
    ),
  ).then((lines) => console.log(lines.join('  |  ')));
}, 20_000);
try {
  await Promise.all(all.map((p) => p.waitForSelector('.results', { timeout: 1_800_000 })));
} catch (e) {
  await host.screenshot({ path: 'shots/net-stuck-host.png' });
  await guests[0]!.screenshot({ path: 'shots/net-stuck-guest.png' });
  console.log('errors:', errors.length ? errors : 'none');
  throw e;
} finally {
  clearInterval(watch);
}
// Let late finishers fill in.
await host.waitForTimeout(4000);
await host.screenshot({ path: 'shots/net-results-host.png' });
await guests[0]!.screenshot({ path: 'shots/net-results-guest.png' });
const tables = await Promise.all(all.map((p) => p.locator('.results table').innerText()));
tables.forEach((t, i) => console.log(`--- ${i === 0 ? 'host' : `guest${i - 1}`}\n${t}`));

// Back to the room together.
await host.click('.results .again');
await guests[0]!.waitForSelector('.room .waiting', { timeout: 20_000 });
console.log('back in the room together');
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
