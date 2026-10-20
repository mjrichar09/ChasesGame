/**
 * A player in someone else's room: the lobby, then a race where only our own
 * kart is driven here.
 *
 * - Our kart: real physics on this phone, fed straight from the controls.
 *   Banana boosts, the parrot, snake swings and our own swagger moves start
 *   on the press; the host confirms them (and owns the item counts).
 * - Everyone else: proxies drawn `INTERP_DELAY` in the past, blended between
 *   the two host snapshots around that moment — smooth even on a jittery
 *   connection. Solid, so we can still bump them.
 * - Hits on us (whacks, roars, claps, beats), pickups, laps, places, the
 *   lava and the jungle's changes arrive from the host.
 *
 * If the host's AI took our kart while we were away, we pick it up again
 * from where the host has it (the epoch says which spell of driving a report
 * belongs to).
 */

import { type DriverInput, NEUTRAL_INPUT } from '../sim/input.js';
import type { AiDriver } from '../sim/driver.js';
import { type ItemEvent, Items } from '../sim/items.js';
import type { Quat, Vec3 } from '../sim/math.js';
import { add, lerp, normalize, scale, sub, v3 } from '../sim/math.js';
import type { RaceSim } from '../sim/race.js';
import { roared } from '../sim/swagger.js';
import type { Link } from './link.js';
import {
  INTERP_DELAY,
  PROTOCOL,
  type RaceConfig,
  REPORT_EVERY,
  type Seat,
  type Settings,
  type ToHost,
  type ToPlayer,
  buildRace,
} from './protocol.js';
import { FAST, type KartSnap, type Snapshot, applyStatus, fastType, packReport, statusOf, unpackSnapshot } from './state.js';

/** No snapshot for this long and the host is gone quiet (its phone locked?), s. */
const STALL_AFTER = 1.0;
/**
 * How far past the host's newest snapshot our clock may run, s. A host phone
 * that is slow (or busy) runs its race slower than real time; we slow down
 * with it rather than race ahead and then stall.
 */
const MAX_LEAD = 0.25;

/** Own-kart events this phone already played when they happened. */
const PREDICTED = new Set<ItemEvent['type']>(['boost', 'peelDrop', 'swing', 'throw', 'parrot', 'swagger', 'peelHit', 'bonk']);

export interface ClientRace {
  sim: RaceSim;
  drivers: AiDriver[];
  config: RaceConfig;
  own: number;
}

export interface Room {
  you: string;
  seats: Seat[];
  settings: Settings;
  racing: boolean;
}

export class NetClient {
  room: Room | null = null;
  race: ClientRace | null = null;
  /** Round trip to the host, s (smoothed). */
  rtt = 0.1;
  /** The host has gone quiet mid-race. */
  stalled = false;
  onRoom: () => void = () => {};
  onStart: () => void = () => {};
  onBack: () => void = () => {};
  onClosed: (why: string) => void = () => {};

  private readonly link: Link;
  private readonly now: () => number;
  private snaps: Snapshot[] = [];
  private applied = -1;
  private lastHeard = 0;
  /** Host clock minus ours, as seen by snapshots arriving (null: not known yet). */
  private offset: number | null = null;
  private tick = 0;
  private epoch = 0;
  private lastUse = -1;
  private latch: DriverInput = { ...NEUTRAL_INPUT };
  private landed = false;
  private bonks = 0;
  private inbox: ItemEvent[] = [];
  private lastPing = -Infinity;
  private lastReport = -Infinity;
  private lastInput: DriverInput = NEUTRAL_INPUT;
  private why = '';

  constructor(link: Link, now: () => number, name: string, gorilla: number) {
    this.link = link;
    this.now = now;
    link.onReliable = (msg) => this.reliable(msg as ToPlayer);
    link.onFast = (buf) => this.fast(buf);
    link.onClose = () => this.onClosed(this.why || 'Lost the host.');
    this.send({ t: 'hello', v: PROTOCOL, name, gorilla });
  }

  private send(msg: ToHost): void {
    this.link.sendReliable(msg);
  }

  pick(gorilla: number): void {
    this.send({ t: 'pick', gorilla });
  }

  leave(): void {
    this.why = 'You left.';
    this.link.close();
  }

