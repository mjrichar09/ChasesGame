/**
 * Cheap particles: one pooled point cloud for everything.
 *
 * Dust off the wheels, boost flames, banana sparkles, whack stars, river
 * splashes and landing puffs are all the same thing — a soft round sprite with
 * a colour, a size, a velocity and a life — so they share one draw call.
 * The pool recycles the oldest particle when full rather than allocating.
 */

import * as THREE from 'three';
import { radialTexture } from './itemsView.js';

const MAX = 1500;

export interface Burst {
  pos: THREE.Vector3;
  count: number;
  color: number | number[];
  /** Initial speed range and the spread around `dir` (or all round). */
  speed: [number, number];
  dir?: THREE.Vector3;
  spread?: number;
  size: [number, number];
  life: [number, number];
  gravity?: number;
  drag?: number;
}

export class Fx {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly col = new Float32Array(MAX * 3);
  private readonly size = new Float32Array(MAX);
  private readonly baseSize = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private readonly maxLife = new Float32Array(MAX);
  private readonly grav = new Float32Array(MAX);
  private readonly drag = new Float32Array(MAX);
  private next = 0;
  private readonly tmp = new THREE.Color();
  /** 0..1 — fewer particles on low quality. */
  density = 1;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: radialTexture() }, scale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float scale;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  setViewportHeight(px: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale!.value = px * 0.9;
  }

  emit(b: Burst): void {
    const n = Math.max(1, Math.round(b.count * this.density));
    const colors = Array.isArray(b.color) ? b.color : [b.color];
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const sp = b.speed[0] + Math.random() * (b.speed[1] - b.speed[0]);
      let dx = Math.random() * 2 - 1;
      let dy = Math.random() * 2 - 1;
      let dz = Math.random() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      if (b.dir) {
        const s = b.spread ?? 0.3;
        dx = b.dir.x + dx * s;
        dy = b.dir.y + dy * s;
        dz = b.dir.z + dz * s;
      }
      this.pos[i * 3] = b.pos.x;
      this.pos[i * 3 + 1] = b.pos.y;
      this.pos[i * 3 + 2] = b.pos.z;
      this.vel[i * 3] = dx * sp;
      this.vel[i * 3 + 1] = dy * sp;
      this.vel[i * 3 + 2] = dz * sp;
      this.tmp.set(colors[k % colors.length]!);
      this.col[i * 3] = this.tmp.r;
      this.col[i * 3 + 1] = this.tmp.g;
      this.col[i * 3 + 2] = this.tmp.b;
      this.baseSize[i] = b.size[0] + Math.random() * (b.size[1] - b.size[0]);
      this.maxLife[i] = this.life[i] = b.life[0] + Math.random() * (b.life[1] - b.life[0]);
      this.grav[i] = b.gravity ?? 0;
      this.drag[i] = b.drag ?? 1.5;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i]! <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i]! -= dt;
      const t = Math.max(0, this.life[i]! / this.maxLife[i]!);
      const d = Math.exp(-this.drag[i]! * dt);
      this.vel[i * 3]! *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! * d - this.grav[i]! * dt;
      this.vel[i * 3 + 2]! *= d;
      this.pos[i * 3]! += this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
      this.alpha[i] = Math.min(1, t * 2.2);
      // Puffs grow as they fade.
      this.size[i] = this.baseSize[i]! * (1.6 - t * 0.6);
    }
    const g = this.points.geometry;
    g.attributes.position!.needsUpdate = true;
    g.attributes.color!.needsUpdate = true;
    g.attributes.size!.needsUpdate = true;
    g.attributes.alpha!.needsUpdate = true;
  }
}
