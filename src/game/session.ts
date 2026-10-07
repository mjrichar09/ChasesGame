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
import { TRACKS } from '../data/tracks/index.js';
import { LOOKS } from '../data/tracks/looks.js';
import { Sound } from '../audio/sound.js';
import { ChaseCam } from '../render/chaseCam.js';
import { Fx } from '../render/fx.js';
import { ItemsView } from '../render/itemsView.js';
import { KartView } from '../render/kartView.js';
import { Stage } from '../render/scene.js';
import { type TrackView, buildTrackView } from '../render/trackView.js';
import { toon } from '../render/toon.js';
import { AiDriver, type Difficulty, fieldLevels, personality } from '../sim/driver.js';
import { type DriverInput, NEUTRAL_INPUT } from '../sim/input.js';
import { Items } from '../sim/items.js';
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
/** `?give=parrot` (or banana/snake): hand the player that item at GO, for testing. */
const GIVE = params.get('give') as 'banana' | 'snake' | 'parrot' | null;

export class Game {
  private readonly stage: Stage;
  private readonly cam: ChaseCam;
  private readonly controls: Controls;
  private readonly touch: TouchControls;
  private readonly hud: Hud;
  private readonly menu: Menu;
  private readonly sound = new Sound();
  private readonly fx = new Fx();
  /** Each circuit's scenery, built the first time it is picked. */
  private readonly venues: { track: Track; view: TrackView }[] = [];
  private trackIndex = 0;

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
  private wasWet: boolean[] = [];
  private flapTimer = 0;
  private eruptTimer = 0;
  private warned = false;
  private lastLap = 0;
  private playerFinishedAt: number | null = null;
  private seed = 1;
  private difficulty: Difficulty = loadDifficulty();

