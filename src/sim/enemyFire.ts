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
import type { Dummy, EnemyBullet, ScoreState, ShipState, SimEvent, Sweep, Terrain, TurretKind } from './types';
import { waveHeight } from './waves';

const POOL = 1500;
const UP = new Vector3(0, 1, 0);
const _d = new Vector3();
const _u = new Vector3();
const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _r = new Vector3();
const _mid = new Vector3();

export interface EnemyFire {
  bullets: EnemyBullet[];
  /** Round-robin cursor so a full pool recycles the oldest-ish orb. */
  cursor: number;
}

export function createEnemyFire(): EnemyFire {
  const bullets: EnemyBullet[] = [];
  for (let i = 0; i < POOL; i++)
    bullets.push({ pos: new Vector3(), vel: new Vector3(), radius: 2, life: 0, alive: false, color: 0, grazed: false, damage: 0 });
  return { bullets, cursor: 0 };
}

export function spawnOrb(f: EnemyFire, pos: Vector3, vel: Vector3, radius: number, color: number, damage = config.enemyFire.damage): void {
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
  b.damage = damage;
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

export const makeSweep = (): Sweep => ({ active: false, p0: new Vector3(), p1: new Vector3(), t: 0, dur: 1, acc: 0 });

/**
 * Begin a machine-gun sweep from `from`: the aim will walk a straight, world-fixed line through
 * the player's predicted position (mid-sweep, including round flight time), from sweepHalf on one
 * side to sweepHalf past. Usually the line runs along the player's own motion, so flying straight
 * doesn't escape it; otherwise it crosses it at a random angle.
 */
export function startSweep(sw: Sweep, from: Vector3, ship: ShipState, rng: Rng, events: SimEvent[]): void {
  const ef = config.enemyFire;
  const flight = from.distanceTo(ship.pos) / ef.sweepSpeed;
  const mid = _mid.copy(ship.pos).addScaledVector(ship.vel, ef.sweepTime * 0.5 + flight);
  const los = _d.subVectors(mid, from).normalize();
  const along = rng() < ef.sweepAlongShare && ship.vel.lengthSq() > 25;
  if (along) _b.copy(ship.vel).normalize();
  else _b.set(rng() - 0.5, (rng() - 0.5) * 0.5, rng() - 0.5);
  _b.addScaledVector(los, -_b.dot(los));
  if (_b.lengthSq() < 1e-6) basis(los, _b, _v);
  _b.normalize();
  // Along the player's path the stream starts behind and overtakes (walks up your tail and past
  // you); across it, either direction.
  const sign = along ? 1 : rng() < 0.5 ? -1 : 1;
  sw.p0.copy(mid).addScaledVector(_b, -sign * ef.sweepHalf);
  sw.p1.copy(mid).addScaledVector(_b, sign * ef.sweepHalf);
  sw.t = 0;
  sw.dur = ef.sweepTime;
  sw.acc = 1; // first round right away
  sw.active = true;
  events.push({ type: 'sweepStart', from: from.clone(), p0: sw.p0.clone(), p1: sw.p1.clone(), duration: sw.dur });
}

/** Fire the rounds a sweep owes this step. */
export function stepSweep(f: EnemyFire, sw: Sweep, from: Vector3, kind: 'gunner' | TurretKind, rng: Rng, dt: number, events: SimEvent[]): void {
  if (!sw.active) return;
  const ef = config.enemyFire;
  sw.t += dt;
  sw.acc += dt * ef.sweepRate;
  while (sw.acc >= 1) {
    sw.acc -= 1;
    const u = Math.min(1, sw.t / sw.dur);
    _a.lerpVectors(sw.p0, sw.p1, u).sub(from).normalize();
    jitterDir(_a, ef.sweepSpread, rng);
    spawnOrb(f, from, _a.multiplyScalar(ef.sweepSpeed), ef.sweepRadius, 4, ef.sweepDamage);
    events.push({ type: 'enemyFire', pos: from.clone(), kind, count: 1 });
  }
  if (sw.t >= sw.dur) sw.active = false;
}

function jitterDir(dir: Vector3, cone: number, rng: Rng): void {
  basis(dir, _u, _v);
  const r = Math.tan(cone * Math.sqrt(rng()));
  const th = rng() * Math.PI * 2;
  dir.addScaledVector(_u, Math.cos(th) * r).addScaledVector(_v, Math.sin(th) * r).normalize();
}

/** Gunner drones: machine-gun sweeps (mostly) or aimed orb bursts, when in range. */
export function stepGunners(f: EnemyFire, list: Dummy[], ship: ShipState, dt: number, rng: Rng, events: SimEvent[]): void {
  const ef = config.enemyFire;
  for (const u of list) {
    if (!u.alive || u.kind !== 'gunner') {
      if (u.sweep) u.sweep.active = false;
      continue;
    }
    if (u.sweep?.active) {
      if (ship.dead) u.sweep.active = false;
      else stepSweep(f, u.sweep, u.pos, 'gatling', rng, dt, events);
      continue;
    }
    u.fireTimer -= dt;
    if (u.fireTimer > 0) continue;
    u.fireTimer = ef.gunnerInterval * (0.8 + 0.4 * rng());
    if (ship.dead || u.pos.distanceTo(ship.pos) > ef.gunnerRange) continue;
    if (rng() < ef.sweepShare) {
      u.sweep ??= makeSweep();
      startSweep(u.sweep, u.pos, ship, rng, events);
      continue;
    }
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
        damageShield(ship, b.damage);
        events.push({ type: 'playerHit', pos: b.pos.clone(), damage: b.damage });
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
