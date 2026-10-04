/**
 * Phone controls.
 *
 * Gas is automatic on touch — holding a pedal with a thumb you also need for
 * items is no fun — so the right thumb is free for brake, the banana/item
 * button and the two whack buttons. The left thumb steers by dragging
 * anywhere on the left half of the screen: analogue, centred wherever the
 * thumb first lands, so there is no small target to miss.
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
        <button data-b="whackLeft" class="tb tb-whack">🐍◀</button>
        <button data-b="item" class="tb tb-item">🍌</button>
        <button data-b="whackRight" class="tb tb-whack">▶🐍</button>
        <button data-b="brake" class="tb tb-brake">BRAKE</button>
      </div>`;
    parent.appendChild(this.root);
    this.knob = this.root.querySelector('.touch-knob')!;
    this.pad = this.root.querySelector('.touch-pad')!;

    const zone = this.root.querySelector<HTMLDivElement>('.touch-steer')!;
    zone.addEventListener('pointerdown', (e) => {
      this.steerId = e.pointerId;
      this.steerX0 = e.clientX;
      zone.setPointerCapture(e.pointerId);
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

    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('[data-b]')) {
      const name = btn.dataset.b!;
      const set = (v: boolean) => (e: PointerEvent) => {
        e.preventDefault();
        this.buttons.set(name, v);
        btn.classList.toggle('down', v);
      };
      btn.addEventListener('pointerdown', set(true));
      btn.addEventListener('pointerup', set(false));
      btn.addEventListener('pointercancel', set(false));
      btn.addEventListener('pointerleave', set(false));
    }
  }

  static wanted(): boolean {
    return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  }

  show(on: boolean): void {
    this.active = on;
    this.root.style.display = on ? '' : 'none';
  }

  sample(): Partial<DriverInput> | null {
    if (!this.active) return null;
    const b = (n: string) => this.buttons.get(n) ?? false;
    return {
      throttle: b('brake') ? 0 : 1,
      brake: b('brake') ? 1 : 0,
      steer: this.steer,
      item: b('item'),
      whackLeft: b('whackLeft'),
      whackRight: b('whackRight'),
    };
  }
}
