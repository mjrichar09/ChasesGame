/**
 * A tiny binary writer/reader for the fast messages (snapshots, reports).
 *
 * Phones host races, so the host's upload is the tight spot: seven clients
 * at 20 snapshots a second. JSON for the same data is about five times the
 * size. Floats that don't need it are quantised (timers to ms, velocities to
 * cm/s, quaternions to 16 bits per component).
 */

import type { Quat, Vec3 } from '../sim/math.js';

export class Writer {
  private buf: ArrayBuffer;
  private view: DataView;
  private at = 0;

  constructor(size = 2048) {
    this.buf = new ArrayBuffer(size);
    this.view = new DataView(this.buf);
  }

  private room(n: number): void {
    if (this.at + n <= this.buf.byteLength) return;
    const bigger = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.at + n));
    new Uint8Array(bigger).set(new Uint8Array(this.buf));
    this.buf = bigger;
    this.view = new DataView(bigger);
  }

  u8(v: number): void {
    this.room(1);
    this.view.setUint8(this.at, v);
    this.at += 1;
  }
  i8(v: number): void {
    this.room(1);
    this.view.setInt8(this.at, Math.max(-127, Math.min(127, Math.round(v))));
    this.at += 1;
  }
  u16(v: number): void {
    this.room(2);
    this.view.setUint16(this.at, Math.max(0, Math.min(65535, Math.round(v))));
    this.at += 2;
  }
  i16(v: number): void {
    this.room(2);
    this.view.setInt16(this.at, Math.max(-32767, Math.min(32767, Math.round(v))));
    this.at += 2;
  }
  u32(v: number): void {
    this.room(4);
    this.view.setUint32(this.at, v >>> 0);
    this.at += 4;
  }
  f32(v: number): void {
    this.room(4);
    this.view.setFloat32(this.at, v);
    this.at += 4;
  }
  /** Seconds as milliseconds, 0..65.5 s. */
  time(v: number): void {
    this.u16(v * 1000);
  }
  /** 0..1 as a byte. */
  unit(v: number): void {
    this.u8(Math.max(0, Math.min(1, v)) * 255);
  }
  vec(v: Vec3): void {
    this.f32(v.x);
    this.f32(v.y);
    this.f32(v.z);
  }
  /** A velocity, in cm/s (±327 m/s). */
  vel(v: Vec3): void {
    this.i16(v.x * 100);
    this.i16(v.y * 100);
    this.i16(v.z * 100);
  }
  quat(q: Quat): void {
    this.i16(q.x * 32767);
    this.i16(q.y * 32767);
    this.i16(q.z * 32767);
    this.i16(q.w * 32767);
  }

  done(): ArrayBuffer {
    return this.buf.slice(0, this.at);
  }
}

export class Reader {
  private readonly view: DataView;
  private at = 0;

  constructor(buf: ArrayBuffer) {
    this.view = new DataView(buf);
  }

  get left(): number {
    return this.view.byteLength - this.at;
  }

  u8(): number {
    return this.view.getUint8(this.at++);
  }
  i8(): number {
    return this.view.getInt8(this.at++);
  }
  u16(): number {
    const v = this.view.getUint16(this.at);
    this.at += 2;
    return v;
  }
  i16(): number {
    const v = this.view.getInt16(this.at);
    this.at += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.at);
    this.at += 4;
    return v;
  }
  f32(): number {
    const v = this.view.getFloat32(this.at);
    this.at += 4;
    return v;
  }
  time(): number {
    return this.u16() / 1000;
  }
  unit(): number {
    return this.u8() / 255;
  }
  vec(): Vec3 {
    return { x: this.f32(), y: this.f32(), z: this.f32() };
  }
  vel(): Vec3 {
    return { x: this.i16() / 100, y: this.i16() / 100, z: this.i16() / 100 };
  }
  quat(): Quat {
    const x = this.i16() / 32767;
    const y = this.i16() / 32767;
    const z = this.i16() / 32767;
    const w = this.i16() / 32767;
    const n = Math.hypot(x, y, z, w) || 1;
    return { x: x / n, y: y / n, z: z / n, w: w / n };
  }
}
