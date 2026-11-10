/**
 * Draws world.weapons: bullet tracers (long additive streaks), missile bodies (instanced mesh),
 * motor flares, and long puffy smoke trails (one pooled dynamic strip mesh for every missile;
 * trails persist and fade after the missile is gone). Event effects live in fx/fx.ts.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { config } from '../core/config';
import type { World } from '../sim/world';

// ---- streaks (tracers + motor flares): instanced camera-facing quads from head to tail ------------

const STREAK_VERT = /* glsl */ `
attribute vec3 aHead;
attribute vec3 aTail;
attribute vec4 aHot;   // rgb hot core colour, width
attribute vec3 aEdge;  // edge colour
varying vec2 vUv;
varying vec3 vHot;
varying vec3 vEdge;
void main() {
  vUv = vec2(position.x, position.y);
  vHot = aHot.rgb; vEdge = aEdge;
  vec3 p = mix(aHead, aTail, position.y);
  vec3 axis = aTail - aHead;
  vec3 side = cross(axis, cameraPosition - p);
  float l = length(side);
  side = l > 1e-5 ? side / l : vec3(0.0, 1.0, 0.0);
  p += side * position.x * aHot.w * 0.5;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const STREAK_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vHot;
varying vec3 vEdge;
void main() {
  float x = abs(vUv.x);
  float along = vUv.y;
  float core = exp(-x * x * 9.0);
  float halo = 1.0 - smoothstep(0.0, 1.0, x);
  float fade = pow(1.0 - along, 1.6);
  float head = smoothstep(0.0, 0.03, along);
  vec3 c = vEdge * halo * 0.8 + vHot * core * core;
  float a = (0.55 * halo + 0.9 * core) * fade * mix(0.5, 1.0, head);
  gl_FragColor = vec4(c * fade * (0.6 + 0.8 * head), a);
}
`;

class Streaks {
  readonly mesh: Mesh;
  private readonly head: InstancedBufferAttribute;
  private readonly tail: InstancedBufferAttribute;
  private readonly hot: InstancedBufferAttribute;
  private readonly edge: InstancedBufferAttribute;
  private readonly geo = new InstancedBufferGeometry();
  n = 0;

