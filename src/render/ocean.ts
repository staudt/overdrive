/**
 * Shader ocean. Vertex displacement uses the shared wavesGLSL() so visuals equal physics.
 * Polar grid following the camera (dense near, coarse far), Fresnel sky reflection, sun glitter,
 * crest + shoreline foam (heightfield DataTexture), and an underwater view from below.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  FogExp2,
  LinearFilter,
  Mesh,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { config } from '../core/config';
import type { Terrain } from '../sim/types';
import { waveUniformData, wavesGLSL } from '../sim/waves';
import { SKY_HORIZON, SKY_MID, SKY_ZENITH, UNDERWATER_FOG, skyGLSL } from './sky';

const SNAP = 4;
/** Heightfield encoding for the shore texture: h in [-HMIN, HMAX] -> 0..255. */
const H_LO = -24;
const H_HI = 16;

const vert = /* glsl */ `
${wavesGLSL()}
uniform float uTime;
#include <fog_pars_vertex>
varying vec3 vWorld;
varying float vWave;
void main() {
  vec3 p = position;
  p.xz += vec2(uCenter.x, uCenter.y);
  float h = waveHeight(p.xz, uTime);
  vWave = h;
  p.y = h;
  vWorld = p;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`.replace('uniform float uTime;', 'uniform float uTime;\nuniform vec2 uCenter;');

