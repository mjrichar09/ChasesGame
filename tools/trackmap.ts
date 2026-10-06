// Plan view of each track as a PNG: road coloured by corner radius (red =
// tight), control points numbered, features marked. Usage: npm run trackmap
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { TRACKS } from '../src/data/tracks/index.js';
import { Track } from '../src/sim/track.js';

mkdirSync('shots', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
for (const def of TRACKS) {
  const t = new Track(def);
  const xs = t.samples.map((s) => s.p.x);
  const zs = t.samples.map((s) => s.p.z);
  const minX = Math.min(...xs) - 30;
  const maxX = Math.max(...xs) + 30;
  const minZ = Math.min(...zs) - 30;
  const maxZ = Math.max(...zs) + 30;
  const k = 860 / Math.max(maxX - minX, maxZ - minZ);
  // Screen: +X to the left (matches the minimap), +Z up.
  const P = (x: number, z: number) => [20 + (maxX - x) * k, 20 + (maxZ - z) * k] as const;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="#234"/>`;
  for (let i = 0; i < t.samples.length; i++) {
    const a = t.samples[i]!;
    const b = t.samples[(i + 1) % t.samples.length]!;
    const r = 1 / Math.max(Math.abs(a.curvature), 1e-4);
    const col = !a.road ? '#39f' : r < 15 ? '#f33' : r < 25 ? '#f93' : r < 45 ? '#fd4' : '#8c8';
    const [x1, y1] = P(a.p.x, a.p.z);
    const [x2, y2] = P(b.p.x, b.p.z);
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${a.halfWidth * 2 * k}" stroke-linecap="round"/>`;
  }
  for (const kk of t.kickers) {
    const p = t.pointAt(kk.s1, kk.lateral);
    const [x, y] = P(p.x, p.z);
    svg += `<circle cx="${x}" cy="${y}" r="4" fill="#a52"/>`;
  }
  for (const w of t.waters) {
    const p = t.at((w.s0 + w.s1) / 2).p;
    const [x, y] = P(p.x, p.z);
    svg += `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="#3cf" stroke-width="3"/>`;
  }
  def.points.forEach((pt, i) => {
    const [x, y] = P(pt.x, pt.z);
    svg += `<text x="${x + 6}" y="${y - 6}" fill="#fff" font-size="14" font-family="sans-serif">${i}</text>`;
  });
  const [sx, sy] = P(t.at(0).p.x, t.at(0).p.z);
  svg += `<circle cx="${sx}" cy="${sy}" r="7" fill="#fff"/>`;
  svg += `<text x="10" y="890" fill="#fff" font-size="16" font-family="sans-serif">${def.name} — ${t.length.toFixed(0)} m · red r&lt;15 · orange &lt;25 · yellow &lt;45</text></svg>`;
  await page.setContent(svg);
  await page.screenshot({ path: `shots/map-${def.id}.png` });
}
await browser.close();
