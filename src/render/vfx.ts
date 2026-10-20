/**
 * Showpiece particles on three.quarks: sparks, smoke, dust rings, stars, fur,
 * feathers, leaves, embers, confetti and fireworks.
 *
 * `fx.ts` stays for the hundreds of cheap puffs. These want what it can't do —
 * streaks stretched along their flight, shaped sprites that tumble, colour and
 * size curves over a life, particles that orbit their kart — and three.quarks
 * draws every system that shares a material in one call.
 *
 * Three ways in:
 * - bursts (`hitSparks`, `dust`, `stars`, …) from small round-robin pools —
 *   restarting a system clears its particles, so each burst in flight needs its own;
 * - trails (`trail`): one looping emitter per kart and kind, made on first use,
 *   whose rate the game sets every frame (0 stops it; what is out fades);
 * - the air around the camera (`ambient`: falling leaves, rising embers) and the
 *   podium's confetti.
 *
 * Emitters must sit under the Scene (three.quarks disposes orphaned systems),
 * so `object` goes straight into the scene, never into a race group.
 */

import * as THREE from 'three';
import {
  ApplyForce,
  BatchedRenderer,
  Bezier,
  ColorOverLife,
  ConeEmitter,
  ConstantColor,
  ConstantValue,
  Gradient,
  IntervalValue,
  Noise,
  OrbitOverLife,
  ParticleSystem,
  PiecewiseBezier,
  RandomColor,
  RenderMode,
  RotationOverLife,
  SizeOverLife,
  SpeedOverLife,
  SphereEmitter,
  Vector3 as QVec3,
  Vector4 as QVec4,
} from 'three.quarks';
import { radialTexture } from './itemsView.js';

/** Bursts that can be in flight at once, per kind. */
const POOL = 10;
const FORWARD = new THREE.Vector3(0, 0, 1);
const TURN = Math.PI * 2;

/** Per-kart looping effects, set every frame by the game. */
export type TrailKind = 'boost' | 'tyre' | 'burn' | 'scrape' | 'chips' | 'rubble' | 'feathers' | 'cool';

type Params = ConstructorParameters<typeof ParticleSystem>[0];

const linear = (hex: number): QVec3 => {
  const c = new THREE.Color(hex);
  return new QVec3(c.r, c.g, c.b);
};
const rgba = (hex: number, a = 1): QVec4 => {
  const c = new THREE.Color(hex);
  return new QVec4(c.r, c.g, c.b, a);
};
/** A straight ramp from `a` to `b` over a particle's life. */
const ramp = (a: number, b: number) => new PiecewiseBezier([[new Bezier(a, a + (b - a) / 3, a + ((b - a) * 2) / 3, b), 0]]);
/** Colour keys over life, with alpha keys. */
const fade = (colors: [number, number][], alpha: [number, number][]) =>
  new Gradient(
    colors.map(([hex, t]) => [linear(hex), t]),
    alpha,
  );
const down = (g: number) => new ApplyForce(new QVec3(0, -1, 0), new ConstantValue(g));
const up = (g: number) => new ApplyForce(new QVec3(0, 1, 0), new ConstantValue(g));
const tumble = (rate: number) => new RotationOverLife(new IntervalValue(-rate, rate));

// ------------------------------------------------------------- textures

