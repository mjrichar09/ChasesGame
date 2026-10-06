// Drive the real game in headless Chromium and take screenshots.
// Usage: npm run shoot -- [--url=http://localhost:5174/] [--mobile]
// Needs `npm run dev` running. Shots land in shots/.
import { mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}`))?.split('=')[1];
const url = arg('url') ?? 'http://localhost:5174/';
const mobile = process.argv.includes('--mobile');
mkdirSync('shots', { recursive: true });
const tag = mobile ? 'mobile' : 'desktop';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = mobile
  ? await browser.newContext({ ...devices['iPhone 13 landscape'] })
  : await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(url);
await page.waitForSelector('.go', { timeout: 30000 });
await page.screenshot({ path: `shots/${tag}-1-title.png` });
await page.click('.go');
await page.waitForSelector('.select');
await page.click('.card[data-i="5"]');
await page.waitForTimeout(800);
await page.screenshot({ path: `shots/${tag}-2-select.png` });
await page.click('.select .go');
await page.waitForTimeout(1500);
await page.screenshot({ path: `shots/${tag}-3-countdown.png` });

const hud = () =>
  page.evaluate(() => ({
    pos: document.querySelector('.hud-pos')?.textContent,
    lap: document.querySelector('.hud-lap')?.textContent,
    time: document.querySelector('.hud-time')?.textContent,
    speed: document.querySelector('.hud-speed span')?.textContent,
    item: (document.querySelector('.hud-item') as HTMLElement | null)?.dataset.kind,
    touch: getComputedStyle(document.querySelector('.touch')!).display,
  }));

// A finger on a touch button: a pointer event at the button's centre, so the
// controls' "which button is under this finger" logic runs for real.
const finger = (sel: string, type: 'pointerdown' | 'pointerup', id: number) =>
  page.evaluate(
    ([sel, type, id]) => {
      const el = document.querySelector(sel as string)!;
      const r = el.getBoundingClientRect();
      el.dispatchEvent(
        new PointerEvent(type as string, {
          bubbles: true,
          pointerId: id as number,
          pointerType: 'touch',
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
        }),
      );
    },
    [sel, type, id] as const,
  );

if (mobile) {
  // Hold GAS with one finger the whole time; tap the item button with another.
  await finger('.tb-gas', 'pointerdown', 11);
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(2500);
    await finger('.tb-item', 'pointerdown', 12);
    await page.waitForTimeout(150);
    await finger('.tb-item', 'pointerup', 12);
    if (i === 3) await finger('.tb-brake', 'pointerdown', 13);
    if (i === 4) await finger('.tb-brake', 'pointerup', 13);
    await page.screenshot({ path: `shots/${tag}-4-race-${i}.png` });
    console.log(i, await hud());
  }
} else {
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(2500);
    // Eat a banana / swing the snake whenever there is one.
    await page.keyboard.press('Space');
    await page.screenshot({ path: `shots/${tag}-4-race-${i}.png` });
    console.log(i, await hud());
  }
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
