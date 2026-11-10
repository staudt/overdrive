/**
 * Effects for the battleship: part kills (fireball, debris, smoke column), the dying sequence
 * (chain fireballs, burning trail, plumes), the huge death blast with shockwave and sea splash,
 * hull scrape sparks, and persistent smoke/fire on destroyed parts and a damaged hull.
 * Own particle systems (3 draw calls) plus a small pool of shockwave rings.
 * Debug: `?bossdemo` is handled in BossView (kills a part every 2 s).
 */
import { AdditiveBlending, Color, Mesh, PlaneGeometry, type PerspectiveCamera, type Scene, ShaderMaterial, Vector3 } from 'three';
import type { SimEvent } from '../sim/types';
import { waveHeight } from '../sim/waves';
import type { World } from '../sim/world';
import { col, ParticleSystem } from './particles';

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

const FIRE0 = col(4, 2.0, 0.5, 0.95);
const FIRE1 = col(0.5, 0.08, 0.02, 0);
const HOT0 = col(7, 5, 3, 1);
const HOT1 = col(3, 0.8, 0.2, 0);
const MAG0 = col(5, 0.8, 4, 0.95);
const MAG1 = col(1.2, 0.1, 1.2, 0);
const RED0 = col(5, 0.5, 0.3, 0.95);
const RED1 = col(1.2, 0.05, 0.05, 0);
const SMOKE0 = col(0.1, 0.09, 0.1, 0.9);
const SMOKE1 = col(0.28, 0.27, 0.3, 0);
const WATER0 = col(0.95, 0.98, 1, 0.9);
const WATER1 = col(0.8, 0.92, 1, 0);
const CHUNK0 = col(0.08, 0.08, 0.1, 1);
const CHUNK1 = col(0.08, 0.08, 0.1, 0.8);
const SPARK0 = col(6, 3.4, 1, 1);
const SPARK1 = col(1.4, 0.25, 0.02, 0);

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
  active: boolean;
}

export class BossFx {
  trauma = 0;
  private time = 0;
  private readonly smoke: ParticleSystem;
  private readonly fire: ParticleSystem;
  private readonly spark: ParticleSystem;
  private readonly rings: Ring[] = [];
  private readonly _v = new Vector3();
  private readonly _w = new Vector3();
  private acc = 0;
  private accHull = 0;
  private accDie = 0;
  private rumble = 0;

  constructor(
    scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {
    this.smoke = new ParticleSystem(scene, 3000, false, true, 15);
    this.fire = new ParticleSystem(scene, 3000, true, true, 16);
    this.spark = new ParticleSystem(scene, 2000, true, false, 17);
    const geo = new PlaneGeometry(2, 2);
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
      const mesh = new Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 18;
      scene.add(mesh);
      this.rings.push({ mesh, mat, age: 0, life: 1, maxR: 1, active: false });
    }
  }

  private shake(base: number, pos: Vector3, world: World, range = 1400): void {
    const d = pos.distanceTo(world.ship.pos);
    this.trauma = Math.min(1, this.trauma + base * clamp(1 - d / range, 0.12, 1));
  }

  private ring(pos: Vector3, y: number, maxR: number, life: number, c: Color, horizontal: boolean): void {
    const r = this.rings.find((q) => !q.active) ?? this.rings[0]!;
    r.active = true;
    r.age = 0;
    r.life = life;
    r.maxR = maxR;
    r.mesh.visible = true;
    r.mesh.position.set(pos.x, y, pos.z);
    if (horizontal) r.mesh.rotation.set(-Math.PI / 2, 0, 0);
    (r.mat.uniforms.uCol!.value as Color).copy(c);
    (r.mesh.userData as { h: boolean }).h = !horizontal;
  }

