/**
 * A gorilla's junk kart.
 *
 * A Rapier dynamic body on four raycast wheels, tuned for arcade fun rather than
 * realism. Each wheel is a spring-damper along the chassis' up axis plus a
 * grip force that kills sideways sliding, capped by the wheel's load. The
 * suspension is long and under-damped on purpose: karts bounce over bumps,
 * pogo off landings and wallow through corners.
 *
 * Status effects from items live here because they change how the kart
 * drives: boost (more force, higher top speed), spin-out (no drive, low grip,
 * a scripted pirouette) and wobble (a whacked kart's steering shakes).
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import { ITEMS, KART, PARROT, SIM, WATER } from '../data/tuning.js';
import { TREE } from './events.js';
import type { Move } from './swagger.js';
import type { DriverInput } from './input.js';
import { NEUTRAL_INPUT } from './input.js';
import {
  type Quat,
  type Vec3,
  add,
  clamp,
  cross,
  dot,
  lerp,
  moveToward,
  normalize,
  rotate,
  scale,
  sub,
  v3,
} from './math.js';

export type ItemKind = 'none' | 'banana' | 'snake' | 'parrot';

/**
 * Collision groups (Rapier packs membership in the high 16 bits, filter in
 * the low 16; two colliders touch only if each one's membership is in the
 * other's filter).
 *
 * - ground (road, floor, ramps): what wheels stand on.
 * - barriers: wheel rays ignore them — a raycast wheel that can stand on a
 *   log lets its spring lift the kart up and over, which is how slow karts
 *   were escaping the track.
 * - kart chassis: wheel rays ignore them too, or karts stack and ride piggyback.
 * - kart skirt: an invisible box filling the space under the chassis down to
 *   the wheels, touching only other karts. Long-travel suspension leaves the
 *   chassis 0.6 m in the air, and without this, karts in a pile-up slid on top
 *   of each other with their wheels in the air and never got out.
 */
const G_GROUND = 0x0001;
const G_BARRIER = 0x0002;
const G_KART = 0x0004;
const G_SKIRT = 0x0008;
const groups = (member: number, filter: number) => (member << 16) | filter;
export const GROUND_GROUPS = groups(G_GROUND, 0xffff);
export const BARRIER_GROUPS = groups(G_BARRIER, 0xffff);
const KART_GROUPS = groups(G_KART, 0xffff);
const SKIRT_GROUPS = groups(G_SKIRT, G_KART | G_SKIRT);
const WHEEL_RAY_GROUPS = groups(0xffff, 0xffff & ~(G_BARRIER | G_KART | G_SKIRT));

export interface WheelState {
  /** Mount point in chassis coordinates. */
  local: Vec3;
  front: boolean;
  /** Current spring compression, m. */
  compression: number;
  contact: boolean;
  /** Spin angle for the renderer, rad. */
  spin: number;
}

export class Kart {
  readonly index: number;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly world: RAPIER.World;
  private readonly rapier: typeof RAPIER;
  readonly wheels: WheelState[];

  /** Front wheel angle, rad (driver frame: + = right). */
  steerAngle = 0;
  /** Held input this step (after status effects), for the renderer and audio. */
  applied: DriverInput = { ...NEUTRAL_INPUT };
  /** Raw held input last step — for rising-edge detection. */
  prevInput: DriverInput = { ...NEUTRAL_INPUT };

