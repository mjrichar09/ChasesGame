// Tile screenshots into one 2-wide contact sheet (shots/sheet.png).
// Usage: npx tsx tools/sheet.ts a.png b.png ...
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const names = process.argv.slice(2);
const imgs = names.map((n) => `data:image/png;base64,${readFileSync(n).toString('base64')}`);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(2,640px)">${imgs.map((s) => `<img src="${s}" style="width:640px;height:360px">`).join('')}</body>`);
await p.screenshot({ path: 'shots/sheet.png' });
await b.close();
