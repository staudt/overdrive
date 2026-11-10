/**
 * Enemy orbs: a pooled bullet-hell layer. Pattern emitters (aimed bursts, fans, rings, spirals)
 * spawn orbs; stepEnemyBullets moves them, kills them on terrain/water, and tests them against
 * the player with a swept relative-motion check (the player moves fast). Near misses graze for
 * points. Gunner drones fire aimed bursts.
 */
import { Vector3 } from 'three';
import { config } from '../core/config';
import type { Rng } from '../core/rng';
import { damageShield } from './shield';
import type { Dummy, EnemyBullet, ScoreState, ShipState, SimEvent, Terrain } from './types';
import { waveHeight } from './waves';

const POOL = 1500;
const UP = new Vector3(0, 1, 0);
const _d = new Vector3();
const _u = new Vector3();
const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _r = new Vector3();

export interface EnemyFire {
  bullets: EnemyBullet[];
  /** Round-robin cursor so a full pool recycles the oldest-ish orb. */
  cursor: number;
}

export function createEnemyFire(): EnemyFire {
  const bullets: EnemyBullet[] = [];
  for (let i = 0; i < POOL; i++)
    bullets.push({ pos: new Vector3(), vel: new Vector3(), radius: 2, life: 0, alive: false, color: 0, grazed: false });
  return { bullets, cursor: 0 };
}

export function spawnOrb(f: EnemyFire, pos: Vector3, vel: Vector3, radius: number, color: number): void {
  const n = f.bullets.length;
  let b = f.bullets[f.cursor]!;
  for (let i = 0; i < n && b.alive; i++) {
    f.cursor = (f.cursor + 1) % n;
    b = f.bullets[f.cursor]!;
  }
  f.cursor = (f.cursor + 1) % n;
  b.pos.copy(pos);
  b.vel.copy(vel);
  b.radius = radius;
  b.color = color;
  b.life = config.enemyFire.life;
  b.alive = true;
  b.grazed = false;
}

/** Orthonormal u, v perpendicular to unit `dir`. */
function basis(dir: Vector3, u: Vector3, v: Vector3): void {
  u.copy(Math.abs(dir.y) < 0.95 ? UP : _r.set(1, 0, 0)).cross(dir).normalize();
  v.crossVectors(dir, u);
}

/** Lead aim from `from` at a target moving with `tv`, for orbs of `speed`. */
export function leadDir(from: Vector3, tp: Vector3, tv: Vector3, speed: number, out: Vector3): Vector3 {
  let t = tp.distanceTo(from) / speed;
  for (let i = 0; i < 2; i++) t = out.copy(tp).addScaledVector(tv, t).distanceTo(from) / speed;
  return out.copy(tp).addScaledVector(tv, t).sub(from).normalize();
}

/** n orbs in a random cone of half-angle `spread` around `dir`. */
export function aimedBurst(f: EnemyFire, from: Vector3, dir: Vector3, n: number, spread: number, speed: number, radius: number, color: number, rng: Rng): void {
  basis(dir, _u, _v);
  for (let i = 0; i < n; i++) {
    const r = Math.tan(spread * Math.sqrt(rng()));
    const th = rng() * Math.PI * 2;
    _a.copy(dir).addScaledVector(_u, Math.cos(th) * r).addScaledVector(_v, Math.sin(th) * r).normalize();
    spawnOrb(f, from, _a.multiplyScalar(speed * (0.92 + 0.16 * rng())), radius, color);
  }
}

/** A flat fan of n orbs across `arc`, centred on `dir`, swept around `up`. */
export function fan(f: EnemyFire, from: Vector3, dir: Vector3, up: Vector3, n: number, arc: number, speed: number, radius: number, color: number): void {
  for (let i = 0; i < n; i++) {
    const a = n === 1 ? 0 : -arc / 2 + (arc * i) / (n - 1);
    _a.copy(dir).applyAxisAngle(up, a).multiplyScalar(speed);
    spawnOrb(f, from, _a, radius, color);
  }
}

/**
 * A ring of n orbs in the plane that contains `dir` and `up`: from the target's point of view
 * it's a vertical wheel rolling at them (a wall to slip around sideways).
 */
