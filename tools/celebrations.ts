// Screenshot every gorilla mid-celebration on the select podium.
// Needs `npm run dev`. Shots land in shots/celebrate-*.png.
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(process.argv[2] ?? 'http://localhost:5174/');
await page.click('.go');
await page.addStyleTag({ content: '.select .cards, .select-foot, .tracks { opacity: 0.25 }' });
for (let i = 0; i < 8; i++) {
  await page.click(`.card[data-i="${i}"]`);
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `shots/celebrate-${i}.png`, clip: { x: 340, y: 60, width: 600, height: 520 } });
}
console.log('errors', errors.length ? errors : 'none');
await browser.close();
