/**
 * Renderer, sky, light and quality.
 *
 * A warm late-afternoon jungle: gradient sky dome, humid fog that swallows
 * the far scenery (and hides the draw distance), a hemisphere fill and one
 * sun with a shadow box that follows the player.
 *
 * Quality is two tiers picked from the device: phones get a capped pixel
 * ratio, no shadows and fewer particles.
 */

import * as THREE from 'three';
import type { TrackLook } from '../data/tracks/looks.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export interface Quality {
  pixelRatio: number;
  shadows: boolean;
  particles: number;
  /** Bloom, grade and vignette passes. */
  post: boolean;
  /** Ink outlines on karts and gorillas. */
  ink: boolean;
}

export function pickQuality(): Quality {
  const touch = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 820;
  if (touch || small) return { pixelRatio: Math.min(devicePixelRatio, 1.5), shadows: false, particles: 0.5, post: false, ink: false };
  return { pixelRatio: Math.min(devicePixelRatio, 2), shadows: true, particles: 1, post: true, ink: true };
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly quality: Quality;
  private readonly hemi: THREE.HemisphereLight;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private readonly sky: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement) {
    this.quality = pickQuality();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const fogColor = new THREE.Color(0xbfe3c8);
    this.scene.background = fogColor;
    this.scene.fog = new THREE.Fog(fogColor, 70, 300);
    this.sky = skyDome();
    this.scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xfff4d6, 0x3f6b2a, 1.4);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0c8, 2.2);
    this.sun.position.set(60, 90, 30);
    this.sun.castShadow = this.quality.shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -45;
    sc.right = sc.top = 45;
    sc.near = 1;
    sc.far = 220;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);
  }

  /** Switch sky, fog and light to a track's look. */
  applyLook(look: TrackLook): void {
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(look.fog);
    fog.near = look.fogNear;
    fog.far = look.fogFar;
    (this.scene.background as THREE.Color).set(look.fog);
    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    (u.top!.value as THREE.Color).set(look.skyTop);
    (u.horizon!.value as THREE.Color).set(look.skyHorizon);
    this.hemi.color.set(look.hemiSky);
    this.hemi.groundColor.set(look.hemiGround);
    this.hemi.intensity = look.hemiIntensity;
    this.sun.color.set(look.sun);
    this.sun.intensity = look.sunIntensity;
  }

  /** Keep the shadow box centred on what the player is looking at. */
  followSun(target: THREE.Vector3): void {
    this.sun.position.set(target.x + 60, target.y + 90, target.z + 30);
    this.sun.target.position.copy(target);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.bloom?.resolution.set(w, h);
  }

  /**
   * Draw a frame. On desktop it goes through a light post stack: a gentle
   * bloom (glows, lava, pickups, sunbeams), then a grade — a touch more
   * saturation and contrast for the cartoon — and a soft vignette.
   */
  render(camera: THREE.Camera): void {
    if (!this.quality.post) {
      this.renderer.render(this.scene, camera);
      return;
    }
    if (!this.composer) {
      const size = this.renderer.getSize(new THREE.Vector2());
      this.composer = new EffectComposer(this.renderer);
      this.composer.setPixelRatio(this.quality.pixelRatio);
      this.composer.setSize(size.x, size.y);
      this.composer.addPass(new RenderPass(this.scene, camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.14, 0.35, 0.92);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new ShaderPass(GRADE));
      this.composer.addPass(new OutputPass());
    }
    (this.composer.passes[0] as RenderPass).camera = camera;
    this.composer.render();
  }
}

/** Gradient sky on an inverted sphere: haze at the horizon, blue overhead. */
function skyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x58b4e8) },
      horizon: { value: new THREE.Color(0xd9f0d0) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 1.6, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(800, 24, 12), mat);
  dome.onBeforeRender = (_r, _s, camera) => dome.position.copy(camera.position);
  dome.renderOrder = -1;
  return dome;
}

/** Saturation, contrast and a soft vignette, in linear space before output. */
const GRADE = {
  uniforms: { tDiffuse: { value: null }, saturation: { value: 1.14 }, contrast: { value: 1.06 }, vignette: { value: 0.32 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 col = mix(vec3(l), c.rgb, saturation);
      col = (col - 0.18) * contrast + 0.18;
      float d = distance(vUv, vec2(0.5));
      col *= 1.0 - vignette * smoothstep(0.35, 0.85, d);
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }`,
};
