/**
 * Chunked, flat-shaded, vertex-coloured terrain with 3 LODs per chunk (built lazily, cached),
 * toon lighting, wet darkening near the waterline and shader-side strata bands on canyon walls.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { config } from '../core/config';
import type { Terrain } from '../sim/types';

const CHUNK_CELLS = 64;
const STEPS = [1, 2, 4];
/** Camera distance (to chunk edge) below which each LOD is used. */
const LOD_DIST = [450, 1300];

const vert = /* glsl */ `
#include <fog_pars_vertex>
attribute float aStrata;
varying vec3 vSN;
varying vec3 vColor;
varying vec3 vWorld;
varying float vStrata;
void main() {
  vSN = normal;
  vColor = color;
  vStrata = aStrata;
  vWorld = position;
  vec4 mvPosition = viewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const frag = /* glsl */ `
#include <fog_pars_fragment>
uniform vec3 uSun;
varying vec3 vSN;
varying vec3 vColor;
varying vec3 vWorld;
varying float vStrata;

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
}
vec3 strata(float y, vec2 xz) {
  float w = y + 5.0 * vn(xz * 0.02) + 2.0 * vn(xz * 0.11);
  float id = floor(w / 6.5);
  float k = hash(id);
  vec3 cream = vec3(0.95, 0.72, 0.42);
  vec3 orange = vec3(0.90, 0.36, 0.10);
  vec3 red = vec3(0.60, 0.12, 0.08);
  vec3 dark = vec3(0.45, 0.10, 0.09);
  vec3 tan = vec3(0.72, 0.42, 0.20);
  vec3 c = k < 0.22 ? cream : k < 0.5 ? orange : k < 0.76 ? red : k < 0.84 ? dark : tan;
  float edge = fract(w / 6.5);
  c *= 0.86 + 0.2 * smoothstep(0.0, 0.1, edge) - 0.14 * smoothstep(0.88, 1.0, edge);
  return c;
}
void main() {
  vec3 nf = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 n = normalize(mix(nf, normalize(vSN), 0.5 + 0.4 * clamp(vStrata, 0.0, 1.0)));
  vec3 albedo = vColor;
  if (vStrata > 0.01) {
    float steep = 1.0 - smoothstep(0.6, 0.9, n.y);
    albedo = mix(albedo, strata(vWorld.y, vWorld.xz), clamp(vStrata, 0.0, 1.0) * mix(0.55, 1.0, steep));
  }
  float ndl = dot(n, uSun);
  float band = 0.0;
  band += smoothstep(-0.02, 0.06, ndl) * 0.55;
  band += smoothstep(0.30, 0.42, ndl) * 0.45;
  vec3 shade = vec3(0.66, 0.66, 0.95);
  vec3 sunCol = vec3(1.0, 0.94, 0.80) * 1.25;
  vec3 light = mix(shade * 0.72, sunCol, band) + vec3(0.10, 0.14, 0.2) * n.y;
  vec3 c = albedo * light;
  // Wet darkening near the waterline.
  float wet = smoothstep(4.5, 0.2, vWorld.y) * step(-3.0, vWorld.y);
  c *= 1.0 - 0.32 * wet;
  // Underwater tint for seabed seen from below the surface.
  float sub = smoothstep(0.0, -25.0, vWorld.y);
  c = mix(c, c * vec3(0.35, 0.8, 0.9), sub);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

interface Chunk {
  cx: number;
  cz: number;
  /** World-space centre and half extent (xz). */
  x: number;
  z: number;
  half: number;
  meshes: (Mesh | null)[];
  current: number;
}

export class TerrainView {
  private readonly chunks: Chunk[] = [];
  private readonly scene: Scene;
  private readonly terrain: Terrain;
  private readonly material: ShaderMaterial;
  private readonly sunDir = new Vector3();
  /** Triangles currently visible, for debugging. */
  triangles = 0;
  private readonly mesaCenter: [number, number, number];

  constructor(scene: Scene, terrain: Terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.mesaCenter = terrain.islands[terrain.islands.length - 1] ?? [0, 0, 0];
    this.material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uSun: { value: new Vector3(0, 1, 0) } }]),
      vertexShader: vert,
      fragmentShader: frag,
      vertexColors: true,
      side: DoubleSide,
      fog: true,
    });

    const { n, halfSize, cell, heights } = terrain;
    const nChunks = Math.floor((n - 1) / CHUNK_CELLS);
    for (let cz = 0; cz < nChunks; cz++) {
      for (let cx = 0; cx < nChunks; cx++) {
        let max = -1e9;
        for (let j = cz * CHUNK_CELLS; j <= (cz + 1) * CHUNK_CELLS; j++)
          for (let i = cx * CHUNK_CELLS; i <= (cx + 1) * CHUNK_CELLS; i++) max = Math.max(max, heights[j * n + i]!);
        if (max < -8) continue;
        const half = (CHUNK_CELLS * cell) / 2;
        this.chunks.push({
          cx,
          cz,
          x: -halfSize + (cx * CHUNK_CELLS) * cell + half,
          z: -halfSize + (cz * CHUNK_CELLS) * cell + half,
          half,
          meshes: [null, null, null],
          current: -1,
        });
      }
    }
  }

  private build(ch: Chunk, lod: number): Mesh {
    const t = this.terrain;
    const { n, cell, halfSize, heights, material } = t;
    const step = STEPS[lod]!;
    const k = CHUNK_CELLS / step + 1;
    const vCount = k * k + 4 * k;
    const pos = new Float32Array(vCount * 3);
    const col = new Float32Array(vCount * 3);
    const strata = new Float32Array(vCount);
    const nrm = new Float32Array(vCount * 3);
    const c = new Color();
    const i0 = ch.cx * CHUNK_CELLS;
    const j0 = ch.cz * CHUNK_CELLS;
    const [mx, mz, mr] = this.mesaCenter;

    const setV = (v: number, i: number, j: number, yOff: number): void => {
      const gi = Math.min(n - 1, i);
      const gj = Math.min(n - 1, j);
      const h = heights[gj * n + gi]!;
      const m = material[gj * n + gi]!;
      const x = -halfSize + gi * cell;
      const z = -halfSize + gj * cell;
      const gx = (heights[gj * n + Math.min(n - 1, gi + 1)]! - heights[gj * n + Math.max(0, gi - 1)]!) / (2 * cell);
      const gz = (heights[Math.min(n - 1, gj + 1) * n + gi]! - heights[Math.max(0, gj - 1) * n + gi]!) / (2 * cell);
      const slope = Math.hypot(gx, gz);
      const r = (Math.sin(gi * 12.9898 + gj * 78.233) * 43758.5453) % 1;
      const jit = 0.94 + 0.12 * Math.abs(r);
      const nl = Math.hypot(gx, gz, 1);
      nrm[v * 3] = -gx / nl;
      nrm[v * 3 + 1] = 1 / nl;
      nrm[v * 3 + 2] = -gz / nl;
      pos[v * 3] = x;
      pos[v * 3 + 1] = h + yOff;
      pos[v * 3 + 2] = z;
      let s = 0;
      if (m === 0) {
        c.set('#e6cf94').lerp(new Color('#2d7f93'), Math.min(1, -h / 30));
      } else if (m === 1) {
        c.set('#f6dfa2');
        if (h < 1.2) c.lerp(new Color('#d9bd82'), 0.5);
      } else if (m === 2) {
        const hh = Math.min(1, Math.max(0, (h - 4) / 70));
        c.set('#4cc23c').lerp(new Color('#2f9b3a'), hh * 0.8);
        if (hh > 0.5) c.lerp(new Color('#9bd04a'), (hh - 0.5) * 0.5);
        if (slope > 0.6) c.lerp(new Color('#8a7f6c'), Math.min(1, (slope - 0.6) * 2));
        if (h < 9) c.lerp(new Color('#f1d88f'), 0.5 * (1 - (h - 4) / 5));
      } else if (m === 3) {
        c.set('#9a8b82').lerp(new Color('#d0c1b3'), Math.min(1, Math.max(0, (h - 60) / 150)));
        if (Math.hypot(x - mx, z - mz) < mr * 1.25) c.set('#d98a50');
      } else {
        c.set('#c1582a');
        s = 1;
      }
      c.multiplyScalar(jit);
      col[v * 3] = c.r;
      col[v * 3 + 1] = c.g;
      col[v * 3 + 2] = c.b;
      strata[v] = s;
    };

    for (let b = 0; b < k; b++)
      for (let a = 0; a < k; a++) setV(b * k + a, i0 + a * step, j0 + b * step, 0);

    // Skirts: duplicate border vertices lowered by 10 m to hide LOD cracks.
    const skirt = (base: number, edge: (q: number) => [number, number]): void => {
      for (let q = 0; q < k; q++) {
        const [a, b] = edge(q);
        setV(base + q, i0 + a * step, j0 + b * step, -10);
      }
    };
    const sBase = k * k;
    skirt(sBase, (q) => [q, 0]);
    skirt(sBase + k, (q) => [q, k - 1]);
    skirt(sBase + 2 * k, (q) => [0, q]);
    skirt(sBase + 3 * k, (q) => [k - 1, q]);

    const idx: number[] = [];
    for (let b = 0; b < k - 1; b++) {
      for (let a = 0; a < k - 1; a++) {
        const v00 = b * k + a;
        const v10 = v00 + 1;
        const v01 = v00 + k;
        const v11 = v01 + 1;
        idx.push(v00, v01, v10, v10, v01, v11);
      }
    }
    for (let q = 0; q < k - 1; q++) {
      // top edge (z min), bottom (z max), left (x min), right (x max)
      idx.push(q, sBase + q, q + 1, q + 1, sBase + q, sBase + q + 1);
      idx.push(sBase + k + q, (k - 1) * k + q, sBase + k + q + 1, sBase + k + q + 1, (k - 1) * k + q, (k - 1) * k + q + 1);
      idx.push(q * k, q * k + k, sBase + 2 * k + q, sBase + 2 * k + q, q * k + k, sBase + 2 * k + q + 1);
      idx.push(q * k + k - 1, sBase + 3 * k + q, (q + 1) * k + k - 1, (q + 1) * k + k - 1, sBase + 3 * k + q, sBase + 3 * k + q + 1);
    }

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.setAttribute('normal', new BufferAttribute(nrm, 3));
    g.setAttribute('aStrata', new BufferAttribute(strata, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mesh = new Mesh(g, this.material);
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    this.scene.add(mesh);
    return mesh;
  }

  update(camera: PerspectiveCamera): void {
    this.sunDir.set(...config.render.sunDir).normalize();
    (this.material.uniforms.uSun!.value as Vector3).copy(this.sunDir);
    const cx = camera.position.x;
    const cz = camera.position.z;
    let tris = 0;
    for (const ch of this.chunks) {
      const d = Math.max(Math.abs(cx - ch.x), Math.abs(cz - ch.z)) - ch.half;
      const lod = d < LOD_DIST[0]! ? 0 : d < LOD_DIST[1]! ? 1 : 2;
      if (lod !== ch.current) {
        if (ch.current >= 0) ch.meshes[ch.current]!.visible = false;
        ch.meshes[lod] ??= this.build(ch, lod);
        ch.meshes[lod]!.visible = true;
        ch.current = lod;
      }
      const m = ch.meshes[lod]!;
      tris += (m.geometry.index!.count / 3) | 0;
    }
    this.triangles = tris;
  }
}
