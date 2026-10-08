/**
 * All game audio, synthesised (as in RSC): no files to ship or license.
 *
 * - The player's engine is RSC's `EngineVoice`, fed a fake rev counter from
 *   speed, so it pitches up with the kart and bogs on landings.
 * - One-shot effects are tiny WebAudio recipes: noise sweeps, chirps, thumps.
 * - Jungle ambience: a bed of filtered noise (insects) and random bird calls.
 * - Gorilla voices: a buzzy source through two vowel formants, so hoots,
 *   grunts and roars sound throaty rather than beepy. Bigger gorillas are
 *   lower.
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
  | 'flap'
  | 'swagger';

/** Things a gorilla can say. */
export type Voice = 'hoot' | 'grunt' | 'ouch' | 'roar' | 'pound';

/** Vowel formants (F1, F2), Hz. */
const OO: [number, number] = [320, 800];
const OH: [number, number] = [500, 900];
const UH: [number, number] = [600, 1100];
const AH: [number, number] = [760, 1250];

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private engine: EngineVoice | null = null;
  private noise: AudioBuffer | null = null;
  private birdTimer = 2;
  muted = false;

  /** True while the page is hidden or unfocused: everything is silent. */
  private away = false;
  /** When each gorilla last spoke (audio clock), so voices don't pile up. */
  private lastVoice = new Map<number, number>();

  /**
   * The page went to the background (another tab, another app, the phone
   * locked) or came back. All sound stops while away — the whole audio
   * context is suspended, so nothing keeps playing behind the player's back.
   */
  setAway(away: boolean): void {
    this.away = away;
    if (!this.ctx) return;
    if (away) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.away) void this.ctx.resume();
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
      case 'swagger':
        // A bright rising arpeggio over a cymbal swell.
        env(0.5 * volume, 0.01, 0.9);
        noise('highpass', 6000, 9000, 0.7, 0.6);
        for (const [f, t] of [[523, 0], [659, 0.06], [784, 0.12], [1046, 0.18]] as const) {
          const o = ctx.createOscillator();
          o.type = 'square';
          o.frequency.value = f;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, now + t);
          g.gain.exponentialRampToValueAtTime(0.1 * volume, now + t + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.35);
          o.connect(g).connect(out);
          o.start(now + t);
          o.stop(now + t + 0.4);
        }
        break;
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

  /**
   * A gorilla says something. `who` identifies the speaker (one voice at a
   * time each), `size` their build — 1 is average, bigger is deeper.
   */
  say(kind: Voice, who: number, size = 1, volume = 1): void {
    const ctx = this.ctx;
    const out = this.sfxBus;
    if (!ctx || !out || volume <= 0) return;
    const now = ctx.currentTime;
    if (now - (this.lastVoice.get(who) ?? -9) < 0.5) return;
    this.lastVoice.set(who, now);
    const p = 150 / size; // speaking pitch, Hz
    const v = Math.min(1, volume);
    switch (kind) {
      case 'hoot':
        // "Hoo-hoo-hoo-AAH!": rising hoots, then a big open shout.
        for (let i = 0; i < 3; i++) this.syllable(now + i * 0.17, 0.13, [p * (1.3 + i * 0.2), p * (1.5 + i * 0.2)], OO, OH, 0.28 * v, 0.05);
        this.syllable(now + 0.53, 0.4, [p * 2.2, p * 1.5], AH, UH, 0.36 * v, 0.12);
        break;
      case 'grunt':
        this.syllable(now, 0.2, [p * 0.75, p * 0.55], UH, OH, 0.4 * v, 0.25);
        this.breath(now, 0.18, 700, 0.12 * v);
        break;
      case 'ouch':
        // "Oo-WAH!": a yelp that falls away.
        this.syllable(now, 0.48, [p * 2.4, p * 1.0], OO, AH, 0.36 * v, 0.08);
        break;
      case 'roar':
        this.syllable(now, 0.85, [p * 0.6, p * 0.45], AH, UH, 0.5 * v, 0.45);
        this.breath(now, 0.8, 500, 0.22 * v);
        break;
      case 'pound':
        // Chest-beating: a quick drum roll of hollow thumps, then a grunt.
        for (let i = 0; i < 6; i++) this.thump(now + i * 0.085, (i % 2 ? 95 : 120) / Math.sqrt(size), 0.55 * v);
        this.syllable(now + 0.55, 0.22, [p * 0.9, p * 0.6], UH, OH, 0.35 * v, 0.2);
        break;
    }
  }

  /**
   * One voiced syllable: a sawtooth (with a growl wobble of `rough`) gliding
   * `f0[0]`→`f0[1]`, shaped by formants gliding vowel `a`→`b`.
   */
  private syllable(t: number, dur: number, f0: [number, number], a: [number, number], b: [number, number], peak: number, rough: number): void {
    const ctx = this.ctx!;
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0[0], t);
    src.frequency.exponentialRampToValueAtTime(f0[1], t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 31;
    const depth = ctx.createGain();
    depth.gain.value = f0[0] * rough;
    lfo.connect(depth).connect(src.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.04, dur * 0.25));
    g.gain.setValueAtTime(peak, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.sfxBus!);
    for (const [k, gain] of [[0, 1], [1, 0.5]] as const) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 5;
      f.frequency.setValueAtTime(a[k], t);
      f.frequency.linearRampToValueAtTime(b[k], t + dur);
      const fg = ctx.createGain();
      fg.gain.value = gain * 2.2;
      src.connect(f).connect(fg).connect(g);
    }
    src.start(t);
    lfo.start(t);
    src.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  /** Breathy noise under a grunt or roar. */
  private breath(t: number, dur: number, freq: number, peak: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus!);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** A hollow chest thump. */
  private thump(t: number, freq: number, peak: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(this.sfxBus!);
    o.start(t);
    o.stop(t + 0.12);
    this.breath(t, 0.05, 1400, peak * 0.25);
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
