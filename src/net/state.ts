/**
 * What goes over the wire during a race, and how it is packed.
 *
 * - A **snapshot** (host → each player, 20 Hz): every kart's pose and status,
 *   everyone's progress, the pickups, peels and loose bananas, and the track
 *   events' phases. The host packs it once; only the 5-byte header (whose
 *   report it acknowledges) differs per player.
 * - A **report** (player → host, 60 Hz): the player's held buttons and where
 *   their kart is — the kart is driven on their phone, so this *is* the kart
 *   as far as the host is concerned.
 */

import type { DriverInput } from '../sim/input.js';
import type { ItemKind, Kart } from '../sim/kart.js';
import type { Quat, Vec3 } from '../sim/math.js';
import type { EventPhase } from '../sim/events.js';
import type { RaceSim } from '../sim/race.js';
import { Reader, Writer } from './bin.js';

const ITEM_KINDS: readonly ItemKind[] = ['none', 'banana', 'snake', 'parrot'];
const PHASES: readonly EventPhase[] = ['idle', 'warning', 'active'];
const MSG_SNAPSHOT = 1;
const MSG_REPORT = 2;

/** Message type of a fast (binary) message. */
export function fastType(buf: ArrayBuffer): number {
  return buf.byteLength ? new DataView(buf).getUint8(0) : 0;
}

/** The status a kart's view and the race rules read, besides where it is. */
export interface KartStatus {
  steerAngle: number;
  throttle: number;
  brake: number;
  steer: number;
  comp: number[];
  contact: number;
  airTime: number;
  boostTime: number;
  spinTime: number;
  spinDir: -1 | 1;
  wobbleTime: number;
  flyTime: number;
  flyElapsed: number;
  sinceFlight: number;
  noBrakesTime: number;
  slowTime: number;
  steerSwapTime: number;
  coolTime: number;
  boulderTime: number;
  moveWindup: number;
  moveT: number;
  showOff: number;
  swingSide: -1 | 0 | 1;
  swingTime: number;
}

export interface KartSnap extends KartStatus {
  pos: Vec3;
  rot: Quat;
  vel: Vec3;
  item: ItemKind;
  charges: number;
  swagger: number;
  out: boolean;
  /** The host's AI is driving this player's kart (they are away); bumped each takeover. */
  ai: boolean;
  epoch: number;
  // Progress.
  dist: number;
  s: number;
  lateral: number;
  lap: number;
  finishTime: number | null;
  dnf: boolean;
}

export interface SnapItems {
  pickups: { active: boolean; kind: Exclude<ItemKind, 'none'> }[];
  peels: { id: number; pos: Vec3; yaw: number; owner: number }[];
  loose: { id: number; pos: Vec3 }[];
}

/** A short key that changes whenever the road's items do. */
export function itemsKey(sim: RaceSim): string {
  const it = sim.items;
  return `${it.pickups.map((p) => (p.active ? p.kind[0] : '-')).join('')}|${it.peels.map((p) => p.id).join(',')}|${it.loose.map((l) => l.id).join(',')}`;
}

export interface Snapshot {
  /** The last report from this player the host had applied. */
  ack: number;
  tick: number;
  /** Host race clock (sim.clock). */
  time: number;
  karts: KartSnap[];
  order: number[];
  /** The road's items — only sent when they changed (and once a second), null otherwise. */
  items: SnapItems | null;
  events: { phase: EventPhase; stage: number; t: number }[];
}

function writeStatus(w: Writer, k: KartStatus): void {
  w.i8(k.steerAngle * 100);
  w.unit(k.throttle);
  w.unit(k.brake);
  w.i8(k.steer * 127);
  for (const c of k.comp) w.unit(c);
  w.u8(k.contact);
  w.time(k.airTime);
  w.time(k.boostTime);
  w.time(k.spinTime);
  w.i8(k.spinDir);
  w.time(k.wobbleTime);
  w.time(k.flyTime);
  w.time(k.flyElapsed);
  w.time(k.sinceFlight);
  w.time(k.noBrakesTime);
  w.time(k.slowTime);
  w.time(k.steerSwapTime);
  w.time(k.coolTime);
  w.time(k.boulderTime);
  w.time(k.moveWindup);
  w.time(k.moveT);
  w.time(k.showOff);
  w.i8(k.swingSide);
  w.time(k.swingTime);
}

function readStatus(r: Reader): KartStatus {
  return {
    steerAngle: r.i8() / 100,
    throttle: r.unit(),
    brake: r.unit(),
    steer: r.i8() / 127,
    comp: [r.unit(), r.unit(), r.unit(), r.unit()],
    contact: r.u8(),
    airTime: r.time(),
    boostTime: r.time(),
    spinTime: r.time(),
    spinDir: r.i8() < 0 ? -1 : 1,
    wobbleTime: r.time(),
    flyTime: r.time(),
    flyElapsed: r.time(),
    sinceFlight: r.time(),
    noBrakesTime: r.time(),
    slowTime: r.time(),
    steerSwapTime: r.time(),
    coolTime: r.time(),
    boulderTime: r.time(),
    moveWindup: r.time(),
    moveT: r.time(),
    showOff: r.time(),
    swingSide: r.i8() as -1 | 0 | 1,
    swingTime: r.time(),
  };
}

