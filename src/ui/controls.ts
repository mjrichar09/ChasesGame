/**
 * Keyboard and gamepad, mapped onto the sim's `DriverInput`.
 *
 * Keyboard steering ramps rather than snapping (as in RSC): a digital ±1
 * makes a bouncy kart twitch. Item buttons are reported as held state; the
 * sim picks out the presses.
 *
 *   Drive   W/S or ↑/↓        Steer   A/D or ←/→
 *   Item    Space / Shift     Whack   Q (left) / E (right)     Swagger  F (hold)
 *   Pause   Esc / P               Look back  C (held)
 *
 * Pad (standard mapping): RT/LT pedals, left stick steers, A item,
 * LB/RB whack left/right, Start pauses.
 */

import type { DriverInput } from '../sim/input.js';
import { clamp, moveToward } from '../sim/math.js';
import { isTyping } from './typing.js';

const KEY_STEER_RATE = 4.2;
const KEY_STEER_RETURN = 7;
const DEADZONE = 0.14;

export interface InputSource {
  sample(dt: number): Partial<DriverInput> | null;
}

export class Controls {
  private readonly held = new Set<string>();
  private keySteer = 0;
  private padPause = false;
  /** Extra sources merged in (touch). */
  readonly sources: InputSource[] = [];
  onPause: (() => void) | null = null;

  /** True while the look-back key (C, or pad Y) is held. */
  get lookingBack(): boolean {
    if (this.down('KeyC')) return true;
    const pad = this.pad();
    return !!pad && (pad.buttons[3]?.value ?? 0) > 0.5;
  }

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (isTyping()) return;
      if (!e.repeat && (e.code === 'Escape' || e.code === 'KeyP')) this.onPause?.();
      this.held.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    target.addEventListener('blur', () => this.held.clear());
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  private pad(): Gamepad | null {
    for (const p of navigator.getGamepads?.() ?? []) if (p && p.connected) return p;
    return null;
  }

  sample(dt: number): DriverInput {
    const left = this.down('KeyA', 'ArrowLeft');
    const right = this.down('KeyD', 'ArrowRight');
    const wanted = (right ? 1 : 0) - (left ? 1 : 0);
    this.keySteer = moveToward(this.keySteer, wanted, (wanted === 0 ? KEY_STEER_RETURN : KEY_STEER_RATE) * dt);

    const out: DriverInput = {
      throttle: this.down('KeyW', 'ArrowUp') ? 1 : 0,
      brake: this.down('KeyS', 'ArrowDown') ? 1 : 0,
      steer: this.keySteer,
      item: this.down('Space', 'ShiftLeft', 'ShiftRight'),
      whackLeft: this.down('KeyQ'),
      whackRight: this.down('KeyE'),
      swagger: this.down('KeyF'),
    };

    const pad = this.pad();
    if (pad) {
      const btn = (i: number) => pad.buttons[i]?.value ?? 0;
      const ax = pad.axes[0] ?? 0;
      const stick = Math.abs(ax) < DEADZONE ? 0 : Math.sign(ax) * ((Math.abs(ax) - DEADZONE) / (1 - DEADZONE));
      out.throttle = Math.max(out.throttle, btn(7), btn(12) > 0.5 ? 1 : 0);
      out.brake = Math.max(out.brake, btn(6), btn(13) > 0.5 ? 1 : 0);
      if (stick !== 0) out.steer = stick;
      out.item ||= btn(0) > 0.5;
      // X, or both shoulders together, for swagger.
      out.swagger ||= btn(2) > 0.5 || (btn(4) > 0.5 && btn(5) > 0.5);
      out.whackLeft ||= btn(4) > 0.5;
      out.whackRight ||= btn(5) > 0.5;
      const pause = btn(9) > 0.5;
      if (pause && !this.padPause) this.onPause?.();
      this.padPause = pause;
    }

    for (const src of this.sources) {
      const t = src.sample(dt);
      if (!t) continue;
      out.throttle = Math.max(out.throttle, t.throttle ?? 0);
      out.brake = Math.max(out.brake, t.brake ?? 0);
      if (t.steer) out.steer = t.steer;
      out.item ||= t.item ?? false;
      out.whackLeft ||= t.whackLeft ?? false;
      out.whackRight ||= t.whackRight ?? false;
      out.swagger ||= t.swagger ?? false;
    }
    out.throttle = clamp(out.throttle, 0, 1);
    out.brake = clamp(out.brake, 0, 1);
    out.steer = clamp(out.steer, -1, 1);
    return out;
  }
}
