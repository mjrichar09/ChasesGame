/**
 * The race HUD: a DOM overlay over the canvas.
 *
 * Position and lap top-left, the item slot top-right (one item at a time, so
 * one slot, with pips for the bananas or swings left), a minimap, the
 * countdown, and big cartoon callouts for the moments that matter.
 */

import type { Gorilla } from '../data/gorillas.js';
import type { RaceSim } from '../sim/race.js';

const ORDINAL = ['th', 'st', 'nd', 'rd'];
export const ordinal = (n: number): string => {
  const v = n % 100;
  return `${n}${ORDINAL[(v - 20) % 10] ?? ORDINAL[v] ?? ORDINAL[0]}`;
};

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export class Hud {
  readonly root: HTMLDivElement;
  private readonly pos: HTMLElement;
  private readonly lap: HTMLElement;
  private readonly time: HTMLElement;
  private readonly item: HTMLElement;
  private readonly pips: HTMLElement;
  private readonly flight: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly center: HTMLElement;
  private readonly callout: HTMLElement;
  private readonly map: HTMLCanvasElement;
  private mapPath: Path2D | null = null;
  private mapXf = { x0: 0, z0: 0, k: 1 };
  private lastCount = -1;
  private calloutTimer = 0;
  private lastItem = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-tl">
        <div class="hud-pos"><span class="n">1st</span><span class="of">/8</span></div>
        <div class="hud-lap">LAP 1/3</div>
        <div class="hud-time">0:00.0</div>
      </div>
      <div class="hud-tr">
        <div class="hud-item"><span class="icon"></span></div>
        <div class="hud-pips"></div>
        <div class="hud-flight"><i></i></div>
      </div>
      <canvas class="hud-map" width="180" height="180"></canvas>
      <div class="hud-speed"><span>0</span> km/h</div>
      <div class="hud-center"></div>
      <div class="hud-callout"></div>`;
    parent.appendChild(this.root);
    const q = (s: string) => this.root.querySelector<HTMLElement>(s)!;
    this.pos = q('.hud-pos');
    this.lap = q('.hud-lap');
    this.time = q('.hud-time');
    this.item = q('.hud-item');
    this.pips = q('.hud-pips');
    this.flight = q('.hud-flight');
    this.speed = q('.hud-speed span');
    this.center = q('.hud-center');
    this.callout = q('.hud-callout');
    this.map = q('.hud-map') as HTMLCanvasElement;
  }

  show(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
  }

  /** Bake the track outline into a path once per race. */
  setTrack(sim: RaceSim): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of sim.track.samples) {
      minX = Math.min(minX, s.p.x);
      maxX = Math.max(maxX, s.p.x);
      minZ = Math.min(minZ, s.p.z);
      maxZ = Math.max(maxZ, s.p.z);
    }
    const size = this.map.width - 24;
    const k = size / Math.max(maxX - minX, maxZ - minZ);
    this.mapXf = { x0: (minX + maxX) / 2, z0: (minZ + maxZ) / 2, k };
    const path = new Path2D();
    sim.track.samples.forEach((s, i) => {
      const [x, y] = this.mapPoint(s.p.x, s.p.z);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.closePath();
    this.mapPath = path;
  }

  private mapPoint(x: number, z: number): [number, number] {
    const c = this.map.width / 2;
    // Looking down with +Z up the page; +X (the kart's left at the start) to the left.
    return [c - (x - this.mapXf.x0) * this.mapXf.k, c - (z - this.mapXf.z0) * this.mapXf.k];
  }

  /** Flash a big message in the middle of the screen. */
  shout(text: string, kind = '', seconds = 1.2): void {
    this.callout.textContent = text;
    this.callout.className = `hud-callout show ${kind}`;
    this.calloutTimer = seconds;
  }

  update(dt: number, sim: RaceSim, player: number, roster: readonly Gorilla[]): void {
    const pr = sim.progress[player]!;
    const kart = sim.karts[player]!;
    const place = sim.position(player);
    this.pos.querySelector('.n')!.textContent = ordinal(place);
    this.pos.querySelector('.of')!.textContent = `/${sim.karts.length}`;
    this.pos.dataset.place = String(place);
    const lap = Math.min(sim.laps, pr.lap + 1);
    this.lap.textContent = pr.finishTime !== null ? 'FINISHED' : `LAP ${lap}/${sim.laps}`;
    this.time.textContent = formatTime(pr.finishTime ?? sim.raceTime);
    this.speed.textContent = String(Math.round(Math.max(0, kart.forwardSpeed) * 3.6));

    // Item slot.
    const key = `${kart.item}/${kart.charges}`;
    if (key !== this.lastItem) {
      this.lastItem = key;
      this.item.dataset.kind = kart.item;
      this.item.querySelector('.icon')!.textContent =
        kart.item === 'banana' ? '🍌' : kart.item === 'snake' ? '🐍' : kart.item === 'parrot' ? '🦜' : '';
      this.pips.innerHTML = '<i></i>'.repeat(kart.item === 'none' ? 0 : kart.charges);
      if (kart.item !== 'none') this.item.classList.remove('pop'), void this.item.offsetWidth, this.item.classList.add('pop');
    }

    // Flight time left, as a draining bar under the item slot.
    this.flight.style.display = kart.flying ? '' : 'none';
    if (kart.flying) {
      const bar = this.flight.querySelector('i') as HTMLElement;
      bar.style.width = `${Math.max(0, (kart.flyTime / 6) * 100)}%`;
      this.flight.classList.toggle('low', kart.flyTime < 1);
    }

    // Countdown.
    const left = Math.ceil(3 - sim.clock);
    if (sim.phase === 'countdown') {
      if (left !== this.lastCount) {
        this.lastCount = left;
        this.center.textContent = String(left);
        this.center.className = 'hud-center count';
        void this.center.offsetWidth;
        this.center.classList.add('pulse');
      }
    } else if (sim.clock < 4) {
      if (this.lastCount !== 0) {
        this.lastCount = 0;
        this.center.textContent = 'GO!';
        this.center.className = 'hud-center go pulse';
      }
    } else {
      this.center.textContent = '';
      this.center.className = 'hud-center';
    }

    if (this.calloutTimer > 0) {
      this.calloutTimer -= dt;
      if (this.calloutTimer <= 0) this.callout.className = 'hud-callout';
    }

    this.drawMap(sim, player, roster);
  }

  private drawMap(sim: RaceSim, player: number, roster: readonly Gorilla[]): void {
    const c = this.map.getContext('2d')!;
    const w = this.map.width;
    c.clearRect(0, 0, w, w);
    if (!this.mapPath) return;
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(40,25,10,0.65)';
    c.lineWidth = 11;
    c.stroke(this.mapPath);
    c.strokeStyle = '#e9c48a';
    c.lineWidth = 6;
    c.stroke(this.mapPath);
    // Pickups and the river.
    for (const g of sim.track.gaps) {
      const k = sim.track.at((g.s0 + g.s1) / 2);
      const [x, y] = this.mapPoint(k.p.x, k.p.z);
      c.fillStyle = '#2f9fc4';
      c.beginPath();
      c.arc(x, y, 5, 0, Math.PI * 2);
      c.fill();
    }
    // Others first so the player's dot sits on top.
    const order = sim.karts.map((k) => k.index).filter((i) => i !== player);
    order.push(player);
    for (const i of order) {
      const p = sim.karts[i]!.position;
      const [x, y] = this.mapPoint(p.x, p.z);
      c.beginPath();
      c.arc(x, y, i === player ? 6.5 : 4.5, 0, Math.PI * 2);
      c.fillStyle = hex(roster[i]?.accent ?? 0xffffff);
      c.fill();
      c.lineWidth = i === player ? 3 : 1.5;
      c.strokeStyle = i === player ? '#fff' : '#222';
      c.stroke();
    }
  }
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
