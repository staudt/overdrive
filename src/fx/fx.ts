/**
 * All particle/trail/glow effects: GPU particles (particles.ts), ribbons (ribbon.ts), afterburner
 * flames (flame.ts), shockwave rings, splashes, explosions, speed lines.
 * Debug: add `?fxdemo` to the URL to spawn a splash/hit/explosion in front of the ship every second.
 */
import {
  AdditiveBlending,
  Color,
  Mesh,
  PlaneGeometry,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  Vector3,
} from 'three';
import { config } from '../core/config';
import type { ShipModel } from '../render/ship/model';
import type { ShipState, SimEvent } from '../sim/types';
import { waveHeight } from '../sim/waves';
import type { World } from '../sim/world';
import { Flame, coneGeo } from './flame';
import { col, ParticleSystem } from './particles';
import { Ribbon } from './ribbon';

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Colour constants (HDR values > 1 bloom).
const WATER0 = col(0.95, 0.98, 1.0, 0.9);
const WATER1 = col(0.8, 0.92, 1.0, 0);
const FOAM0 = col(1, 1, 1, 0.55);
const FOAM1 = col(0.9, 0.97, 1, 0);
const MIST0 = col(0.8, 1.3, 1.8, 0.5);
const MIST1 = col(0.5, 1.0, 1.6, 0);
const DROP0 = col(2.2, 2.4, 2.6, 0.9);
const DROP1 = col(1.0, 1.4, 1.8, 0);
const SPARK0 = col(5, 2.6, 0.7, 1);
const SPARK1 = col(1.4, 0.25, 0.02, 0);
const HOTSPARK0 = col(6, 5, 3, 1);
const DUST0 = col(0.62, 0.52, 0.4, 0.75);
const DUST1 = col(0.5, 0.43, 0.34, 0);
const ROCK0 = col(0.22, 0.19, 0.17, 1);
const ROCK1 = col(0.22, 0.19, 0.17, 0.9);
const FLASH0 = col(5, 3.6, 1.6, 0.9);
const FLASH1 = col(3, 1, 0.3, 0);
const FIRE0 = col(3.4, 1.7, 0.4, 1);
const FIRE1 = col(0.3, 0.06, 0.01, 0);
const GLOW0 = col(3, 1.4, 0.45, 0.6);
const GLOW1 = col(1, 0.2, 0.05, 0);
const BLACK0 = col(0.07, 0.06, 0.06, 0.92);
const BLACK1 = col(0.16, 0.15, 0.15, 0);
const BURN0 = col(4, 1.4, 3.2, 0.9);
const BURN1 = col(1.4, 0.15, 1.2, 0);
const BOOST0 = col(4, 3, 0.6, 1);
const BOOST1 = col(2, 0.6, 0.05, 0);
const VAPOR0 = col(0.97, 0.97, 1, 0.5);
const VAPOR1 = col(1, 1, 1, 0);
const BUBBLE0 = col(1.2, 1.9, 2.4, 0.8);
const BUBBLE1 = col(0.8, 1.4, 1.9, 0);
const STREAK0 = col(1.6, 1.9, 2.4, 0.55);
const STREAK1 = col(1.6, 1.9, 2.4, 0);

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const RING_FRAG = /* glsl */ `
uniform float uAge;
uniform vec3 uCol;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float w = mix(0.22, 0.05, uAge);
  float band = smoothstep(1.0 - w * 2.0, 1.0 - w, r) * (1.0 - smoothstep(1.0 - w * 0.3, 1.0, r));
  float a = band * pow(1.0 - uAge, 1.6);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uCol * a * 2.0, a);
}
`;

interface Ring {
  mesh: Mesh;
  mat: ShaderMaterial;
  age: number;
  life: number;
  maxR: number;
  facing: boolean;
  active: boolean;
}

export class Fx {
  /** Camera shake trauma 0..1 added by events; the camera reads and decays it. */
  trauma = 0;
  private time = 0;
  private readonly alpha: ParticleSystem;
  private readonly add: ParticleSystem;
  private readonly rings: Ring[] = [];
  private flames: Flame[] | null = null;
  private boosterFlames: Flame[] | null = null;
  private boosterLen = 0;
  private readonly wingRibbons: Ribbon[];
  private readonly burnRibbons: Ribbon[];
  private contrail = 0;
  private flameLen = [0, 0];
  private flameI = [1, 1];
  private readonly acc = new Float32Array(24);
  private readonly demo: boolean;
  private demoT = 0;
  private demoN = 0;
  private readonly p = new Vector3();
  private readonly dir = new Vector3();
  private readonly rgt = new Vector3();
  private readonly cx = new Vector3();
  private readonly cy = new Vector3();
  private readonly cz = new Vector3();
  private readonly e0 = new Vector3();

