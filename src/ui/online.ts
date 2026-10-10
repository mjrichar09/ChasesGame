/**
 * The online screens: pick a name, host a room or join one by its four-digit
 * code, then the room itself — who's in, which gorillas are taken, and (for
 * the host) the track and race settings.
 *
 * Drawn into the same overlay as the other menus (`Menu.root`), so the 3D
 * gorilla podium stays the centrepiece behind it. Phone first: big tap
 * targets, a numeric keypad for the code, a Share button for the invite.
 */

import { GORILLAS } from '../data/gorillas.js';
import { TRACKS } from '../data/tracks/index.js';
import type { Difficulty } from '../sim/driver.js';
import { MOVES, MOVE_INFO, MOVE_NAMES } from '../sim/swagger.js';
import { MAX_PLAYERS, type Seat, type Settings } from '../net/protocol.js';
import { escapeHtml } from './escape.js';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export interface RoomView {
  code: string;
  /** This phone is the host (it picks the settings and starts). */
  hosting: boolean;
  seats: readonly Seat[];
  settings: Settings;
  /** This phone's seat id. */
  me: string;
}

export class OnlineMenu {
  onHost: ((name: string) => void) | null = null;
  onJoin: ((name: string, code: string) => void) | null = null;
  onBack: (() => void) | null = null;
  onCancel: (() => void) | null = null;
  onPick: ((gorilla: number) => void) | null = null;
  onSettings: ((s: Partial<Settings>) => void) | null = null;
  onStart: (() => void) | null = null;
  onLeave: (() => void) | null = null;
  onGesture: (() => void) | null = null;

  constructor(private readonly root: HTMLElement) {}

  private on(sel: string, fn: (el: HTMLElement) => void): void {
    for (const el of this.root.querySelectorAll<HTMLElement>(sel)) {
      el.addEventListener('click', () => {
        this.onGesture?.();
        fn(el);
      });
    }
  }