  item: ItemKind = 'none';
  charges = 0;
  boostTime = 0;
  spinTime = 0;
  wobbleTime = 0;
  /** Seconds since a swing started, and which side; side 0 = not swinging. */
  swingSide: -1 | 0 | 1 = 0;
  swingTime = 0;
  swingCooldown = 0;
  /** Seconds the kart has been wheels-up, for the renderer and landing thuds. */
  airTime = 0;
  /** Downward speed at the last touchdown, m/s — the size of the landing. */
  lastLanding = 0;
  /** Parrot flight: seconds left, seconds since take-off, and the height it holds (set by the race). */
  flyTime = 0;
  flyElapsed = 0;
  flyTargetY = 0;
  /** Road height where the flight started — the parrot never dips below it. */
  flyBaseY = 0;
  /** Seconds since the parrot let go (large when it never has). */
  sinceFlight = 1e9;
  /** Out of the race (taken by the lava): items and other karts ignore it. */
  out = false;
  /** Set by the race each step while the kart is fording a stream. */
  wet = false;
  /** How deep the water is (floods make it more): multiplies the drag. */
  waterDepth = 1;
  /** Downstream push while wet, m/s² (a flooded creek's current). */
  current: Vec3 = v3();
  /** Ploughing through a fallen tree's crown. */
  brush = false;
  /** Planing across the water's surface (fast and straight). */
  skimming = false;

  // ---- Swagger (see sim/swagger.ts)
  /** This gorilla's signature move. */
  move: Move = 'roar';
  /** 0..100. Full = one move. */
  swagger = 0;
  /** Seconds the swagger button has been held with a full meter. */
  swaggerHold = 0;
  /** Seconds left of the wind-up before the move hits (0 = none). */
  moveWindup = 0;
  /** Seconds since the last move was triggered (for the renderer). */
  moveT = 99;
  /** Seated show-off after a hit, s (renderer celebrates). */
  showOff = 0;
  noBrakesTime = 0;
  slowTime = 0;
  steerSwapTime = 0;
  coolTime = 0;
  boulderTime = 0;
  /** Touched down this step after real air (for the clean-landing bonus). */
  landedThisStep = false;

  /** Too cool or a boulder: peels, whacks, wobbles, bonks and lava pass it by. */
  get immune(): boolean {
    return this.coolTime > 0 || this.boulderTime > 0;
  }