  private reliable(msg: ToPlayer): void {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'reject':
        this.why = msg.why;
        break;
      case 'room':
        this.room = { you: msg.you, seats: msg.seats, settings: msg.settings, racing: msg.racing };
        this.onRoom();
        break;
      case 'start':
        this.begin(msg.race, msg.you);
        break;
      case 'events':
        if (this.race) this.inbox.push(...msg.list);
        break;
      case 'pong': {
        const sample = this.now() - msg.at;
        this.rtt = this.rtt * 0.8 + sample * 0.2;
        break;
      }
      case 'back':
        this.race?.sim.free();
        this.race = null;
        this.onBack();
        break;
    }
  }

  private fast(buf: ArrayBuffer): void {
    if (!this.race || fastType(buf) !== FAST.snapshot) return;
    let snap: Snapshot;
    try {
      snap = unpackSnapshot(buf);
    } catch {
      return;
    }
    const newest = this.snaps[this.snaps.length - 1];
    if (newest && snap.tick <= newest.tick) return; // Late: a newer one is already here.
    // Items only come when they change: carry the last ones forward.
    this.snaps.push(snap);
    if (this.snaps.length > 12) this.snaps.shift();
    const now = this.now();
    const sample = snap.time - now;
    // Track the fastest arrivals; drift down slowly in case the clocks wander.
    if (this.offset === null || this.stalled || sample > this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.05;
    this.lastHeard = now;
  }

  private begin(config: RaceConfig, own: number): void {
    this.race?.sim.free();
    const { sim, drivers } = buildRace(config, 'client', own);
    sim.karts.forEach((k) => k.setProxy(k.index !== own));
    this.race = { sim, drivers, config, own };
    this.snaps = [];
    this.applied = -1;
    this.offset = null;
    this.tick = 0;
    this.epoch = 0;
    this.lastUse = -1;
    this.bonks = 0;
    this.inbox = [];
    this.stalled = false;
    this.onStart();
    // Tell the host we're loaded (it waits for everyone before the countdown).
    this.report(true);
  }

  /**
   * The host's race clock as the newest snapshots show it: from the clock
   * offset, but never more than `MAX_LEAD` past the newest one.
   */
  private hostSeen(): number {
    const now = this.now();
    const newest = this.snaps[this.snaps.length - 1]!;
    return Math.min(now + (this.offset ?? 0), newest.time + Math.min(now - this.lastHeard, MAX_LEAD));
  }

  /** Still here, even when there's nothing to step (the host waits for us, or would hand our kart to the AI). */
  private keepAlive(now: number): void {
    if (now - this.lastReport > 0.1) this.report(false, this.lastInput);
  }

  /**
   * One fixed step. `local` is the player's held input (null: let the AI
   * drive our kart, e.g. after the finish). Returns false while there is
   * nothing to step (waiting for the host).
   */
  step(local: DriverInput | null): boolean {
    const race = this.race;
    if (!race) return false;
    const now = this.now();
    if (now - this.lastPing > 1) {
      this.lastPing = now;
      this.send({ t: 'ping', at: now });
    }
    const latest = this.snaps[this.snaps.length - 1];
    if (!latest) {
      // Loaded, waiting for the host to start: keep saying so.
      if (this.tick++ % 30 === 0) this.report(true);
      return false;
    }
    this.stalled = now - this.lastHeard > STALL_AFTER;
    const { sim, own } = race;
    // Our clock follows the host's (half a round trip ahead of what we've seen),
    // and waits for it when the host runs slow.
    const seen = this.hostSeen();
    const target = seen + this.rtt / 2;
    if (this.stalled || sim.clock > target + 0.1) {
      this.keepAlive(now);
      return false;
    }
    const kart = sim.karts[own]!;
    if (latest.tick !== this.applied) {
      this.applyLatest(latest);
      this.applied = latest.tick;
    }
    this.interpolate(seen - INTERP_DELAY + sim.dt);
    for (const e of sim.events) e.t += sim.dt;
    const drift = target - sim.clock;
    if (drift > 0.3) sim.clock = target - sim.dt;
    else sim.clock += drift * 0.05;

    const pr = sim.progress[own]!;
    const input = local ?? race.drivers[own]!.drive(sim.dt, kart, pr, sim.track, sim.karts, sim.items, null, sim);
    if (rising(input, kart.prevInput)) this.lastUse = this.tick;
    this.lastInput = input;
    for (const b of BUTTONS) this.latch[b] ||= input[b];
    const inputs = sim.karts.map((_, i) => (i === own ? input : snapInput(this.snapOf(i))));
    const from = sim.items.events.length;
    sim.step(inputs);
    if (kart.landedThisStep) this.landed = true;
    for (let i = from; i < sim.items.events.length; i++) {
      const e = sim.items.events[i]!;
      if (e.type === 'peelHit' && e.kart === own && e.peel && e.peel > 0) this.send({ t: 'peel', id: e.peel });
      if (e.type === 'bonk' && e.kart === own) this.bonks++;
    }
    this.deliver(sim);
    this.tick++;
    if (this.tick % REPORT_EVERY === 0) this.report(false, input);
    return true;
  }

  private snapOf(i: number): KartSnap | undefined {
    return this.snaps[this.snaps.length - 1]?.karts[i];
  }

  /** Where our kart is and what we're pressing, for the host. */
  private report(hello: boolean, input: DriverInput = NEUTRAL_INPUT): void {
    const race = this.race!;
    const kart = race.sim.karts[race.own]!;
    const held: DriverInput = { ...input };
    for (const b of BUTTONS) held[b] = input[b] || this.latch[b];
    this.latch = { ...NEUTRAL_INPUT };
    this.link.sendFast(
      packReport({
        ...statusOf(kart),
        tick: hello ? 0 : this.tick,
        epoch: this.epoch,
        input: held,
        pos: kart.position,
        rot: kart.rotation,
        vel: kart.velocity,
        respawns: race.sim.progress[race.own]!.respawns,
        bonks: this.bonks,
        landed: this.landed,
      }),
    );
    this.landed = false;
    this.lastReport = this.now();
  }

  /** Take in the newest snapshot: everything the host decides. */
  private applyLatest(snap: Snapshot): void {
    const { sim, own } = this.race!;
    sim.order = snap.order;
    snap.karts.forEach((ks, i) => {
      const k = sim.karts[i]!;
      const pr = sim.progress[i]!;
      if (i !== own) {
        k.item = ks.item;
        k.charges = ks.charges;
        k.swagger = ks.swagger;
        pr.dist = ks.dist;
        pr.s = ks.s;
        pr.lateral = ks.lateral;
      }
      pr.lap = ks.lap;
      pr.finishTime = ks.finishTime;
      if (ks.dnf && !pr.dnf) {
        pr.dnf = true;
        sim.toast(k, true);
      }
    });
    this.applyOwn(snap);

    const items = snap.items;
    if (items) {
      items.pickups.forEach((p, i) => {
        const mine = sim.items.pickups[i];
        if (mine) {
          mine.active = p.active;
          mine.kind = p.kind;
        }
      });
      const ages = new Map(sim.items.peels.map((p) => [p.id, p.age]));
      // Our own peel guesses stay until the host's real one turns up near them.
      const guesses = sim.items.peels.filter(
        (g) => g.id < 0 && g.age < 1.5 && !items.peels.some((p) => p.owner === g.owner && Math.hypot(p.pos.x - g.pos.x, p.pos.z - g.pos.z) < 3),
      );
      sim.items.peels.length = 0;
      for (const p of items.peels) sim.items.peels.push({ ...p, age: ages.get(p.id) ?? 0 });
      sim.items.peels.push(...guesses);
      sim.items.loose.length = 0;
      for (const l of items.loose) sim.items.loose.push({ ...l, ttl: 99 });
    }
    // The jungle's changes, as the host has them.
    snap.events.forEach((h, i) => {
      const e = sim.events[i];
      if (!e) return;
      const grew = e.def.kind === 'flood' && h.stage > e.stage;
      if (h.phase === 'active' && (e.phase !== 'active' || grew)) {
        e.phase = 'active';
        e.stage = h.stage;
        e.t = h.t;
        sim.applyEvent(e);
      } else if (h.phase === 'warning' && e.phase === 'idle') {
        e.phase = 'warning';
        e.t = h.t;
      }
    });
  }

  private applyOwn(snap: Snapshot): void {
    const { sim, own } = this.race!;
    const me = snap.karts[own]!;
    const kart = sim.karts[own]!;
    const pr = sim.progress[own]!;
    if (me.ai && me.epoch !== this.epoch) {
      // The host's AI drove our kart while we were away: take it back from there.
      this.epoch = me.epoch;
      const age = Math.min(0.3, this.rtt / 2 + (this.now() + (this.offset ?? 0) - snap.time));
      kart.body.setTranslation(add(me.pos, scale(me.vel, age)), true);
      kart.body.setRotation(me.rot, true);
      kart.body.setLinvel(me.vel, true);
      kart.body.setAngvel(v3(), true);
      applyStatus(kart, me);
      pr.dist = me.dist;
      pr.s = me.s;
      pr.safeS = me.s;
      pr.lateral = me.lateral;
      kart.power = 1;
    }
    // Items and the meter are the host's — unless we just used one and the
    // host hasn't seen that press yet.
    if (snap.ack >= this.lastUse) {
      kart.item = me.item;
      kart.charges = me.charges;
      kart.swagger = me.swagger;
    }
    // Hits from others: whichever lasts longer.
    kart.wobbleTime = Math.max(kart.wobbleTime, me.wobbleTime);
    kart.slowTime = Math.max(kart.slowTime, me.slowTime);
    kart.steerSwapTime = Math.max(kart.steerSwapTime, me.steerSwapTime);
  }

  /** Put every other kart where it was `t` (host clock) — between two snapshots. */
  private interpolate(t: number): void {
    const { sim, own } = this.race!;
    const snaps = this.snaps;
    let a = snaps[snaps.length - 1]!;
    let b = a;
    for (let i = snaps.length - 1; i > 0; i--) {
      if (snaps[i - 1]!.time <= t) {
        a = snaps[i - 1]!;
        b = snaps[i]!;
        break;
      }
      a = b = snaps[i - 1]!;
    }
    const span = b.time - a.time;
    const f = span > 1e-6 ? Math.max(0, Math.min(1, (t - a.time) / span)) : 0;
    // Past the newest snapshot: carry on along its velocity a little way.
    const ahead = b === snaps[snaps.length - 1] && t > b.time ? Math.min(0.25, t - b.time) : 0;
    for (const k of sim.karts) {
      if (k.index === own || k.out) continue;
      const ka = a.karts[k.index]!;
      const kb = b.karts[k.index]!;
      const pos = ahead > 0 ? add(kb.pos, scale(kb.vel, ahead)) : lerpVec(ka.pos, kb.pos, f);
      k.pose(pos, ahead > 0 ? kb.rot : nlerp(ka.rot, kb.rot, f), lerpVec(ka.vel, kb.vel, f));
      applyStatus(k, f < 0.5 ? ka : kb);
    }
  }

  /** Hand the host's events to the game, minus the ones we already played. */
  private deliver(sim: RaceSim): void {
    const own = this.race!.own;
    for (const e of this.inbox) {
      if (e.type === 'track') continue; // Played when we applied the change ourselves.
      // Coconuts fly here as well as on the host, and drop here when they run out.
      if (e.type === 'coconutDrop') continue;
      if ('kart' in e && e.kart === own && PREDICTED.has(e.type)) continue;
      if (e.type === 'whack' && e.victim === own) this.whacked(sim, e.kart);
      if (e.type === 'throw') sim.items.launch(e.kart, e.pos, e.vel, e.curve, e.life);
      if (e.type === 'conk') {
        sim.items.dropCoconut(e.kart);
        const me = sim.karts[own]!;
        if (e.victim === own && !me.immune && !me.flying) Items.conked(me, e.vel);
      }
      if (e.type === 'swagger' && e.move === 'roar' && e.phase === 'hit' && e.victims?.includes(own)) {
        const me = sim.karts[own]!;
        if (!me.immune && !me.flying) roared(me, e.pos);
      }
      sim.items.events.push(e);
    }
    this.inbox = [];
  }

  /** Someone's snake got us: lose speed, wobble, slow down, and get shoved away from them. */
  private whacked(sim: RaceSim, by: number): void {
    const me = sim.karts[this.race!.own]!;
    if (me.immune || me.flying) return;
    const away = sub(me.position, sim.karts[by]!.position);
    Items.whacked(me, normalize(v3(away.x, 0, away.z)));
  }
}

const BUTTONS = ['item', 'whackLeft', 'whackRight', 'swagger'] as const;

function rising(now: DriverInput, before: DriverInput): boolean {
  return BUTTONS.some((b) => now[b] && !before[b]);
}

function snapInput(k: KartSnap | undefined): DriverInput {
  return k ? { ...NEUTRAL_INPUT, throttle: k.throttle, brake: k.brake, steer: k.steer } : NEUTRAL_INPUT;
}

function lerpVec(a: Vec3, b: Vec3, f: number): Vec3 {
  return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f) };
}

function nlerp(a: Quat, b: Quat, f: number): Quat {
  const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  const x = lerp(a.x, b.x * sign, f);
  const y = lerp(a.y, b.y * sign, f);
  const z = lerp(a.z, b.z * sign, f);
  const w = lerp(a.w, b.w * sign, f);
  const n = Math.hypot(x, y, z, w) || 1;
  return { x: x / n, y: y / n, z: z / n, w: w / n };
}
