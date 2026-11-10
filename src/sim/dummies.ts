/** Slow target drones for M1: wander in lazy circles, take ram damage, respawn. */
import { Quaternion, Vector3 } from 'three';
import { config } from '../core/config';
import type { Rng } from '../core/rng';
import type { Dummy, ShipState, SimEvent } from './types';

const UP = new Vector3(0, 1, 0);
const _n = new Vector3();
const _m = new Vector3();

export function spawnDummy(id: number, center: Vector3, rng: Rng): Dummy {
  const a = rng() * Math.PI * 2;
  const r = 150 + rng() * 500;
  const pos = new Vector3(center.x + Math.cos(a) * r, 60 + rng() * 160, center.z + Math.sin(a) * r);
  const heading = rng() * Math.PI * 2;
  const vel = new Vector3(Math.cos(heading), 0, Math.sin(heading)).multiplyScalar(config.dummies.speed);
  return { id, pos, vel, quat: new Quaternion(), hp: config.dummies.hp, alive: true, respawnTimer: 0, hitFlash: 99 };
}

export function stepDummies(list: Dummy[], center: Vector3, dt: number, t: number, rng: Rng): void {
  const d = config.dummies;
  for (const u of list) {
    u.hitFlash += dt;
    if (!u.alive) {
      u.respawnTimer -= dt;
      if (u.respawnTimer <= 0) Object.assign(u, spawnDummy(u.id, center, rng));
      continue;
    }
    // Lazy circling with a gentle bob; knockback decays back to cruise speed.
    _m.copy(u.vel).setY(0);
    const turn = 0.25 + 0.1 * Math.sin(u.id * 1.7);
    _m.applyAxisAngle(UP, turn * dt);
    const sp = _m.length();
    _m.multiplyScalar((sp + (d.speed - sp) * (1 - Math.exp(-1.5 * dt))) / Math.max(sp, 1e-3));
    u.vel.x = _m.x;
    u.vel.z = _m.z;
    u.vel.y += (Math.sin(t * 0.5 + u.id) * 3 - u.vel.y) * (1 - Math.exp(-2 * dt));
    if (u.pos.y < 30) u.vel.y += 20 * dt;
    u.pos.addScaledVector(u.vel, dt);
    _n.copy(u.vel).normalize();
    u.quat.setFromUnitVectors(new Vector3(0, 0, -1), _n);
  }
}

/** Ramming: hurts the dummy, never the player's shield (per design). */
export function collideDummies(s: ShipState, list: Dummy[], events: SimEvent[]): boolean {
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
    // Separate.
    u.pos.addScaledVector(_n, r - dist + 0.1);
    if (closing <= 0) continue;
    u.hp -= closing * c.ramDamagePerMps;
    u.hitFlash = 0;
    u.vel.addScaledVector(_n, c.ramPush + closing * 0.6);
    s.vel.addScaledVector(_n, -closing * 0.25);
    const killed = u.hp <= 0;
    if (killed) {
      u.alive = false;
      u.respawnTimer = config.dummies.respawnTime;
    }
    events.push({ type: 'ram', pos: u.pos.clone(), dummyId: u.id, impact: closing, killed });
    any = true;
  }
  return any;
}

