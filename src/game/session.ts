/**
 * The game: menus, a race, results — and the frame loop that drives them.
 *
 * The sim steps at a fixed 120 Hz from an accumulator (capped so a stalled
 * tab cannot spiral) and the views blend between the last two steps. The
 * player's input is sampled once per frame and held for that frame's steps;
 * the AI is asked every step, so a race stays a pure function of its seed and
 * inputs.
 *
 * Everything the sim reports (pickups, boosts, peel hits, whacks, respawns,
 * landings) is turned into particles, sounds, camera shake and callouts here,
 * so neither the sim nor the views need to know about each other.
 */

import * as THREE from 'three';
import { GORILLAS, type Gorilla } from '../data/gorillas.js';
import { VINE_VALLEY } from '../data/tracks/jungle1.js';
import { Sound } from '../audio/sound.js';
import { ChaseCam } from '../render/chaseCam.js';
import { Fx } from '../render/fx.js';
import { ItemsView } from '../render/itemsView.js';
import { KartView } from '../render/kartView.js';
import { Stage } from '../render/scene.js';
import { type TrackView, buildTrackView } from '../render/trackView.js';
import { toon } from '../render/toon.js';
import { AiDriver, personality } from '../sim/driver.js';
import { type DriverInput, NEUTRAL_INPUT } from '../sim/input.js';
import { RaceSim } from '../sim/race.js';
import { Rng } from '../sim/rng.js';
import { Track } from '../sim/track.js';
import { Controls } from '../ui/controls.js';
import { Hud } from '../ui/hud.js';
import { Menu, type ResultRow } from '../ui/menu.js';
import { TouchControls } from '../ui/touch.js';

type State = 'menu' | 'race' | 'paused' | 'results';

/** Grid slot the player starts from (0 = pole). Mid-pack: something to chase, something to hold off. */
const PLAYER_SLOT = 4;
const MAX_FRAME = 0.1;

/**
 * Developer switches from the URL: `?laps=1` for short races, `?autopilot`
 * to let the AI drive the player's kart (headless checks, attract mode).
 */
const params = new URLSearchParams(location.search);
const DEV_LAPS = Number(params.get('laps')) || undefined;
const AUTOPILOT = params.has('autopilot');

export class Game {
  private readonly stage: Stage;
  private readonly cam: ChaseCam;
  private readonly controls: Controls;
  private readonly touch: TouchControls;
  private readonly hud: Hud;
  private readonly menu: Menu;
  private readonly sound = new Sound();
  private readonly fx = new Fx();
  private readonly trackView: TrackView;
  private readonly previewTrack: Track;

  private state: State = 'menu';
  private sim: RaceSim | null = null;
  private drivers: AiDriver[] = [];
  private views: KartView[] = [];
  private itemsView: ItemsView | null = null;
  private raceGroup = new THREE.Group();
  private roster: Gorilla[] = [];
  private player = PLAYER_SLOT;
  private chosen = 0;
  private acc = 0;
  private time = 0;
  private last = 0;
  private wasAir: boolean[] = [];
  private lastLap = 0;
  private playerFinishedAt: number | null = null;
  private seed = 1;