  constructor(
    scene: Scene,
    private readonly cap: number,
  ) {
    const g = this.geo;
    g.setAttribute('position', new Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    const mk = (k: number, name: string): InstancedBufferAttribute => {
      const a = new InstancedBufferAttribute(new Float32Array(cap * k), k).setUsage(DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    };
    this.head = mk(3, 'aHead');
    this.tail = mk(3, 'aTail');
    this.hot = mk(4, 'aHot');
    this.edge = mk(3, 'aEdge');
    g.instanceCount = 0;
    this.mesh = new Mesh(
      g,
      new ShaderMaterial({
        vertexShader: STREAK_VERT,
        fragmentShader: STREAK_FRAG,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;
    scene.add(this.mesh);
  }

  begin(): void {
    this.n = 0;
  }

  add(
    hx: number,
    hy: number,
    hz: number,
    tx: number,
    ty: number,
    tz: number,
    width: number,
    hr: number,
    hg: number,
    hb: number,
    er: number,
    eg: number,
    eb: number,
  ): void {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.head.setXYZ(i, hx, hy, hz);
    this.tail.setXYZ(i, tx, ty, tz);
    this.hot.setXYZW(i, hr, hg, hb, width);
    this.edge.setXYZ(i, er, eg, eb);
  }

  end(): void {
    this.geo.instanceCount = this.n;
    this.head.needsUpdate = true;
    this.tail.needsUpdate = true;
    this.hot.needsUpdate = true;
    this.edge.needsUpdate = true;
  }
}

// ---- smoke trails: pooled strips in one dynamic mesh -----------------------------------------------

const TRAIL_VERT = /* glsl */ `
attribute float aA;
attribute vec3 aT; // x: across (-1..1), y: along coord, z: heat
varying float vA;
varying vec3 vT;
void main() {
  vA = aA; vT = aT;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;
const TRAIL_FRAG = /* glsl */ `
varying float vA;
varying vec3 vT;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float x = abs(vT.x);
  float n = vn(vec2(vT.y * 0.9, vT.x * 1.7 + 3.0));
  float n2 = vn(vec2(vT.y * 2.3 + 11.0, vT.x * 3.1));
  float edge = 1.0 - smoothstep(0.35, 1.0, x + (n - 0.5) * 0.7);
  float a = vA * edge;
  if (a < 0.004) discard;
  float shade = smoothstep(0.35, 0.75, n2 * 0.6 + (1.0 - x) * 0.5);
  vec3 c = mix(vec3(0.62, 0.72, 0.9), vec3(1.0), shade);
  c = mix(c, vec3(3.2, 1.7, 0.7), clamp(vT.z, 0.0, 1.0));
  gl_FragColor = vec4(c, a);
}
`;

const TRAIL_PTS = 72;
const TRAIL_SLOTS = 360;
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _s = new Vector3();

interface Slot {
  used: boolean;
  /** Still attached to a live missile. */
  live: boolean;
  owner: number;
  pts: Float32Array;
  times: Float32Array;
  head: number;
  count: number;
  lastSample: number;
  endTime: number;
  seed: number;
}

type HeadFn = (owner: number, out: Vector3) => void;

class Trails {
  readonly mesh: Mesh;
  private readonly slots: Slot[] = [];
  private readonly pos: BufferAttribute;
  private readonly aA: BufferAttribute;
  private readonly aT: BufferAttribute;
  private readonly idx: BufferAttribute;
  private readonly geo = new BufferGeometry();
  /** Vertices written last frame (debug/perf). */
  verts = 0;

  constructor(scene: Scene) {
    const vc = TRAIL_SLOTS * (TRAIL_PTS + 1) * 2;
    this.pos = new BufferAttribute(new Float32Array(vc * 3), 3).setUsage(DynamicDrawUsage);
    this.aA = new BufferAttribute(new Float32Array(vc), 1).setUsage(DynamicDrawUsage);
    this.aT = new BufferAttribute(new Float32Array(vc * 3), 3).setUsage(DynamicDrawUsage);
    this.idx = new BufferAttribute(new Uint32Array(TRAIL_SLOTS * (TRAIL_PTS + 1) * 6), 1).setUsage(DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('aA', this.aA);
    this.geo.setAttribute('aT', this.aT);
    this.geo.setIndex(this.idx);
    this.geo.setDrawRange(0, 0);
    for (let i = 0; i < TRAIL_SLOTS; i++) {
      this.slots.push({
        used: false,
        live: false,
        owner: -1,
        pts: new Float32Array(TRAIL_PTS * 3),
        times: new Float32Array(TRAIL_PTS),
        head: 0,
        count: 0,
        lastSample: 0,
        endTime: 0,
        seed: 0,
      });
    }
    this.mesh = new Mesh(
      this.geo,
      new ShaderMaterial({
        vertexShader: TRAIL_VERT,
        fragmentShader: TRAIL_FRAG,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: NormalBlending,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    scene.add(this.mesh);
  }

  acquire(owner: number, now: number, seed: number): Slot {
    let s = this.slots.find((q) => !q.used);
    // Pool exhausted: recycle the oldest dying trail.
    s ??= this.slots.reduce((m, q) => (!q.live && q.endTime < m.endTime ? q : m), this.slots[0]!);
    s.used = true;
    s.live = true;
    s.owner = owner;
    s.head = 0;
    s.count = 0;
    s.lastSample = -1;
    s.seed = seed;
    s.endTime = now;
    return s;
  }

  private push(s: Slot, x: number, y: number, z: number, now: number): void {
    const h = s.head;
    s.pts[h * 3] = x;
    s.pts[h * 3 + 1] = y;
    s.pts[h * 3 + 2] = z;
    s.times[h] = now;
    s.head = (h + 1) % TRAIL_PTS;
    s.count = Math.min(TRAIL_PTS, s.count + 1);
    s.lastSample = now;
  }

  feed(s: Slot, x: number, y: number, z: number, now: number): void {
    if (s.lastSample < 0 || now - s.lastSample >= config.fx.trailInterval) this.push(s, x, y, z, now);
  }

  end(s: Slot, x: number, y: number, z: number, now: number): void {
    this.push(s, x, y, z, now);
    s.live = false;
    s.owner = -1;
    s.endTime = now;
  }

  private fetch(s: Slot, k: number, hasHead: boolean, out: Vector3, headOf: HeadFn): number {
    if (hasHead && k === 0) {
      headOf(s.owner, out);
      return -1;
    }
    const j = (s.head - (k - (hasHead ? 1 : 0)) - 1 + TRAIL_PTS * 2) % TRAIL_PTS;
    out.set(s.pts[j * 3]!, s.pts[j * 3 + 1]!, s.pts[j * 3 + 2]!);
    return s.times[j]!;
  }

  /** Rebuild all strips facing the camera. */
  build(now: number, cam: Vector3, headOf: HeadFn): void {
    const life = config.fx.trailLife;
    const w0 = config.fx.trailWidth;
    let vi = 0;
    let ii = 0;
    for (const s of this.slots) {
      if (!s.used) continue;
      if (!s.live && now - s.endTime > life) {
        s.used = false;
        continue;
      }
      const hasHead = s.live && s.count > 0;
      const total = s.count + (hasHead ? 1 : 0);
      if (total < 2) continue;
      const firstV = vi;
      let kept = 0;
      for (let k = 0; k < total; k++) {
        let t = this.fetch(s, k, hasHead, _c, headOf);
        if (t < 0) t = now;
        const age = (now - t) / life;
        if (age >= 1) break;
        this.fetch(s, Math.max(0, k - 1), hasHead, _a, headOf);
        this.fetch(s, Math.min(total - 1, k + 1), hasHead, _b, headOf);
        _a.sub(_b);
        _s.set(cam.x - _c.x, cam.y - _c.y, cam.z - _c.z);
        _s.crossVectors(_a, _s);
        const l = _s.length();
        if (l > 1e-6) _s.multiplyScalar(1 / l);
        else _s.set(0, 1, 0);
        const bump = 1 + 0.28 * Math.sin(k * 1.9 + s.seed * 40) + 0.16 * Math.sin(k * 4.3 + s.seed * 17);
        const taper = Math.min(1, (k + (hasHead ? 0 : 3)) / 2.5);
        const w = w0 * (0.35 + 6 * Math.pow(age, 0.55)) * bump * (0.25 + 0.75 * taper);
        const fadeIn = Math.min(1, (now - t) / 0.05 + 0.15);
        const a = config.fx.trailAlpha * Math.pow(1 - age, 1.4) * fadeIn;
        const heat = Math.max(0, 1 - (now - t) / 0.08);
        this.pos.setXYZ(vi, _c.x - _s.x * w, _c.y - _s.y * w, _c.z - _s.z * w);
        this.pos.setXYZ(vi + 1, _c.x + _s.x * w, _c.y + _s.y * w, _c.z + _s.z * w);
        this.aA.setX(vi, a);
        this.aA.setX(vi + 1, a);
        const along = k * 0.9 + s.seed * 50;
        this.aT.setXYZ(vi, -1, along, heat);
        this.aT.setXYZ(vi + 1, 1, along, heat);
        vi += 2;
        kept++;
      }
      for (let k = 0; k < kept - 1; k++) {
        const a0 = firstV + k * 2;
        this.idx.setX(ii++, a0);
        this.idx.setX(ii++, a0 + 1);
        this.idx.setX(ii++, a0 + 2);
        this.idx.setX(ii++, a0 + 1);
        this.idx.setX(ii++, a0 + 3);
        this.idx.setX(ii++, a0 + 2);
      }
    }
    this.verts = vi;
    this.geo.setDrawRange(0, ii);
    this.pos.needsUpdate = true;
    this.aA.needsUpdate = true;
    this.aT.needsUpdate = true;
    this.idx.needsUpdate = true;
  }

  get active(): number {
    let n = 0;
    for (const s of this.slots) if (s.used) n++;
    return n;
  }
}

// ---- missile body ---------------------------------------------------------------------------------

function missileGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const paint = (g: BufferGeometry, r: number, gr: number, b: number): BufferGeometry => {
    const ng = g.toNonIndexed();
    const n = ng.getAttribute('position').count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c[i * 3] = r;
      c[i * 3 + 1] = gr;
      c[i * 3 + 2] = b;
    }
    ng.setAttribute('color', new BufferAttribute(c, 3));
    ng.deleteAttribute('uv');
    ng.deleteAttribute('normal');
    return ng;
  };
  parts.push(paint(new CylinderGeometry(0.3, 0.3, 1.5, 10).rotateX(-Math.PI / 2).translate(0, 0, 0.1), 1.05, 1.05, 1.1));
  parts.push(paint(new ConeGeometry(0.3, 0.9, 10).rotateX(-Math.PI / 2).translate(0, 0, -1.1), 1.6, 0.12, 0.1));
  parts.push(paint(new CylinderGeometry(0.31, 0.31, 0.25, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.35), 1.5, 0.15, 0.12));
  for (let i = 0; i < 4; i++) {
    parts.push(paint(new BoxGeometry(0.05, 0.75, 0.55).translate(0, 0.5, 0.65).rotateZ((i * Math.PI) / 2), 1.5, 0.15, 0.12));
  }
  parts.push(paint(new CylinderGeometry(0.2, 0.26, 0.2, 8).rotateX(-Math.PI / 2).translate(0, 0, 0.95), 0.3, 0.3, 0.35));
  const merged = mergeGeometries(parts, false);
  merged.scale(1.25, 1.25, 1.25);
  return merged;
}

const BODY_CAP = 256;
const _m = new Matrix4();
const _one = new Vector3(1, 1, 1);
const _f = new Vector3();

export class WeaponsView {
  private readonly streaks: Streaks;
  private readonly trails: Trails;
  private readonly bodies: InstancedMesh;
  private readonly owner: (Slot | undefined)[] = [];
  private readonly lastAge: number[] = [];
  private time = 0;
  private world: World | null = null;
  private readonly headOf: HeadFn = (id, out) => {
    const m = this.world?.weapons.missiles[id];
    if (!m) return;
    // Trail head sits at the nozzle, a little behind the body.
    _f.set(0, 0, 1).applyQuaternion(m.quat);
    out.copy(m.pos).addScaledVector(_f, 1.1);
  };

  constructor(
    scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {
    this.streaks = new Streaks(scene, 1024);
    this.trails = new Trails(scene);
    this.bodies = new InstancedMesh(missileGeometry(), new MeshBasicMaterial({ vertexColors: true }), BODY_CAP);
    this.bodies.instanceMatrix.setUsage(DynamicDrawUsage);
    this.bodies.frustumCulled = false;
    this.bodies.count = 0;
    scene.add(this.bodies);
  }

  /** Active trail strips and vertices (debug). */
  get stats(): { trails: number; verts: number; streaks: number } {
    return { trails: this.trails.active, verts: this.trails.verts, streaks: this.streaks.n };
  }

  update(dt: number, world: World): void {
    this.time += dt;
    this.world = world;
    const now = this.time;
    const ws = world.weapons;
    const st = this.streaks;
    st.begin();
    const fx = config.fx;

    // Bullet tracers.
    const gunLife = config.gun.life;
    for (const b of ws.bullets) {
      if (!b.alive) continue;
      const sp = b.vel.length();
      if (sp < 1) continue;
      const age = Math.max(0, gunLife - b.life);
      const len = Math.min(fx.tracerLength, Math.max(8, age * sp + 6));
      const k = len / sp;
      st.add(
        b.pos.x, b.pos.y, b.pos.z,
        b.pos.x - b.vel.x * k, b.pos.y - b.vel.y * k, b.pos.z - b.vel.z * k,
        fx.tracerWidth, 12, 10, 5, 4, 1.4, 0.2,
      );
    }

    // Missiles.
    let nb = 0;
    for (let i = 0; i < ws.missiles.length; i++) {
      const m = ws.missiles[i]!;
      let slot = this.owner[i];
      if (slot && (!m.alive || m.age < (this.lastAge[i] ?? 0))) {
        // Died (or the pool entry was relaunched): freeze the trail so it fades out.
        this.headOf(i, _c);
        this.trails.end(slot, _c.x, _c.y, _c.z, now);
        this.owner[i] = undefined;
        slot = undefined;
      }
      if (!m.alive) continue;
      this.lastAge[i] = m.age;
      if (!slot) {
        slot = this.trails.acquire(i, now, m.seed);
        this.owner[i] = slot;
      }
      this.headOf(i, _c);
      this.trails.feed(slot, _c.x, _c.y, _c.z, now);
      if (nb < BODY_CAP) {
        _m.compose(m.pos, m.quat, _one);
        this.bodies.setMatrixAt(nb++, _m);
      }
      if (m.age > config.missiles.dropTime) {
        _f.set(0, 0, 1).applyQuaternion(m.quat);
        const fl = 1 + 0.25 * Math.sin(now * 90 + m.seed * 50);
        const tx = m.pos.x + _f.x * 1.0;
        const ty = m.pos.y + _f.y * 1.0;
        const tz = m.pos.z + _f.z * 1.0;
        const L = fx.flareLength * fl;
        st.add(tx, ty, tz, tx + _f.x * L, ty + _f.y * L, tz + _f.z * L, 1.5 * fx.flareWidth, 6, 4.2, 1.6, 3.5, 1.0, 0.15);
        const L2 = L * 0.35;
        st.add(tx, ty, tz, tx + _f.x * L2, ty + _f.y * L2, tz + _f.z * L2, 4.5 * fx.flareWidth, 3, 1.8, 0.7, 1.5, 0.45, 0.08);
      }
    }
    this.bodies.count = nb;
    this.bodies.instanceMatrix.needsUpdate = true;
    st.end();
    this.trails.build(now, this.camera.position, this.headOf);
  }
}
