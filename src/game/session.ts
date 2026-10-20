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
import { KART, RACE } from '../data/tuning.js';
import { LOOKS } from '../data/tracks/looks.js';
import { Sound, type Voice } from '../audio/sound.js';
import { ChaseCam } from '../render/chaseCam.js';
import { Fx } from '../render/fx.js';
import { Vfx } from '../render/vfx.js';
import { ItemsView } from '../render/itemsView.js';
import { KartView } from '../render/kartView.js';
import { Stage } from '../render/scene.js';
import { type TrackView, buildTrackView } from '../render/trackView.js';
import { toon } from '../render/toon.js';
import { AiDriver, type Difficulty, fieldLevels, personality } from '../sim/driver.js';
import { MOVES, MOVE_NAMES, SWAGGER } from '../sim/swagger.js';
import { type DriverInput, NEUTRAL_INPUT } from '../sim/input.js';
import { type ItemEvent, Items } from '../sim/items.js';
import { RaceSim } from '../sim/race.js';
import { Rng } from '../sim/rng.js';
import { Track } from '../sim/track.js';
import { Controls } from '../ui/controls.js';
import { Hud } from '../ui/hud.js';
import { Menu, type ResultRow } from '../ui/menu.js';
import { OnlineMenu } from '../ui/online.js';
import { TouchControls } from '../ui/touch.js';
import { NetClient } from '../net/client.js';
import { NetHost } from '../net/host.js';
import { hostRoom, joinRoom } from '../net/peer.js';
import { cleanName } from '../net/protocol.js';

type State = 'menu' | 'race' | 'paused' | 'results';
/** Solo against the AI, hosting a room on this phone, or racing in someone else's. */
type Mode = 'solo' | 'host' | 'client';

/** Seconds, for the netcode's clocks. */
const nowSecs = () => performance.now() / 1000;

/** Grid slot the player starts from (0 = pole). Mid-pack: something to chase, something to hold off. */
const PLAYER_SLOT = 4;
const MAX_FRAME = 0.1;
/** Sideways slide (m/s) above which the tyres smoke. */
const TYRE_SLIP = 4;
const FIREWORKS = [0xff4d6d, 0xffd23a, 0x29c8ff, 0x7dff6a, 0xd05cf6];

/**
 * Developer switches from the URL: `?laps=1` for short races, `?autopilot`
 * to let the AI drive the player's kart (headless checks, attract mode).
 */
const params = new URLSearchParams(location.search);
const DEV_LAPS = Number(params.get('laps')) || undefined;
const AUTOPILOT = params.has('autopilot');
/** `?give=parrot` (or banana/snake/coconut): hand the player that item at GO, for testing. */
const GIVE = params.get('give') as 'banana' | 'snake' | 'parrot' | 'coconut' | 'swagger' | null;
/** `?eventlap=1`: mid-race track events fire on that lap instead (testing). */
const EVENT_LAP = Number(params.get('eventlap')) || 0;
/** `?room=1234`: an invite link — open the online screen with the code filled in. */
const INVITE = /^\d{4}$/.test(params.get('room') ?? '') ? params.get('room')! : '';

export class Game {
  private readonly stage: Stage;
  private readonly cam: ChaseCam;
  private readonly controls: Controls;
  private readonly touch: TouchControls;
  private readonly hud: Hud;
  private readonly menu: Menu;
  private readonly sound = new Sound();
  private readonly fx = new Fx();
  /** Sparks and boost smoke (three.quarks). */
  private readonly vfx = new Vfx();
  /** Kart positions last frame and a cooldown per pair, for spotting kart-on-kart hits. */
  private bumpPrev: THREE.Vector3[] = [];
  private bumpCool = new Map<number, number>();
  /** Each kart's boulder time last frame, to see the rock crumble. */
  private wasBoulder: number[] = [];
  /** Each kart's velocity as drawn (works for online proxies too). */
  private viewVel: THREE.Vector3[] = [];
  /** A wave surging across the ford (coast tracks): seconds to the next, and the one running. */
  private waveTimer = 0;
  private wave: { s: number; from: -1 | 1; t: number } | null = null;
  /** Over the podium: where, and seconds to the next firework. */
  private podiumAt: THREE.Vector3 | null = null;
  private fireworkTimer = 0;
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
  private wasSkim = false;
  private eruptTimer = 0;
  /** Event warnings already shown this race. */
  private warned2 = new Set<string>();
  private warned = false;
  private lastLap = 0;
  private playerFinishedAt: number | null = null;
  /** Toasted: the kart the camera follows instead (-1 = the player's own). */
  private watching = -1;
  private skipHeld = true;
  private seed = 1;
  private difficulty: Difficulty = loadDifficulty();
  private swaggerOn = loadSwagger();
  /** Expanding rings for area moves (Roar, Drop the Beat, Slow Clap). */
  private rings: { mesh: THREE.Mesh; t: number; life: number; size: number }[] = [];