  // Menu preview.
  private preview: KartView | null = null;
  private readonly podium = new THREE.Group();
  private orbit = 0;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement) {
    this.stage = new Stage(canvas);
    this.cam = new ChaseCam(1);
    this.fx.density = this.stage.quality.particles;
    this.stage.scene.add(this.fx.points);

    this.previewTrack = new Track(VINE_VALLEY);
    this.trackView = buildTrackView(this.previewTrack);
    this.stage.scene.add(this.trackView.group);
    this.stage.scene.add(this.raceGroup);
    this.buildPodium();

    this.controls = new Controls();
    this.touch = new TouchControls(overlay);
    this.touch.show(false);
    this.controls.sources.push(this.touch);
    this.controls.onPause = () => this.togglePause();
    this.hud = new Hud(overlay);
    this.hud.show(false);
    this.menu = new Menu(overlay);
    this.menu.onGesture = () => this.sound.unlock();
    this.menu.onPreview = (i) => this.showPreview(i);
    this.menu.onStart = (i) => {
      this.chosen = i;
      this.startRace();
    };
    this.menu.onResume = () => this.togglePause();
    this.menu.onRestart = () => this.startRace();
    this.menu.onQuit = () => this.toMenu();
    this.menu.onMute = () => this.sound.toggleMute();

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.menu.title();
    this.showPreview(0);
    requestAnimationFrame((t) => this.frame(t));
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.stage.resize(w, h);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
    this.fx.setViewportHeight(h * this.stage.quality.pixelRatio);
  }

  // ---------------------------------------------------------------- menu

  private buildPodium(): void {
    const k = this.previewTrack.at(-60);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 0.6, 28), toon(0x8a5a33));
    const top = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.12, 28), toon(0xf2c14e));
    top.position.y = 0.36;
    base.add(top);
    base.receiveShadow = true;
    this.podium.add(base);
    this.podium.position.set(k.p.x, k.p.y + 0.3, k.p.z);
    this.stage.scene.add(this.podium);
  }

  private showPreview(i: number): void {
    if (this.preview) this.podium.remove(this.preview.object);
    this.preview = new KartView(GORILLAS[i]!);
    this.preview.restPose();
    this.preview.object.position.set(0, 1.4, 0);
    this.podium.add(this.preview.object);
  }

  private toMenu(): void {
    this.endRace();
    this.state = 'menu';
    this.hud.show(false);
    this.touch.show(false);
    this.podium.visible = true;
    this.sound.stopEngine();
    this.menu.select(this.chosen);
  }

  // ---------------------------------------------------------------- race

  private endRace(): void {
    this.sim?.free();
    this.sim = null;
    this.stage.scene.remove(this.raceGroup);
    this.raceGroup = new THREE.Group();
    this.stage.scene.add(this.raceGroup);
    this.views = [];
    this.itemsView = null;
  }

  private startRace(): void {
    this.endRace();
    this.seed = (this.seed * 7919 + 13) % 100000;
    const sim = new RaceSim(VINE_VALLEY, { seed: this.seed, laps: DEV_LAPS });
    this.sim = sim;
    this.player = PLAYER_SLOT;

    // The player's gorilla in their slot; the other seven fill the grid in a shuffled order.
    const others = GORILLAS.filter((_, i) => i !== this.chosen);
    const rng = new Rng(this.seed);
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [others[i], others[j]] = [others[j]!, others[i]!];
    }
    this.roster = sim.karts.map((_, i) => (i === this.player ? GORILLAS[this.chosen]! : others.shift()!));
    this.drivers = sim.karts.map((k) => new AiDriver(personality(sim.rng, k.index)));
    this.views = sim.karts.map((k, i) => {
      const v = new KartView(this.roster[i]!);
      v.capture(k, true);
      this.raceGroup.add(v.object);
      return v;
    });
    this.itemsView = new ItemsView(sim.items);
    this.raceGroup.add(this.itemsView.group);
    this.wasAir = sim.karts.map(() => false);
    this.lastLap = 0;
    this.playerFinishedAt = null;
    this.acc = 0;

    this.hud.setTrack(sim);
    this.hud.show(true);
    this.touch.show(TouchControls.wanted());
    this.menu.hide();
    this.podium.visible = false;
    this.cam.cut();
    this.state = 'race';
    this.sound.unlock();
    this.sound.startEngine();
  }

  private togglePause(): void {
    if (this.state === 'race') {
      this.state = 'paused';
      this.menu.pause(this.sound.muted);
      this.sound.stopEngine();
    } else if (this.state === 'paused') {
      this.state = 'race';
      this.menu.hide();
      this.sound.startEngine();
    }
  }

  private stepRace(dt: number): void {
    const sim = this.sim!;
    this.acc += dt;
    const human: DriverInput = this.controls.sample(dt);
    const playerPr = sim.progress[this.player]!;
    const playerDone = playerPr.finishTime !== null;
    while (this.acc >= sim.dt) {
      this.acc -= sim.dt;
      const inputs = sim.karts.map((k, i) => {
        if (i === this.player && !playerDone && !AUTOPILOT) return human;
        return this.drivers[i]!.drive(sim.dt, k, sim.progress[i]!, sim.track, sim.karts, sim.items, playerPr.dist);
      });
      sim.step(sim.phase === 'countdown' ? sim.karts.map(() => NEUTRAL_INPUT) : inputs);
      sim.karts.forEach((k, i) => this.views[i]!.capture(k, sim.respawned.includes(i)));
      this.handleEvents(sim);
    }

    // Lap and finish callouts for the player.
    if (playerPr.lap !== this.lastLap && playerPr.finishTime === null) {
      this.lastLap = playerPr.lap;
      this.sound.play('lap');
      this.hud.shout(playerPr.lap === sim.laps - 1 ? 'FINAL LAP!' : `LAP ${playerPr.lap + 1}`, 'lap');
    }
    if (playerDone && this.playerFinishedAt === null) {
      this.playerFinishedAt = this.time;
      this.sound.play('finish');
      const place = sim.position(this.player);
      this.hud.shout(place === 1 ? 'YOU WIN!' : `FINISHED ${place}${['st', 'nd', 'rd'][place - 1] ?? 'th'}`, 'finish', 3);
    }
    if (this.playerFinishedAt !== null && (sim.allFinished || this.time - this.playerFinishedAt > 10)) {
      this.showResults();
    }
  }

  private showResults(): void {
    const sim = this.sim!;
    this.state = 'results';
    this.sound.stopEngine();
    this.touch.show(false);
    const rows: ResultRow[] = sim.standings().map((i) => ({
      gorilla: this.roster[i]!,
      time: sim.progress[i]!.finishTime,
      player: i === this.player,
    }));
    this.menu.results(rows);
  }

  private nearPlayer(pos: { x: number; y: number; z: number }): number {
    const p = this.sim!.karts[this.player]!.position;
    const d = Math.hypot(pos.x - p.x, pos.y - p.y, pos.z - p.z);
    return Math.max(0, 1 - d / 70);
  }

  private handleEvents(sim: RaceSim): void {
    const v = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);
    for (const e of sim.items.events) {
      const vol = e.kart === this.player ? 1 : this.nearPlayer(e.pos);
      switch (e.type) {
        case 'pickup':
          this.fx.emit({ pos: v(e.pos).setY(e.pos.y + 0.3), count: 26, color: e.kind === 'banana' ? [0xffe14d, 0xfff6b0] : [0x7dff6a, 0xd9ff9a], speed: [3, 8], size: [0.25, 0.5], life: [0.4, 0.8], gravity: 4 });
          if (vol > 0) this.sound.play('pickup', vol);
          break;
        case 'boost':
          if (vol > 0) this.sound.play('boost', vol);
          if (e.kart === this.player) this.hud.shout('BANANA BOOST!', 'boost', 0.9);
          break;
        case 'peelDrop':
          if (vol > 0) this.sound.play('peelDrop', vol * 0.7);
          break;
        case 'peelHit':
          this.fx.emit({ pos: v(e.pos).setY(e.pos.y + 0.8), count: 22, color: [0xffe14d, 0xffffff], speed: [3, 7], size: [0.3, 0.6], life: [0.4, 0.9], gravity: 6 });
          if (vol > 0) this.sound.play('peelHit', vol);
          if (e.kart === this.player) {
            this.hud.shout('SLIPPED!', 'bad');
            this.cam.kick(0.4);
          }
          break;
        case 'swing':
          if (vol > 0) this.sound.play('swing', vol);
          break;
        case 'whack':
          this.fx.emit({ pos: v(e.pos).setY(e.pos.y + 1.2), count: 18, color: [0xffffff, 0xffe14d], speed: [4, 9], size: [0.3, 0.55], life: [0.3, 0.6] });
          if (vol > 0 || e.victim === this.player) this.sound.play('whack', Math.max(vol, e.victim === this.player ? 1 : 0));
          if (e.kart === this.player) this.hud.shout('WHACK!', 'good', 0.8);
          if (e.victim === this.player) {
            this.hud.shout('OOF!', 'bad', 0.8);
            this.cam.kick(0.6);
          }
          break;
      }
    }
    sim.items.events = [];

    for (const i of sim.respawned) {
      const pr = sim.progress[i]!;
      if (pr.lastRespawn === 'fell' && sim.track.gaps.length) {
        const k = sim.karts[i]!.position;
        if (i === this.player || this.nearPlayer(k) > 0) this.sound.play('splash', i === this.player ? 1 : 0.5);
      }
      if (i === this.player) {
        this.cam.cut();
        if (pr.lastRespawn === 'fell') this.hud.shout('SPLASH!', 'bad');
      }
    }

    // Landings.
    sim.karts.forEach((k, i) => {
      const air = k.airTime > 0.25;
      if (this.wasAir[i] && k.grounded > 0) {
        const hard = Math.min(1, k.lastLanding / 9);
        const p = k.position;
        this.fx.emit({ pos: new THREE.Vector3(p.x, p.y - 0.8, p.z), count: Math.round(6 + hard * 18), color: [0xc9a46c, 0xa8865a], speed: [2, 6], dir: new THREE.Vector3(0, 0.4, 0), spread: 1, size: [0.6, 1.2], life: [0.4, 0.9], gravity: 1 });
        const vol = i === this.player ? 1 : this.nearPlayer(p);
        if (vol > 0 && hard > 0.15) this.sound.play('land', vol * hard);
        if (i === this.player) this.cam.kick(hard * 0.5);
      }
      this.wasAir[i] = air;
    });
  }

  /** Per-frame effects: dust, boost flames. */
  private ambientFx(sim: RaceSim): void {
    const camPos = this.cam.camera.position;
    sim.karts.forEach((k, i) => {
      const view = this.views[i]!;
      if (view.pos.distanceTo(camPos) > 80) return;
      const speed = Math.abs(k.forwardSpeed);
      if (k.grounded >= 2 && speed > 6 && Math.random() < speed / 40) {
        const back = new THREE.Vector3(0, -0.9, -1).applyQuaternion(view.rot).add(view.pos);
        this.fx.emit({ pos: back, count: 1, color: [0xd2b07a, 0xbf9a62], speed: [0.5, 2], dir: new THREE.Vector3(0, 0.6, 0), spread: 1, size: [0.5, 1.0], life: [0.4, 0.8] });
      }
      if (k.boosting) {
        const ex = view.rig.exhaust.clone().applyQuaternion(view.rot).add(view.pos);
        const back = new THREE.Vector3(0, 0.2, -1).applyQuaternion(view.rot);
        this.fx.emit({ pos: ex, count: 3, color: [0xffe14d, 0xff8a1f, 0xff4d1f], speed: [3, 7], dir: back, spread: 0.25, size: [0.35, 0.7], life: [0.15, 0.35], drag: 4 });
      }
      if (k.spinning && Math.random() < 0.5) {
        const p = view.pos.clone().setY(view.pos.y + 1.8);
        this.fx.emit({ pos: p, count: 1, color: [0xffe14d, 0xffffff], speed: [1, 2], size: [0.25, 0.4], life: [0.3, 0.5] });
      }
    });
  }

  // ---------------------------------------------------------------- frame

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const dt = this.last ? Math.min(MAX_FRAME, (now - this.last) / 1000) : 0;
    this.last = now;
    this.time += dt;
    this.trackView.update(this.time);

    const sim = this.sim;
    if (sim && (this.state === 'race' || this.state === 'results')) {
      if (this.state === 'race') this.stepRace(dt);
      else {
        // Keep the race running behind the results screen.
        this.acc += dt;
        while (this.acc >= sim.dt) {
          this.acc -= sim.dt;
          sim.step(sim.karts.map((k, i) => this.drivers[i]!.drive(sim.dt, k, sim.progress[i]!, sim.track, sim.karts, sim.items, null)));
          sim.karts.forEach((k, i) => this.views[i]!.capture(k, sim.respawned.includes(i)));
          sim.items.events = [];
        }
      }
    }

    if (sim) {
      const alpha = this.acc / sim.dt;
      sim.karts.forEach((k, i) => this.views[i]!.update(k, alpha, dt));
      this.itemsView?.update(sim.items, this.time);
      if (this.state !== 'paused') this.ambientFx(sim);
      const me = this.views[this.player]!;
      const kart = sim.karts[this.player]!;
      if (this.state !== 'paused') {
        this.cam.update(dt, me.pos, me.rot, {
          boosting: kart.boosting,
          spinning: kart.spinning,
          speed: kart.forwardSpeed,
          track: sim.track,
          s: sim.progress[this.player]!.s,
        });
      }
      this.stage.followSun(me.pos);
      if (this.state === 'race') {
        this.hud.update(dt, sim, this.player, this.roster);
        this.sound.updateEngine(dt, kart.forwardSpeed, kart.applied.throttle, kart.grounded === 0, kart.boosting);
      }
    } else {
      this.menuCamera(dt);
    }

    if (this.state !== 'paused') this.fx.update(dt);
    this.stage.renderer.render(this.stage.scene, this.cam.camera);
  }

  private menuCamera(dt: number): void {
    this.orbit += dt * 0.35;
    const p = this.podium.position;
    if (this.preview) {
      this.preview.object.rotation.y = this.orbit * 1.4;
      // Idle bounce on the podium.
      const bounce = Math.abs(Math.sin(this.time * 2.2)) * 0.25;
      this.preview.object.position.y = 1.35 + bounce;
    }
    const cam = this.cam.camera;
    const portrait = cam.aspect < 1;
    const r = portrait ? 9.5 : 6.5;
    cam.position.set(p.x + Math.sin(0.6) * r, p.y + 2.6, p.z + Math.cos(0.6) * r);
    cam.lookAt(p.x, p.y + 1.6 - (portrait ? 0.6 : 0), p.z);
    cam.fov = 55;
    cam.updateProjectionMatrix();
    this.stage.followSun(p);
  }
}

