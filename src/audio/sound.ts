/**
 * All game audio, synthesised (as in RSC): no files to ship or license.
 *
 * - The player's engine is RSC's `EngineVoice`, fed a fake rev counter from
 *   speed, so it pitches up with the kart and bogs on landings.
 * - One-shot effects are tiny WebAudio recipes: noise sweeps, chirps, thumps.
 * - Jungle ambience: a bed of filtered noise (insects) and random bird calls.
 *
 * The AudioContext starts on the first user gesture, as browsers require.
 */

import { EngineVoice, whiteNoise } from './engine.js';

export type Sfx =
  | 'boost'
  | 'peelDrop'
  | 'peelHit'
  | 'swing'
  | 'whack'
  | 'pickup'
  | 'land'
  | 'splash'
  | 'beep'
  | 'go'
  | 'lap'
  | 'finish'
  | 'squawk'
  | 'flap';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private engine: EngineVoice | null = null;
  private noise: AudioBuffer | null = null;
  private birdTimer = 2;
  muted = false;

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.noise = whiteNoise(ctx, 2);
    const engineBus = ctx.createGain();
    engineBus.gain.value = 0.35;
    engineBus.connect(this.master);
    this.engine = new EngineVoice(ctx, engineBus);
    this.ambience();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  startEngine(): void {
    this.engine?.start();
  }

  stopEngine(): void {
    this.engine?.silence();
  }

  /** Per-frame engine update from the player's kart. */
  updateEngine(dt: number, speed: number, throttle: number, airborne: boolean, boosting: boolean): void {
    if (!this.engine) return;
    // A fake single-gear rev counter, overrevving in the air: junk engines scream.
    const frac = Math.min(1.3, Math.abs(speed) / 30);
    const rpm = 1600 + frac * 5200 + (airborne && throttle > 0 ? 1400 : 0) + (boosting ? 900 : 0);
    this.engine.update(
      {
        rpm,
        maxRpm: 8500,
        throttle,
        load: airborne ? 0.1 : throttle,
        health: 0.82, // a little ragged — it is a junk kart
        turboHealth: 0,
        misfiring: false,
        shifting: false,
      },
      dt,
    );
    this.birdTimer -= dt;
    if (this.birdTimer < 0) {
      this.birdTimer = 1.5 + Math.random() * 4;
      this.bird();
    }
  }

  play(name: Sfx, volume = 1): void {
    const ctx = this.ctx;
    const out = this.sfxBus;
    if (!ctx || !out) return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(out);
    const env = (peak: number, attack: number, decay: number) => {
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak * volume, now + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    };
    const osc = (type: OscillatorType, f0: number, f1: number, dur: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, now);
      o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), now + dur);
      o.connect(gain);
      o.start(now);
      o.stop(now + dur + 0.05);
      return o;
    };
    const noise = (type: BiquadFilterType, f0: number, f1: number, q: number, dur: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.Q.value = q;
      f.frequency.setValueAtTime(f0, now);
      f.frequency.exponentialRampToValueAtTime(f1, now + dur);
      src.connect(f).connect(gain);
      src.start(now, Math.random());
      src.stop(now + dur + 0.05);
    };
    switch (name) {
      case 'boost':
        env(0.5, 0.02, 0.9);
        noise('bandpass', 300, 2400, 1.2, 0.9);
        osc('sawtooth', 110, 330, 0.6);
        break;
      case 'peelDrop':
        env(0.25, 0.005, 0.15);
        osc('sine', 500, 180, 0.15);
        break;
      case 'peelHit':
        env(0.6, 0.01, 0.8);
        osc('triangle', 900, 120, 0.8);
        noise('lowpass', 2000, 300, 0.7, 0.5);
        break;
      case 'swing':
        env(0.35, 0.03, 0.3);
        noise('bandpass', 3000, 6000, 3, 0.3); // hiss
        break;
      case 'whack':
        env(0.9, 0.003, 0.35);
        osc('sine', 160, 45, 0.3);
        noise('lowpass', 4000, 400, 0.8, 0.15);
        break;
      case 'pickup':
        env(0.35, 0.005, 0.45);
        for (const [f, t] of [[880, 0], [1320, 0.07], [1760, 0.14]] as const) {
          const o = ctx.createOscillator();
          o.type = 'square';
          o.frequency.value = f;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, now + t);
          g.gain.exponentialRampToValueAtTime(0.12 * volume, now + t + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.2);
          o.connect(g).connect(out);
          o.start(now + t);
          o.stop(now + t + 0.25);
        }
        break;
      case 'land':
        env(0.7 * Math.min(1, volume), 0.005, 0.25);
        osc('sine', 120, 40, 0.25);
        osc('square', 60, 30, 0.08);
        break;
      case 'splash':
        env(0.6, 0.01, 0.9);
        noise('lowpass', 3000, 500, 0.5, 0.9);
        break;
      case 'beep':
        env(0.35, 0.005, 0.25);
        osc('square', 660, 660, 0.25);
        break;
      case 'go':
        env(0.4, 0.005, 0.6);
        osc('square', 1320, 1320, 0.6);
        break;
      case 'lap':
        env(0.3, 0.01, 0.4);
        osc('triangle', 1046, 1568, 0.3);
        break;
      case 'squawk': {
        // A harsh, warbling macaw call: a square wave bent up and down.
        env(0.45, 0.01, 0.55);
        const o = osc('square', 900, 1500, 0.25);
        o.frequency.exponentialRampToValueAtTime(700, now + 0.55);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 38;
        const depth = ctx.createGain();
        depth.gain.value = 180;
        lfo.connect(depth).connect(o.frequency);
        lfo.start(now);
        lfo.stop(now + 0.6);
        break;
      }
      case 'flap':
        env(0.25 * volume, 0.02, 0.18);
        noise('lowpass', 900, 250, 0.7, 0.2);
        break;
      case 'finish':
        env(0.4, 0.01, 1.6);
        for (const f of [523, 659, 784, 1046]) osc('triangle', f, f, 1.5);
        break;
    }
  }

  /** A constant insect bed. */
  private ambience(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 5200;
    f.Q.value = 6;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    // Slow tremolo, like a cicada chorus breathing.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.4;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain).connect(g.gain);
    lfo.start();
    src.connect(f).connect(g).connect(this.master!);
    src.start();
  }

  /** A random jungle bird: a few quick chirps. */
  private bird(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const base = 1800 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 4);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    pan.connect(this.master);
    for (let i = 0; i < n; i++) {
      const t = now + i * 0.12;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * (Math.random() < 0.5 ? 1.5 : 0.7), t + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.12);
    }
  }
}