export function ring(f: EnemyFire, from: Vector3, dir: Vector3, up: Vector3, n: number, speed: number, radius: number, color: number): void {
  _u.copy(dir);
  _v.copy(up).addScaledVector(dir, -up.dot(dir)).normalize();
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    _a.copy(_u).multiplyScalar(Math.cos(th)).addScaledVector(_v, Math.sin(th)).multiplyScalar(speed);
    spawnOrb(f, from, _a, radius, color);
  }
}

/** One step of a spiral: `arms` orbs on a cone of half-angle `cone` around `dir`, rotated by `phase`. */
export function spiral(f: EnemyFire, from: Vector3, dir: Vector3, arms: number, cone: number, phase: number, speed: number, radius: number, color: number): void {
  basis(dir, _u, _v);
  for (let k = 0; k < arms; k++) {
    const th = phase + (k / arms) * Math.PI * 2;
    _a.copy(dir)
      .multiplyScalar(Math.cos(cone))
      .addScaledVector(_u, Math.cos(th) * Math.sin(cone))
      .addScaledVector(_v, Math.sin(th) * Math.sin(cone))
      .multiplyScalar(speed);
    spawnOrb(f, from, _a, radius, color);
  }
}

/** Gunner drones: aimed (leading) bursts at the player when in range. */
export function stepGunners(f: EnemyFire, list: Dummy[], ship: ShipState, dt: number, rng: Rng, events: SimEvent[]): void {
  const ef = config.enemyFire;
  for (const u of list) {
    if (!u.alive || u.kind !== 'gunner') continue;
    u.fireTimer -= dt;
    if (u.fireTimer > 0) continue;
    u.fireTimer = ef.gunnerInterval * (0.8 + 0.4 * rng());
    if (ship.dead || u.pos.distanceTo(ship.pos) > ef.gunnerRange) continue;
    leadDir(u.pos, ship.pos, ship.vel, ef.gunnerSpeed, _d);
    aimedBurst(f, u.pos, _d, ef.gunnerBurst, ef.gunnerSpread, ef.gunnerSpeed, 2, 1, rng);
    events.push({ type: 'enemyFire', pos: u.pos.clone(), kind: 'gunner', count: ef.gunnerBurst });
  }
}

/** Squared distance from the origin to segment ab. */
function segOriginDist2(a: Vector3, b: Vector3): number {
  _b.subVectors(b, a);
  const l2 = _b.lengthSq();
  const t = l2 > 1e-9 ? Math.max(0, Math.min(1, -a.dot(_b) / l2)) : 0;
  return _a.copy(a).addScaledVector(_b, t).lengthSq();
}

export function stepEnemyBullets(
  f: EnemyFire,
  ship: ShipState,
  terrain: Terrain,
  score: ScoreState,
  t: number,
  dt: number,
  events: SimEvent[],
): void {
  const ef = config.enemyFire;
  for (const b of f.bullets) {
    if (!b.alive) continue;
    b.life -= dt;
    if (b.life <= 0) {
      b.alive = false;
      continue;
    }
    // Relative motion this step, in the ship's frame (both move fast).
    const ax = b.pos.x - ship.pos.x;
    const ay = b.pos.y - ship.pos.y;
    const az = b.pos.z - ship.pos.z;
    b.pos.addScaledVector(b.vel, dt);
    if (!ship.dead) {
      _u.set(ax, ay, az);
      _v.set(ax + (b.vel.x - ship.vel.x) * dt, ay + (b.vel.y - ship.vel.y) * dt, az + (b.vel.z - ship.vel.z) * dt);
      const d2 = segOriginDist2(_u, _v);
      const hit = ef.hitRadius + b.radius * 0.5;
      if (d2 < hit * hit) {
        b.alive = false;
        damageShield(ship, ef.damage);
        events.push({ type: 'playerHit', pos: b.pos.clone(), damage: ef.damage });
        continue;
      }
      if (!b.grazed && d2 < ef.grazeRadius * ef.grazeRadius) {
        b.grazed = true;
        score.score += ef.grazePoints;
        events.push({ type: 'graze', pos: b.pos.clone(), points: ef.grazePoints });
      }
    }
    if (b.pos.y < 300) {
      const g = Math.max(terrain.heightAt(b.pos.x, b.pos.z), waveHeight(b.pos.x, b.pos.z, t));
      if (b.pos.y < g) b.alive = false;
    }
  }
}
