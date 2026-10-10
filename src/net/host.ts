/**
 * The host: a room on one player's phone, and the official race.
 *
 * Who decides what (docs/multiplayer.md):
 * - Each player's own kart is driven on *their* phone — steering never waits
 *   on the network. Here it is a proxy that follows their reports.
 * - Everything shared is decided here, once: pickups and item rolls, hits on
 *   other karts, swagger moves, laps and places, the finish, the lava, the
 *   jungle's mid-race changes, and the AI gorillas in empty grid slots.
 * - A player who goes quiet (phone locked, app switched) has their kart
 *   driven by the AI until they come back, so the race never waits on anyone
 *   but the host.
 *
 * The host's own kart is an ordinary kart in its own race.
 */

import { GORILLAS } from '../data/gorillas.js';
import type { AiDriver } from '../sim/driver.js';
import { type DriverInput, NEUTRAL_INPUT } from '../sim/input.js';
import type { ItemEvent } from '../sim/items.js';
import { add, scale } from '../sim/math.js';
import type { RaceSim } from '../sim/race.js';
import type { Link } from './link.js';
import {
  AWAY_AFTER,
  DEFAULT_SETTINGS,
  MAX_PLAYERS,
  PROTOCOL,
  type RaceConfig,
  SNAPSHOT_EVERY,
  type Seat,
  type Settings,
  type ToHost,
  type ToPlayer,
  buildRace,
  cleanName,
  makeRaceConfig,
} from './protocol.js';
import { FAST, type Report, applyStatus, fastType, itemsKey, packSnapshot, unpackReport, withAck } from './state.js';

/** How long the host waits for every phone to load the track before starting anyway, s. */
const LOAD_WAIT = 15;

interface Remote {
  link: Link;
  kart: number;
  report: Report | null;
  /** When the latest report arrived, and when any report did. */
  at: number;
  heard: number;
  /** The tick of the report last applied to the race (the ack). */
  applied: number;
  away: boolean;
  /** Bumped each time the AI takes the kart over. */
  epoch: number;
  respawns: number;
  bonks: number;
  landed: boolean;
  gone: boolean;
}

export interface HostRace {
  sim: RaceSim;
  drivers: AiDriver[];
  config: RaceConfig;
  /** The host's own kart. */
  own: number;
}

export class NetHost {
  readonly seats: Seat[];
  settings: Settings = { ...DEFAULT_SETTINGS };
  race: HostRace | null = null;
  /** Called when the room changes (someone joins, leaves, picks a gorilla). */
  onRoom: () => void = () => {};

  private readonly links = new Map<string, Link>();
  private readonly remotes = new Map<string, Remote>();
  private readonly now: () => number;
  private tick = 0;
  private startedAt = 0;
  private sentKey = '';
  private outbox: ItemEvent[] = [];
  private claims: { kart: number; id: number }[] = [];
  /** When the race last stepped (a host phone that was asleep hasn't been listening). */
  private lastStep = 0;

  constructor(now: () => number, name: string, gorilla: number) {
    this.now = now;
    this.seats = [{ id: 'host', name: cleanName(name), gorilla }];
  }

  /** A player's phone connected. They are seated once they say hello. */
  accept(link: Link): void {
    link.onReliable = (raw) => this.reliable(link, raw as ToHost);
    link.onFast = (buf) => this.fast(link, buf);
    link.onClose = () => this.drop(link);
  }