  constructor(
    scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {
    const budget = config.fx.particleBudget;
    const addN = Math.floor(budget * config.fx.additiveFraction);
    this.alpha = new ParticleSystem(scene, budget - addN, false, true, 10);
    this.add = new ParticleSystem(scene, addN, true, false, 11);
    const ringGeo = new PlaneGeometry(2, 2);
    for (let i = 0; i < 6; i++) {
      const mat = new ShaderMaterial({
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        uniforms: { uAge: { value: 0 }, uCol: { value: new Color(1, 1, 1) } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: 2,
      });
      const mesh = new Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 12;
      scene.add(mesh);
      this.rings.push({ mesh, mat, age: 0, life: 1, maxR: 1, facing: false, active: false });
    }
    const n = Math.ceil(config.fx.contrailSeconds / 0.02);
    this.wingRibbons = [0, 1].map(() => new Ribbon(scene, n, 0.02, 0.55, 3.5, new Color(1, 1, 1), false));
    this.burnRibbons = [0, 1].map(() => new Ribbon(scene, 26, 0.02, 0.45, 0.6, new Color(3, 0.6, 2.4), true));
    this.demo = new URLSearchParams(window.location.search).has('fxdemo');
  }

  // ---- helpers -------------------------------------------------------------------------------

  private take(i: number, rate: number, dt: number): number {
    this.acc[i] = this.acc[i]! + rate * dt * config.fx.density;
    const n = Math.floor(this.acc[i]!);
    this.acc[i] = this.acc[i]! - n;
    return n;
  }

  private ring(x: number, y: number, z: number, maxR: number, life: number, facing: boolean, c: Color): void {
    let r = this.rings.find((q) => !q.active);
    r ??= this.rings[0]!;
    r.active = true;
    r.age = 0;
    r.life = life;
    r.maxR = maxR;
    r.facing = facing;
    r.mesh.visible = true;
    r.mesh.position.set(x, y, z);
    if (!facing) r.mesh.rotation.set(-Math.PI / 2, 0, 0);
    (r.mat.uniforms.uCol!.value as Color).copy(c);
  }

  private rsph(out: Vector3): Vector3 {
    const z = rnd(-1, 1);
    const a = rnd(0, Math.PI * 2);
    const s = Math.sqrt(1 - z * z);
    return out.set(s * Math.cos(a), z, s * Math.sin(a));
  }

  // ---- events --------------------------------------------------------------------------------

  handle(e: SimEvent, world: World): void {
    switch (e.type) {
      case 'waterEnter':
        this.splash(e.pos.x, e.pos.z, e.speed, false, world.t);
        this.trauma = Math.min(1, this.trauma + 0.25);
        break;
      case 'waterExit':
        this.splash(e.pos.x, e.pos.z, e.speed, true, world.t);
        this.trauma = Math.min(1, this.trauma + 0.2);
        break;
      case 'terrainHit':
        this.terrainHit(e.pos, e.normal, e.impact);
        this.trauma = Math.min(1, this.trauma + e.impact / 60);
        break;
      case 'ram':
        this.ram(e.pos, e.impact, e.killed);
        this.trauma = Math.min(1, this.trauma + (e.killed ? 0.9 : 0.4));
        break;
      case 'boostStart':
        this.boostBurst(world);
        this.trauma = Math.min(1, this.trauma + 0.35);
        break;
      default:
        break;
    }
  }

  /** Boost kick: yellow shockwave rings behind the ship and a spray of hot sparks. */
  private boostBurst(world: World): void {
    const s = world.ship;
    const T = this.time;
    this.dir.set(0, 0, 1).applyQuaternion(s.quat); // backwards
    const x = s.pos.x + this.dir.x * 3;
    const y = s.pos.y + this.dir.y * 3;
    const z = s.pos.z + this.dir.z * 3;
    this.ring(x, y, z, 14, 0.35, true, new Color(1.6, 1.2, 0.25));
    this.ring(x, y, z, 8, 0.25, true, new Color(1.2, 1.2, 1.2));
    for (let n = 0; n < 90 * config.fx.density; n++) {
      const sp = rnd(30, 90);
      this.add.emit(T, x, y, z, s.vel.x * 0.4 + this.dir.x * sp + rnd(-25, 25), s.vel.y * 0.4 + this.dir.y * sp + rnd(-25, 25), s.vel.z * 0.4 + this.dir.z * sp + rnd(-25, 25), rnd(0.3, 0.7), 0.8, 0.2, 0, 2.5, 0.06, BOOST0, BOOST1);
    }
  }

  private splash(x: number, z: number, speed: number, exit: boolean, t: number): void {
    const y = waveHeight(x, z, t);
    const s = clamp(speed / 110, 0.35, 2.2);
    const d = config.fx.density;
    const A = this.alpha;
    const T = this.time;
    const vmax = (14 + 0.4 * speed) * (exit ? 1.2 : 1);
    // Tall white column.
    for (let i = 0, n = Math.floor(110 * s * d); i < n; i++) {
      const a = rnd(0, Math.PI * 2);
      const rr = rnd(0, 2.2) * s;
      const hv = rnd(0.2, 1) * vmax;
      const out = rnd(0, 9) * s;
      A.emit(T, x + Math.cos(a) * rr, y, z + Math.sin(a) * rr, Math.cos(a) * out, hv, Math.sin(a) * out, rnd(1.3, 2.3), 3.5 * s, rnd(7, 11) * s, 22, 0.12, 0, WATER0, WATER1);
    }
    // Spray ring.
    for (let i = 0, n = Math.floor(80 * s * d); i < n; i++) {
      const a = rnd(0, Math.PI * 2);
      const v = rnd(8, 26) * s;
      A.emit(T, x, y + 0.5, z, Math.cos(a) * v, rnd(3, 10), Math.sin(a) * v, rnd(0.9, 1.5), 2, rnd(3, 5), 16, 0.5, 0, WATER0, WATER1);
    }
    // Glittering droplets and mist (additive).
    for (let i = 0, n = Math.floor(70 * s * d); i < n; i++) {
      const a = rnd(0, Math.PI * 2);
      const out = rnd(0, 9) * s;
      this.add.emit(T, x, y + 1, z, Math.cos(a) * out, rnd(0.3, 1.1) * vmax, Math.sin(a) * out, rnd(0.8, 1.6), 0.5, 0.3, 24, 0.1, 0.035, DROP0, DROP1);
    }
    for (let i = 0, n = Math.floor(30 * s * d); i < n; i++) {
      const a = rnd(0, Math.PI * 2);
      const out = rnd(0, 8) * s;
      this.add.emit(T, x, y + 2, z, Math.cos(a) * out, rnd(0.2, 0.9) * vmax, Math.sin(a) * out, rnd(0.8, 1.5), 4, 9, 14, 0.3, 0, MIST0, MIST1);
    }
    this.ring(x, y + 0.4, z, 26 * s, 0.9, false, new Color(1, 1, 1));
    this.ring(x, y + 0.4, z, 14 * s, 0.6, false, new Color(0.6, 1, 1.6));
  }

  private terrainHit(pos: Vector3, nrm: Vector3, impact: number): void {
    const k = clamp(impact / 30, 0.25, 2);
    const d = config.fx.density;
    const T = this.time;
    const v = this.e0;
    for (let i = 0, n = Math.floor(45 * k * d); i < n; i++) {
      this.rsph(v).multiplyScalar(0.9).add(nrm).normalize().multiplyScalar(rnd(15, 55) * Math.sqrt(k));
      this.add.emit(T, pos.x, pos.y, pos.z, v.x, v.y, v.z, rnd(0.4, 1.0), 0.5, 0.35, 25, 0.4, 0.05, i % 4 === 0 ? HOTSPARK0 : SPARK0, SPARK1);
    }
    for (let i = 0, n = Math.floor(26 * k * d); i < n; i++) {
      this.rsph(v).multiplyScalar(0.7).addScaledVector(nrm, 1.2).multiplyScalar(rnd(4, 14));
      this.alpha.emit(T, pos.x, pos.y, pos.z, v.x, v.y, v.z, rnd(1.6, 2.6), 3, 10 * k + 3, -1.5, 1.2, 0, DUST0, DUST1);
    }
    for (let i = 0, n = Math.floor(14 * k * d); i < n; i++) {
      this.rsph(v).addScaledVector(nrm, 1).multiplyScalar(rnd(8, 30));
      this.alpha.emit(T, pos.x, pos.y, pos.z, v.x, v.y, v.z, rnd(1, 1.8), 0.7, 0.5, 25, 0.2, 0, ROCK0, ROCK1);
    }
    this.add.emit(T, pos.x, pos.y, pos.z, 0, 0, 0, 0.22, 5 * k + 3, 14 * k + 4, 0, 0.1, 0, FLASH0, FLASH1);
  }

  private ram(pos: Vector3, impact: number, killed: boolean): void {
    const k = clamp(impact / 60, 0.5, 2);
    const d = config.fx.density;
    const T = this.time;
    const v = this.e0;
    this.add.emit(T, pos.x, pos.y, pos.z, 0, 0, 0, 0.25, 14, 34, 0, 0.1, 0, FLASH0, FLASH1);
    for (let i = 0, n = Math.floor(50 * k * d); i < n; i++) {
      this.rsph(v).multiplyScalar(rnd(15, 70));
      this.add.emit(T, pos.x, pos.y, pos.z, v.x, v.y, v.z, rnd(0.4, 1.0), 0.6, 0.4, 20, 0.5, 0.05, i % 3 === 0 ? HOTSPARK0 : SPARK0, SPARK1);
    }
    for (let i = 0, n = Math.floor(22 * k * d); i < n; i++) {
      this.rsph(v).multiplyScalar(rnd(10, 40));
      this.alpha.emit(T, pos.x, pos.y, pos.z, v.x, v.y, v.z, rnd(1.2, 2), 1, 0.7, 20, 0.3, 0, ROCK0, ROCK1);
    }
    this.ring(pos.x, pos.y, pos.z, 26, 0.45, true, new Color(1.6, 1.3, 0.8));
    if (!killed) return;
    // Orange fireball with black smoke.
    for (let i = 0, n = Math.floor(34 * d); i < n; i++) {
      this.rsph(v).multiplyScalar(rnd(2, 22));
      this.alpha.emit(T, pos.x + v.x * 0.1, pos.y + v.y * 0.1, pos.z + v.z * 0.1, v.x, v.y, v.z, rnd(1.0, 1.8), 5, rnd(16, 28), -2, 1.8, 0, FIRE0, FIRE1);
    }
    for (let i = 0, n = Math.floor(20 * d); i < n; i++) {
      this.rsph(v).multiplyScalar(rnd(1, 14));
      this.add.emit(T, pos.x, pos.y, pos.z, v.x, v.y, v.z, rnd(0.4, 0.8), 10, rnd(22, 34), 0, 2, 0, GLOW0, GLOW1);
    }
    for (let i = 0, n = Math.floor(16 * d); i < n; i++) {
      this.rsph(v).multiplyScalar(rnd(2, 15));
      this.alpha.emit(T, pos.x, pos.y, pos.z, v.x, v.y, v.z, rnd(2, 3.6), 6, rnd(18, 32), -4, 1.2, 0, BLACK0, BLACK1);
    }
    this.ring(pos.x, pos.y, pos.z, 60, 0.7, true, new Color(1.2, 0.9, 0.7));
  }

  // ---- per-frame -----------------------------------------------------------------------------

  update(dt: number, world: World, ship: ShipModel): void {
    this.time += dt;
    const s = world.ship;
    const T = this.time;
    ship.group.updateMatrixWorld(true);

    if (this.demo) this.runDemo(dt, world);

    this.flamesAndTrails(dt, s, ship);
    this.skimAndWater(dt, world, s);
    this.speedLines(dt, s);


    // Rings.
    for (const r of this.rings) {
      if (!r.active) continue;
      r.age += dt;
      const u = r.age / r.life;
      if (u >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - u, 2.5);
      r.mesh.scale.setScalar(Math.max(0.01, r.maxR * e));
      if (r.facing) r.mesh.quaternion.copy(this.camera.quaternion);
      r.mat.uniforms.uAge!.value = u;
    }

    this.alpha.flush(T);
    this.add.flush(T);
  }

  private flamesAndTrails(dt: number, s: ShipState, ship: ShipModel): void {
    const T = this.time;
    if (!this.flames) {
      const geo = coneGeo();
      this.flames = ship.engines.map((a, i) => new Flame(a, geo, i * 1.7));
    }
    const ts = s.throttleState;
    const wantLen = ts === -1 ? 0.8 : ts === 0 ? 3.2 : ts === 1 ? 6 : 13;
    const wantI = ts === -1 ? 0.5 : ts === 0 ? 0.9 : ts === 1 ? 1.2 : 1.7;
    const k = Math.min(1, dt * 7);
    const glow = config.fx.flameGlow;
    const lenMul = config.fx.flameLength;
    for (let i = 0; i < this.flames.length; i++) {
      this.flameLen[i] = this.flameLen[i]! + (wantLen - this.flameLen[i]!) * k;
      this.flameI[i] = this.flameI[i]! + (wantI - this.flameI[i]!) * k;
      this.flames[i]!.update(T, this.flameLen[i]! * lenMul, this.flameI[i]! * glow, ts === 2 ? 1 : ts === 1 ? 0.25 : 0);
    }

    // Yellow boost thrusters.
    if (!this.boosterFlames) {
      const geo = coneGeo();
      this.boosterFlames = ship.boosters.map((a, i) => new Flame(a, geo, 3 + i * 1.3, 'yellow', 0.75));
    }
    this.boosterLen += ((ts === 2 ? 15 : 0) - this.boosterLen) * Math.min(1, dt * (ts === 2 ? 10 : 6));
    for (const bf of this.boosterFlames) bf.update(T, this.boosterLen * lenMul, 1.6 * glow, 1);
    if (ts === 2) {
      for (let i = 0; i < ship.boosters.length; i++) {
        ship.boosters[i]!.getWorldPosition(this.p);
        for (let n = this.take(16 + i, 70, dt); n > 0; n--) {
          this.add.emit(T, this.p.x, this.p.y, this.p.z, s.vel.x * 0.3 + rnd(-3, 3), s.vel.y * 0.3 + rnd(-3, 3), s.vel.z * 0.3 + rnd(-3, 3), rnd(0.25, 0.5), 0.6, 0.2, 0, 1.6, 0.06, BOOST0, BOOST1);
        }
      }
    }

    const sp = s.speed;
    if (sp > 1) this.dir.copy(s.vel).multiplyScalar(1 / sp);
    else this.dir.set(0, 0, -1).applyQuaternion(s.quat);
    const cam = this.camera.position;

    // Engine streak particles and boost vapour.
    for (let i = 0; i < ship.engines.length; i++) {
      ship.engines[i]!.getWorldPosition(this.p);
      const sRate = ts === 2 ? 110 : ts === 1 ? 32 : ts === 0 ? 8 : 0;
      for (let n = this.take(i, sRate, dt); n > 0; n--) {
        this.add.emit(T, this.p.x + rnd(-0.2, 0.2), this.p.y + rnd(-0.2, 0.2), this.p.z + rnd(-0.2, 0.2), s.vel.x * 0.35 + rnd(-2, 2), s.vel.y * 0.35 + rnd(-2, 2), s.vel.z * 0.35 + rnd(-2, 2), rnd(0.35, 0.7), 0.7, 0.3, 0, 1.6, 0.05, BURN0, BURN1);
      }
      if (ts === 2) {
        for (let n = this.take(2 + i, sp / 1.5, dt); n > 0; n--) {
          this.alpha.emit(T, this.p.x, this.p.y, this.p.z, s.vel.x * 0.03 + rnd(-1, 1), s.vel.y * 0.03 + rnd(-1, 1), s.vel.z * 0.03 + rnd(-1, 1), rnd(2, 2.8), 1.5, rnd(5, 7), 0, 0.4, 0, VAPOR0, VAPOR1);
        }
      }
      const br = this.burnRibbons[i]!;
      br.update(dt, this.p.x, this.p.y, this.p.z, ts === 2 ? 0.7 : ts === 1 ? 0.25 : 0, cam);
    }

    // Wingtip contrails: strong when turning hard or boosting.
    const bankA = Math.abs(s.bank);
    const target = Math.max(smooth(0.9, 1.7, s.turnRate), smooth(0.6, 1.2, bankA) * 0.7, ts === 2 ? 1 : 0, smooth(config.flight.maxSpeed, config.flight.maxSpeed + 30, sp) * 0.6);
    this.contrail += (target - this.contrail) * Math.min(1, dt * (target > this.contrail ? 8 : 2.5));
    for (let i = 0; i < ship.wingtips.length; i++) {
      ship.wingtips[i]!.getWorldPosition(this.p);
      this.wingRibbons[i]!.update(dt, this.p.x, this.p.y, this.p.z, this.contrail * 0.85, cam);
    }
  }

  private skimAndWater(dt: number, world: World, s: ShipState): void {
    const T = this.time;
    const t = world.t;
    const px = s.pos.x;
    const pz = s.pos.z;
    const surf = waveHeight(px, pz, t);
    this.dir.copy(s.vel);
    const sp = s.speed;
    if (sp > 0.5) this.dir.multiplyScalar(1 / sp);
    this.rgt.set(-this.dir.z, 0, this.dir.x).normalize();
    const sf = clamp(sp / 110, 0.3, 1.8);

    if (s.submerged) {
      for (let n = this.take(4, 70, dt); n > 0; n--) {
        this.add.emit(T, px + rnd(-2, 2), s.pos.y + rnd(-1, 1), pz + rnd(-2, 2), rnd(-1, 1), rnd(1, 3), rnd(-1, 1), rnd(1, 2), 0.35, 0.7, -5, 1, 0, BUBBLE0, BUBBLE1);
      }
      for (let n = this.take(5, 45, dt); n > 0; n--) {
        const o = rnd(-1.5, 1.5);
        this.add.emit(T, px + this.rgt.x * o, s.pos.y + rnd(-0.5, 0.5), pz + this.rgt.z * o, -this.dir.x * 12, -this.dir.y * 12 + 2, -this.dir.z * 12, rnd(0.5, 0.9), 0.6, 0.4, 0, 0.8, 0.08, DROP0, DROP1);
      }
      return;
    }
    const terrainY = world.terrain.heightAt(px, pz);
    const h = s.pos.y - surf;
    if (terrainY < surf - 0.5 && h < config.water.skimHeight && h > -1 && sp > 25) {
      const q = 1 - clamp(h, 0, config.water.skimHeight) / config.water.skimHeight;
      const rate = 300 * q * sf;
      for (let n = this.take(6, rate, dt); n > 0; n--) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const o = side * rnd(1.2, 2.8);
        this.alpha.emit(T, px + this.rgt.x * o - this.dir.x * rnd(0, 4), surf + 0.2, pz + this.rgt.z * o - this.dir.z * rnd(0, 4), s.vel.x * 0.12 + this.rgt.x * side * rnd(5, 14), rnd(4, 11) * (0.5 + 0.5 * sf), s.vel.z * 0.12 + this.rgt.z * side * rnd(5, 14), rnd(0.8, 1.3), 1.6, rnd(3, 5), 20, 0.6, 0, WATER0, WATER1);
      }
      // Rooster tail.
      for (let n = this.take(7, 90 * q * sf, dt); n > 0; n--) {
        this.alpha.emit(T, px - this.dir.x * 4 + rnd(-1, 1), surf + 0.3, pz - this.dir.z * 4 + rnd(-1, 1), s.vel.x * 0.28 + rnd(-2, 2), rnd(8, 20) * q * (0.5 + 0.5 * sf), s.vel.z * 0.28 + rnd(-2, 2), rnd(1, 1.6), 2, rnd(4, 7), 17, 0.25, 0, WATER0, WATER1);
      }
      for (let n = this.take(11, 60 * q * sf, dt); n > 0; n--) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.add.emit(T, px - this.dir.x * 2, surf + 0.5, pz - this.dir.z * 2, s.vel.x * 0.2 + this.rgt.x * side * rnd(3, 12), rnd(6, 16), s.vel.z * 0.2 + this.rgt.z * side * rnd(3, 12), rnd(0.6, 1.2), 0.5, 0.3, 20, 0.3, 0.04, DROP0, DROP1);
      }
      // Hovering on the water: huge sheets of water thrown out to both sides.
      if (s.skimming) {
        const big = clamp(sp / 80, 0.6, 2.5);
        for (let n = this.take(18, 520 * big, dt); n > 0; n--) {
          const side = Math.random() < 0.5 ? -1 : 1;
          const back = rnd(-2, 6);
          const out = rnd(14, 38) * big;
          this.alpha.emit(T, px + this.rgt.x * side * rnd(2, 4) - this.dir.x * back, surf + 0.3, pz + this.rgt.z * side * rnd(2, 4) - this.dir.z * back, s.vel.x * 0.35 + this.rgt.x * side * out, rnd(9, 22) * (0.6 + 0.4 * big), s.vel.z * 0.35 + this.rgt.z * side * out, rnd(1.1, 1.9), 2.5 * big, rnd(7, 13) * big, 24, 0.45, 0, WATER0, WATER1);
        }
        // Glittering droplets on top of the sheets.
        for (let n = this.take(19, 260 * big, dt); n > 0; n--) {
          const side = Math.random() < 0.5 ? -1 : 1;
          const out = rnd(10, 32) * big;
          this.add.emit(T, px + this.rgt.x * side * 3, surf + 0.6, pz + this.rgt.z * side * 3, s.vel.x * 0.3 + this.rgt.x * side * out, rnd(10, 26), s.vel.z * 0.3 + this.rgt.z * side * out, rnd(0.7, 1.3), 0.7, 0.4, 24, 0.3, 0.05, DROP0, DROP1);
        }
        // Tall rooster tail behind.
        for (let n = this.take(20, 160 * big, dt); n > 0; n--) {
          this.alpha.emit(T, px - this.dir.x * 7 + rnd(-1.5, 1.5), surf + 0.3, pz - this.dir.z * 7 + rnd(-1.5, 1.5), s.vel.x * 0.4 + rnd(-4, 4), rnd(14, 32) * (0.6 + 0.4 * big), s.vel.z * 0.4 + rnd(-4, 4), rnd(1.2, 2), 3, rnd(8, 14) * big, 18, 0.25, 0, WATER0, WATER1);
        }
      }
      // Foam wake left on the surface.
      for (let n = this.take(12, sp / 3.5 * q, dt); n > 0; n--) {
        const o = rnd(-2, 2);
        this.alpha.emit(T, px + this.rgt.x * o - this.dir.x * 3, surf + 0.3, pz + this.rgt.z * o - this.dir.z * 3, rnd(-1, 1), 0, rnd(-1, 1), rnd(2, 3), 4, rnd(9, 13), 0, 1, 0, FOAM0, FOAM1);
      }
    }
  }

