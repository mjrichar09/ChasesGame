/**
 * Title, gorilla select, pause and results screens.
 *
 * Plain DOM panels over the 3D view. Gorilla select leaves the middle of the
 * screen clear so the chosen gorilla, spinning on its podium in the real
 * scene, is the centrepiece.
 */

import { GORILLAS, type Gorilla } from '../data/gorillas.js';
import { TRACKS } from '../data/tracks/index.js';
import type { Difficulty } from '../sim/driver.js';
import { LOOKS } from '../data/tracks/looks.js';
import { escapeHtml } from './escape.js';
import { formatTime, ordinal } from './hud.js';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export interface ResultRow {
  gorilla: Gorilla;
  time: number | null;
  player: boolean;
  /** Caught by the lava. */
  dnf?: boolean;
}

export class Menu {
  readonly root: HTMLDivElement;
  onStart: ((gorilla: number) => void) | null = null;
  onPreview: ((gorilla: number) => void) | null = null;
  onTrack: ((track: number) => void) | null = null;
  onDifficulty: ((d: Difficulty) => void) | null = null;
  difficulty: Difficulty = 'normal';
  onSwagger: ((on: boolean) => void) | null = null;
  swagger = true;
  onResume: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  onQuit: (() => void) | null = null;
  onMute: (() => boolean) | null = null;
  onGesture: (() => void) | null = null;
  private chosen = 0;
  private track = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    parent.appendChild(this.root);
    this.root.addEventListener('pointerdown', () => this.onGesture?.());
    window.addEventListener('keydown', (e) => {
      if (this.root.dataset.screen !== 'select') return;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.pick((this.chosen + 1) % GORILLAS.length);
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.pick((this.chosen + GORILLAS.length - 1) % GORILLAS.length);
      if (e.code === 'Enter' || e.code === 'Space') {
        this.onGesture?.();
        this.onStart?.(this.chosen);
      }
    });
  }

  hide(): void {
    this.root.innerHTML = '';
    this.root.dataset.screen = '';
  }

  title(): void {
    this.root.dataset.screen = 'title';
    this.root.innerHTML = `
      <div class="panel title">
        <h1 class="logo"><span>JUNGLE</span><span>JALOPIES</span></h1>
        <p class="sub">Eight gorillas. Junk karts. Too many bananas.</p>
        <button class="big go">PLAY</button>
      </div>`;
    this.root.querySelector('.go')!.addEventListener('click', () => {
      this.onGesture?.();
      this.select();
    });
  }

  select(initial = this.chosen, track = this.track): void {
    this.root.dataset.screen = 'select';
    const cards = GORILLAS.map(
      (g, i) => `
        <button class="card" data-i="${i}" style="--c:${hex(g.kartColor)};--a:${hex(g.accent)}">
          <span class="swatch" style="background:${hex(g.fur)}"></span>
          <span class="name">${escapeHtml(g.name)}</span>
        </button>`,
    ).join('');
    this.root.innerHTML = `
      <div class="select">
        <h2>CHOOSE YOUR GORILLA</h2>
        <div class="tracks">${TRACKS.map(
          (t, i) => `<button class="track" data-t="${i}"><b>${escapeHtml(t.name)}</b><span>${escapeHtml(LOOKS[t.id]?.blurb ?? '')}</span></button>`,
        ).join('')}</div>
        <div class="who"><div class="who-name"></div><div class="who-tag"></div></div>
        <div class="cards">${cards}</div>
        <div class="select-foot">
          <div class="keys">
            <b>Drive</b> W/S or ↑↓ · <b>Steer</b> A/D or ←→ · <b>Banana / item</b> Space · <b>Whack</b> Q / E · <b>Swagger</b> hold F · <b>Look back</b> C · <b>Pause</b> Esc
          </div>
          <div class="difficulty swagger-toggle" role="radiogroup" aria-label="Swagger">
            <span>Swagger</span>
            <button data-sw="on" class="${this.swagger ? 'on' : ''}">On</button>
            <button data-sw="off" class="${this.swagger ? '' : 'on'}">Off</button>
          </div>
          <div class="difficulty" role="radiogroup" aria-label="Opponents">
            <span>Rivals</span>
            ${(['chill', 'normal', 'wild'] as const)
              .map((d) => `<button data-d="${d}" class="${d === this.difficulty ? 'on' : ''}">${d[0]!.toUpperCase() + d.slice(1)}</button>`)
              .join('')}
          </div>
          <button class="big go">RACE!</button>
        </div>
      </div>`;
    for (const card of this.root.querySelectorAll<HTMLButtonElement>('.card')) {
      card.addEventListener('click', () => {
        this.onGesture?.();
        this.pick(Number(card.dataset.i));
      });
    }
    this.root.querySelector('.go')!.addEventListener('click', () => {
      this.onGesture?.();
      this.onStart?.(this.chosen);
    });
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.track')) {
      b.addEventListener('click', () => {
        this.onGesture?.();
        this.pickTrack(Number(b.dataset.t));
      });
    }
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.swagger-toggle button')) {
      b.addEventListener('click', () => {
        this.swagger = b.dataset.sw === 'on';
        for (const o of this.root.querySelectorAll('.swagger-toggle button')) o.classList.toggle('on', o === b);
        this.onSwagger?.(this.swagger);
      });
    }
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.difficulty:not(.swagger-toggle) button')) {
      b.addEventListener('click', () => {
        this.difficulty = b.dataset.d as Difficulty;
        for (const o of this.root.querySelectorAll('.difficulty:not(.swagger-toggle) button')) o.classList.toggle('on', o === b);
        this.onDifficulty?.(this.difficulty);
      });
    }
    this.pickTrack(track);
    this.pick(initial);
  }

  private pickTrack(i: number): void {
    this.track = i;
    for (const b of this.root.querySelectorAll<HTMLElement>('.track')) b.classList.toggle('on', Number(b.dataset.t) === i);
    this.onTrack?.(i);
  }

  private pick(i: number): void {
    this.chosen = i;
    const g = GORILLAS[i]!;
    for (const c of this.root.querySelectorAll('.card')) c.classList.toggle('on', Number((c as HTMLElement).dataset.i) === i);
    const name = this.root.querySelector('.who-name');
    const tag = this.root.querySelector('.who-tag');
    if (name) name.textContent = g.name;
    if (tag) tag.textContent = g.tagline;
    this.onPreview?.(i);
  }

  pause(muted: boolean): void {
    this.root.dataset.screen = 'pause';
    this.root.innerHTML = `
      <div class="panel pause">
        <h2>PAUSED</h2>
        <button class="big resume">RESUME</button>
        <button class="restart">Restart race</button>
        <button class="mute">${muted ? 'Sound: off' : 'Sound: on'}</button>
        <button class="quit">Quit race</button>
      </div>`;
    this.root.querySelector('.resume')!.addEventListener('click', () => this.onResume?.());
    this.root.querySelector('.restart')!.addEventListener('click', () => this.onRestart?.());
    this.root.querySelector('.quit')!.addEventListener('click', () => this.onQuit?.());
    const mute = this.root.querySelector<HTMLButtonElement>('.mute')!;
    mute.addEventListener('click', () => {
      const m = this.onMute?.() ?? false;
      mute.textContent = m ? 'Sound: off' : 'Sound: on';
    });
  }

  results(rows: ResultRow[]): void {
    this.root.dataset.screen = 'results';
    const me = rows.findIndex((r) => r.player) + 1;
    const lines = rows
      .map(
        (r, i) => `
        <tr class="${r.player ? 'me' : ''}">
          <td class="p">${ordinal(i + 1)}</td>
          <td><span class="swatch" style="background:${hex(r.gorilla.accent)}"></span>${escapeHtml(r.gorilla.name)}</td>
          <td class="t">${r.dnf ? '🔥 TOASTED' : r.time === null ? '—' : formatTime(r.time)}</td>
        </tr>`,
      )
      .join('');
    const toasted = rows.find((r) => r.player)?.dnf;
    const cheer = toasted ? 'TOASTED!' : me === 1 ? 'TOP BANANA!' : me <= 3 ? 'ON THE PODIUM!' : 'BANANA PEELED…';
    this.root.innerHTML = `
      <div class="panel results">
        <h2>${cheer}</h2>
        <table>${lines}</table>
        <div class="row">
          <button class="big again">RACE AGAIN</button>
          <button class="choose">Choose gorilla</button>
        </div>
      </div>`;
    this.root.querySelector('.again')!.addEventListener('click', () => this.onRestart?.());
    this.root.querySelector('.choose')!.addEventListener('click', () => this.onQuit?.());
  }
}