  private reliable(link: Link, msg: ToHost): void {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      if (this.links.has(link.id)) return;
      const no = (why: string) => {
        this.send(link, { t: 'reject', why });
        setTimeout(() => link.close(), 500);
      };
      if (msg.v !== PROTOCOL) return no('Different game version — reload the page on both phones.');
      if (this.race) return no('A race is on — try again when it ends.');
      if (this.seats.length >= MAX_PLAYERS) return no('The room is full.');
      this.links.set(link.id, link);
      this.seats.push({ id: link.id, name: cleanName(msg.name), gorilla: this.freeGorilla(msg.gorilla) });
      this.roomChanged();
    } else if (msg.t === 'pick') {
      const seat = this.seats.find((s) => s.id === link.id);
      if (seat && !this.race && this.taken(msg.gorilla, seat.id) === false) {
        seat.gorilla = msg.gorilla;
        this.roomChanged();
      }
    } else if (msg.t === 'peel') {
      const r = this.remotes.get(link.id);
      if (r && typeof msg.id === 'number') this.claims.push({ kart: r.kart, id: msg.id });
    } else if (msg.t === 'ping') {
      this.send(link, { t: 'pong', at: msg.at });
    }
  }

  private fast(link: Link, buf: ArrayBuffer): void {
    if (fastType(buf) !== FAST.report) return;
    const r = this.remotes.get(link.id);
    if (!r) return;
    let rep: Report;
    try {
      rep = unpackReport(buf);
    } catch {
      return;
    }
    r.heard = this.now();
    if (rep.epoch !== r.epoch) return; // From before the AI took over; they'll catch up.
    if (r.report && rep.tick <= r.report.tick) return; // Arrived out of order.
    if (rep.landed) r.landed = true;
    r.report = rep;
    r.at = this.now();
  }

  private drop(link: Link): void {
    this.links.delete(link.id);
    const r = this.remotes.get(link.id);
    if (r) r.gone = true;
    const i = this.seats.findIndex((s) => s.id === link.id);
    if (i >= 0 && !this.race) {
      this.seats.splice(i, 1);
      this.roomChanged();
    }
  }

  private taken(gorilla: number, except: string): boolean {
    return gorilla < 0 || gorilla >= GORILLAS.length || this.seats.some((s) => s.id !== except && s.gorilla === gorilla);
  }

  private freeGorilla(want: number): number {
    if (!this.taken(want, '')) return want;
    return GORILLAS.findIndex((_, g) => !this.taken(g, '')) ;
  }

  /** The host picks their own gorilla. */
  pick(gorilla: number): void {
    if (!this.taken(gorilla, 'host')) {
      this.seats[0]!.gorilla = gorilla;
      this.roomChanged();
    }
  }

  setSettings(s: Partial<Settings>): void {
    this.settings = { ...this.settings, ...s };
    this.roomChanged();
  }

  private roomChanged(): void {
    for (const link of this.links.values()) {
      this.send(link, { t: 'room', you: link.id, seats: this.seats, settings: this.settings, racing: !!this.race });
    }
    this.onRoom();
  }

  private send(link: Link, msg: ToPlayer): void {
    link.sendReliable(msg);
  }

  /** Start a race with everyone in the room. */
  start(seed: number): HostRace {
    // Seats whose phone went away before the start don't race.
    for (let i = this.seats.length - 1; i > 0; i--) if (!this.links.has(this.seats[i]!.id)) this.seats.splice(i, 1);
    const { config, slots } = makeRaceConfig(this.seats, this.settings, seed);
    const { sim, drivers } = buildRace(config, 'host');
    this.remotes.clear();
    this.seats.forEach((seat, i) => {
      if (seat.id === 'host') return;
      const link = this.links.get(seat.id)!;
      const kart = slots[i]!;
      sim.karts[kart]!.setProxy(true);
      this.remotes.set(seat.id, {
        link, kart, report: null, at: 0, heard: 0, applied: 0, away: false, epoch: 0, respawns: 0, bonks: 0, landed: false, gone: false,
      });
      this.send(link, { t: 'start', race: config, you: kart });
    });
    this.race = { sim, drivers, config, own: slots[0]! };
    this.tick = 0;
    this.startedAt = this.now();
    this.lastStep = this.startedAt;
    this.sentKey = '';
    this.outbox = [];
    this.claims = [];
    this.roomChanged();
    return this.race;
  }

  /** True while players' phones are still loading the race (the host waits for them). */
  get loading(): boolean {
    if (!this.race || this.tick > 0) return false;
    if (this.now() - this.startedAt > LOAD_WAIT) return false;
    return [...this.remotes.values()].some((r) => !r.report && !r.gone);
  }

  /** Remote players and how they are doing, for the HUD. */
  get players(): { kart: number; away: boolean; gone: boolean }[] {
    return [...this.remotes.values()].map((r) => ({ kart: r.kart, away: r.away, gone: r.gone }));
  }

  /**
   * One fixed step of the official race. `local` is the host's own held
   * input (null: the AI drives the host's kart, e.g. after the finish).
   * Returns false while waiting for phones to load.
   */
  step(local: DriverInput | null): boolean {
    const race = this.race;
    if (!race || this.loading) return false;
    const { sim, drivers } = race;
    const now = this.now();
    const from = sim.items.events.length;
    // Back from being asleep ourselves: nobody went quiet, we did.
    if (now - this.lastStep > AWAY_AFTER / 2) for (const r of this.remotes.values()) r.heard = Math.max(r.heard, now);
    this.lastStep = now;

    for (const r of this.remotes.values()) this.follow(r, sim, now);
    for (const c of this.claims) sim.items.claimPeel(sim.karts[c.kart]!, c.id);
    this.claims = [];

    // Rubber-banding leans on the best human, as in solo.
    const humans = [race.own, ...[...this.remotes.values()].map((r) => r.kart)];
    const best = Math.max(...humans.map((i) => sim.progress[i]!.dist));
    const ai = (i: number) => drivers[i]!.drive(sim.dt, sim.karts[i]!, sim.progress[i]!, sim.track, sim.karts, sim.items, best, sim);
    const remoteOf = new Map([...this.remotes.values()].map((r) => [r.kart, r]));
    const inputs = sim.karts.map((_, i) => {
      if (i === race.own) return local ?? ai(i);
      const r = remoteOf.get(i);
      if (!r) return ai(i);
      if (r.away) return ai(i);
      return r.report?.input ?? NEUTRAL_INPUT;
    });
    sim.step(sim.phase === 'countdown' ? sim.karts.map(() => NEUTRAL_INPUT) : inputs);
    this.tick++;
    for (let i = from; i < sim.items.events.length; i++) this.outbox.push(sim.items.events[i]!);
    if (this.tick % SNAPSHOT_EVERY === 0) this.broadcast(sim);
    return true;
  }

  /** Move a player's proxy to where their phone says it is, or hand it to the AI. */
  private follow(r: Remote, sim: RaceSim, now: number): void {
    const kart = sim.karts[r.kart]!;
    const quiet = r.gone || (r.report ? now - r.heard > AWAY_AFTER : now - this.startedAt > LOAD_WAIT);
    if (quiet && !r.away) {
      // The AI takes over from wherever the kart is.
      r.away = true;
      r.epoch = (r.epoch + 1) % 256;
      r.report = null;
      kart.setProxy(false);
      return;
    }
    const rep = r.report;
    if (r.away) {
      // Back: their phone has picked the kart up from the AI (a report in the new epoch).
      if (quiet || !rep) return;
      r.away = false;
      kart.power = 1;
      kart.setProxy(true);
    }
    if (!rep) return;
    // Their report is a little old by now: carry it forward (at most 0.2 s).
    const age = Math.min(0.2, now - r.at) + sim.dt;
    const keep = { windup: kart.moveWindup, moveT: kart.moveT, wobble: kart.wobbleTime, slow: kart.slowTime, swap: kart.steerSwapTime };
    kart.pose(add(rep.pos, scale(rep.vel, age)), rep.rot, rep.vel);
    applyStatus(kart, rep);
    // Swagger moves fire here (they hit other karts); hits from others last
    // whichever is longer — the host's or what the phone already knows.
    kart.moveWindup = keep.windup;
    kart.moveT = keep.moveT;
    kart.wobbleTime = Math.max(keep.wobble, rep.wobbleTime);
    kart.slowTime = Math.max(keep.slow, rep.slowTime);
    kart.steerSwapTime = Math.max(keep.swap, rep.steerSwapTime);
    if (r.landed) {
      kart.reportedLanding = true;
      r.landed = false;
    }
    while (r.respawns < rep.respawns) {
      r.respawns++;
      sim.reportRespawn(r.kart);
    }
    while (r.bonks < rep.bonks) {
      r.bonks++;
      sim.reportBonk(r.kart, 0.6);
    }
    r.applied = rep.tick;
  }

  private broadcast(sim: RaceSim): void {
    const ai = sim.karts.map(() => false);
    const epoch = sim.karts.map(() => 0);
    for (const r of this.remotes.values()) {
      ai[r.kart] = r.away;
      epoch[r.kart] = r.epoch;
    }
    const key = itemsKey(sim);
    const withItems = key !== this.sentKey || this.tick % 120 === 0;
    this.sentKey = key;
    const snap = packSnapshot(sim, this.tick, ai, epoch, withItems);
    const events = this.outbox;
    this.outbox = [];
    for (const r of this.remotes.values()) {
      if (r.gone) continue;
      if (events.length) this.send(r.link, { t: 'events', list: events });
      r.link.sendFast(withAck(snap, r.applied));
    }
  }

  /** Everyone back to the room for another race. */
  backToRoom(): void {
    this.race?.sim.free();
    this.race = null;
    this.remotes.clear();
    for (let i = this.seats.length - 1; i > 0; i--) if (!this.links.has(this.seats[i]!.id)) this.seats.splice(i, 1);
    for (const link of this.links.values()) this.send(link, { t: 'back' });
    this.roomChanged();
  }

  close(): void {
    for (const link of this.links.values()) link.close();
    this.links.clear();
  }
}