  /** Spherical fireball with embers, smoke and chunks. s = radius scale (m). */
  private blast(p: Vector3, s: number, vel: Vector3 | null, magenta = false): void {
    const T = this.time;
    const vx = vel ? vel.x * 0.5 : 0;
    const vy = vel ? vel.y * 0.5 : 0;
    const vz = vel ? vel.z * 0.5 : 0;
    this.fire.emit(T, p.x, p.y, p.z, vx, vy, vz, 0.35, s * 1.2, s * 2.6, 0, 1, 0, magenta ? MAG0 : HOT0, magenta ? MAG1 : HOT1);
    const n = Math.round(10 + s * 0.6);
    for (let i = 0; i < n; i++) {
      const v = this._v.set(rnd(-1, 1), rnd(-0.6, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(0.3, 1.2) * s * 1.6);
      this.fire.emit(T, p.x, p.y, p.z, v.x + vx, v.y + vy, v.z + vz, rnd(0.6, 1.4), s * rnd(0.5, 0.9), s * rnd(1.2, 2), 0, 1.6, 0, i % 3 === 0 && magenta ? MAG0 : FIRE0, i % 3 === 0 && magenta ? MAG1 : FIRE1);
    }
    for (let i = 0; i < n; i++) {
      const v = this._v.set(rnd(-1, 1), rnd(-0.3, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(0.2, 0.9) * s);
      this.smoke.emit(T, p.x, p.y, p.z, v.x + vx, v.y + vy + s * 0.4, v.z + vz, rnd(2.2, 4.5), s * rnd(0.6, 1), s * rnd(1.8, 3), -2, 1.2, 0, SMOKE0, SMOKE1);
    }
    for (let i = 0; i < n * 2; i++) {
      const v = this._v.set(rnd(-1, 1), rnd(-0.5, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(0.8, 2.6) * s * 2);
      this.spark.emit(T, p.x, p.y, p.z, v.x, v.y, v.z, rnd(0.6, 1.5), 1.2, 0.4, 30, 0.3, 0.06, SPARK0, SPARK1);
    }
    for (let i = 0; i < Math.round(n * 0.7); i++) {
      const v = this._v.set(rnd(-1, 1), rnd(0, 1.2), rnd(-1, 1)).normalize().multiplyScalar(rnd(0.5, 1.6) * s * 1.6);
      this.smoke.emit(T, p.x, p.y, p.z, v.x + vx, v.y + vy, v.z + vz, rnd(1.5, 3.2), rnd(1.5, 4), rnd(1.5, 4), 38, 0.15, 0, CHUNK0, CHUNK1);
    }
  }

  handle(e: SimEvent, world: World): void {
    const T = this.time;
    const boss = world.boss;
    switch (e.type) {
      case 'bossPartDestroyed': {
        const p = e.pos;
        if (e.coreExposed) {
          // Hatch blow-out: flash, red glow and flying armour plates.
          this.fire.emit(T, p.x, p.y, p.z, 0, 0, 0, 0.5, 30, 90, 0, 1, 0, RED0, RED1);
          this.fire.emit(T, p.x, p.y, p.z, 0, 0, 0, 0.25, 40, 70, 0, 1, 0, HOT0, HOT1);
          this.ring(p, p.y, 120, 0.9, new Color(2, 0.3, 0.3), false);
          this.blast(p, 14, boss?.vel ?? null);
          this.shake(0.7, p, world);
          break;
        }
        const big = e.role === 'engine' ? 2.6 : e.role === 'core' ? 3 : 1;
        this.blast(p, 12 * big, boss?.vel ?? null, e.role === 'engine');
        if (e.role === 'engine') {
          this.fire.emit(T, p.x, p.y, p.z, 0, 0, 0, 0.45, 60, 160, 0, 1, 0, MAG0, MAG1);
          this.ring(p, p.y, 160, 0.8, new Color(2.4, 0.4, 2), false);
        }
        // Smoke column.
        for (let i = 0; i < 16 * big; i++) {
          this.smoke.emit(T, p.x + rnd(-4, 4), p.y, p.z + rnd(-4, 4), (boss?.vel.x ?? 0) * 0.6 + rnd(-6, 6), rnd(12, 30), (boss?.vel.z ?? 0) * 0.6 + rnd(-6, 6), rnd(3, 6), rnd(8, 14), rnd(30, 60) * Math.sqrt(big), -1, 0.6, 0, SMOKE0, SMOKE1);
        }
        this.shake(e.role === 'turret' ? 0.35 : e.role === 'engine' ? 0.7 : 1, p, world);
        break;
      }
      case 'bossDying':
        this.accDie = 0;
        this.shake(0.9, e.pos, world, 2000);
        break;
      case 'bossDeath': {
        const p = e.pos;
        // Huge fireball: layered flash, fire cloud, smoke and debris rain.
        this.fire.emit(T, p.x, p.y, p.z, 0, 0, 0, 1.0, 260, 640, 0, 1, 0, HOT0, HOT1);
        this.fire.emit(T, p.x, p.y, p.z, 0, 0, 0, 1.2, 150, 420, 0, 1, 0, FIRE0, FIRE1);
        this.blast(p, 60, null);
        for (let i = 0; i < 6; i++) {
          this._w.set(rnd(-90, 90), rnd(-40, 60), rnd(-160, 160));
          this._w.add(p);
          this.blast(this._w, rnd(24, 44), null, i % 2 === 0);
        }
        for (let i = 0; i < 60; i++) {
          const a = rnd(0, 6.283);
          const v = rnd(30, 140);
          this.smoke.emit(T, p.x, p.y, p.z, Math.cos(a) * v, rnd(10, 70), Math.sin(a) * v, rnd(5, 9), rnd(40, 80), rnd(120, 260), -3, 0.7, 0, SMOKE0, SMOKE1);
        }
        for (let i = 0; i < 90; i++) {
          const a = rnd(0, 6.283);
          const v = rnd(40, 160);
          this.smoke.emit(T, p.x + rnd(-80, 80), p.y + rnd(-20, 30), p.z + rnd(-120, 120), Math.cos(a) * v, rnd(20, 120), Math.sin(a) * v, rnd(3, 6.5), rnd(4, 10), rnd(4, 10), 55, 0.1, 0, CHUNK0, CHUNK1);
        }
        for (let i = 0; i < 160; i++) {
          const v = this._v.set(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(60, 260));
          this.spark.emit(T, p.x, p.y, p.z, v.x, v.y, v.z, rnd(1, 2.4), 3, 1, 45, 0.2, 0.05, SPARK0, SPARK1);
        }
        this.ring(p, p.y, 450, 1.8, new Color(2.2, 1.4, 0.8), false);
        this.ring(p, p.y, 300, 1.2, new Color(2.5, 0.5, 2.0), false);
        this.ring(p, p.y, 380, 1.4, new Color(1.5, 1.5, 2), true);
        // Sea splash column when near the water.
        const sea = waveHeight(p.x, p.z, world.t);
        if (p.y - sea < 400) {
          const y = sea;
          for (let i = 0; i < 90; i++) {
            const a = rnd(0, 6.283);
            const r = rnd(0, 40);
            this.smoke.emit(T, p.x + Math.cos(a) * r, y, p.z + Math.sin(a) * r, Math.cos(a) * rnd(5, 35), rnd(120, 300), Math.sin(a) * rnd(5, 35), rnd(2.5, 4.5), rnd(14, 24), rnd(40, 80), 55, 0.4, 0, WATER0, WATER1);
          }
          for (let i = 0; i < 80; i++) {
            const a = rnd(0, 6.283);
            const v = rnd(60, 220);
            this.smoke.emit(T, p.x, y + 2, p.z, Math.cos(a) * v, rnd(10, 60), Math.sin(a) * v, rnd(1.5, 3), 10, rnd(30, 60), 24, 0.6, 0, WATER0, WATER1);
          }
          this.ring(p, y + 1, 520, 2.2, new Color(1, 1.2, 1.5), false);
        }
        this.shake(1, p, world, 2500);
        break;
      }
      case 'hullHit': {
        const n = e.normal;
        for (let i = 0; i < 26; i++) {
          const v = this._v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(0.7).addScaledVector(n, rnd(0.4, 1.4)).multiplyScalar(rnd(25, 90));
          this.spark.emit(T, e.pos.x, e.pos.y, e.pos.z, v.x, v.y, v.z, rnd(0.3, 0.9), 1.1, 0.3, 30, 0.2, 0.05, SPARK0, SPARK1);
        }
        this.fire.emit(T, e.pos.x, e.pos.y, e.pos.z, 0, 0, 0, 0.15, 8, 14, 0, 1, 0, HOT0, HOT1);
        this.trauma = Math.min(1, this.trauma + clamp(e.impact / 70, 0.1, 0.6));
        break;
      }
      default:
        break;
    }
  }

  update(dt: number, world: World): void {
    this.time += dt;
    const T = this.time;
    const boss = world.boss;
    if (boss && boss.stage !== 'dead') {
      const bv = boss.vel;
      const dying = boss.stage === 'dying';
      // Smoke + fire from destroyed parts.
      this.acc += dt * 16;
      const n = Math.floor(this.acc);
      this.acc -= n;
      if (n > 0) {
        for (const p of boss.parts) {
          if (p.target.hp > 0 || p.target.alive) continue;
          const q = p.target.pos;
          const big = p.role === 'engine' ? 1.6 : 1;
          for (let i = 0; i < n; i++) {
            this.smoke.emit(T, q.x + rnd(-3, 3), q.y + rnd(0, 3), q.z + rnd(-3, 3), bv.x * 0.7 + rnd(-3, 3), rnd(6, 14), bv.z * 0.7 + rnd(-3, 3), rnd(2.5, 4.5), rnd(6, 10) * big, rnd(22, 36) * big, -1, 0.5, 0, SMOKE0, SMOKE1);
            if (i % 2 === 0) this.fire.emit(T, q.x + rnd(-3, 3), q.y + rnd(0, 3), q.z + rnd(-3, 3), bv.x * 0.8, rnd(3, 9), bv.z * 0.8, rnd(0.5, 0.9), rnd(5, 8) * big, 1.5, -4, 0.8, 0, FIRE0, FIRE1);
          }
        }
      }
      // Hull fires scale with rage and the dying sequence.
      const hullRate = boss.rage * boss.rage * 14 + (dying ? 40 : 0);
      this.accHull += hullRate * dt;
      const hn = Math.floor(this.accHull);
      this.accHull -= hn;
      for (let i = 0; i < hn; i++) {
        this._w.set(rnd(-1, 1) * boss.half.x, rnd(0, 1) * boss.half.y, rnd(-1, 1) * boss.half.z).applyQuaternion(boss.quat).add(boss.pos);
        this.smoke.emit(T, this._w.x, this._w.y, this._w.z, bv.x * 0.8 + rnd(-3, 3), rnd(5, 12), bv.z * 0.8 + rnd(-3, 3), rnd(2.5, 5), rnd(6, 12), rnd(26, 50), -1, 0.4, 0, SMOKE0, SMOKE1);
        this.fire.emit(T, this._w.x, this._w.y, this._w.z, bv.x * 0.9, rnd(2, 8), bv.z * 0.9, rnd(0.5, 1), rnd(7, 12), 2, -3, 0.5, 0, FIRE0, FIRE1);
      }
      if (dying) {
        this.accDie += dt * 7;
        const dn = Math.floor(this.accDie);
        this.accDie -= dn;
        for (let i = 0; i < dn; i++) {
          this._w.set(rnd(-1, 1) * boss.half.x, rnd(-1, 1) * boss.half.y, rnd(-1, 1) * boss.half.z).applyQuaternion(boss.quat).add(boss.pos);
          this.blast(this._w, rnd(10, 22), bv, Math.random() < 0.3);
          // Burning debris falling away with a fire trail.
          this.smoke.emit(T, this._w.x, this._w.y, this._w.z, bv.x * 0.4 + rnd(-30, 30), rnd(0, 30), bv.z * 0.4 + rnd(-30, 30), rnd(2, 3.5), 4, 6, 40, 0.1, 0, CHUNK0, CHUNK1);
        }
        // Continuous burning plume along the hull.
        for (let i = 0; i < 3; i++) {
          this._w.set(rnd(-1, 1) * boss.half.x * 0.8, boss.half.y * 0.5, rnd(-1, 1) * boss.half.z).applyQuaternion(boss.quat).add(boss.pos);
          this.fire.emit(T, this._w.x, this._w.y, this._w.z, bv.x * 0.5, rnd(8, 25), bv.z * 0.5, rnd(0.8, 1.4), rnd(14, 24), 4, -6, 0.5, 0, FIRE0, FIRE1);
        }
        this.rumble += dt;
        if (this.rumble > 0.25) {
          this.rumble = 0;
          this.shake(0.22 + 0.2 * clamp(boss.stageTime / 4, 0, 1), boss.pos, world, 1800);
        }
      }
    }
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
      if ((r.mesh.userData as { h?: boolean }).h) r.mesh.quaternion.copy(this.camera.quaternion);
      r.mat.uniforms.uAge!.value = u;
    }
    this.smoke.flush(T);
    this.fire.flush(T);
    this.spark.flush(T);
  }
}
