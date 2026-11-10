/**
 * Target drones. They arrive in waves ahead of the player, loiter in lazy circles around their
 * wave's center, and die to guns, missiles and ramming. Ramming never costs player shield.
 */
import { Quaternion, Vector3 } from 'three';
import { config } from '../core/config';
import type { Rng } from '../core/rng';
import { damageDummy } from './combat';
import type { Dummy, ScoreState, ShipState, SimEvent } from './types';

const UP = new Vector3(0, 1, 0);
const FWD = new Vector3(0, 0, -1);
const _n = new Vector3();
const _m = new Vector3();

export function makeDummy(id: number): Dummy {
  return {
    id,
    pos: new Vector3(),
    vel: new Vector3(),
    quat: new Quaternion(),
    hp: 0,
    alive: false,
    respawnTimer: 0,
    hitFlash: 99,
    home: new Vector3(),
  };
}

/** (Re)spawn a drone somewhere around `center`. */
export function placeDummy(u: Dummy, center: Vector3, spread: number, rng: Rng): void {
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * spread;
  u.home.copy(center);
  u.pos.set(center.x + Math.cos(a) * r, 60 + rng() * 200, center.z + Math.sin(a) * r);
  const heading = rng() * Math.PI * 2;
  u.vel.set(Math.cos(heading), 0, Math.sin(heading)).multiplyScalar(config.dummies.speed);
  u.quat.setFromUnitVectors(FWD, _n.copy(u.vel).normalize());
  u.hp = config.dummies.hp;
  u.alive = true;
  u.hitFlash = 99;
}

/**
 * Spawn a wave of `count` drones centered `waveDist` ahead of the ship (horizontal heading),
 * reusing dead slots and growing the list up to maxDummies. Returns the wave center.
 */
export function spawnWave(list: Dummy[], ship: ShipState, count: number, rng: Rng): Vector3 {
  const d = config.dummies;
  _m.copy(ship.vel).setY(0);
  if (_m.lengthSq() < 1) _m.set(0, 0, -1).applyQuaternion(ship.quat).setY(0);
  if (_m.lengthSq() < 1e-6) _m.set(0, 0, -1);
  _m.normalize();
  const dist = d.waveDistMin + rng() * (d.waveDistMax - d.waveDistMin);
  const center = new Vector3(ship.pos.x + _m.x * dist, 0, ship.pos.z + _m.z * dist);
  let placed = 0;
  for (const u of list) {
    if (placed >= count) break;
    if (u.alive) continue;
    placeDummy(u, center, d.waveSpread, rng);
    placed++;
  }
  while (placed < count && list.length < d.maxDummies) {
    const u = makeDummy(list.length);
    list.push(u);
    placeDummy(u, center, d.waveSpread, rng);
    placed++;
  }
  return center;
}

export function stepDummies(list: Dummy[], dt: number, t: number): void {
  const d = config.dummies;
  for (const u of list) {
    u.hitFlash += dt;
    if (!u.alive) continue;
    // Lazy circling with a gentle bob; leashed to home; knockback decays back to cruise speed.
    _m.copy(u.vel).setY(0);
    _n.subVectors(u.home, u.pos).setY(0);
    const far = _n.length() > d.leash;
    let turn = 0.25 + 0.1 * Math.sin(u.id * 1.7);
    if (far) {
      // Turn toward home (sign from the cross product's y).
      const cross = _m.x * _n.z - _m.z * _n.x;
      turn = cross < 0 ? 0.6 : -0.6;
    }
    _m.applyAxisAngle(UP, turn * dt);
    const sp = _m.length();
    _m.multiplyScalar((sp + (d.speed - sp) * (1 - Math.exp(-1.5 * dt))) / Math.max(sp, 1e-3));
    u.vel.x = _m.x;
    u.vel.z = _m.z;
    u.vel.y += (Math.sin(t * 0.5 + u.id) * 3 - u.vel.y) * (1 - Math.exp(-2 * dt));
    if (u.pos.y < 30) u.vel.y += 20 * dt;
    u.pos.addScaledVector(u.vel, dt);
    _n.copy(u.vel).normalize();
    u.quat.setFromUnitVectors(FWD, _n);
  }
}

/** Ramming: hurts the drone, never the player's shield (per design). Returns true on any contact. */
export function collideDummies(s: ShipState, list: Dummy[], score: ScoreState, events: SimEvent[]): boolean {
  const c = config.combat;
  let any = false;
  for (const u of list) {
    if (!u.alive) continue;
    const r = c.shipRadius + config.dummies.radius;
    _n.subVectors(u.pos, s.pos);
    const dist = _n.length();
    if (dist >= r || dist < 1e-4) continue;
    _n.divideScalar(dist);
    const closing = _m.subVectors(s.vel, u.vel).dot(_n);
    u.pos.addScaledVector(_n, r - dist + 0.1);
    if (closing <= 0) continue;
    u.vel.addScaledVector(_n, c.ramPush + closing * 0.6);
    s.vel.addScaledVector(_n, -closing * 0.25);
    const killed = damageDummy(score, u, closing * c.ramDamagePerMps, 'ram', events);
    events.push({ type: 'ram', pos: u.pos.clone(), dummyId: u.id, impact: closing, killed });
    any = true;
  }
  return any;
}