  /** Name, then host or join. */
  lobby(name: string, code = '', error = ''): void {
    this.root.dataset.screen = 'online';
    this.root.innerHTML = `
      <div class="panel online">
        <h2>PLAY ONLINE</h2>
        <label class="field"><span>Your name</span>
          <input class="player-name" maxlength="12" autocomplete="nickname" enterkeyhint="done" spellcheck="false" value="${escapeHtml(name)}" />
        </label>
        <button class="big host">HOST A ROOM</button>
        <div class="or">or join a friend’s room</div>
        <div class="join-row">
          <input class="code" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="0000" autocomplete="off" value="${escapeHtml(code)}" aria-label="Room code" />
          <button class="join">JOIN</button>
        </div>
        <p class="err" ${error ? '' : 'hidden'}>${escapeHtml(error)}</p>
        <p class="hint">Up to ${MAX_PLAYERS} players — AI gorillas fill the empty karts. The host’s phone runs the race, so the host keeps the game open.</p>
        <button class="back">Back</button>
      </div>`;
    const nameIn = this.root.querySelector<HTMLInputElement>('.player-name')!;
    const codeIn = this.root.querySelector<HTMLInputElement>('.code')!;
    codeIn.addEventListener('input', () => {
      codeIn.value = codeIn.value.replace(/\D/g, '').slice(0, 4);
    });
    const join = () => {
      const c = codeIn.value.trim();
      if (!/^\d{4}$/.test(c)) {
        this.error('Room codes are four digits.');
        codeIn.focus();
        return;
      }
      this.onJoin?.(nameIn.value, c);
    };
    codeIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') join();
    });
    this.on('.host', () => this.onHost?.(nameIn.value));
    this.on('.join', join);
    this.on('.back', () => this.onBack?.());
    if (code && !error) codeIn.focus();
  }

  private error(text: string): void {
    const p = this.root.querySelector<HTMLElement>('.err');
    if (!p) return;
    p.hidden = false;
    p.textContent = text;
  }

  /** Waiting on the network, with a way out. */
  busy(text: string): void {
    this.root.dataset.screen = 'online';
    this.root.innerHTML = `
      <div class="panel online">
        <h2 class="busy">${escapeHtml(text)}</h2>
        <div class="spinner" aria-hidden="true">🍌</div>
        <button class="cancel">Cancel</button>
      </div>`;
    this.on('.cancel', () => this.onCancel?.());
  }

  /** The room. Redrawn whenever anything in it changes. */
  room(v: RoomView): void {
    this.root.dataset.screen = 'room';
    const mine = v.seats.find((s) => s.id === v.me) ?? v.seats[0]!;
    const takenBy = new Map(v.seats.map((s) => [s.gorilla, s]));
    const g = GORILLAS[mine.gorilla]!;
    const move = MOVES[mine.gorilla]!;
    const players = v.seats
      .map((s, i) => {
        const gor = GORILLAS[s.gorilla]!;
        return `<span class="chip ${s.id === v.me ? 'me' : ''}"><i style="background:${hex(gor.kartColor)}"></i>${escapeHtml(s.name)}${i === 0 ? ' 👑' : ''}</span>`;
      })
      .join('');
    const ai = MAX_PLAYERS - v.seats.length;
    const cards = GORILLAS.map((gor, i) => {
      const who = takenBy.get(i);
      const taken = who && who.id !== v.me;
      return `
        <button class="card ${who?.id === v.me ? 'on' : ''} ${taken ? 'taken' : ''}" data-i="${i}" ${taken ? 'disabled' : ''} style="--c:${hex(gor.kartColor)};--a:${hex(gor.accent)}">
          <span class="swatch" style="background:${hex(gor.fur)}"></span>
          <span class="name">${escapeHtml(gor.name)}</span>
          ${taken ? `<span class="by">${escapeHtml(who.name)}</span>` : ''}
        </button>`;
    }).join('');
    const s = v.settings;
    const seg = (cls: string, label: string, opts: [string, string][], on: string) =>
      `<div class="difficulty ${cls}" role="radiogroup" aria-label="${label}"><span>${label}</span>${opts
        .map(([val, text]) => `<button data-v="${val}" class="${val === on ? 'on' : ''}" ${v.hosting ? '' : 'disabled'}>${text}</button>`)
        .join('')}</div>`;
    const settings = TRACKS[s.track]!.open
      ? ''
      : seg('laps', 'Laps', [['1', '1'], ['2', '2'], ['3', '3']], String(s.laps));
    this.root.innerHTML = `
      <div class="select room">
        <div class="room-top">
          <div class="room-code"><span>ROOM</span><b>${escapeHtml(v.code)}</b><button class="share">Invite</button></div>
          <div class="room-players">${players}${ai > 0 ? `<span class="chip ai">+${ai} AI</span>` : ''}</div>
          <div class="tracks">${TRACKS.map(
            (t, i) => `<button class="track ${i === s.track ? 'on' : ''}" data-t="${i}" ${v.hosting ? '' : 'disabled'}><b>${escapeHtml(t.name)}</b></button>`,
          ).join('')}</div>
        </div>
        <div class="who"><div class="who-name">${escapeHtml(g.name)}</div><div class="who-tag">${escapeHtml(g.tagline)}</div>
          <div class="who-move" ${s.swagger ? '' : 'style="display:none"'}><b>★ ${MOVE_NAMES[move]}</b><span>${escapeHtml(MOVE_INFO[move])}</span></div></div>
        <div class="cards">${cards}</div>
        <div class="select-foot room-foot">
          ${settings}
          ${seg('rivals', 'Rivals', [['chill', 'Chill'], ['normal', 'Normal'], ['wild', 'Wild']], s.difficulty)}
          ${seg('swagger-toggle', 'Swagger', [['on', 'On'], ['off', 'Off']], s.swagger ? 'on' : 'off')}
          <button class="leave">Leave</button>
          ${v.hosting ? '<button class="big go">START!</button>' : '<div class="waiting">Waiting for the host to start…</div>'}
        </div>
      </div>`;
    this.on('.card', (el) => this.onPick?.(Number(el.dataset.i)));
    this.on('.share', () => void share(v.code, this.root.querySelector<HTMLButtonElement>('.share')!));
    this.on('.leave', () => this.onLeave?.());
    if (!v.hosting) return;
    this.on('.go', () => this.onStart?.());
    this.on('.track', (el) => this.onSettings?.({ track: Number(el.dataset.t) }));
    this.on('.laps button', (el) => this.onSettings?.({ laps: Number(el.dataset.v) }));
    this.on('.rivals button', (el) => this.onSettings?.({ difficulty: el.dataset.v as Difficulty }));
    this.on('.swagger-toggle button', (el) => this.onSettings?.({ swagger: el.dataset.v === 'on' }));
  }
}

/** The link that opens straight into a room. */
export function roomLink(code: string): string {
  const url = new URL(location.href);
  url.search = '';
  const peer = new URLSearchParams(location.search).get('peer');
  if (peer) url.searchParams.set('peer', peer);
  url.searchParams.set('room', code);
  return url.toString();
}

/** Share the invite: the phone's share sheet, or copy the link. */
async function share(code: string, button: HTMLButtonElement): Promise<void> {
  const url = roomLink(code);
  const text = `Race me in Jungle Jalopies! Room ${code}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Jungle Jalopies', text, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    button.textContent = 'Link copied!';
  } catch {
    // Share sheet dismissed, or no clipboard: the code is on screen anyway.
  }
}