  private speedLines(dt: number, s: ShipState): void {
    const max = config.flight.maxSpeed;
    const k = s.boosting ? 1 : smooth(max, config.flight.boostSpeed, s.speed);
    if (k <= 0.02) return;
    const T = this.time;
    this.camera.matrixWorld.extractBasis(this.cx, this.cy, this.cz);
    const cam = this.camera.position;
    for (let n = this.take(13, 150 * k, dt); n > 0; n--) {
      const a = rnd(0, Math.PI * 2);
      const r = rnd(5, 30);
      const dist = rnd(8, 90);
      const px = cam.x - this.cz.x * dist + (this.cx.x * Math.cos(a) + this.cy.x * Math.sin(a)) * r;
      const py = cam.y - this.cz.y * dist + (this.cx.y * Math.cos(a) + this.cy.y * Math.sin(a)) * r;
      const pz = cam.z - this.cz.z * dist + (this.cx.z * Math.cos(a) + this.cy.z * Math.sin(a)) * r;
      this.add.emit(T, px, py, pz, -s.vel.x * 0.5, -s.vel.y * 0.5, -s.vel.z * 0.5, rnd(0.35, 0.6), 0.25, 0.2, 0, 0, 0.07, STREAK0, STREAK1);
    }
  }

  private runDemo(dt: number, world: World): void {
    this.demoT += dt;
    if (this.demoT < 1.2) return;
    this.demoT = 0;
    const s = world.ship;
    const f = new Vector3(0, 0, -1).applyQuaternion(s.quat);
    const base = s.pos.clone().addScaledVector(f, 80);
    const kind = this.demoN++ % 4;
    if (kind === 0) this.handle({ type: 'waterEnter', pos: new Vector3(base.x, 0, base.z), speed: 100 }, world);
    else if (kind === 1) this.handle({ type: 'terrainHit', pos: base, normal: new Vector3(0, 1, 0), impact: 40 }, world);
    else if (kind === 2) this.handle({ type: 'ram', pos: base, dummyId: 0, impact: 70, killed: true }, world);
    else this.handle({ type: 'waterExit', pos: new Vector3(base.x, 0, base.z), speed: 140 }, world);
  }
}
