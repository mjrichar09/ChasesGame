/**
 * Counting visits, on the copy of the game that Vercel serves.
 *
 * GitHub Pages gives no visitor numbers; Vercel Web Analytics does. Its script
 * lives at `/_vercel/insights/script.js` on Vercel's own hosts and nowhere else,
 * so it is only loaded there — on GitHub Pages or `npm run dev` it would be a
 * 404 on every load.
 *
 * It sends page views only: path, referrer, country, device and browser. No
 * cookies, nothing typed into the game. A custom domain pointed at the Vercel
 * project would need adding to `servedByVercel`, or its visits are not counted.
 * (Same module as RSC's `src/ui/analytics.ts`.)
 */

const SCRIPT = '/_vercel/insights/script.js';

/** Whether this page is being served by Vercel, where the script exists. */
export function servedByVercel(hostname: string): boolean {
  return hostname === 'vercel.app' || hostname.endsWith('.vercel.app');
}

/** Load Vercel Web Analytics, if this is the Vercel copy (Vercel's plain-HTML queue). */
export function startAnalytics(): void {
  if (!servedByVercel(location.hostname)) return;
  const w = window as unknown as { va?: (...args: unknown[]) => void; vaq?: unknown[][] };
  w.va ??= (...args: unknown[]) => {
    (w.vaq ??= []).push(args);
  };
  const script = document.createElement('script');
  script.defer = true;
  script.src = SCRIPT;
  document.head.appendChild(script);
}
