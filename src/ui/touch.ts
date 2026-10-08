/**
 * Phone controls.
 *
 * The left thumb steers by dragging anywhere on the left half of the screen:
 * analogue, centred wherever the thumb first lands, so there is no small
 * target to miss. The right thumb works the pedals — a big GAS button with
 * BRAKE beside it, since the tracks need braking — and reaches up for the
 * banana/item button and the two whack buttons.
 *
 * Each button tracks its own pointer, so sliding a thumb from GAS onto
 * BRAKE (or holding gas while tapping an item with another finger) works.
 */

import type { DriverInput } from '../sim/input.js';
import { clamp } from '../sim/math.js';
import type { InputSource } from './controls.js';

const STEER_RANGE = 70; // px of drag for full lock

export class TouchControls implements InputSource {
  readonly root: HTMLDivElement;
  private steerId: number | null = null;
  private steerX0 = 0;
  private steer = 0;
  private readonly buttons = new Map<string, boolean>();
  private readonly knob: HTMLDivElement;
  private readonly pad: HTMLDivElement;
  active = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch';
    this.root.innerHTML = `
      <div class="touch-steer"><div class="touch-pad"><div class="touch-knob"></div></div></div>
      <div class="touch-buttons">
        <button data-b="whackLeft" class="tb tb-whack tb-wl">🐍◀</button>
        <button data-b="item" class="tb tb-item">🍌</button>
        <button data-b="swagger" class="tb tb-swagger">★</button>
        <button data-b="whackRight" class="tb tb-whack tb-wr">▶🐍</button>
        <button data-b="brake" class="tb tb-brake">BRAKE</button>
        <button data-b="gas" class="tb tb-gas">GAS</button>
      </div>`;
    parent.appendChild(this.root);
    this.knob = this.root.querySelector('.touch-knob')!;
    this.pad = this.root.querySelector('.touch-pad')!;

    const zone = this.root.querySelector<HTMLDivElement>('.touch-steer')!;
    zone.addEventListener('pointerdown', (e) => {
      this.steerId = e.pointerId;
      this.steerX0 = e.clientX;
      capture(zone, e.pointerId);
      this.pad.style.left = `${e.clientX - 60}px`;
      this.pad.style.top = `${e.clientY - 60}px`;
      this.pad.classList.add('on');
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.steerId) return;
      this.steer = clamp((e.clientX - this.steerX0) / STEER_RANGE, -1, 1);
      this.knob.style.transform = `translateX(${this.steer * 40}px)`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.steerId) return;
      this.steerId = null;
      this.steer = 0;
      this.knob.style.transform = '';
      this.pad.classList.remove('on');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    // Pedals and items: a press is whichever button the finger is over, and a
    // finger can slide between GAS and BRAKE without lifting.
    const pads = new Map<number, string>();
    const sync = () => {
      const held = new Set(pads.values());
      for (const btn of this.root.querySelectorAll<HTMLButtonElement>('[data-b]')) {
        const on = held.has(btn.dataset.b!);
        this.buttons.set(btn.dataset.b!, on);
        btn.classList.toggle('down', on);
      }
    };
    const box = this.root.querySelector<HTMLDivElement>('.touch-buttons')!;
    const at = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-b]');
      return el && box.contains(el) ? el.dataset.b! : null;
    };
    box.addEventListener('pointerdown', (e) => {
      const name = at(e);
      if (!name) return;
      e.preventDefault();
      pads.set(e.pointerId, name);
      sync();
      capture(box, e.pointerId);
    });
    box.addEventListener('pointermove', (e) => {
      if (!pads.has(e.pointerId)) return;
      const name = at(e);
      // Only the pedals hand over by sliding; items need a fresh press.
      const cur = pads.get(e.pointerId)!;
      if (name && name !== cur && (name === 'gas' || name === 'brake') && (cur === 'gas' || cur === 'brake')) {
        pads.set(e.pointerId, name);
        sync();
      }
    });
    const lift = (e: PointerEvent) => {
      if (pads.delete(e.pointerId)) sync();
    };
    box.addEventListener('pointerup', lift);
    box.addEventListener('pointercancel', lift);
  }

  static wanted(): boolean {
    return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  }

  /** The ★ button only shows when the swagger meter is full. */
  setSwaggerReady(ready: boolean): void {
    this.root.querySelector<HTMLElement>('.tb-swagger')!.classList.toggle('ready', ready);
  }

  show(on: boolean): void {
    this.active = on;
    this.root.style.display = on ? '' : 'none';
  }

  sample(): Partial<DriverInput> | null {
    if (!this.active) return null;
    const b = (n: string) => this.buttons.get(n) ?? false;
    return {
      throttle: b('gas') ? 1 : 0,
      brake: b('brake') ? 1 : 0,
      steer: this.steer,
      item: b('item'),
      whackLeft: b('whackLeft'),
      whackRight: b('whackRight'),
      swagger: b('swagger'),
    };
  }
}

/** Keep a finger's moves coming to `el` even when it strays. Best-effort: the press counts either way. */
function capture(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Not a live pointer (synthetic event) — nothing to capture.
  }
}