/** A kart's status, read off the sim. */
export function statusOf(k: Kart): KartStatus {
  return {
    steerAngle: k.steerAngle,
    throttle: k.applied.throttle,
    brake: k.applied.brake,
    steer: k.applied.steer,
    // Compression as a fraction of the spring's length (≤ 0.6 m).
    comp: k.wheels.map((w) => w.compression / 0.6),
    contact: k.wheels.reduce((bits, w, i) => bits | (w.contact ? 1 << i : 0), 0),
    airTime: k.airTime,
    boostTime: k.boostTime,
    spinTime: k.spinTime,
    spinDir: k.spinDir,
    wobbleTime: k.wobbleTime,
    flyTime: k.flyTime,
    flyElapsed: k.flyElapsed,
    sinceFlight: k.sinceFlight,
    noBrakesTime: k.noBrakesTime,
    slowTime: k.slowTime,
    steerSwapTime: k.steerSwapTime,
    coolTime: k.coolTime,
    boulderTime: k.boulderTime,
    moveWindup: k.moveWindup,
    moveT: k.moveT,
    showOff: k.showOff,
    swingSide: k.swingSide,
    swingTime: k.swingTime,
  };
}

/**
 * Put a status onto a kart. `victim` fields (what others do to you) are
 * merged by max when `merge` is set, so a hit the host saw is never lost
 * and one the phone saw first is never shortened.
 */
export function applyStatus(k: Kart, s: KartStatus): void {
  k.steerAngle = s.steerAngle;
  k.applied = { ...k.applied, throttle: s.throttle, brake: s.brake, steer: s.steer };
  k.wheels.forEach((w, i) => {
    w.compression = s.comp[i]! * 0.6;
    w.contact = (s.contact & (1 << i)) !== 0;
  });
  k.airTime = s.airTime;
  k.boostTime = s.boostTime;
  k.spinTime = s.spinTime;
  k.spinDir = s.spinDir;
  k.wobbleTime = s.wobbleTime;
  k.flyTime = s.flyTime;
  k.flyElapsed = s.flyElapsed;
  k.sinceFlight = s.sinceFlight;
  k.noBrakesTime = s.noBrakesTime;
  k.slowTime = s.slowTime;
  k.steerSwapTime = s.steerSwapTime;
  k.coolTime = s.coolTime;
  k.boulderTime = s.boulderTime;
  k.moveWindup = s.moveWindup;
  k.moveT = s.moveT;
  k.showOff = s.showOff;
  k.swingSide = s.swingSide;
  k.swingTime = s.swingTime;
}

/**
 * Pack a snapshot of the race. `ai[i]`/`epoch[i]` say who drives kart i.
 * The ack (bytes 1..4) is patched per player with `withAck`.
 */
export function packSnapshot(sim: RaceSim, tick: number, ai: readonly boolean[], epoch: readonly number[], withItems = true): ArrayBuffer {
  const w = new Writer(1600);
  w.u8(MSG_SNAPSHOT);
  w.u32(0);
  w.u32(tick);
  w.f32(sim.clock);
  w.u8(sim.karts.length);
  for (const k of sim.karts) {
    const pr = sim.progress[k.index]!;
    w.vec(k.position);
    w.quat(k.rotation);
    w.vel(k.velocity);
    writeStatus(w, statusOf(k));
    w.u8(ITEM_KINDS.indexOf(k.item));
    w.u8(k.charges);
    w.u8(k.swagger);
    w.u8((k.out ? 1 : 0) | (ai[k.index] ? 2 : 0) | (pr.dnf ? 4 : 0));
    w.u8(epoch[k.index] ?? 0);
    w.f32(pr.dist);
    w.f32(pr.s);
    w.f32(pr.lateral);
    w.u8(pr.lap);
    w.f32(pr.finishTime ?? -1);
  }
  for (const i of sim.standings()) w.u8(i);
  w.u8(withItems ? 1 : 0);
  if (withItems) packItems(w, sim);
  w.u8(sim.events.length);
  for (const e of sim.events) {
    w.u8(PHASES.indexOf(e.phase));
    w.u8(e.stage);
    w.f32(e.t);
  }
  return w.done();
}