  // Online.
  private mode: Mode = 'solo';
  private readonly online: OnlineMenu;
  private host: NetHost | null = null;
  private client: NetClient | null = null;
  /** The open WebRTC room (host) or connection (player), to close on leaving. */
  private peer: { close(): void } | null = null;
  private roomCode = '';
  /** Players' names by grid slot ('' for AI). */
  private names: string[] = [];
  private readonly netBadge: HTMLDivElement;
  private resultsKey = '';
  private resultsTimer = 0;
  private wakeLock: { release(): Promise<void> } | null = null;

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
    this.vfx.density = this.stage.quality.particles;
    this.stage.scene.add(this.vfx.object);

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
    this.hud.onPause = () => this.togglePause();
    // Leaving the page (another tab, another app, screen locked) silences
    // everything and pauses a race in progress; it waits on the pause menu.
    // Online the race can't wait: the host's AI drives for a player who's away.
    const away = () => {
      this.sound.setAway(true);
      if (this.state === 'race' && this.mode === 'solo') this.togglePause();
    };
    const back = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) this.sound.setAway(false);
      if (document.visibilityState === 'visible' && this.sim) void this.keepAwake(true);
    };
    document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? away() : back()));
    window.addEventListener('blur', away);
    window.addEventListener('focus', back);
    window.addEventListener('pagehide', away);
    this.menu = new Menu(overlay);
    this.menu.onGesture = () => this.sound.unlock();
    this.menu.onPreview = (i) => this.showPreview(i);
    this.menu.onTrack = (i) => this.selectTrack(i);
    this.menu.difficulty = this.difficulty;
    this.menu.swagger = this.swaggerOn;
    this.menu.onSwagger = (on) => {
      this.swaggerOn = on;
      try {
        localStorage.setItem('jj-swagger', on ? 'on' : 'off');
      } catch {
        // Storage blocked — lasts this visit.
      }
    };
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
    this.menu.onRestart = () => {
      if (this.mode === 'host') this.hostBackToRoom();
      else this.startRace();
    };
    this.menu.onQuit = () => {
      if (this.mode === 'solo') this.toMenu();
      else this.leaveOnline('');
    };
    this.menu.onMute = () => this.sound.toggleMute();
    this.menu.onOnline = () => this.online.lobby(loadName(), INVITE);

    this.online = new OnlineMenu(this.menu.root);
    this.online.onGesture = () => this.sound.unlock();
    this.online.onBack = () => this.menu.title();
    this.online.onHost = (name) => void this.hostOnline(name);
    this.online.onJoin = (name, code) => void this.joinOnline(name, code);
    this.online.onCancel = () => this.leaveOnline('');
    this.online.onLeave = () => this.leaveOnline('');
    this.online.onPick = (g) => {
      if (this.host) this.host.pick(g);
      else this.client?.pick(g);
    };
    this.online.onSettings = (set) => this.host?.setSettings(set);
    this.online.onStart = () => this.startOnline();
    this.netBadge = document.createElement('div');
    this.netBadge.className = 'net-badge';
    this.netBadge.hidden = true;
    overlay.appendChild(this.netBadge);

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.menu.title();
    if (INVITE) this.online.lobby(loadName(), INVITE);
    // Dev builds only: a handle for headless checks (teleporting to a spot, etc).
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = this;
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
    this.preview = new KartView(GORILLAS[i]!, { ink: this.stage.quality.ink });
    this.preview.restPose();
    this.preview.object.position.set(0, 1.4, 0);
    this.podium.add(this.preview.object);
    this.preview.celebrate(2.6, false);
    this.sound.say('hoot', -1, GORILLAS[i]!.size, 0.8);
    this.encore = 5;
  }

  // ---------------------------------------------------------------- online

  /** Open a room on this phone and wait in it. */
  private async hostOnline(name: string): Promise<void> {
    saveName(name);
    this.online.busy('Opening a room…');
    const host = new NetHost(nowSecs, name, this.chosen);
    host.setSettings({ track: this.trackIndex, difficulty: this.difficulty, swagger: this.swaggerOn, ...(DEV_LAPS ? { laps: DEV_LAPS } : {}) });
    try {
      const room = await hostRoom((link) => host.accept(link));
      if (this.menu.root.dataset.screen !== 'online') {
        room.close(); // Cancelled while it was opening.
        return;
      }
      this.peer = room;
      this.roomCode = room.code;
    } catch (e) {
      this.online.lobby(name, '', (e as Error).message);
      return;
    }
    this.host = host;
    this.mode = 'host';
    host.onRoom = () => {
      if (this.state === 'menu' && this.menu.root.dataset.screen === 'room') this.showRoom();
    };
    this.showRoom();
  }

  /** Join the room with this code and wait in it. */
  private async joinOnline(name: string, code: string): Promise<void> {
    saveName(name);
    this.online.busy(`Joining room ${code}…`);
    let joined: Awaited<ReturnType<typeof joinRoom>>;
    try {
      joined = await joinRoom(code);
    } catch (e) {
      if (this.menu.root.dataset.screen === 'online') this.online.lobby(name, code, (e as Error).message);
      return;
    }
    if (this.menu.root.dataset.screen !== 'online') {
      joined.close();
      return;
    }
    this.peer = joined;
    this.roomCode = code;
    this.mode = 'client';
    const client = new NetClient(joined.link, nowSecs, cleanName(name), this.chosen);
    this.client = client;
    client.onRoom = () => {
      if (this.state === 'menu') this.showRoom();
    };
    client.onStart = () => this.beginOnline();
    client.onBack = () => this.backToRoom();
    client.onClosed = (why) => this.leaveOnline(why);
  }

  /** The room screen, with this phone's gorilla on the podium and the chosen track behind. */
  private showRoom(): void {
    const room = this.host
      ? { seats: this.host.seats, settings: this.host.settings, me: 'host' }
      : this.client?.room
        ? { seats: this.client.room.seats, settings: this.client.room.settings, me: this.client.room.you }
        : null;
    if (!room) return;
    const mine = room.seats.find((s) => s.id === room.me);
    if (mine && mine.gorilla !== this.chosen) {
      this.chosen = mine.gorilla;
      this.showPreview(mine.gorilla);
    }
    if (room.settings.track !== this.trackIndex) this.selectTrack(room.settings.track);
    this.podium.visible = true;
    this.online.room({ code: this.roomCode, hosting: !!this.host, ...room });
  }

  /** The host starts the race for everyone. */
  private startOnline(): void {
    const host = this.host;
    if (!host) return;
    this.seed = 1 + Math.floor(Math.random() * 99999);
    host.start(this.seed);
    this.beginOnline();
  }

  /** The race this phone hosts or joined is built: show it. */
  private beginOnline(): void {
    const race = this.host?.race ?? this.client?.race;
    if (!race) return;
    this.endRace();
    this.selectTrack(race.config.track);
    this.player = race.own;
    this.names = race.config.names;
    // Players' karts carry their names (HUD, results); AI karts their gorilla's.
    this.roster = race.config.roster.map((g, i) => (this.names[i] ? { ...GORILLAS[g]!, name: this.names[i]! } : GORILLAS[g]!));
    this.beginRace(race.sim, race.drivers);
  }

  /** Host: everyone back to the room (results, or a race abandoned). */
  private hostBackToRoom(): void {
    this.host?.backToRoom();
    this.backToRoom();
  }

  private backToRoom(): void {
    this.sim = null; // Freed by the netcode.
    this.endRace();
    this.state = 'menu';
    this.hud.show(false);
    this.touch.show(false);
    this.podium.visible = true;
    this.sound.stopEngine();
    this.showRoom();
  }

  /** Leave the room (or close it, as host) and go back to the online screen. */
  private leaveOnline(why: string): void {
    const wasOnline = this.mode !== 'solo' || this.peer;
    if (this.client) this.client.onClosed = () => {};
    this.host?.close();
    this.client?.leave();
    this.peer?.close();
    this.host = null;
    this.client = null;
    this.peer = null;
    this.mode = 'solo';
    if (this.sim) this.toMenu();
    this.state = 'menu';
    this.podium.visible = true;
    if (wasOnline || why) this.online.lobby(loadName(), '', why);
  }

  /** The waiting banner and the connection badge. */
  private netStatus(): void {
    const sim = this.sim!;
    let text = '';
    if (this.host?.loading) text = 'Waiting for everyone to load…';
    else if (this.client && (this.client.stalled || sim.clock === 0)) text = this.client.stalled ? 'Waiting for the host…' : 'Starting…';
    const away = this.host?.players.filter((p) => p.away && !p.gone).map((p) => this.names[p.kart]) ?? [];
    const badge = this.client ? `📶 ${Math.round(this.client.rtt * 1000)} ms` : `Room ${this.roomCode}${away.length ? ` · ${away.join(', ')} away (AI driving)` : ''}`;
    this.netBadge.hidden = this.state !== 'race';
    this.netBadge.innerHTML = `${text ? `<b>${text}</b>` : ''}<span>${badge}</span>`;
    this.netBadge.classList.toggle('waiting', !!text);
  }

  private resultRows(): ResultRow[] {
    const sim = this.sim!;
    return sim.standings().map((i) => ({
      gorilla: this.roster[i]!,
      name: this.names[i] || undefined,
      time: sim.progress[i]!.finishTime,
      player: i === this.player,
      dnf: sim.progress[i]!.dnf,
      racing: this.mode !== 'solo' && sim.progress[i]!.finishTime === null && !sim.progress[i]!.dnf,
    }));
  }

  private resultsSig(): string {
    const sim = this.sim!;
    return sim.standings().map((i) => `${i}:${sim.progress[i]!.finishTime ?? (sim.progress[i]!.dnf ? 'x' : '-')}`).join();
  }

  /** Online, the results fill in as the others finish. */
  private refreshResults(dt: number): void {
    this.resultsTimer -= dt;
    if (this.resultsTimer > 0 || !this.sim) return;
    this.resultsTimer = 0.5;
    const sig = this.resultsSig();
    if (sig === this.resultsKey) return;
    this.resultsKey = sig;
    this.menu.results(this.resultRows(), this.mode);
  }

  /** Keep a phone's screen on through a race (where the browser allows it). */
  private async keepAwake(on: boolean): Promise<void> {
    const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    try {
      if (!on) {
        await this.wakeLock?.release();
        this.wakeLock = null;
      } else if (wl && !this.wakeLock && document.visibilityState === 'visible') {
        const lock = await wl.request('screen');
        this.wakeLock = lock;
        (lock as unknown as EventTarget).addEventListener?.('release', () => {
          if (this.wakeLock === lock) this.wakeLock = null;
        });
      }
    } catch {
      // Not allowed (battery saver, iframe): the screen may dim, the race goes on.
    }
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
    this.vfx.clear();
    this.bumpPrev = [];
    this.bumpCool.clear();
    this.wasBoulder = [];
    this.viewVel = [];
    this.wave = null;
    this.podiumAt = null;
    this.netBadge.hidden = true;
    void this.keepAwake(false);
  }

  private startRace(): void {
    this.endRace();
    this.seed = (this.seed * 7919 + 13) % 100000;
    const base = TRACKS[this.trackIndex]!;
    const def = EVENT_LAP && base.events ? { ...base, events: base.events.map((e) => ({ ...e, lap: EVENT_LAP })) } : base;
    this.player = PLAYER_SLOT;
    // The player's gorilla in their slot; the other seven fill the grid in a shuffled order.
    const others = GORILLAS.filter((_, i) => i !== this.chosen);
    const rng = new Rng(this.seed);
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [others[i], others[j]] = [others[j]!, others[i]!];
    }
    this.roster = Array.from({ length: RACE.karts }, (_, i) => (i === this.player ? GORILLAS[this.chosen]! : others.shift()!));
    // Each gorilla brings its own signature move.
    const sim = new RaceSim(def, {
      seed: this.seed,
      laps: DEV_LAPS,
      swagger: this.swaggerOn,
      moves: this.roster.map((g) => MOVES[GORILLAS.indexOf(g)]!),
    });
    // A spread of skill across the field, set by the difficulty.
    const levels = fieldLevels(this.difficulty, sim.karts.length - 1, new Rng(this.seed + 7));
    let next = 0;
    const drivers = sim.karts.map(
      (k) => new AiDriver(personality(sim.rng, k.index, k.index === this.player ? 0.8 : levels[next++]!)),
    );
    this.mode = 'solo';
    this.names = [];
    this.beginRace(sim, drivers);
  }

  /** Views, HUD and controls for a race that is ready to go (solo or online). */
  private beginRace(sim: RaceSim, drivers: AiDriver[]): void {
    this.sim = sim;
    this.drivers = drivers;
    this.views = sim.karts.map((k, i) => {
      const v = new KartView(this.roster[i]!, { ink: this.stage.quality.ink });
      this.raceGroup.add(v.shadow);
      v.capture(k, true);
      this.raceGroup.add(v.object);
      // Online, other players' names float over their karts.
      const name = this.names[i];
      if (name && i !== this.player) v.object.add(nameTag(name));
      return v;
    });
    this.itemsView = new ItemsView(sim.items);
    this.raceGroup.add(this.itemsView.group);
    this.wasAir = sim.karts.map(() => false);
    this.warned2.clear();
    this.wasWet = sim.karts.map(() => false);
    this.lastLap = 0;
    this.playerFinishedAt = null;
    this.watching = -1;
    this.acc = 0;

    this.hud.setTrack(sim);
    this.hud.show(true);
    this.touch.show(TouchControls.wanted());
    this.hud.touchMode = TouchControls.wanted();
    this.menu.hide();
    this.podium.visible = false;
    this.cam.cut();
    this.state = 'race';
    this.resultsKey = '';
    this.sound.unlock();
    this.sound.startEngine();
    void this.keepAwake(true);
  }

  private togglePause(): void {
    if (this.state === 'race') {
      this.state = 'paused';
      this.menu.pause(this.sound.muted, this.mode !== 'solo');
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
    const net = this.host ?? this.client;
    // Online, the race runs on through the menu and the results: the AI drives.
    const driving = this.state === 'race' && !playerDone && !AUTOPILOT;
    while (this.acc >= sim.dt) {
      this.acc -= sim.dt;
      if (net) {
        if (!net.step(driving ? human : null)) {
          this.acc = 0;
          break;
        }
        sim.karts.forEach((k, i) => this.views[i]!.capture(k, sim.respawned.includes(i)));
        this.handleEvents(sim);
        continue;
      }
      const inputs = sim.karts.map((k, i) => {
        if (i === this.player && !playerDone && !AUTOPILOT) return human;
        return this.drivers[i]!.drive(sim.dt, k, sim.progress[i]!, sim.track, sim.karts, sim.items, playerPr.dist, sim);
      });
      const wasCountdown = sim.phase === 'countdown';
      sim.step(wasCountdown ? sim.karts.map(() => NEUTRAL_INPUT) : inputs);
      if (GIVE && wasCountdown && sim.phase === 'racing') {
        if (GIVE === 'swagger') sim.karts[this.player]!.swagger = 100;
        else Items.give(sim.karts[this.player]!, GIVE);
      }
      sim.karts.forEach((k, i) => this.views[i]!.capture(k, sim.respawned.includes(i)));
      this.handleEvents(sim);
    }
    if (net) this.netStatus();
    if (this.state === 'results') {
      this.refreshResults(dt);
      return;
    }
    if (this.state !== 'race') return;

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
      this.voice('ouch', this.player, 1);
      this.skipHeld = human.item;
    } else if (playerDone && this.playerFinishedAt === null) {
      this.playerFinishedAt = this.time;
      this.sound.play('finish');
      const place = sim.position(this.player);
      this.voice(place <= 3 ? 'hoot' : 'grunt', this.player, 1);
      this.hud.shout(place === 1 ? 'YOU WIN!' : `FINISHED ${place}${['st', 'nd', 'rd'][place - 1] ?? 'th'}`, 'finish', 3);
    }
    // Toasted: watch the rest of the race from the leader's tail (item skips
    // to the results). Finished: the results follow shortly.
    const skip = playerPr.dnf && human.item && !this.skipHeld;
    this.skipHeld = human.item;
    const wait = playerPr.dnf ? 240 : 10;
    if (this.playerFinishedAt !== null && (sim.allFinished || skip || this.time - this.playerFinishedAt > wait)) {
      this.showResults();
    }
  }

  private showResults(): void {
    const sim = this.sim!;
    this.state = 'results';
    this.sound.stopEngine();
    this.touch.show(false);
    this.hud.show(false);
    this.menu.results(this.resultRows(), this.mode);
    this.resultsKey = this.resultsSig();
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
      const view = new KartView(this.roster[kartIndex]!, { ink: this.stage.quality.ink });
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
    // Confetti over the steps and fireworks behind them; the race's own effects stop.
    this.vfx.quiet();
    this.podiumAt = group.position.clone();
    this.vfx.confetti(this.podiumAt.clone().setY(this.podiumAt.y + 9));
    this.fireworkTimer = 0.6;
    this.stage.scene.add(group);
  }

  /** Kart `i`'s gorilla says something, in their own voice. */
  private voice(kind: Voice, i: number, vol: number): void {
    if (vol > 0) this.sound.say(kind, i, this.roster[i]!.size, vol);
  }

  private nearPlayer(pos: { x: number; y: number; z: number }): number {
    const p = this.sim!.karts[this.player]!.position;
    const d = Math.hypot(pos.x - p.x, pos.y - p.y, pos.z - p.z);
    return Math.max(0, 1 - d / 70);
  }

  private handleEvents(sim: RaceSim): void {
    const v = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);
    for (const e of sim.items.events) {
      if (e.type === 'track') {
        this.trackEvent(e.kind, e.pos, e.stage ?? 1);
        continue;
      }
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
          // Mushed banana flying, and a scuffed ring of tyre marks where it spun.
          this.vfx.bananaBits(v(e.pos).setY(e.pos.y + 0.4));
          this.ring(v(e.pos).setY(e.pos.y + 0.45), 0x2a1d14, 2.4, 1.6, false);
          if (vol > 0) this.sound.play('peelHit', vol);
          this.voice('ouch', e.kart, vol);
          if (e.owner !== e.kart) {
            this.voice('hoot', e.owner, e.owner === this.player ? 1 : this.nearPlayer(sim.karts[e.owner]!.position) * 0.8);
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
          this.voice('ouch', e.kart, vol);
          if (e.kart !== this.player && vol > 0.2) this.hud.shout(`${this.roster[e.kart]!.name.toUpperCase()} TOASTED`, 'bad', 1.2);
          break;
        case 'swagger':
          this.swaggerEvent(e);
          break;
        case 'bonk':
          // Splinters and dust off the logs, sparks where the kart scrapes them.
          this.fx.emit({ pos: v(e.pos), count: Math.round(6 + e.strength * 14), color: [0x8a5a33, 0xd2b07a], speed: [2, 6], size: [0.25, 0.6], life: [0.3, 0.7], gravity: 8 });
          this.wallSparks(sim, e.kart, e.strength);
          if (vol > 0) this.sound.play('land', vol * (0.5 + e.strength * 0.5));
          if (e.kart === this.player) this.cam.kick(0.25 + e.strength * 0.35);
          if (e.strength > 0.6) this.voice('grunt', e.kart, vol * 0.8);
          break;
        case 'swing':
          if (vol > 0) this.sound.play('swing', vol);
          break;
        case 'whack':
          this.fx.emit({ pos: v(e.pos).setY(e.pos.y + 1.2), count: 18, color: [0xffffff, 0xffe14d], speed: [4, 9], size: [0.3, 0.55], life: [0.3, 0.6] });
          // Stars, loose fur in the victim's colour, and an impact ring.
          this.vfx.whacked(v(e.pos).setY(e.pos.y + 1.4), this.roster[e.victim]!.fur);
          this.ring(v(e.pos).setY(e.pos.y + 1.2), 0xffffff, 3, 0.3);
          if (vol > 0 || e.victim === this.player) this.sound.play('whack', Math.max(vol, e.victim === this.player ? 1 : 0));
          this.views[e.kart]?.celebrate(1.5, true);
          this.voice('grunt', e.kart, vol);
          this.voice('ouch', e.victim, e.victim === this.player ? 1 : vol);
          if (e.kart === this.player) this.hud.shout('WHACK!', 'good', 0.8);
          if (e.victim === this.player) {
            this.hud.shout('OOF!', 'bad', 0.8);
            this.cam.kick(0.6);
          }
          break;
        case 'throw':
          if (vol > 0) this.sound.play('swing', vol);
          this.voice('grunt', e.kart, vol);
          break;
        case 'conk': {
          // The shell cracks: husk and white flesh flying, stars, and a ring.
          const at = v(e.pos);
          const along = v(e.vel).setY(0).normalize();
          this.fx.emit({ pos: at, count: 26, color: [0x6b4325, 0x8a5a33, 0xf3ead2], speed: [3, 9], dir: along.clone().setY(0.6), spread: 0.9, size: [0.2, 0.45], life: [0.4, 0.9], gravity: 16 });
          this.vfx.whacked(at.clone().setY(at.y + 0.5), this.roster[e.victim]!.fur);
          this.ring(at, 0xffffff, 2.4, 0.3);
          if (vol > 0 || e.victim === this.player) this.sound.play('whack', Math.max(vol, e.victim === this.player ? 1 : 0));
          this.views[e.kart]?.celebrate(1.5, true);
          this.voice('ouch', e.victim, e.victim === this.player ? 1 : vol);
          if (e.kart === this.player) this.hud.shout('CONK!', 'good', 0.8);
          if (e.victim === this.player) {
            this.hud.shout('BONK!', 'bad', 0.8);
            this.cam.kick(0.5);
          }
          break;
        }
        case 'coconutDrop': {
          const at = v(e.pos);
          const below = sim.track.project(e.pos, -1);
          const ground = below.height > -2 && below.height < 6 ? e.pos.y - below.height : e.pos.y - 1.6;
          this.itemsView?.drop(at, v(e.vel), ground);
          break;
        }
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
        if (pr.lastRespawn === 'fell') this.voice('ouch', i, 1);
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
        // Big air: a ring of dust rolls out from the wheels (sawdust and
        // splinters on the treetop decks, where the drops are biggest).
        if (hard > 0.25) {
          const deck = sim.track.aloft(sim.progress[i]!.s) || LOOKS[sim.track.def.id]?.road === 'bark';
          this.vfx.dust(new THREE.Vector3(p.x, p.y - 0.75, p.z), hard * (deck ? 1.8 : 1), deck ? 0xb08a5c : 0xd2b07a);
          if (deck) this.fx.emit({ pos: new THREE.Vector3(p.x, p.y - 0.6, p.z), count: Math.round(hard * 16), color: [0x8a5a33, 0xd2b07a], speed: [3, 8], dir: new THREE.Vector3(0, 1, 0), spread: 0.9, size: [0.2, 0.45], life: [0.4, 0.8], gravity: 14 });
        }
        const vol = i === this.player ? 1 : this.nearPlayer(p);
        if (vol > 0 && hard > 0.15) this.sound.play('land', vol * hard);
        if (i === this.player) this.cam.kick(hard * 0.5);
      }
      this.wasAir[i] = air;
    });
  }

  /** A swagger move: wind-up celebration and sting, then the move's own show. */
  private swaggerEvent(e: Extract<ItemEvent, { type: 'swagger' }>): void {
    const who = this.roster[e.kart]!;
    const mine = e.kart === this.player;
    const vol = mine ? 1 : this.nearPlayer(e.pos);
    const at = new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z);
    if (e.phase === 'windup') {
      this.views[e.kart]?.celebrate(1.4, true);
      if (vol > 0) this.sound.play('swagger', Math.max(0.4, vol));
      this.voice('pound', e.kart, vol);
      if (mine) this.hud.shout(`${MOVE_NAMES[e.move]}!`, 'good', 1.3);
      else if (vol > 0.3) this.hud.shout(`${who.name.split(' ')[0]!.toUpperCase()}: ${MOVE_NAMES[e.move]}!`, 'bad', 1.1);
      this.fx.emit({ pos: at.clone().setY(at.y + 2), count: 24, color: [0xffcc33, 0xfff6dd], speed: [3, 7], size: [0.3, 0.6], life: [0.4, 0.8], gravity: 3 });
      return;
    }
    if (mine) this.cam.kick(0.45);
    else if (vol > 0.3) this.cam.kick(0.2 * vol);
    switch (e.move) {
      case 'roar':
        // Rings out to the move's real reach, so you can see who it caught.
        this.ring(at, 0xffcc33, SWAGGER.roarRadius, 0.8);
        this.ring(at, 0xff8a1f, SWAGGER.roarRadius * 0.6, 0.55);
        this.fx.emit({ pos: at.clone().setY(at.y + 0.3), count: 60, color: [0xffcc33, 0xff8a1f, 0xfff6dd], speed: [10, 22], dir: new THREE.Vector3(0, 0.15, 0), spread: 1, size: [0.4, 0.9], life: [0.4, 0.9], drag: 1.5 });
        // The shockwave: dust blown flat out along the road.
        this.vfx.dust(at.clone().setY(at.y - 0.6), 3, 0xe8d3a8);
        if (vol > 0) this.sound.play('land', vol);
        this.sound.say('roar', 1000 + e.kart, who.size, vol);
        break;
      case 'beat':
        this.ring(at, 0x9b5cf6, SWAGGER.beatRadius, 0.9);
        this.ring(at, 0xd05cf6, SWAGGER.beatRadius * 0.66, 0.7);
        this.ring(at, 0x9b5cf6, SWAGGER.beatRadius * 0.33, 0.5);
        this.fx.emit({ pos: at.clone().setY(at.y + 1.5), count: 40, color: [0x9b5cf6, 0xd05cf6, 0xffffff], speed: [4, 10], size: [0.3, 0.7], life: [0.6, 1.2], gravity: 1 });
        break;
      case 'slowClap':
        this.ring(at, 0xffffff, SWAGGER.clapRange, 0.9);
        this.ring(at, 0xfff6dd, SWAGGER.clapRange * 0.5, 0.6);
        break;
      case 'tooCool':
      case 'boulder':
        this.ring(at, e.move === 'tooCool' ? 0x4dd2ff : 0xd2b07a, SWAGGER.shoveRadius * 2, 0.5);
        if (e.move === 'boulder') this.vfx.dust(at.clone().setY(at.y - 0.6), 1.6, 0x9a948c);
        this.fx.emit({ pos: at.clone().setY(at.y + 1), count: 40, color: e.move === 'tooCool' ? [0x4dd2ff, 0xe9fbff] : [0xd2b07a, 0x8a6a42], speed: [4, 10], size: [0.4, 0.9], life: [0.5, 1], gravity: 3 });
        break;
      case 'pogo':
        this.fx.emit({ pos: at.clone().setY(at.y - 0.6), count: 30, color: [0xd2b07a, 0xbf9a62], speed: [3, 8], dir: new THREE.Vector3(0, 0.3, 0), spread: 1, size: [0.6, 1.2], life: [0.5, 1], gravity: 2 });
        this.vfx.dust(at.clone().setY(at.y - 0.6), 2);
        if (vol > 0) this.sound.play('land', vol);
        break;
      case 'feed':
        this.fx.emit({ pos: at.clone().setY(at.y + 1), count: 30, color: [0xffe14d, 0xfff6b0], speed: [3, 8], size: [0.3, 0.6], life: [0.5, 1], gravity: 4 });
        break;
      default:
        this.fx.emit({ pos: at.clone().setY(at.y + 1), count: 20, color: [0xffcc33, 0xff8a1f], speed: [3, 7], size: [0.3, 0.6], life: [0.4, 0.8] });
    }
    // On the receiving end.
    if (e.victims?.includes(this.player)) {
      const msg = e.move === 'roar' ? 'ROARED AT!' : e.move === 'beat' ? 'STEERING SWAPPED!' : e.move === 'slowClap' ? 'SLOW-CLAPPED!' : '';
      if (msg) this.hud.shout(msg, 'bad', 1.2);
      this.cam.kick(0.35);
    }
  }

  /** Contact shadows: on the surface under each kart (road, ramp or branch top). */
  private placeShadows(sim: RaceSim): void {
    const t = sim.track;
    sim.karts.forEach((k, i) => {
      const view = this.views[i]!;
      const pr = sim.progress[i]!;
      const smp = t.at(pr.s);
      if (k.out || !smp.road || Math.abs(pr.lateral) > smp.halfWidth + 1) {
        view.shadow.visible = false;
        return;
      }
      const p = t.pointAt(pr.s, pr.lateral);
      const lift = t.kickerHeight(pr.s, pr.lateral) - t.surfaceDrop(pr.lateral, smp.halfWidth);
      const n = new THREE.Vector3(smp.n.x, smp.n.y, smp.n.z);
      view.placeShadow(new THREE.Vector3(p.x, p.y, p.z).addScaledVector(n, lift), n);
    });
  }

  /** An expanding, fading ring on the ground: a glow, or (not additive) a scuff. */
  private ring(at: THREE.Vector3, color: number, size: number, life = 0.7, additive = true): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(at).setY(at.y - 0.4);
    this.stage.scene.add(mesh);
    this.rings.push({ mesh, t: 0, life, size });
  }

  private updateRings(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.t += dt;
      const f = r.t / r.life;
      r.mesh.scale.setScalar(0.5 + f * r.size);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - f);
      if (f >= 1) {
        this.stage.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        this.rings.splice(i, 1);
      }
    }
  }

  /** The jungle changes: callout, sound, shake, and a burst at the spot. */
  private trackEvent(kind: 'treefall' | 'flood' | 'snap', pos: { x: number; y: number; z: number }, stage: number): void {
    const near = this.nearPlayer(pos);
    const at = new THREE.Vector3(pos.x, pos.y + 1, pos.z);
    if (kind === 'treefall') {
      this.hud.shout('TIMBER!', 'bad', 1.6);
      this.sound.play('land', Math.max(0.35, near));
      this.cam.kick(0.2 + near * 0.6);
      this.fx.emit({ pos: at, count: 40, color: [0x4ea83c, 0x2f7d2a, 0x8a6440], speed: [3, 9], size: [0.5, 1.2], life: [0.8, 1.6], gravity: 5 });
    } else if (kind === 'flood') {
      this.hud.shout(stage > 1 ? 'THE CREEK IS STILL RISING!' : 'FLASH FLOOD!', 'bad', 1.8);
      this.sound.play('splash', Math.max(0.4, near));
    } else {
      this.hud.shout('SNAP! THE BRANCH BROKE!', 'bad', 1.8);
      this.sound.play('land', Math.max(0.4, near));
      this.sound.play('whack', Math.max(0.3, near));
      this.cam.kick(0.2 + near * 0.6);
      this.fx.emit({ pos: at, count: 36, color: [0x8a6440, 0x6e4c2e, 0x5e8f3a], speed: [3, 8], size: [0.4, 0.9], life: [0.8, 1.6], gravity: 9 });
    }
  }

  /** Heads-up a lap before something happens to the track. */
  private eventWarnings(sim: RaceSim): void {
    sim.events.forEach((e, i) => {
      const key = `${i}:${e.phase}`;
      if (e.phase !== 'warning' || this.warned2.has(key)) return;
      this.warned2.add(key);
      if (e.def.kind === 'snap') this.hud.shout('CREEEAK… THAT BRANCH WON’T HOLD', 'bad', 2);
      if (e.def.kind === 'treefall' && sim.raceTime > 5) this.hud.shout('CREEEAK…', 'bad', 1.4);
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

  /** Sparks off the side of kart `i` that hit the logs, flying back off the wall. */
  private wallSparks(sim: RaceSim, i: number, strength: number): void {
    const view = this.views[i];
    if (!view || view.pos.distanceTo(this.cam.camera.position) > 90) return;
    const pr = sim.progress[i]!;
    const r = sim.track.at(pr.s).r;
    const side = Math.sign(pr.lateral) || 1;
    const out = new THREE.Vector3(r.x, 0, r.z).multiplyScalar(side);
    const at = view.pos.clone().addScaledVector(out, KART.half.x).setY(view.pos.y + 0.1);
    // Off the wall, up, and trailing behind the kart.
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(view.rot);
    const dir = out.clone().multiplyScalar(-0.7).add(new THREE.Vector3(0, 0.8, 0)).addScaledVector(fwd, -0.5);
    this.vfx.hitSparks(at, dir, 0.3 + strength * 0.7);
  }

  /**
   * Kart-on-kart hits, spotted from the views (the sim has no event for them,
   * and online the other phones' karts are proxies): two karts touching and
   * closing fast throw sparks from where they meet.
   */
  private kartSparks(dt: number): void {
    const n = this.views.length;
    if (dt <= 0) return;
    const camPos = this.cam.camera.position;
    const vel = this.views.map((view, i) => {
      const prev = this.bumpPrev[i];
      const vel = prev ? view.pos.clone().sub(prev).divideScalar(dt) : new THREE.Vector3();
      this.bumpPrev[i] = view.pos.clone();
      // A respawn teleports: no hit from that.
      return vel.lengthSq() > 80 * 80 ? new THREE.Vector3() : vel;
    });
    this.viewVel = vel;
    for (const [key, t] of this.bumpCool) {
      if (t <= dt) this.bumpCool.delete(key);
      else this.bumpCool.set(key, t - dt);
    }
    for (let i = 0; i < n; i++) {
      const a = this.views[i]!.pos;
      if (a.distanceTo(camPos) > 90) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.views[j]!.pos;
        const d = a.distanceTo(b);
        if (d > 2.6 || d < 0.01 || this.bumpCool.has(i * n + j)) continue;
        const normal = b.clone().sub(a).divideScalar(d);
        const closing = -vel[j]!.clone().sub(vel[i]!).dot(normal);
        if (closing < 2.5) continue;
        this.bumpCool.set(i * n + j, 0.35);
        const at = a.clone().add(b).multiplyScalar(0.5);
        at.y += 0.2;
        // Up and out, sideways to the hit.
        const dir = new THREE.Vector3(-normal.z, 1.4, normal.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
        dir.y = Math.abs(dir.y);
        this.vfx.hitSparks(at, dir, Math.min(1, closing / 12));
      }
    }
  }

  /**
   * Kart `i`'s looping effects: tyre smoke (sliding, hard braking, spun out),
   * burning tyres under No Brakes, sparks grinding along the logs, boulder grit,
   * Too Cool's glitter and feathers from a parrot overhead.
   */
  private kartTrails(sim: RaceSim, i: number): void {
    const k = sim.karts[i]!;
    const view = this.views[i]!;
    const vel = this.viewVel[i] ?? new THREE.Vector3();
    const speed = vel.length();
    const onGround = k.grounded >= 2 && !k.flying;
    const rear = new THREE.Vector3(0, -0.8, KART.wheelRearZ).applyQuaternion(view.rot).add(view.pos);
    const behind = new THREE.Vector3(0, 0.6, -1).applyQuaternion(view.rot);
    // Kart frame: local +X is the kart's left.
    const slip = Math.abs(vel.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(view.rot)));
    let tyre = 0;
    if (onGround) {
      if (k.spinning) tyre = 45;
      else if (slip > TYRE_SLIP && speed > 5) tyre = Math.min(45, 10 + (slip - TYRE_SLIP) * 10);
      if (k.applied.brake > 0.6 && k.forwardSpeed > 10) tyre = Math.max(tyre, 22);
    }
    this.vfx.trail('tyre', i, rear, behind, tyre);
    this.vfx.trail('burn', i, rear, behind, onGround && k.noBrakesTime > 0 ? 35 : 0);

    // Grinding along a barrier: the kart's edge is at the logs and it is moving.
    const pr = sim.progress[i]!;
    const smp = sim.track.at(pr.s);
    const side = pr.lateral < 0 ? -1 : 1;
    const grinding =
      onGround && speed > 5 && smp.road && !k.wet && Math.abs(pr.lateral) > smp.halfWidth - KART.half.x - 0.3 && !sim.track.isOpen(pr.s, side);
    const out = new THREE.Vector3(smp.r.x, 0, smp.r.z).multiplyScalar(side);
    const edge = view.pos.clone().addScaledVector(out, KART.half.x).setY(view.pos.y + 0.1);
    const back = vel.clone().normalize().multiplyScalar(-0.8).addScaledVector(out, -0.4).add(new THREE.Vector3(0, 0.7, 0));
    this.vfx.trail('scrape', i, edge, back, grinding ? speed * 2.5 : 0);

    // The boulder: grit and chips spat out behind, dust ground up either side,
    // and when it runs out the rock bursts back into a kart.
    const rolling = onGround && k.boulderTime > 0 && speed > 4;
    const under = view.pos.clone().setY(view.pos.y - 0.85);
    const kick = new THREE.Vector3(0, 0, -1.6).applyQuaternion(view.rot);
    this.vfx.trail('chips', i, under.clone().add(kick), behind.clone().setY(1.2), rolling ? 12 + speed * 2.5 : 0);
    this.vfx.trail('rubble', i, under.clone().addScaledVector(kick, 0.5), behind.clone().setY(0.25), rolling ? 10 + speed * 1.2 : 0);
    if ((this.wasBoulder[i] ?? 0) > 0 && k.boulderTime <= 0 && !k.out) {
      const at = view.pos.clone().setY(view.pos.y + 0.3);
      this.fx.emit({ pos: at, count: 40, color: [0x847e73, 0x625d55, 0xa59f92, 0x5f8f3e], speed: [4, 11], dir: new THREE.Vector3(0, 0.8, 0), spread: 1, size: [0.3, 0.7], life: [0.5, 1.1], gravity: 16 });
      this.vfx.dust(view.pos.clone().setY(view.pos.y - 0.75), 1.8, 0xa39c90);
    }
    this.wasBoulder[i] = k.boulderTime;
    this.vfx.trail('cool', i, view.pos, null, k.coolTime > 0 ? 40 : 0);
    this.vfx.trail('feathers', i, view.pos.clone().setY(view.pos.y + 3.2), null, k.flying ? 6 : 0);
  }

  /** Leaves or embers in the air ahead of the camera, and waves over a coast's ford. */
  private airFx(sim: RaceSim, dt: number): void {
    const look = LOOKS[sim.track.def.id];
    const camPos = this.cam.camera.position;
    // Well ahead and thick, since the camera races through the field: the rate
    // grows with the camera's speed, so the air looks as full at 30 m/s as at rest.
    const ahead = camPos.clone().addScaledVector(this.cam.camera.getWorldDirection(new THREE.Vector3()), 26);
    const rush = 1 + (this.viewVel[this.focusKart(sim)]?.length() ?? 0) / 6;
    this.vfx.ambient('leaves', ahead.clone().setY(ahead.y + 5), (look?.leaves ?? 0) * rush);
    this.vfx.ambient('embers', ahead, (look?.embers ?? 0) * rush);
    if (!look?.waveSpray) return;
    // Every few seconds a wave runs in from the sea across the ford: a line
    // of spray and foam sweeping over the road.
    const t = sim.track;
    if (!this.wave) {
      this.waveTimer -= dt;
      const w = t.waters[Math.floor(Math.random() * t.waters.length)];
      if (this.waveTimer > 0 || !w) return;
      this.waveTimer = 2 + Math.random() * 2;
      const s = w.s0 + Math.random() * (w.s1 - w.s0);
      const mid = t.at(s);
      if (camPos.distanceTo(new THREE.Vector3(mid.p.x, mid.p.y, mid.p.z)) > 150) return;
      // The sea is on the lower side.
      const h = t.def.terrain?.height;
      const ground = (lat: number) => (h ? h(mid.p.x + mid.r.x * lat, mid.p.z + mid.r.z * lat) : 0);
      this.wave = { s, from: ground(-30) < ground(30) ? -1 : 1, t: 0 };
    }
    const wave = this.wave;
    const reach = t.at(wave.s).halfWidth + 3;
    const before = wave.t;
    wave.t += dt / 0.9;
    // Spray at each step across the road that the front passed this frame.
    for (let step = Math.ceil(before * 8); step <= Math.min(8, wave.t * 8); step++) {
      const lat = wave.from * reach * (1 - (step / 8) * 2);
      const p = t.pointAt(wave.s + (Math.random() - 0.5) * 3, lat);
      const at = new THREE.Vector3(p.x, p.y + 0.15, p.z);
      this.fx.emit({ pos: at, count: 8, color: [0xffffff, 0xd8f4ff], speed: [3, 7], dir: new THREE.Vector3(0, 1, 0), spread: 0.5, size: [0.4, 0.9], life: [0.5, 1.0], gravity: 10 });
      this.vfx.dust(at, 0.35, 0xf4fbff);
    }
    if (wave.t >= 1) this.wave = null;
  }

  /** Over the podium: a firework every second or so. */
  private fireworks(dt: number): void {
    if (!this.podiumAt || !this.finishPodium) return;
    this.fireworkTimer -= dt;
    if (this.fireworkTimer > 0) return;
    this.fireworkTimer = 0.5 + Math.random() * 0.8;
    // In the podium's frame (+Z faces the camera): behind the steps, low enough to stay in shot.
    const at = this.finishPodium.localToWorld(new THREE.Vector3((Math.random() - 0.5) * 24, 9 + Math.random() * 4, -6 - Math.random() * 8));
    this.vfx.firework(at, FIREWORKS[Math.floor(Math.random() * FIREWORKS.length)]!);
  }

  /** Per-frame effects: dust, boost flames and smoke, sparks, the air. */
  private ambientFx(sim: RaceSim, dt: number): void {
    this.kartSparks(dt);
    this.airFx(sim, dt);
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
      if (view.pos.distanceTo(camPos) > 80 || k.out) {
        this.vfx.stopTrails(i);
        return;
      }
      const speed = Math.abs(k.forwardSpeed);
      if (k.grounded >= 2 && speed > 6 && Math.random() < speed / 40) {
        const back = new THREE.Vector3(0, -0.9, -1).applyQuaternion(view.rot).add(view.pos);
        this.fx.emit({ pos: back, count: 1, color: [0xd2b07a, 0xbf9a62], speed: [0.5, 2], dir: new THREE.Vector3(0, 0.6, 0), spread: 1, size: [0.5, 1.0], life: [0.4, 0.8] });
      }
      if (k.boosting) {
        const ex = view.rig.exhaust.clone().applyQuaternion(view.rot).add(view.pos);
        const back = new THREE.Vector3(0, 0.2, -1).applyQuaternion(view.rot);
        this.fx.emit({ pos: ex, count: 3, color: [0xffe14d, 0xff8a1f, 0xff4d1f], speed: [3, 7], dir: back, spread: 0.25, size: [0.35, 0.7], life: [0.15, 0.35], drag: 4 });
        this.vfx.trail('boost', i, ex, back, 40);
      } else this.vfx.trail('boost', i, view.pos, null, 0);
      this.kartTrails(sim, i);
      // Skimming across the top: a big fan of spray behind, and a callout.
      if (k.skimming) {
        const back = new THREE.Vector3(0, -0.7, -1.4).applyQuaternion(view.rot).add(view.pos);
        for (const side of [-1, 1]) {
          const out = new THREE.Vector3(side * 0.9, 0.9, -1).applyQuaternion(view.rot);
          this.fx.emit({ pos: back, count: 3, color: [0xffffff, 0xd8f4ff], speed: [6, 10], dir: out, spread: 0.3, size: [0.4, 0.8], life: [0.4, 0.8], gravity: 12 });
        }
        if (i === this.player && !this.wasSkim) this.hud.shout('SKIMMING!', 'good', 0.9);
      }
      if (i === this.player) this.wasSkim = k.skimming;
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
    const live = this.sim && this.state !== 'menu' ? this.sim : null;
    venue?.view.update(this.time, live ? live.lavaS : -Infinity, live?.events, live?.track.waters);
    if (live && this.state === 'race') this.eventWarnings(live);
    if (venue?.view.crater && this.state !== 'paused') this.erupt(dt, venue.view.crater);

    const sim = this.sim;
    if (sim && (this.state === 'race' || (this.mode !== 'solo' && (this.state === 'paused' || this.state === 'results')))) {
      this.stepRace(dt);
    }

    if (sim && this.state === 'results' && this.finishPodium) {
      for (const v of this.finishViews) v.animateIdle(dt);
      this.podiumCamera();
      this.fireworks(dt);
    } else if (sim) {
      const alpha = this.acc / sim.dt;
      sim.karts.forEach((k, i) => this.views[i]!.update(k, alpha, dt));
      this.placeShadows(sim);
      this.itemsView?.update(sim.items, this.time);
      if (this.state !== 'paused') this.ambientFx(sim, dt);
      const kart = sim.karts[this.player]!;
      const focus = this.focusKart(sim);
      if (this.state !== 'paused') {
        const fk = sim.karts[focus]!;
        this.cam.update(dt, this.views[focus]!.pos, this.views[focus]!.rot, {
          boosting: fk.boosting,
          spinning: fk.spinning,
          flying: fk.flying,
          lookBack: focus === this.player && this.controls.lookingBack,
          speed: fk.forwardSpeed,
          track: sim.track,
          s: sim.progress[focus]!.s,
        });
      }
      this.stage.followSun(this.views[focus]!.pos);
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

    if (this.state !== 'paused') {
      this.fx.update(dt);
      this.vfx.update(dt);
      this.updateRings(dt);
    }
    // The touch ★ shows only with a full meter.
    if (this.sim && this.state === 'race') {
      this.touch.setSwaggerReady(this.sim.swaggerOn && this.sim.karts[this.player]!.swagger >= 100);
      this.touch.setItem(this.sim.karts[this.player]!.item);
    }
    this.venues[this.trackIndex]?.view.sky?.update(this.time, this.cam.camera);
    this.stage.render(this.cam.camera);
  }

  /**
   * Whose kart the camera follows: the player's — or, once the lava has
   * toasted them, whoever is leading the karts still racing.
   */
  private focusKart(sim: RaceSim): number {
    if (this.state !== 'race' || !sim.progress[this.player]!.dnf) return this.player;
    // A moment on the smoking wreck first.
    if (this.playerFinishedAt === null || this.time - this.playerFinishedAt < 2) return this.player;
    const order = sim.standings();
    const lead =
      order.find((i) => !sim.karts[i]!.out && sim.progress[i]!.finishTime === null) ?? order.find((i) => !sim.karts[i]!.out);
    if (lead === undefined) return this.player;
    if (lead !== this.watching) {
      this.watching = lead;
      this.cam.cut();
      this.hud.shout(`WATCHING ${this.roster[lead]!.name.split(' ')[0]!.toUpperCase()}`, 'lap', 1.6);
    }
    return lead;
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

/** A floating name over another player's kart. */
function nameTag(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 40px "Lilita One", "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = '#2a1a0e';
  g.strokeText(name, 128, 34);
  g.fillStyle = '#fff6dd';
  g.fillText(name, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(3.2, 0.8, 1);
  sprite.position.set(0, 3.1, 0);
  sprite.renderOrder = 10;
  return sprite;
}

function loadName(): string {
  try {
    return localStorage.getItem('jj-name') ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem('jj-name', cleanName(name));
  } catch {
    // Storage blocked.
  }
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

function loadSwagger(): boolean {
  try {
    return localStorage.getItem('jj-swagger') !== 'off';
  } catch {
    return true;
  }
}
