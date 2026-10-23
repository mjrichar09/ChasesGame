/** Where the visit counter loads: only on Vercel's hosts, where its script exists. */

import { describe, expect, it } from 'vitest';
import { servedByVercel } from '../src/ui/analytics.js';

describe('the visit counter', () => {
  it('loads on the Vercel copy', () => {
    expect(servedByVercel('chasesgame.vercel.app')).toBe(true);
    expect(servedByVercel('chasesgame-git-main-mjr-fx.vercel.app')).toBe(true);
  });

  it('stays off GitHub Pages and the dev server', () => {
    expect(servedByVercel('mjrichar09.github.io')).toBe(false);
    expect(servedByVercel('localhost')).toBe(false);
  });

  it('is not fooled by a host that only contains the name', () => {
    expect(servedByVercel('vercel.app.example.com')).toBe(false);
    expect(servedByVercel('notvercel.app')).toBe(false);
  });
});
