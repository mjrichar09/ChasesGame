/**
 * The race HUD: a DOM overlay over the canvas.
 *
 * Position and lap top-left, the item slot top-right (one item at a time, so
 * one slot, with pips for the bananas or swings left), a minimap, the
 * countdown, and big cartoon callouts for the moments that matter.
 */

import type { Gorilla } from '../data/gorillas.js';
import type { RaceSim } from '../sim/race.js';
import { MOVE_NAMES } from '../sim/swagger.js';

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
  private readonly swag: HTMLElement;
  private swagShown = '';
  private readonly speed: HTMLElement;
  private readonly center: HTMLElement;
  private readonly callout: HTMLElement;
  private readonly map: HTMLCanvasElement;
  private readonly lava: HTMLElement;
  private readonly heat: HTMLElement;
  private readonly lines: HTMLElement;
  private linesOn = 0;
  private mapPath: Path2D | null = null;
  private mapXf = { x0: 0, z0: 0, k: 1 };
  private lastCount = -1;
  private calloutTimer = 0;
  private lastItem = '';
  /** Touch controls are showing (changes the swagger hint). */
  touchMode = false;
  /** The on-screen pause button (the only way to pause on a phone). */
  onPause: (() => void) | null = null;

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
      <div class="hud-swagger"><div class="ring"><b>★</b></div><span class="name"></span></div>
      <canvas class="hud-map" width="180" height="180"></canvas>
      <div class="hud-speed"><span>0</span> km/h</div>
      <div class="hud-lava"><span class="lbl">LAVA</span> <b>0</b> m</div>
      <div class="hud-heat"></div>
      <div class="hud-speedlines"></div>
      <div class="hud-vignette"></div>
      <button class="hud-pause" aria-label="Pause">⏸</button>
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
    this.swag = q('.hud-swagger');
    this.speed = q('.hud-speed span');
    this.center = q('.hud-center');
    this.callout = q('.hud-callout');
    this.map = q('.hud-map') as HTMLCanvasElement;
    this.lava = q('.hud-lava');
    q('.hud-pause').addEventListener('click', () => this.onPause?.());
    this.heat = q('.hud-heat');
    this.lines = q('.hud-speedlines');
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
    if (sim.track.closed) path.closePath();
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
    if (pr.dnf) this.lap.textContent = 'TOASTED';
    else if (pr.finishTime !== null) this.lap.textContent = sim.track.closed ? 'FINISHED' : 'ESCAPED!';
    else if (!sim.track.closed) this.lap.textContent = `ESCAPE ${Math.max(0, Math.min(99, Math.floor((pr.dist / sim.raceLength) * 100)))}%`;
    else this.lap.textContent = `LAP ${lap}/${sim.laps}`;

    // How close is the lava?
    const lavaS = sim.lavaS;
    const hasLava = !!sim.track.def.lava && pr.finishTime === null && !pr.dnf;
    this.lava.style.display = hasLava ? '' : 'none';
    let heat = 0;
    if (hasLava) {
      const gap = Number.isFinite(lavaS) ? Math.max(0, pr.s - lavaS) : 999;
      this.lava.querySelector('b')!.textContent = gap > 500 ? '500+' : String(Math.round(gap));
      this.lava.classList.toggle('near', gap < 60);
      heat = Math.max(0, 1 - gap / 70);
    }
    this.heat.style.opacity = String(heat * (0.75 + Math.sin(performance.now() / 120) * 0.25));
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

    // Speed lines at the edges when boosting or flat out.
    const fast = kart.boosting || kart.noBrakesTime > 0 ? 1 : Math.max(0, (kart.forwardSpeed - 30) / 8);
    this.linesOn += (Math.min(1, fast) - this.linesOn) * Math.min(1, dt * 8);
    this.lines.style.opacity = String(this.linesOn * 0.85);

    // Swagger meter: a ring filling gold; full shows the move's name and how to fire it.
    this.swag.style.display = sim.swaggerOn ? '' : 'none';
    if (sim.swaggerOn) {
      const full = kart.swagger >= 100;
      const key = `${Math.floor(kart.swagger)}/${full}/${kart.move}`;
      if (key !== this.swagShown) {
        this.swagShown = key;
        this.swag.style.setProperty('--fill', `${kart.swagger}%`);
        this.swag.classList.toggle('full', full);
        this.swag.querySelector('.name')!.textContent = full ? `${MOVE_NAMES[kart.move]} · ${this.touchMode ? 'HOLD ★' : 'HOLD F'}` : '';
      }
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
    // The lava, eating the route from the top.
    const front = sim.lavaS;
    if (Number.isFinite(front) && front > 0) {
      const lavaPath = new Path2D();
      const end = Math.min(sim.track.samples.length - 1, Math.floor(front));
      for (let i = 0; i <= end; i += 2) {
        const p = sim.track.samples[i]!.p;
        const [x, y] = this.mapPoint(p.x, p.z);
        if (i === 0) lavaPath.moveTo(x, y);
        else lavaPath.lineTo(x, y);
      }
      c.strokeStyle = '#ff5a10';
      c.lineWidth = 8;
      c.stroke(lavaPath);
      const fp = sim.track.at(front).p;
      const [fx, fy] = this.mapPoint(fp.x, fp.z);
      c.fillStyle = '#ffd23a';
      c.beginPath();
      c.arc(fx, fy, 5 + Math.sin(performance.now() / 150) * 1.5, 0, Math.PI * 2);
      c.fill();
    }
    // A fallen tree across the road.
    for (const b of sim.track.brush) {
      const p = sim.track.pointAt((b.s0 + b.s1) / 2, 0);
      const [x, y] = this.mapPoint(p.x, p.z);
      c.font = '13px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('🌳', x, y);
    }
    // The finish, on a point-to-point course.
    if (!sim.track.closed) {
      const fp = sim.track.at(sim.track.finishS).p;
      const [fx, fy] = this.mapPoint(fp.x, fp.z);
      c.font = '14px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('🏁', fx, fy);
    }
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
      if (sim.progress[i]!.dnf) continue;
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