  // Menu preview.
  private preview: KartView | null = null;
  private readonly podium = new THREE.Group();
  private orbit = 0;
  /** Seconds until the preview gorilla celebrates again. */
  private encore = 0;
  /** The finish podium: top three, standing and celebrating, behind the results. */
  private finishPodium: THREE.Group | null = null;
  private finishViews: KartView[] = [];

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement) {
    this.stage = new Stage(canvas);
    this.cam = new ChaseCam(1);
    this.fx.density = this.stage.quality.particles;
    this.stage.scene.add(this.fx.points);

    this.stage.scene.add(this.raceGroup);
    this.buildPodium();
    this.selectTrack(0);

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
    this.menu.onTrack = (i) => this.selectTrack(i);
    this.menu.difficulty = this.difficulty;
    this.menu.onDifficulty = (d) => {
      this.difficulty = d;
      try {
        localStorage.setItem('jj-difficulty', d);
      } catch {
        // Storage blocked — the choice just lasts this visit.
      }
    };
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

  /** Show a circuit: build its scenery on first use, swap the sky and light. */
  private selectTrack(i: number): void {
    this.trackIndex = i;
    TRACKS.forEach((def, j) => {
      if (j === i && !this.venues[j]) {
        const track = new Track(def);
        const view = buildTrackView(track, LOOKS[def.id]!);
        this.stage.scene.add(view.group);
        this.venues[j] = { track, view };
      }
      if (this.venues[j]) this.venues[j]!.view.group.visible = j === i;
    });
    this.stage.applyLook(LOOKS[TRACKS[i]!.id]!);
    const k = this.venues[i]!.track.at(-45);
    this.podium.position.set(k.p.x, k.p.y + 0.3, k.p.z);
  }

  private buildPodium(): void {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 0.6, 28), toon(0x8a5a33));
    const top = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.12, 28), toon(0xf2c14e));
    top.position.y = 0.36;
    base.add(top);
    base.receiveShadow = true;
    this.podium.add(base);
    this.stage.scene.add(this.podium);
  }

  private showPreview(i: number): void {
    if (this.preview) this.podium.remove(this.preview.object);
    this.preview = new KartView(GORILLAS[i]!);
    this.preview.restPose();
    this.preview.object.position.set(0, 1.4, 0);
    this.podium.add(this.preview.object);
    this.preview.celebrate(2.6, false);
    this.encore = 5;
  }

  private toMenu(): void {
    this.endRace();
    this.state = 'menu';
    this.hud.show(false);
    this.touch.show(false);
    this.podium.visible = true;
    this.sound.stopEngine();
    this.menu.select(this.chosen, this.trackIndex);
  }

  // ---------------------------------------------------------------- race

  private endRace(): void {
    if (this.finishPodium) this.stage.scene.remove(this.finishPodium);
    this.finishPodium = null;
    this.finishViews = [];
    this.raceGroup.visible = true;
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
    const sim = new RaceSim(TRACKS[this.trackIndex]!, { seed: this.seed, laps: DEV_LAPS });
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
    // A spread of skill across the field, set by the difficulty.
    const levels = fieldLevels(this.difficulty, sim.karts.length - 1, new Rng(this.seed + 7));
    let next = 0;
    this.drivers = sim.karts.map(
      (k) => new AiDriver(personality(sim.rng, k.index, k.index === this.player ? 0.8 : levels[next++]!)),
    );
    this.views = sim.karts.map((k, i) => {
      const v = new KartView(this.roster[i]!);
      v.capture(k, true);
      this.raceGroup.add(v.object);
      return v;
    });
    this.itemsView = new ItemsView(sim.items);
    this.raceGroup.add(this.itemsView.group);
    this.wasAir = sim.karts.map(() => false);
    this.wasWet = sim.karts.map(() => false);
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
    const playerDone = playerPr.finishTime !== null || playerPr.dnf;
    while (this.acc >= sim.dt) {
      this.acc -= sim.dt;
      const inputs = sim.karts.map((k, i) => {
        if (i === this.player && !playerDone && !AUTOPILOT) return human;
        return this.drivers[i]!.drive(sim.dt, k, sim.progress[i]!, sim.track, sim.karts, sim.items, playerPr.dist);
      });
      const wasCountdown = sim.phase === 'countdown';
      sim.step(wasCountdown ? sim.karts.map(() => NEUTRAL_INPUT) : inputs);
      if (GIVE && wasCountdown && sim.phase === 'racing') Items.give(sim.karts[this.player]!, GIVE);
      sim.karts.forEach((k, i) => this.views[i]!.capture(k, sim.respawned.includes(i)));
      this.handleEvents(sim);
    }

    // Lap and finish callouts for the player.
    if (playerPr.lap !== this.lastLap && playerPr.finishTime === null) {
      this.lastLap = playerPr.lap;
      this.sound.play('lap');
      this.hud.shout(playerPr.lap === sim.laps - 1 ? 'FINAL LAP!' : `LAP ${playerPr.lap + 1}`, 'lap');
    }
    if (playerDone && this.playerFinishedAt === null && playerPr.dnf) {
      this.playerFinishedAt = this.time;
      this.sound.stopEngine();
      this.hud.shout('TOASTED!', 'bad', 3);
    } else if (playerDone && this.playerFinishedAt === null) {
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
    this.hud.show(false);
    const rows: ResultRow[] = sim.standings().map((i) => ({
      gorilla: this.roster[i]!,
      time: sim.progress[i]!.finishTime,
      player: i === this.player,
      dnf: sim.progress[i]!.dnf,
    }));
    this.menu.results(rows);
    // Only karts that actually finished get a step.
    this.buildFinishPodium(sim.standings().filter((i) => sim.progress[i]!.finishTime !== null).slice(0, 3));
  }

  /**
   * A three-step podium by the start line with the top three standing up in
   * their karts, each doing their celebration. The race is hidden behind it.
   */
  private buildFinishPodium(top: number[]): void {
    const group = new THREE.Group();
    const venue = this.venues[this.trackIndex]!.track;
    // By the start line of a loop; past the finish of a point-to-point.
    const k = venue.at(venue.closed ? -30 : venue.finishS + 22);
    group.position.set(k.p.x, k.p.y, k.p.z);
    // Face back down the straight, toward where the camera will be.
    group.rotation.y = Math.atan2(k.t.x, k.t.z) + Math.PI;
    const steps = [
      { x: 0, h: 1.7, color: 0xf2c14e },
      // Seen from the camera, 2nd stands on the left and 3rd on the right.
      { x: -3.6, h: 1.2, color: 0xc9cdd3 },
      { x: 3.6, h: 0.8, color: 0xc98a4b },
    ];
    this.finishViews = [];
    top.forEach((kartIndex, place) => {
      const step = steps[place]!;
      const block = new THREE.Mesh(new THREE.BoxGeometry(3.2, step.h, 3.2), toon(step.color));
      block.position.set(step.x, step.h / 2, 0);
      block.castShadow = true;
      block.receiveShadow = true;
      group.add(block);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), new THREE.MeshBasicMaterial({ map: textTexture(String(place + 1), '#2a1a0e', '#fff6dd'), transparent: true }));
      label.position.set(step.x, step.h * 0.5, 1.61);
      group.add(label);
      const view = new KartView(this.roster[kartIndex]!);
      view.restPose();
      view.object.position.set(step.x, step.h + 1.0, 0);
      group.add(view.object);
      // Stagger the starts so they are not in lockstep.
      view.celebrate(Infinity, false);
      for (let i = 0; i < place; i++) view.animateIdle(0.37);
      this.finishViews.push(view);
      if (kartIndex === this.player) {
        const you = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture('YOU', '#ffd93b', '#2a1a0e'), depthTest: false }));
        you.scale.set(1.8, 1.8, 1);
        you.position.set(step.x, step.h + 4.6, 0);
        group.add(you);
      }
    });
    this.raceGroup.visible = false;
    this.finishPodium = group;
    this.stage.scene.add(group);
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
          if (e.owner !== e.kart) {
            this.views[e.owner]?.celebrate(1.5, true);
            if (e.owner === this.player) this.hud.shout('GOTCHA!', 'good', 0.9);
          }
          if (e.kart === this.player) {
            this.hud.shout('SLIPPED!', 'bad');
            this.cam.kick(0.4);
          }
          break;
        case 'parrot':
          if (vol > 0) this.sound.play('squawk', vol);
          this.fx.emit({ pos: v(e.pos).setY(e.pos.y + 3), count: 20, color: [0xd8262b, 0xffcf2e, 0x2a6fd8], speed: [2, 6], size: [0.3, 0.6], life: [0.5, 1.0], gravity: 3 });
          if (e.kart === this.player) this.hud.shout('PARROT AIRLINES!', 'good', 1.2);
          break;
        case 'toasted':
          this.fx.emit({ pos: v(e.pos).setY(e.pos.y + 0.5), count: 30, color: [0xff6a1a, 0xffd23a, 0xff3a0a], speed: [3, 9], dir: new THREE.Vector3(0, 1, 0), spread: 0.7, size: [0.5, 1.1], life: [0.5, 1.2], gravity: 6 });
          this.fx.emit({ pos: v(e.pos).setY(e.pos.y + 1), count: 16, color: [0x3a3330, 0x55504c], speed: [1, 3], dir: new THREE.Vector3(0, 1, 0), spread: 0.4, size: [1.5, 2.6], life: [1.5, 2.5], drag: 0.6 });
          if (vol > 0) this.sound.play('splash', vol);
          if (e.kart !== this.player && vol > 0.2) this.hud.shout(`${this.roster[e.kart]!.name.toUpperCase()} TOASTED`, 'bad', 1.2);
          break;
        case 'bonk':
          // Splinters and dust off the logs.
          this.fx.emit({ pos: v(e.pos), count: Math.round(6 + e.strength * 14), color: [0x8a5a33, 0xd2b07a], speed: [2, 6], size: [0.25, 0.6], life: [0.3, 0.7], gravity: 8 });
          if (vol > 0) this.sound.play('land', vol * (0.5 + e.strength * 0.5));
          if (e.kart === this.player) this.cam.kick(0.25 + e.strength * 0.35);
          break;
        case 'swing':
          if (vol > 0) this.sound.play('swing', vol);
          break;
        case 'whack':
          this.fx.emit({ pos: v(e.pos).setY(e.pos.y + 1.2), count: 18, color: [0xffffff, 0xffe14d], speed: [4, 9], size: [0.3, 0.55], life: [0.3, 0.6] });
          if (vol > 0 || e.victim === this.player) this.sound.play('whack', Math.max(vol, e.victim === this.player ? 1 : 0));
          this.views[e.kart]?.celebrate(1.5, true);
          if (e.kart === this.player) this.hud.shout('WHACK!', 'good', 0.8);
          if (e.victim === this.player) {
            this.hud.shout('OOF!', 'bad', 0.8);
            this.cam.kick(0.6);
          }
          break;
      }
    }
    sim.items.events = [];

    const wet = LOOKS[sim.track.def.id]?.riverUnderGaps ?? true;
    for (const i of sim.respawned) {
      const pr = sim.progress[i]!;
      if (pr.lastRespawn === 'fell' && sim.track.gaps.length && wet) {
        const k = sim.karts[i]!.position;
        if (i === this.player || this.nearPlayer(k) > 0) this.sound.play('splash', i === this.player ? 1 : 0.5);
      }
      if (i === this.player) {
        this.cam.cut();
        if (pr.lastRespawn === 'fell') this.hud.shout(wet ? 'SPLASH!' : LOOKS[sim.track.def.id]?.branches ? 'TIMBERRR!' : 'WHOOPS!', 'bad');
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

  /** The crater: lava bombs arcing out now and then. */
  private erupt(dt: number, crater: THREE.Vector3): void {
    this.eruptTimer -= dt;
    if (this.eruptTimer > 0) return;
    this.eruptTimer = 0.25 + Math.random() * 1.2;
    const burst = Math.random() < 0.15;
    this.fx.emit({
      pos: crater.clone().setY(crater.y + 4),
      count: burst ? 40 : 8,
      color: [0xff6a1a, 0xffd23a, 0xff3a0a],
      speed: burst ? [18, 34] : [10, 22],
      dir: new THREE.Vector3(0, 1, 0),
      spread: 0.55,
      size: [1.2, 2.6],
      life: [2.0, 3.5],
      gravity: 12,
      drag: 0.15,
    });
    if (burst && this.sim) this.cam.kick(0.15);
  }

  /** Per-frame effects: dust, boost flames. */
  private ambientFx(sim: RaceSim): void {
    const camPos = this.cam.camera.position;
    // Smoke and sparks boiling off the lava front, when it is in view.
    const front = sim.lavaS;
    if (Number.isFinite(front) && front > 0) {
      const k = sim.track.at(front);
      const p = new THREE.Vector3(k.p.x, k.p.y + 0.6, k.p.z);
      if (p.distanceTo(camPos) < 160 && Math.random() < 0.7) {
        const lat = (Math.random() * 2 - 1) * (k.halfWidth + 6);
        p.add(new THREE.Vector3(k.r.x * lat, 0, k.r.z * lat));
        this.fx.emit({ pos: p, count: 1, color: [0x4a3c36, 0x2e2826], speed: [1, 3], dir: new THREE.Vector3(0, 1, 0), spread: 0.3, size: [2, 3.5], life: [1.5, 2.5], drag: 0.5 });
        this.fx.emit({ pos: p, count: 2, color: [0xffd23a, 0xff6a1a], speed: [3, 7], dir: new THREE.Vector3(0, 1, 0), spread: 0.6, size: [0.25, 0.5], life: [0.4, 0.9], gravity: 6 });
      }
    }
    sim.karts.forEach((k, i) => {
      const view = this.views[i]!;
      if (view.pos.distanceTo(camPos) > 80 || k.out) return;
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
      // Fording the stream: spray off every wheel, and a splash on the way in.
      if (k.wet) {
        if (!this.wasWet[i]) {
          const vol = i === this.player ? 1 : this.nearPlayer(view.pos);
          if (vol > 0 && speed > 4) this.sound.play('splash', vol * Math.min(1, speed / 20));
          this.fx.emit({ pos: view.pos.clone().setY(view.pos.y - 0.6), count: 24, color: [0xd8f4ff, 0x8fd3ea], speed: [3, 7], dir: new THREE.Vector3(0, 1, 0), spread: 0.8, size: [0.4, 0.8], life: [0.4, 0.8], gravity: 14 });
        }
        if (speed > 2) {
          for (const side of [-1, 1]) {
            const p = new THREE.Vector3(side * 0.9, -0.8, -0.6).applyQuaternion(view.rot).add(view.pos);
            const out = new THREE.Vector3(side * 0.8, 1.2, -0.4).applyQuaternion(view.rot);
            this.fx.emit({ pos: p, count: Math.ceil(speed / 10), color: [0xe6f8ff, 0x9fdcf0], speed: [speed * 0.15, speed * 0.3], dir: out, spread: 0.35, size: [0.3, 0.6], life: [0.3, 0.6], gravity: 14 });
          }
        }
      }
      this.wasWet[i] = k.wet;
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
    const venue = this.venues[this.trackIndex];
    venue?.view.update(this.time, this.sim && this.state !== 'menu' ? this.sim.lavaS : -Infinity);
    if (venue?.view.crater && this.state !== 'paused') this.erupt(dt, venue.view.crater);

    const sim = this.sim;
    if (sim && (this.state === 'race' || this.state === 'results')) {
      if (this.state === 'race') this.stepRace(dt);
    }

    if (sim && this.state === 'results' && this.finishPodium) {
      for (const v of this.finishViews) v.animateIdle(dt);
      this.podiumCamera();
    } else if (sim) {
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
          flying: kart.flying,
          lookBack: this.controls.lookingBack,
          speed: kart.forwardSpeed,
          track: sim.track,
          s: sim.progress[this.player]!.s,
        });
      }
      this.stage.followSun(me.pos);
      if (this.state === 'race') {
        this.hud.update(dt, sim, this.player, this.roster);
        this.sound.updateEngine(dt, kart.forwardSpeed, kart.applied.throttle, kart.grounded === 0, kart.boosting);
        // Wingbeats while the player is being carried.
        if (kart.flying) {
          this.flapTimer -= dt;
          if (this.flapTimer <= 0) {
            this.sound.play('flap', kart.flyTime < 1 ? 1 : 0.7);
            this.flapTimer = kart.flyTime < 1 ? 0.2 : 0.32;
          }
          if (kart.flyTime < 1 && !this.warned) {
            this.warned = true;
            this.hud.shout('HOLD ON!', 'bad', 0.9);
          }
        } else this.warned = false;
      }
    } else {
      this.menuCamera(dt);
    }

    if (this.state !== 'paused') this.fx.update(dt);
    this.stage.renderer.render(this.stage.scene, this.cam.camera);
  }

  /** Frame the finish podium from in front, drifting slowly. */
  private podiumCamera(): void {
    const g = this.finishPodium!;
    const cam = this.cam.camera;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion);
    const sway = Math.sin(this.time * 0.3) * 2.5;
    const portrait = cam.aspect < 1;
    const dist = portrait ? 17 : 11.5;
    // Aim to the podium's right so it sits in the left half, clear of the results panel.
    const aim = g.position.clone().addScaledVector(right, 4.2);
    cam.position.copy(aim).addScaledVector(fwd, dist).addScaledVector(right, sway);
    cam.position.y += 3.6;
    cam.lookAt(aim.x, aim.y + 2.6, aim.z);
    cam.fov = 55;
    cam.updateProjectionMatrix();
    this.stage.followSun(g.position);
  }

  private menuCamera(dt: number): void {
    this.orbit += dt * 0.35;
    const p = this.podium.position;
    if (this.preview) {
      // Turn toward the camera while celebrating, then go back to spinning.
      const o = this.preview.object.rotation;
      if (this.preview.celebrating) {
        const d = Math.atan2(Math.sin(0.6 - o.y), Math.cos(0.6 - o.y));
        o.y += d * Math.min(1, dt * 6);
      } else o.y = (o.y + dt * 0.5) % (Math.PI * 2);
      this.preview.object.position.y = 1.35;
      this.preview.animateIdle(dt);
      this.encore -= dt;
      if (this.encore <= 0) {
        this.preview.celebrate(2.6, false);
        this.encore = 6;
      }
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

/** A round badge with big cartoon text, for podium plaques and markers. */
function textTexture(text: string, fill: string, ink: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = fill;
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = ink;
  g.stroke();
  g.fillStyle = ink;
  g.font = `bold ${text.length > 1 ? 44 : 78}px "Lilita One", "Arial Black", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function loadDifficulty(): Difficulty {
  try {
    const d = localStorage.getItem('jj-difficulty');
    if (d === 'chill' || d === 'normal' || d === 'wild') return d;
  } catch {
    // Storage blocked.
  }
  return 'normal';
}