const frag = /* glsl */ `
${wavesGLSL()}
${skyGLSL}
uniform float uTime;
uniform sampler2D uHeightTex;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uUnder;
uniform float uHalf;
uniform float uHLo;
uniform float uHHi;
uniform float uWaveMax;
#include <fog_pars_fragment>
varying vec3 vWorld;
varying float vWave;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float groundH(vec2 xz) {
  vec2 uv = (xz + uHalf) / (2.0 * uHalf);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -60.0;
  return mix(uHLo, uHHi, texture2D(uHeightTex, uv).r);
}

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);
  vec2 xz = vWorld.xz;

  // Wave normal (analytic) + procedural ripples, faded with distance.
  vec3 N = waveNormal(xz, uTime);
  float rip = smoothstep(2500.0, 200.0, dist);
  vec2 r1 = vec2(vnoise(xz * 0.35 + uTime * vec2(0.6, 0.3)), vnoise(xz * 0.35 + 17.0 - uTime * vec2(0.4, 0.5))) - 0.5;
  vec2 r2 = vec2(vnoise(xz * 1.3 + uTime * vec2(-0.9, 0.7)), vnoise(xz * 1.3 + 31.0 + uTime * vec2(0.8, 0.6))) - 0.5;
  N = normalize(N + vec3(r1.x + 0.5 * r2.x, 0.0, r1.y + 0.5 * r2.y) * 0.2 * rip);

  float g = groundH(xz);
  float depth = -g; // metres of water above ground

  bool below = !gl_FrontFacing;
  if (below) {
    // Seen from underneath: bright refracted ceiling with sun shafts, teal.
    vec3 Nb = -N;
    float ndv = clamp(dot(Nb, V), 0.0, 1.0);
    float tir = smoothstep(0.35, 0.75, 1.0 - ndv);
    vec3 up = mix(uUnder * 3.0, vec3(0.7, 1.0, 1.0) * 1.8, pow(ndv, 3.0));
    float shaft = pow(max(dot(refract(-V, Nb, 1.33), uSunDir), 0.0), 8.0);
    up += vec3(1.0, 0.95, 0.7) * shaft * 0.8;
    vec3 col = mix(up, uUnder * 0.9, tir);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
    return;
  }

  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.04 + 0.96 * pow(1.0 - ndv, 4.0);

  // Body colour: turquoise in the shallows, deep blue offshore; waves lighten crests a touch.
  float shallowT = smoothstep(9.0, 0.3, depth);
  vec3 body = mix(uDeep, uShallow, shallowT * shallowT);
  body *= 0.82 + 0.5 * smoothstep(-1.5, 1.8, vWave) ;
  float sunLit = max(dot(N, uSunDir), 0.0);
  body += uShallow * 0.12 * sunLit; // subsurface-ish

  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyColor(R);
  vec3 col = mix(body, refl, clamp(fres * 1.15, 0.0, 0.85));

  // Sun glitter: broad specular + sparkles.
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 700.0) * 14.0 + pow(max(dot(N, H), 0.0), 60.0) * 0.5;
  float spark = step(0.86, vnoise(xz * 2.6 + uTime * vec2(0.8, -0.5)) * 0.6 + vnoise(xz * 6.3 - uTime) * 0.4);
  float sparkle = spark * pow(max(dot(N, H), 0.0), 120.0) * 36.0 * rip;
  col += vec3(1.0, 0.93, 0.78) * (spec + sparkle);

  // Crest foam (toon).
  float crest = smoothstep(uWaveMax * 0.72, uWaveMax * 0.95, vWave);
  float fn = vnoise(xz * 0.5 + uTime * 0.3) * 0.6 + vnoise(xz * 1.7 - uTime * 0.4) * 0.4;
  float crestFoam = step(0.62, crest * (0.45 + fn)) * smoothstep(3000.0, 300.0, dist);

  // Shoreline foam.
  float band = sin(depth * 1.1 - uTime * 1.6 + fn * 3.0);
  float shore = step(depth, 1.3 + 0.6 * band * 0.5) * step(-3.0, depth) * step(0.3, fn + 0.25);
  float edge = step(depth, 0.35 + 0.35 * fn);
  float shoreFoam = clamp(shore * 0.85 + edge, 0.0, 1.0) * step(-1.0, depth);

  col = mix(col, uFoam, clamp(max(crestFoam, shoreFoam), 0.0, 1.0) * 0.92);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class Ocean {
  private readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly scene: Scene;
  private readonly baseFog: { color: Color; density: number };
  private wasUnder = false;
  private readonly tmp = new Vector3();

  constructor(scene: Scene, terrain: Terrain) {
    this.scene = scene;
    this.baseFog = { color: SKY_HORIZON.clone(), density: config.render.fogDensity };

    // Height texture for shoreline foam / depth tint.
    const n = terrain.n;
    const data = new Uint8Array(n * n);
    for (let i = 0; i < data.length; i++) {
      const t = (terrain.heights[i]! - H_LO) / (H_HI - H_LO);
      data[i] = Math.round(Math.min(1, Math.max(0, t)) * 255);
    }
    const tex = new DataTexture(data, n, n, RedFormat, UnsignedByteType);
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.needsUpdate = true;

    const sunDir = new Vector3(...config.render.sunDir).normalize();
    const w = waveUniformData();
    this.material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          uTime: { value: 0 },
          uCenter: { value: { x: 0, y: 0 } },
          uWaveA: { value: w.a },
          uWaveSpeed: { value: w.speed },
          uWaveCount: { value: w.count },
          uHeightTex: { value: tex },
          uHalf: { value: terrain.halfSize },
          uHLo: { value: H_LO },
          uHHi: { value: H_HI },
          uDeep: { value: new Color('#0a3fc0') },
          uShallow: { value: new Color('#25d6d0') },
          uFoam: { value: new Color('#ffffff').multiplyScalar(1.1) },
          uUnder: { value: UNDERWATER_FOG.clone().multiplyScalar(1.4) },
          uWaveMax: { value: 1 },
          uHorizon: { value: SKY_HORIZON },
          uMid: { value: SKY_MID },
          uZenith: { value: SKY_ZENITH },
          uSunDir: { value: sunDir },
        },
      ]),
      vertexShader: vert,
      fragmentShader: frag,
      side: DoubleSide,
      fog: true,
    });

    // Polar grid: radius grows geometrically; ring spacing ~ 4 m near the centre.
    const seg = 192;
    const rings: number[] = [0];
    let r = 0;
    let step = 5;
    while (r < 16000) {
      r += step;
      rings.push(r);
      step = Math.min(r * 0.075 + 4, 900);
    }
    const nr = rings.length;
    const pos = new Float32Array(nr * seg * 3);
    for (let i = 0; i < nr; i++) {
      for (let s = 0; s < seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        const k = (i * seg + s) * 3;
        pos[k] = Math.cos(a) * rings[i]!;
        pos[k + 1] = 0;
        pos[k + 2] = Math.sin(a) * rings[i]!;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < nr - 1; i++) {
      for (let s = 0; s < seg; s++) {
        const s1 = (s + 1) % seg;
        const a = i * seg + s;
        const b = i * seg + s1;
        const c = (i + 1) * seg + s;
        const d = (i + 1) * seg + s1;
        // Wound to face up (+Y).
        idx.push(a, b, c, b, d, c);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setIndex(idx);
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  update(camera: PerspectiveCamera, t: number, underwater: boolean): void {
    const u = this.material.uniforms;
    const cx = Math.round(camera.position.x / SNAP) * SNAP;
    const cz = Math.round(camera.position.z / SNAP) * SNAP;
    const c = u.uCenter!.value as { x: number; y: number };
    c.x = cx;
    c.y = cz;
    u.uTime!.value = t;
    const w = waveUniformData();
    (u.uWaveA!.value as Float32Array).set(w.a);
    (u.uWaveSpeed!.value as Float32Array).set(w.speed);
    u.uWaveCount!.value = w.count;
    let amp = 0;
    for (const wv of config.water.waves.list) amp += wv[3];
    u.uWaveMax!.value = amp;
    this.tmp.set(...config.render.sunDir).normalize();
    (u.uSunDir!.value as Vector3).copy(this.tmp);

    if (underwater !== this.wasUnder) {
      this.wasUnder = underwater;
      this.scene.userData.underwater = underwater;
      const fog = this.scene.fog;
      if (fog instanceof FogExp2) {
        if (underwater) {
          fog.color.copy(UNDERWATER_FOG);
          fog.density = 0.022;
        } else {
          fog.color.copy(this.baseFog.color);
          fog.density = config.render.fogDensity;
        }
      }
    } else if (!underwater && this.scene.fog instanceof FogExp2) {
      this.scene.fog.density = config.render.fogDensity;
    }
  }
}