const textures = new Map<string, THREE.Texture>();
function canvasTexture(key: string, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.Texture {
  let t = textures.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  draw(ctx, 64);
  t = new THREE.CanvasTexture(c);
  textures.set(key, t);
  return t;
}
const starTexture = () =>
  canvasTexture('star', (ctx, s) => {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? s * 0.2 : s * 0.47;
      const a = (k / 10) * TURN - Math.PI / 2;
      ctx.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  });
/** A leaf, or (thinner) a feather or a tuft of fur: an almond with a darker rib. */
const leafTexture = (thin: boolean) =>
  canvasTexture(thin ? 'feather' : 'leaf', (ctx, s) => {
    const w = thin ? s * 0.16 : s * 0.3;
    ctx.beginPath();
    ctx.moveTo(s / 2, s * 0.04);
    ctx.quadraticCurveTo(s / 2 + w * 1.6, s / 2, s / 2, s * 0.96);
    ctx.quadraticCurveTo(s / 2 - w * 1.6, s / 2, s / 2, s * 0.04);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = s * 0.03;
    ctx.beginPath();
    ctx.moveTo(s / 2, s * 0.1);
    ctx.lineTo(s / 2, s * 0.92);
    ctx.stroke();
  });
const squareTexture = () => canvasTexture('square', (ctx, s) => ctx.fillRect(s * 0.15, s * 0.3, s * 0.7, s * 0.4));

const materials = new Map<string, THREE.MeshBasicMaterial>();
function material(map: THREE.Texture, additive: boolean): THREE.MeshBasicMaterial {
  const key = `${map.uuid}:${additive}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, transparent: true, depthWrite: false });
    materials.set(key, m);
  }
  return m;
}

// ------------------------------------------------------------- systems

/** A one-shot burst system, paused until it is fired. */
function burst(params: Omit<Params, 'emissionBursts' | 'duration' | 'looping'>): ParticleSystem {
  const s = new ParticleSystem({
    worldSpace: true,
    ...params,
    duration: 0.2,
    looping: false,
    emissionOverTime: new ConstantValue(0),
    emissionBursts: [{ time: 0, count: new ConstantValue(1), cycle: 1, interval: 0.01, probability: 1 }],
  });
  s.pause();
  return s;
}

/** A looping emitter whose rate is set from outside (starts at 0). */
function stream(params: Omit<Params, 'duration' | 'looping' | 'emissionOverTime'>): ParticleSystem {
  return new ParticleSystem({ worldSpace: true, ...params, duration: 1, looping: true, emissionOverTime: new ConstantValue(0) });
}

/** Billowing smoke out of a pipe or off the tyres. */
function smoke(colors: [number, number][], peak: number, size: [number, number], grow: number, life: [number, number]): ParticleSystem {
  return stream({
    startLife: new IntervalValue(...life),
    startSpeed: new IntervalValue(1.5, 4),
    startSize: new IntervalValue(...size),
    startColor: new ConstantColor(new QVec4(1, 1, 1, 1)),
    shape: new ConeEmitter({ radius: 0.3, angle: 0.4, thickness: 1, arc: TURN }),
    material: material(radialTexture(), false),
    renderMode: RenderMode.BillBoard,
    behaviors: [
      new ColorOverLife(fade(colors, [[0, 0], [peak, 0.08], [peak * 0.65, 0.45], [0, 1]])),
      new SizeOverLife(ramp(1, grow)),
      new SpeedOverLife(ramp(1, 0.15)),
      // Warm smoke rises a little as it slows.
      up(1.6),
    ],
  });
}

/** White-hot at birth, cooling through yellow and orange to a red fade. */
const cooling = () =>
  fade(
    [
      [0xffffff, 0],
      [0xffe680, 0.2],
      [0xff9a2a, 0.55],
      [0xd2300a, 1],
    ],
    [
      [1, 0],
      [1, 0.6],
      [0, 1],
    ],
  );

function sparkParams(life: [number, number], speed: [number, number]): Omit<Params, 'emissionBursts' | 'duration' | 'looping' | 'emissionOverTime'> {
  return {
    startLife: new IntervalValue(...life),
    startSpeed: new IntervalValue(...speed),
    startSize: new IntervalValue(0.12, 0.22),
    startColor: new ConstantColor(new QVec4(1, 1, 1, 1)),
    shape: new ConeEmitter({ radius: 0.15, angle: 0.75, thickness: 1, arc: TURN }),
    material: material(radialTexture(), true),
    renderMode: RenderMode.StretchedBillBoard,
    speedFactor: 0.09,
    behaviors: [down(22), new ColorOverLife(cooling()), new SizeOverLife(ramp(1, 0.4))],
  };
}

const TRAILS: Record<TrailKind, () => ParticleSystem> = {
  // Banana-cream at the pipe, greying and thinning as it spreads.
  boost: () => smoke([[0xfff3cf, 0], [0xe9e2d2, 0.4], [0xb9b3aa, 1]], 0.7, [1.0, 1.5], 3.2, [0.9, 1.6]),
  // Pale tyre smoke: slides, hard braking, spins.
  tyre: () => smoke([[0xf4f1ea, 0], [0xd8d3ca, 1]], 0.55, [0.7, 1.1], 3.2, [0.7, 1.3]),
  // No Brakes: the tyres are on fire.
  burn: () => smoke([[0x8a8178, 0], [0x5a534c, 0.5], [0x46413c, 1]], 0.5, [0.9, 1.4], 3.8, [0.9, 1.5]),
  scrape: () => stream({ ...sparkParams([0.2, 0.45], [5, 14]), startSize: new IntervalValue(0.16, 0.28) }),
  // Granite Gus as a boulder: grit and stone chips off the road.
  chips: () =>
    stream({
      startLife: new IntervalValue(0.4, 0.8),
      startSpeed: new IntervalValue(3, 7),
      startSize: new IntervalValue(0.14, 0.28),
      startRotation: new IntervalValue(0, TURN),
      startColor: new RandomColor(rgba(0x8a8580), rgba(0xb9a27c)),
      shape: new ConeEmitter({ radius: 0.6, angle: 0.8, thickness: 1, arc: TURN }),
      material: material(squareTexture(), false),
      renderMode: RenderMode.BillBoard,
      behaviors: [down(18), tumble(10)],
    }),
  // ...and the dust it grinds up, rolling out from under it.
  rubble: () => smoke([[0xc9b48e, 0], [0xa39c90, 0.5], [0x8f897f, 1]], 0.5, [1.3, 2.0], 3, [0.8, 1.4]),
  // Macaw feathers drifting down from the parrot overhead.
  feathers: () =>
    stream({
      startLife: new IntervalValue(1.8, 2.8),
      startSpeed: new IntervalValue(0.5, 1.5),
      startSize: new IntervalValue(0.35, 0.55),
      startRotation: new IntervalValue(0, TURN),
      startColor: new RandomColor(rgba(0xd8262b), rgba(0xffcf2e)),
      shape: new SphereEmitter({ radius: 1, thickness: 1, arc: TURN }),
      material: material(leafTexture(true), false),
      renderMode: RenderMode.BillBoard,
      behaviors: [down(1.2), tumble(3), new Noise(new ConstantValue(0.6), new ConstantValue(0.8)), new ColorOverLife(fade([[0xffffff, 0], [0xffffff, 1]], [[1, 0], [1, 0.7], [0, 1]]))],
    }),
  // Too Cool: an icy glitter orbiting the kart (local space, so it rides along).
  cool: () =>
    stream({
      worldSpace: false,
      startLife: new IntervalValue(0.5, 0.9),
      startSpeed: new ConstantValue(0),
      startSize: new IntervalValue(0.25, 0.45),
      startColor: new RandomColor(rgba(0x4dd2ff), rgba(0xe9fbff)),
      shape: new SphereEmitter({ radius: 1.8, thickness: 0, arc: TURN }),
      material: material(starTexture(), true),
      renderMode: RenderMode.BillBoard,
      behaviors: [
        new OrbitOverLife(new ConstantValue(4.5), new QVec3(0, 1, 0)),
        new SizeOverLife(ramp(0.4, 1)),
        new ColorOverLife(fade([[0xffffff, 0], [0xffffff, 1]], [[0, 0], [1, 0.2], [0, 1]])),
      ],
    }),
};

class Pool {
  private readonly systems: ParticleSystem[] = [];
  private next = 0;

  constructor(parent: THREE.Object3D, batch: BatchedRenderer, make: () => ParticleSystem, size = POOL) {
    for (let i = 0; i < size; i++) {
      const s = make();
      this.systems.push(s);
      parent.add(s.emitter);
      batch.addSystem(s);
    }
  }

  /** `count` particles from `at`, sprayed round `dir`; optionally recoloured and re-speeded. */
  fire(at: THREE.Vector3, dir: THREE.Vector3, count: number, color?: number, speed?: [number, number]): void {
    const s = this.systems[this.next]!;
    this.next = (this.next + 1) % this.systems.length;
    s.emitter.position.copy(at);
    s.emitter.quaternion.setFromUnitVectors(FORWARD, dir.clone().normalize());
    s.emitter.updateMatrixWorld(true);
    (s.emissionBursts[0]!.count as ConstantValue).value = Math.max(1, Math.round(count));
    if (color !== undefined) (s.startColor as ConstantColor).color.copy(rgba(color));
    if (speed) s.startSpeed = new IntervalValue(...speed);
    s.restart();
  }

  clear(): void {
    for (const s of this.systems) {
      s.restart();
      s.pause();
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);

export class Vfx {
  readonly object = new THREE.Group();
  /** 0..1 — fewer particles on low quality. */
  density = 1;
  private readonly batch = new BatchedRenderer();
  private readonly pools: Record<'sparks' | 'flash' | 'dust' | 'stars' | 'fur' | 'bits' | 'firework', Pool>;
  private readonly trails = new Map<string, ParticleSystem>();
  private readonly loops = new Map<string, ParticleSystem>();

  constructor() {
    this.object.add(this.batch);
    const pool = (make: () => ParticleSystem, size?: number) => new Pool(this.object, this.batch, make, size);
    this.pools = {
      sparks: pool(() => burst(sparkParams([0.25, 0.6], [7, 19]))),
      // A blink of light at the point of contact, under the sparks.
      flash: pool(() =>
        burst({
          startLife: new IntervalValue(0.08, 0.12),
          startSpeed: new ConstantValue(0),
          startSize: new IntervalValue(1.4, 2.0),
          startColor: new ConstantColor(new QVec4(1, 0.85, 0.55, 1)),
          shape: new ConeEmitter({ radius: 0.01, angle: 0, thickness: 1, arc: TURN }),
          material: material(radialTexture(), true),
          renderMode: RenderMode.BillBoard,
          behaviors: [new SizeOverLife(ramp(0.6, 1.3)), new ColorOverLife(fade([[0xffffff, 0], [0xffffff, 1]], [[1, 0], [0, 1]]))],
        }),
      ),
      // A flat ring of dust rolling out along the ground (fired pointing up:
      // the cone is opened almost flat).
      dust: pool(() =>
        burst({
          startLife: new IntervalValue(0.5, 0.9),
          startSpeed: new IntervalValue(5, 10),
          startSize: new IntervalValue(0.9, 1.4),
          startColor: new ConstantColor(rgba(0xd2b07a)),
          shape: new ConeEmitter({ radius: 0.9, angle: 1.45, thickness: 0, arc: TURN }),
          material: material(radialTexture(), false),
          renderMode: RenderMode.BillBoard,
          behaviors: [new SpeedOverLife(ramp(1, 0.08)), new SizeOverLife(ramp(1, 2.6)), new ColorOverLife(fade([[0xffffff, 0], [0xffffff, 1]], [[0.85, 0], [0.5, 0.5], [0, 1]]))],
        }),
      ),
      // Cartoon stars off a snake whack.
      stars: pool(() =>
        burst({
          startLife: new IntervalValue(0.6, 0.9),
          startSpeed: new IntervalValue(3, 6),
          startSize: new IntervalValue(0.4, 0.65),
          startRotation: new IntervalValue(0, TURN),
          startColor: new RandomColor(rgba(0xffe14d), rgba(0xffffff)),
          shape: new ConeEmitter({ radius: 0.3, angle: 0.9, thickness: 1, arc: TURN }),
          material: material(starTexture(), false),
          renderMode: RenderMode.BillBoard,
          behaviors: [down(6), tumble(6), new ColorOverLife(fade([[0xffffff, 0], [0xffffff, 1]], [[1, 0], [1, 0.7], [0, 1]]))],
        }),
      ),
      // Tufts of fur knocked loose (coloured per gorilla when fired).
      fur: pool(() =>
        burst({
          startLife: new IntervalValue(0.8, 1.4),
          startSpeed: new IntervalValue(2, 5),
          startSize: new IntervalValue(0.25, 0.4),
          startRotation: new IntervalValue(0, TURN),
          startColor: new ConstantColor(rgba(0x3a2a20)),
          shape: new SphereEmitter({ radius: 0.4, thickness: 1, arc: TURN }),
          material: material(leafTexture(true), false),
          renderMode: RenderMode.BillBoard,
          behaviors: [down(3), tumble(5), new Noise(new ConstantValue(0.8), new ConstantValue(0.6)), new ColorOverLife(fade([[0xffffff, 0], [0xffffff, 1]], [[1, 0], [1, 0.6], [0, 1]]))],
        }),
      ),
      // Banana mush and peel bits flying off a slip.
      bits: pool(() =>
        burst({
          startLife: new IntervalValue(0.5, 0.9),
          startSpeed: new IntervalValue(4, 8),
          startSize: new IntervalValue(0.18, 0.32),
          startRotation: new IntervalValue(0, TURN),
          startColor: new RandomColor(rgba(0xffd21f), rgba(0xfff3b0)),
          shape: new ConeEmitter({ radius: 0.4, angle: 1.0, thickness: 1, arc: TURN }),
          material: material(squareTexture(), false),
          renderMode: RenderMode.BillBoard,
          behaviors: [down(16), tumble(12)],
        }),
      ),
      // Over the podium.
      firework: pool(
        () =>
          burst({
            startLife: new IntervalValue(1.0, 1.6),
            startSpeed: new IntervalValue(12, 18),
            startSize: new IntervalValue(0.9, 1.4),
            startColor: new ConstantColor(rgba(0xff4d6d)),
            shape: new SphereEmitter({ radius: 0.2, thickness: 1, arc: TURN }),
            // Solid colour, not additive: it has to read against a daytime sky.
            material: material(radialTexture(), false),
            renderMode: RenderMode.StretchedBillBoard,
            speedFactor: 0.06,
            behaviors: [down(3), new SpeedOverLife(ramp(1, 0.2)), new SizeOverLife(ramp(1, 0.35)), new ColorOverLife(fade([[0xffffff, 0], [0xffffff, 0.15], [0xffffff, 1]], [[1, 0], [1, 0.6], [0, 1]]))],
          }),
        6,
      ),
    };
  }

  // ------------------------------------------------------------- bursts

  /**
   * Sparks off a hit: `dir` is the way they fly (they spread round it and fall),
   * `strength` 0..1 scales the shower.
   */
  hitSparks(at: THREE.Vector3, dir: THREE.Vector3, strength: number): void {
    this.pools.sparks.fire(at, dir, (12 + strength * 40) * this.density);
    if (strength > 0.25) this.pools.flash.fire(at, dir, 1);
  }

  /** A ring of dust rolling out over the ground from `at`; `strength` 1 is a big landing. */
  dust(at: THREE.Vector3, strength: number, color = 0xd2b07a): void {
    const s = Math.min(3, strength);
    this.pools.dust.fire(at, UP, (10 + s * 16) * this.density, color, [3 + s * 5, 6 + s * 9]);
  }

  /** Cartoon stars and loose fur off a snake whack. */
  whacked(at: THREE.Vector3, fur: number): void {
    this.pools.stars.fire(at, UP, 7 * Math.max(0.6, this.density));
    this.pools.fur.fire(at, UP, 14 * this.density, fur);
  }

  bananaBits(at: THREE.Vector3): void {
    this.pools.bits.fire(at, UP, 16 * this.density);
  }

  firework(at: THREE.Vector3, color: number): void {
    this.pools.firework.fire(at, UP, 110 * Math.max(0.7, this.density), color);
    this.pools.flash.fire(at, UP, 1);
  }

  // ------------------------------------------------------------- trails

  /**
   * Kart `i`'s trail of `kind`: from `at`, blown along `dir` (or world-aligned
   * when null), at `rate` particles a second.
   */
  trail(kind: TrailKind, i: number, at: THREE.Vector3, dir: THREE.Vector3 | null, rate: number): void {
    const key = `${kind}:${i}`;
    let s = this.trails.get(key);
    if (!s) {
      if (rate <= 0) return;
      s = this.add(TRAILS[kind]());
      this.trails.set(key, s);
    }
    this.aim(s, at, dir, rate);
  }

  /** Stop every trail of kart `i` (out of view, or out of the race). */
  stopTrails(i: number): void {
    for (const [key, s] of this.trails) if (key.endsWith(`:${i}`)) (s.emissionOverTime as ConstantValue).value = 0;
  }

  // ------------------------------------------------------------- the air

  /**
   * Leaves drifting down or embers rising round `at` (somewhere just ahead of
   * the camera), `rate` a second.
   */
  ambient(kind: 'leaves' | 'embers', at: THREE.Vector3, rate: number): void {
    let s = this.loops.get(kind);
    if (!s) {
      if (rate <= 0) return;
      s = this.add(kind === 'leaves' ? leaves() : embers());
      this.loops.set(kind, s);
    }
    this.aim(s, at, null, rate);
  }

  /** Confetti raining over `at` (the podium), or stop it. */
  confetti(at: THREE.Vector3 | null): void {
    [0xff4d6d, 0xffd23a, 0x29c8ff, 0x7dff6a].forEach((color, k) => {
      const key = `confetti:${k}`;
      let s = this.loops.get(key);
      if (!s) {
        if (!at) return;
        s = this.add(confetti(color));
        this.loops.set(key, s);
      }
      this.aim(s, at ?? s.emitter.position, null, at ? 14 : 0);
    });
  }

  /** Stop every emitter (what is already out fades); bursts still fire. */
  quiet(): void {
    for (const s of [...this.trails.values(), ...this.loops.values()]) (s.emissionOverTime as ConstantValue).value = 0;
  }

  /** Drop every particle (a new race, or back to the menu). */
  clear(): void {
    for (const p of Object.values(this.pools)) p.clear();
    for (const s of [...this.trails.values(), ...this.loops.values()]) {
      (s.emissionOverTime as ConstantValue).value = 0;
      s.restart();
    }
  }

  update(dt: number): void {
    this.batch.update(dt);
  }

  private add(s: ParticleSystem): ParticleSystem {
    this.object.add(s.emitter);
    this.batch.addSystem(s);
    return s;
  }

  private aim(s: ParticleSystem, at: THREE.Vector3, dir: THREE.Vector3 | null, rate: number): void {
    (s.emissionOverTime as ConstantValue).value = rate * this.density;
    if (rate <= 0) return;
    s.emitter.position.copy(at);
    if (dir) s.emitter.quaternion.setFromUnitVectors(FORWARD, dir.clone().normalize());
    else s.emitter.quaternion.identity();
    s.emitter.updateMatrixWorld(true);
  }
}

function leaves(): ParticleSystem {
  return stream({
    startLife: new IntervalValue(4, 6),
    startSpeed: new ConstantValue(0),
    startSize: new IntervalValue(0.5, 0.8),
    startRotation: new IntervalValue(0, TURN),
    startColor: new RandomColor(rgba(0x3f8f34), rgba(0xb8c94a)),
    shape: new SphereEmitter({ radius: 16, thickness: 1, arc: TURN }),
    material: material(leafTexture(false), false),
    renderMode: RenderMode.BillBoard,
    behaviors: [
      new LimitFall(1.6),
      tumble(2.5),
      new Noise(new ConstantValue(0.4), new ConstantValue(1.2)),
      new ColorOverLife(fade([[0xffffff, 0], [0xffffff, 1]], [[0, 0], [1, 0.1], [1, 0.8], [0, 1]])),
    ],
  });
}

function embers(): ParticleSystem {
  return stream({
    startLife: new IntervalValue(2, 3.5),
    startSpeed: new IntervalValue(0.2, 1),
    startSize: new IntervalValue(0.2, 0.38),
    startColor: new RandomColor(rgba(0xffd23a), rgba(0xff5a1a)),
    shape: new SphereEmitter({ radius: 16, thickness: 1, arc: TURN }),
    material: material(radialTexture(), true),
    renderMode: RenderMode.BillBoard,
    behaviors: [
      up(0.9),
      new Noise(new ConstantValue(0.5), new ConstantValue(1.5)),
      new ColorOverLife(fade([[0xffffff, 0], [0xff8a3a, 1]], [[0, 0], [1, 0.15], [0.8, 0.7], [0, 1]])),
    ],
  });
}

function confetti(color: number): ParticleSystem {
  return stream({
    startLife: new IntervalValue(4, 6),
    startSpeed: new IntervalValue(0, 1),
    startSize: new IntervalValue(0.22, 0.34),
    startRotation: new IntervalValue(0, TURN),
    startColor: new ConstantColor(rgba(color)),
    shape: new SphereEmitter({ radius: 5, thickness: 1, arc: TURN }),
    material: material(squareTexture(), false),
    renderMode: RenderMode.BillBoard,
    behaviors: [new LimitFall(1.8), tumble(6), new Noise(new ConstantValue(0.7), new ConstantValue(1.5))],
  });
}

/**
 * Gravity with air resistance: falls toward `terminal` m/s and no faster —
 * leaves and confetti flutter down instead of dropping.
 */
class LimitFall extends ApplyForce {
  constructor(private readonly terminal: number) {
    super(new QVec3(0, -1, 0), new ConstantValue(terminal * 2));
  }

  override update(particle: Parameters<ApplyForce['update']>[0], delta: number): void {
    if (particle.velocity.y > -this.terminal) super.update(particle, delta);
  }
}