  /** Scale the kart's mass (the boulder is heavy). 1 restores it. */
  setMassScale(k: number): void {
    const m = KART.mass * k;
    const h = KART.half;
    this.body.setAdditionalMassProperties(
      m,
      { x: 0, y: -KART.comDrop, z: 0 },
      {
        x: (m / 12) * (4 * h.y * h.y + 4 * h.z * h.z) * 1.2,
        y: (m / 12) * (4 * h.x * h.x + 4 * h.z * h.z),
        z: (m / 12) * (4 * h.x * h.x + 4 * h.y * h.y) * 1.4,
      },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
  }
  /** Engine and top-speed multiplier: AI skill and rubber-banding. 1 for players. */
  power = 1;
  private wasAirborne = false;
  private upsideTime = 0;

  constructor(rapier: typeof RAPIER, world: RAPIER.World, index: number, pos: Vec3, rot: Quat) {
    this.rapier = rapier;
    this.world = world;
    this.index = index;
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation(rot)
        .setLinearDamping(0.05)
        .setAngularDamping(0.6)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    const h = KART.half;
    // Density 0; mass and a low centre of mass are set explicitly.
    this.collider = world.createCollider(
      rapier.ColliderDesc.cuboid(h.x, h.y, h.z)
        .setDensity(0)
        .setFriction(0.4)
        .setRestitution(0.3)
        .setCollisionGroups(KART_GROUPS),
      this.body,
    );
    const skirtHalf = 0.42;
    world.createCollider(
      rapier.ColliderDesc.cuboid(h.x, skirtHalf, h.z)
        .setTranslation(0, -h.y - skirtHalf, 0)
        .setDensity(0)
        .setFriction(0.2)
        .setRestitution(0.3)
        .setCollisionGroups(SKIRT_GROUPS),
      this.body,
    );
    const m = KART.mass;
    this.body.setAdditionalMassProperties(
      m,
      { x: 0, y: -KART.comDrop, z: 0 },
      {
        x: (m / 12) * (4 * h.y * h.y + 4 * h.z * h.z) * 1.2,
        y: (m / 12) * (4 * h.x * h.x + 4 * h.z * h.z),
        z: (m / 12) * (4 * h.x * h.x + 4 * h.y * h.y) * 1.4,
      },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
    this.wheels = [
      [1, KART.wheelFrontZ, true],
      [-1, KART.wheelFrontZ, true],
      [1, KART.wheelRearZ, false],
      [-1, KART.wheelRearZ, false],
    ].map(([side, z, front]) => ({
      local: v3((side as number) * KART.wheelX, KART.wheelMountY, z as number),
      front: front as boolean,
      compression: 0,
      contact: false,
      spin: 0,
    }));
  }

  get position(): Vec3 {
    return this.body.translation();
  }

  get rotation(): Quat {
    return this.body.rotation();
  }

  get velocity(): Vec3 {
    return this.body.linvel();
  }

  get forward(): Vec3 {
    return rotate(this.rotation, v3(0, 0, 1));
  }

  get up(): Vec3 {
    return rotate(this.rotation, v3(0, 1, 0));
  }

  /** Driver's right. (Local +X is the kart's left.) */
  get right(): Vec3 {
    return rotate(this.rotation, v3(-1, 0, 0));
  }

  /** Signed speed along the nose, m/s. */
  get forwardSpeed(): number {
    return dot(this.velocity, this.forward);
  }

  get grounded(): number {
    return this.wheels.reduce((n, w) => n + (w.contact ? 1 : 0), 0);
  }

  get boosting(): boolean {
    return this.boostTime > 0;
  }

  get spinning(): boolean {
    return this.spinTime > 0;
  }

  get flying(): boolean {
    return this.flyTime > 0;
  }

  /** The parrot grabs the kart. */
  takeOff(baseY: number): void {
    this.flyTime = PARROT.time;
    this.flyElapsed = 0;
    this.flyBaseY = baseY;
    this.spinTime = 0;
    this.wobbleTime = 0;
  }

  /** Put the kart down at rest, e.g. at the grid or after a respawn. */
  place(pos: Vec3, rot: Quat): void {
    this.body.setTranslation(pos, true);
    this.body.setRotation(rot, true);
    this.body.setLinvel(v3(), true);
    this.body.setAngvel(v3(), true);
    this.spinTime = 0;
    this.wobbleTime = 0;
    this.upsideTime = 0;
    this.flyTime = 0;
    this.moveWindup = 0;
    for (const w of this.wheels) w.compression = 0;
  }

  /** Throttle/brake/steer after status effects. */
  private effectiveInput(input: DriverInput): DriverInput {
    const out = { ...input };
    if (this.spinTime > 0) {
      out.throttle = 0;
      out.brake = 0;
      out.steer = 0;
    }
    if (this.wobbleTime > 0 && !this.immune) {
      out.steer = clamp(out.steer + Math.sin(this.wobbleTime * 28) * 0.7, -1, 1);
      out.throttle *= 0.5;
    }
    // Drop the Beat: left is right.
    if (this.steerSwapTime > 0) out.steer = -out.steer;
    if (this.boostTime > 0) {
      out.throttle = 1;
      out.brake = 0;
    }
    return out;
  }

  /** Advance one fixed step. Call before `world.step()`. */
  step(dt: number, raw: DriverInput): void {
    const input = this.effectiveInput(raw);
    this.applied = input;
    this.boostTime = Math.max(0, this.boostTime - dt);
    this.spinTime = Math.max(0, this.spinTime - dt);
    this.wobbleTime = Math.max(0, this.wobbleTime - dt);
    this.noBrakesTime = Math.max(0, this.noBrakesTime - dt);
    this.slowTime = Math.max(0, this.slowTime - dt);
    this.steerSwapTime = Math.max(0, this.steerSwapTime - dt);
    this.coolTime = Math.max(0, this.coolTime - dt);
    this.showOff = Math.max(0, this.showOff - dt);
    this.moveT += dt;
    if (this.boulderTime > 0) {
      this.boulderTime -= dt;
      if (this.boulderTime <= 0) {
        this.boulderTime = 0;
        this.setMassScale(1);
      }
    }
    this.landedThisStep = false;
    this.swingCooldown = Math.max(0, this.swingCooldown - dt);
    if (this.swingSide !== 0) {
      this.swingTime += dt;
      if (this.swingTime > ITEMS.swingTime) this.swingSide = 0;
    }

    this.sinceFlight += dt;
    if (this.flyTime > 0) {
      this.fly(dt, input);
      this.prevInput = { ...raw };
      return;
    }

    const body = this.body;
    const q = this.rotation;
    const pos = this.position;
    const vel = this.velocity;
    const angvel = body.angvel();
    const com = body.worldCom();
    const up = this.up;
    const fwd = this.forward;
    const speed = dot(vel, fwd);
    const boost = this.boostTime > 0;
    // Slow-clapped karts lose a chunk of engine and top speed.
    const slowed = this.slowTime > 0 ? 0.7 : 1;
    const top = KART.topSpeed * this.power * slowed * (boost ? ITEMS.boostTopSpeed : 1);
    const mass = KART.mass;

    // Steering eases toward its target, with less lock at speed.
    const speedFrac = clamp(Math.abs(speed) / KART.topSpeed, 0, 1);
    const lock = lerp(KART.steerLow, KART.steerHigh, speedFrac);
    this.steerAngle = moveToward(this.steerAngle, input.steer * lock, KART.steerRate * dt);

    const staticLoad = (mass * SIM.gravity) / 4;
    const rayLen = KART.restLength + KART.wheelRadius;
    let grounded = 0;
    const contacts: { point: Vec3; normal: Vec3; load: number; wheel: WheelState }[] = [];

    for (const w of this.wheels) {
      const mount = add(pos, rotate(q, w.local));
      const dir = scale(up, -1);
      const ray = new this.rapier.Ray(mount, dir);
      const hit = this.world.castRayAndGetNormal(ray, rayLen, true, undefined, WHEEL_RAY_GROUPS, undefined, body);
      const prev = w.compression;
      if (!hit) {
        w.contact = false;
        w.compression = moveToward(w.compression, 0, dt * 3);
        continue;
      }
      grounded++;
      w.contact = true;
      const travel = hit.timeOfImpact - KART.wheelRadius;
      const x = clamp(KART.restLength - travel, 0, KART.restLength);
      w.compression = x;
      const xdot = (x - prev) / dt;
      let f = KART.spring * x + KART.damper * xdot;
      const over = x - KART.maxTravel;
      if (over > 0) f += KART.bumpStop * over;
      f = Math.max(0, f);
      body.applyImpulseAtPoint(scale(up, f * dt), mount, true);
      const point = add(mount, scale(dir, hit.timeOfImpact));
      contacts.push({ point, normal: hit.normal, load: f, wheel: w });
    }

    // Landing detection.
    if (grounded === 0) {
      this.airTime += dt;
      this.wasAirborne = true;
    } else {
      if (this.wasAirborne && this.airTime > 0.15) {
        this.lastLanding = Math.max(0, -vel.y);
        if (this.airTime > 0.3) this.landedThisStep = true;
      }
      this.wasAirborne = false;
      this.airTime = 0;
    }

    // Tyres.
    const spinning = this.spinTime > 0;
    for (const c of contacts) {
      const w = c.wheel;
      const n = c.normal;
      // Wheel heading in the world: the nose, turned by the steering for the fronts.
      const yaw = w.front ? -this.steerAngle : 0;
      const heading = rotate(q, v3(Math.sin(yaw), 0, Math.cos(yaw)));
      const along = normalize(sub(heading, scale(n, dot(heading, n))));
      const side = normalize(cross(n, along));
      const r = sub(c.point, com);
      const pv = add(vel, cross(angvel, r));
      const vLat = dot(pv, side);
      const vLong = dot(pv, along);
      w.spin += (vLong / KART.wheelRadius) * dt;

      const load = Math.max(c.load, staticLoad * 0.35);
      const grip =
        KART.gripMu * load * (w.front ? 1 : KART.rearGrip) * (spinning ? 0.25 : 1) * (this.wet && !this.skimming ? WATER.grip : 1) *
        (this.brush && this.boulderTime <= 0 ? TREE.grip : 1) * (this.noBrakesTime > 0 ? 1.5 : 1);
      // A tyre that has broken away grips less than one that hasn't: past the
      // limit the force falls toward `slideGrip`. That is what makes a corner
      // taken too fast run wide into the logs instead of scrubbing off speed
      // for free — and so what makes braking worth it.
      const want = -vLat * KART.lateralGain;
      const over = Math.abs(want) / Math.max(grip, 1e-6);
      const slideCap = over > 1 ? grip * lerp(1, KART.slideGrip, clamp((over - 1) / 1.5, 0, 1)) : grip;
      const lat = clamp(want, -slideCap, slideCap);

      let lon = 0;
      if (input.throttle > 0) {
        const pull = speed < top ? 1 - Math.max(0, speed) / top : 0;
        lon += (input.throttle * KART.engineForce * this.power * slowed * (boost ? ITEMS.boostForce : 1) * pull) / 4;
      }
      if (input.brake > 0) {
        if (speed > 0.8) lon -= (input.brake * KART.brakeForce) / 4;
        else if (speed > -KART.reverseTopSpeed) lon -= (input.brake * KART.reverseForce) / 4;
      }
      if (input.throttle === 0 && input.brake === 0) {
        lon -= (Math.sign(vLong) * Math.min(Math.abs(vLong) * 200, KART.rollingDrag)) / 4;
      }
      if (spinning) lon -= (Math.sign(vLong) * KART.rollingDrag * 2.5) / 4;
      lon = clamp(lon, -grip * 1.3, grip * 1.3);

      // Forces act a little above the contact, at the axle — less roll-over.
      const at = add(c.point, scale(n, KART.wheelRadius));
      body.applyImpulseAtPoint(scale(add(scale(side, lat), scale(along, lon)), dt), at, true);
    }

    // Wading: the stream pulls speed off in proportion to it.
    // Water: wade (full drag and current) or skim across the top.
    if (this.wet && grounded > 0) {
      const turning = Math.abs(angvel.y);
      this.skimming = this.skimming
        ? speed > WATER.skimHold && turning < WATER.skimYawHold
        : speed > WATER.skimSpeed && turning < WATER.skimYaw;
      const drag = WATER.drag * this.waterDepth * (this.skimming ? WATER.skimDrag : 1);
      body.applyImpulse(scale(v3(vel.x, 0, vel.z), -mass * drag * dt), true);
      body.applyImpulse(scale(this.current, mass * dt * (this.skimming ? WATER.skimCurrent : 1)), true);
    } else if (!this.wet) {
      this.skimming = false;
    }
    // Leaves and branches: slow going (a boulder flattens them).
    if (this.brush && grounded > 0 && this.boulderTime <= 0) {
      body.applyImpulse(scale(v3(vel.x, 0, vel.z), -mass * TREE.drag * dt), true);
    }

    // Air drag.
    const v2 = Math.hypot(vel.x, vel.y, vel.z);
    if (v2 > 0.01) body.applyImpulse(scale(vel, -KART.airDrag * v2 * dt), true);

    if (spinning) {
      // A scripted pirouette: whole turns, so the kart ends facing where it was.
      const rate = (ITEMS.spinTurns * 2 * Math.PI) / ITEMS.spinTime;
      const w = body.angvel();
      body.setAngvel(v3(w.x, rate, w.z), true);
    } else if (grounded === 0) {
      this.airControl(dt, input, up, fwd, angvel);
    }

    this.checkFlipped(dt, up, v2);
    this.prevInput = { ...raw };
  }

  /**
   * Parrot flight. Arcade control rather than forces: the parrot sets the
   * kart's heading, pace and height directly, eased so it still swoops. The
   * body stays dynamic, so it can still bump into trunks and other karts.
   */
  private fly(dt: number, input: DriverInput): void {
    this.flyElapsed += dt;
    this.flyTime -= dt;
    this.steerAngle = moveToward(this.steerAngle, 0, KART.steerRate * dt);
    for (const w of this.wheels) {
      w.contact = false;
      w.compression = moveToward(w.compression, 0, dt * 3);
    }
    this.airTime = 0;
    this.wasAirborne = true;
    const body = this.body;
    const vel = body.linvel();
    const f = this.forward;
    let yaw = Math.atan2(f.x, f.z);
    yaw += -input.steer * PARROT.turnRate * dt;
    const pace = PARROT.speed * (PARROT.coast + (1 - PARROT.coast) * input.throttle) * (1 - (1 - PARROT.brake) * input.brake);
    const h = Math.hypot(vel.x, vel.z);
    const hNew = moveToward(h, pace, PARROT.accel * dt);
    // Height: climb to the target; sag as the parrot tires, then let go.
    let target = this.flyTargetY;
    if (this.flyTime < PARROT.sag) target -= (1 - this.flyTime / PARROT.sag) * 3;
    const lift = Math.min(1, this.flyElapsed / 0.6);
    const vyWant = clamp((target - this.position.y) * PARROT.climb, -PARROT.maxClimb, PARROT.maxClimb) * lift;
    const vy = vel.y + (vyWant - vel.y) * Math.min(1, dt * 5);
    body.setLinvel(v3(Math.sin(yaw) * hNew, vy + SIM.gravity * dt, Math.cos(yaw) * hNew), true);
    // Hang level under the parrot, banking into turns.
    const bank = -input.steer * 0.35;
    const qYaw = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const qBank = { x: 0, y: 0, z: Math.sin(bank / 2), w: Math.cos(bank / 2) };
    body.setRotation(mulQuat(qYaw, qBank), true);
    body.setAngvel(v3(), true);
    if (this.flyTime <= 0) {
      this.flyTime = 0;
      this.sinceFlight = 0;
    }
  }

  /**
   * In the air the kart is held toward level by a PD controller, and the
   * driver only leans the target: throttle tips the nose down a touch, brake
   * pulls it up, steer yaws. A raw pitch torque flipped karts — an AI or a
   * player holding throttle off a ramp would somersault onto the roof.
   */
  private airControl(dt: number, input: DriverInput, up: Vec3, fwd: Vec3, w: Vec3): void {
    const worldUp = v3(0, 1, 0);
    // Flat heading, then tipped by the requested pitch (+ = nose down).
    const flatLeft = normalize(cross(worldUp, v3(fwd.x, 0, fwd.z)));
    const pitch = input.throttle * KART.airPitchDown - input.brake * KART.airPitchUp;
    const want = add(scale(worldUp, Math.cos(pitch)), scale(cross(flatLeft, worldUp), Math.sin(pitch)));
    const level = scale(cross(up, want), KART.airLevel);
    // Damp only roll and pitch — keep yaw momentum, it is the fun part.
    const wNoYaw = sub(w, scale(worldUp, dot(w, worldUp)));
    const yaw = scale(worldUp, -input.steer * KART.airYaw);
    const torque = add(add(level, yaw), scale(wNoYaw, -KART.airDamp));
    this.body.applyTorqueImpulse(scale(torque, dt), true);
  }

  /** Upside down (or on its side) and nearly stopped for a while: set it back on its wheels. */
  private checkFlipped(dt: number, up: Vec3, speed: number): void {
    if (up.y < 0.35 && speed < 4) this.upsideTime += dt;
    else this.upsideTime = 0;
    if (this.upsideTime > KART.flipDelay) {
      const f = this.forward;
      const yaw = Math.atan2(f.x, f.z);
      const p = this.position;
      this.place(v3(p.x, p.y + 1.2, p.z), yawQuat(yaw));
    }
  }
}

/** Hamilton product a * b. */
function mulQuat(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** Rotation about world +Y. */
export function yawQuat(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
