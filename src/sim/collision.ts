/**
 * Swept ship-vs-heightfield collision. Bounce + shield damage, never instant death.
 * The segment from the previous to the new position is sampled at <= half the ship radius,
 * so boost speed cannot tunnel through thin canyon ridges.
 */
import { Vector3 } from 'three';
import { config } from '../core/config';
import { damageShield } from './shield';
import type { ShipState, SimEvent, Terrain } from './types';

const _a = new Vector3();
const _b = new Vector3();
const _p = new Vector3();
const _n = new Vector3();

const clearance = (t: Terrain, p: Vector3) => p.y - config.combat.shipRadius - t.heightAt(p.x, p.z);

/** Resolve terrain contact for a ship that moved from prev to s.pos this step. */
export function collideTerrain(s: ShipState, prev: Vector3, terrain: Terrain, events: SimEvent[]): void {
  const c = config.combat;
  const len = prev.distanceTo(s.pos);
  const steps = Math.max(1, Math.ceil(len / (c.shipRadius * 0.5)));
  _a.copy(prev);
  if (clearance(terrain, _a) < 0) {
    // Started inside (e.g. terrain edited live): pop straight up.
    _a.y = terrain.heightAt(_a.x, _a.z) + c.shipRadius + 0.05;
  }
  let hit = false;
  for (let i = 1; i <= steps; i++) {
    _b.lerpVectors(prev, s.pos, i / steps);
    if (clearance(terrain, _b) < 0) {
      hit = true;
      break;
    }
    _a.copy(_b);
  }
  if (!hit) return;

  // Refine the contact between the last safe point (_a) and the first penetrating point (_b).
  for (let k = 0; k < 6; k++) {
    _p.lerpVectors(_a, _b, 0.5);
    if (clearance(terrain, _p) < 0) _b.copy(_p);
    else _a.copy(_p);
  }
  terrain.normalAt(_b.x, _b.z, _n);
  s.pos.copy(_a);

  const vn = s.vel.dot(_n);
  if (vn < 0) {
    const impact = -vn;
    // Split into normal and tangential parts: reflect the normal, keep most of the tangent.
    const tangent = _p.copy(s.vel).addScaledVector(_n, -vn).multiplyScalar(c.terrainFriction);
    s.vel.copy(tangent).addScaledVector(_n, impact * c.terrainRestitution);
    damageShield(s, impact * c.terrainDamagePerMps);
    events.push({ type: 'terrainHit', pos: _b.clone(), normal: _n.clone(), impact });
  }
  // Make sure we're not left resting inside a slope.
  const cl = clearance(terrain, s.pos);
  if (cl < 0) s.pos.y -= cl - 0.05;
}
