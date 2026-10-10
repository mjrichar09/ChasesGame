/**
 * Phones play fullscreen, with no browser bars over the road.
 *
 * Browsers only go fullscreen from a tap, so the first tap anywhere asks for
 * it, and so does the next tap after anything drops out of it (app switch,
 * the system back gesture). Android Chrome and iPad Safari allow this.
 * iPhone Safari doesn't allow it for pages at all: there the way to get
 * fullscreen is Add to Home Screen (index.html and the manifest make that
 * launch without browser UI), and the title screen says so.
 */

type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FsDocument = Document & { webkitFullscreenElement?: Element | null };

const isPhone = (): boolean => matchMedia('(pointer: coarse)').matches;
/** Launched from the home screen: already without browser UI. */
const standalone = (): boolean =>
  matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isFullscreen = (): boolean => !!(document.fullscreenElement ?? (document as FsDocument).webkitFullscreenElement);

function canFullscreen(): boolean {
  const el = document.documentElement as FsElement;
  return !!(el.requestFullscreen ?? el.webkitRequestFullscreen);
}

function enter(): void {
  const el = document.documentElement as FsElement;
  try {
    const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
    // Refused (no permission, a frame): carry on in the browser.
    if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
  } catch {
    // Same.
  }
}

/** Go fullscreen on phones at the first tap (and after any drop-out). */
export function autoFullscreen(): void {
  if (!isPhone() || standalone() || !canFullscreen()) return;
  const tap = () => {
    if (!isFullscreen()) enter();
  };
  // These count as a user gesture for touch (pointerdown doesn't).
  window.addEventListener('touchend', tap, { capture: true, passive: true });
  window.addEventListener('click', tap, { capture: true });
}

/** On an iPhone in the browser: how to get fullscreen (null when not needed). */
export function homeScreenHint(): string | null {
  if (!isPhone() || standalone() || canFullscreen()) return null;
  return /iPhone|iPod/.test(navigator.userAgent) ? 'For full screen: tap Share, then “Add to Home Screen”.' : null;
}
