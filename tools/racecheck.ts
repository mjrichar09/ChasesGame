// Run a full (1-lap, autopilot) race in headless Chromium through to the
// results screen. Needs `npm run dev`. Usage: npx tsx tools/racecheck.ts
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${process.argv[2] ?? 'http://localhost:5174/'}?laps=1&autopilot`);
await page.click('.go');
await page.click('.select .go');
await page.waitForSelector('.results', { timeout: 540_000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'shots/results.png' });
await page.evaluate(() => { const m = document.querySelector('.menu') as HTMLElement; m.style.opacity = '0'; });
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots/podium.png' });
console.log(await page.locator('.results').innerText());
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
