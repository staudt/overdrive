/**
 * Swept ship-vs-heightfield collision. Bounce + shield damage, never instant death.
 * The center sphere is swept from the previous to the new position (sampled at <= half the
 * ship radius, so boost speed cannot tunnel through ridges), then a nose probe keeps the
 * nose out of slopes. Every hit guarantees a minimum push-off speed, clears a stall and
 * starts a short recovery where the nose follows the rebound, so the ship can't get stuck.
 */
import { Vector3 } from 'three';
import { config } from '../core/config';
import { forwardOf } from './flight';
import { damageShield } from './shield';
import type { ShipState, SimEvent, Terrain } from './types';

const _a = new Vector3();
const _b = new Vector3();
const _p = new Vector3();
const _n = new Vector3();
const _f = new Vector3();
const _t = new Vector3();

const clearance = (t: Terrain, p: Vector3, r: number) => p.y - r - t.heightAt(p.x, p.z);

/** Reflect velocity off normal n, damage the shield, emit the event. */
function bounce(s: ShipState, n: Vector3, at: Vector3, events: SimEvent[]): void {
  const c = config.combat;
  const vn = s.vel.dot(n);
  const impact = Math.max(0, -vn);
  _t.copy(s.vel).addScaledVector(n, -vn).multiplyScalar(c.terrainFriction);
  s.vel.copy(_t).addScaledVector(n, Math.max(impact * c.terrainRestitution, c.minBounce));
  s.bounceTimer = c.bounceRecovery;
  s.stalled = false;
  s.stallTimer = 0;
  if (impact > 0.5) {
    // The seabed just turns a dive around; it never costs shield.
    if (!s.submerged) damageShield(s, impact * c.terrainDamagePerMps);
    events.push({ type: 'terrainHit', pos: at.clone(), normal: n.clone(), impact });
  }
}

/** Resolve terrain contact for a ship that moved from prev to s.pos this step. */
export function collideTerrain(s: ShipState, prev: Vector3, terrain: Terrain, events: SimEvent[]): void {
  const c = config.combat;
  const r = c.shipRadius;
  const len = prev.distanceTo(s.pos);
  const steps = Math.max(1, Math.ceil(len / (r * 0.5)));
  _a.copy(prev);
  if (clearance(terrain, _a, r) < 0) _a.y = terrain.heightAt(_a.x, _a.z) + r + 0.05;
  let hit = false;
  for (let i = 1; i <= steps; i++) {
    _b.lerpVectors(prev, s.pos, i / steps);
    if (clearance(terrain, _b, r) < 0) {
      hit = true;
      break;
    }
    _a.copy(_b);
  }
  if (hit) {
    // Refine between the last safe point (_a) and the first penetrating point (_b).
    for (let k = 0; k < 6; k++) {
      _p.lerpVectors(_a, _b, 0.5);
      if (clearance(terrain, _p, r) < 0) _b.copy(_p);
      else _a.copy(_p);
    }
    terrain.normalAt(_b.x, _b.z, _n);
    s.pos.copy(_a);
    if (s.vel.dot(_n) < c.minBounce) bounce(s, _n, _b, events);
  }

  // Nose probe: push the whole ship out along the surface normal at the nose.
  _p.copy(s.pos).addScaledVector(forwardOf(s.quat, _f), c.noseLength);
  const pen = -clearance(terrain, _p, c.noseRadius);
  if (pen > 0) {
    terrain.normalAt(_p.x, _p.z, _n);
    // Vertical penetration depth along a tilted normal: move enough to clear it.
    s.pos.addScaledVector(_n, Math.min(pen * Math.max(_n.y, 0.2), 1.5) + 0.05);
    if (s.vel.dot(_n) < c.minBounce) bounce(s, _n, _p, events);
  }

  // Never left resting inside a slope.
  const cl = clearance(terrain, s.pos, r);
  if (cl < 0) s.pos.y -= cl - 0.05;
}