function packItems(w: Writer, sim: RaceSim): void {
  const items = sim.items;
  w.u8(items.pickups.length);
  for (const p of items.pickups) w.u8((p.active ? 4 : 0) | ITEM_KINDS.indexOf(p.kind));
  const peels = items.peels.filter((p) => p.id > 0);
  w.u8(peels.length);
  for (const p of peels) {
    w.u16(p.id);
    w.vec(p.pos);
    w.i16(p.yaw * 10000);
    w.u8(p.owner);
  }
  w.u8(items.loose.length);
  for (const l of items.loose) {
    w.u16(l.id);
    w.vec(l.pos);
  }
}

/** A copy of a packed snapshot acknowledging report `ack`. */
export function withAck(buf: ArrayBuffer, ack: number): ArrayBuffer {
  const copy = buf.slice(0);
  new DataView(copy).setUint32(1, ack >>> 0);
  return copy;
}

export function unpackSnapshot(buf: ArrayBuffer): Snapshot {
  const r = new Reader(buf);
  r.u8();
  const ack = r.u32();
  const tick = r.u32();
  const time = r.f32();
  const n = r.u8();
  const karts: KartSnap[] = [];
  for (let i = 0; i < n; i++) {
    const pos = r.vec();
    const rot = r.quat();
    const vel = r.vel();
    const status = readStatus(r);
    const item = ITEM_KINDS[r.u8()] ?? 'none';
    const charges = r.u8();
    const swagger = r.u8();
    const flags = r.u8();
    const epoch = r.u8();
    const dist = r.f32();
    const s = r.f32();
    const lateral = r.f32();
    const lap = r.u8();
    const fin = r.f32();
    karts.push({
      ...status,
      pos,
      rot,
      vel,
      item,
      charges,
      swagger,
      out: (flags & 1) !== 0,
      ai: (flags & 2) !== 0,
      dnf: (flags & 4) !== 0,
      epoch,
      dist,
      s,
      lateral,
      lap,
      finishTime: fin < 0 ? null : fin,
    });
  }
  const order = Array.from({ length: n }, () => r.u8());
  let items: SnapItems | null = null;
  if (r.u8()) {
    const pickups = Array.from({ length: r.u8() }, () => {
      const b = r.u8();
      return { active: (b & 4) !== 0, kind: (ITEM_KINDS[b & 3] ?? 'banana') as Exclude<ItemKind, 'none'> };
    });
    const peels = Array.from({ length: r.u8() }, () => ({ id: r.u16(), pos: r.vec(), yaw: r.i16() / 10000, owner: r.u8() }));
    const loose = Array.from({ length: r.u8() }, () => ({ id: r.u16(), pos: r.vec() }));
    items = { pickups, peels, loose };
  }
  const events = Array.from({ length: r.u8() }, () => ({ phase: PHASES[r.u8()] ?? 'idle', stage: r.u8(), t: r.f32() }));
  return { ack, tick, time, karts, order, items, events };
}

export interface Report extends KartStatus {
  /** The player's step counter when this was sent. */
  tick: number;
  /** Which spell of driving this is (bumped each time the host's AI hands the kart back). */
  epoch: number;
  input: DriverInput;
  pos: Vec3;
  rot: Quat;
  vel: Vec3;
  /** Totals so far — the host turns increases into events. */
  respawns: number;
  bonks: number;
  /** Touched down after real air since the last report. */
  landed: boolean;
}

const BUTTONS = ['item', 'whackLeft', 'whackRight', 'swagger'] as const;

export function packReport(rep: Report): ArrayBuffer {
  const w = new Writer(160);
  w.u8(MSG_REPORT);
  w.u32(rep.tick);
  w.u8(rep.epoch);
  w.unit(rep.input.throttle);
  w.unit(rep.input.brake);
  w.i8(rep.input.steer * 127);
  w.u8(BUTTONS.reduce((bits, b, i) => bits | (rep.input[b] ? 1 << i : 0), 0) | (rep.landed ? 128 : 0));
  w.vec(rep.pos);
  w.quat(rep.rot);
  w.vel(rep.vel);
  writeStatus(w, rep);
  w.u16(rep.respawns);
  w.u16(rep.bonks);
  return w.done();
}

export function unpackReport(buf: ArrayBuffer): Report {
  const r = new Reader(buf);
  r.u8();
  const tick = r.u32();
  const epoch = r.u8();
  const throttle = r.unit();
  const brake = r.unit();
  const steer = r.i8() / 127;
  const bits = r.u8();
  const input: DriverInput = { throttle, brake, steer, item: false, whackLeft: false, whackRight: false, swagger: false };
  BUTTONS.forEach((b, i) => (input[b] = (bits & (1 << i)) !== 0));
  const pos = r.vec();
  const rot = r.quat();
  const vel = r.vel();
  const status = readStatus(r);
  return { ...status, tick, epoch, input, pos, rot, vel, respawns: r.u16(), bonks: r.u16(), landed: (bits & 128) !== 0 };
}

export const FAST = { snapshot: MSG_SNAPSHOT, report: MSG_REPORT } as const;
