/**
 * Mission area: an invisible circle around the islands. Heading out near the edge raises a
 * warning; past the edge a soft turn rotates the aim (and so the ship) back toward the center,
 * ramping to full over areaSoftBand; beyond that, outward velocity is removed (a wall).
 */
import { Quaternion, Vector3 } from 'three';
import { config } from '../core/config';
import { forwardOf } from './flight';
import type { ShipState, Terrain } from './types';

export interface MissionArea {
  center: Vector3;
  radius: number;
}

const UP = new Vector3(0, 1, 0);
const _f = new Vector3();
const _in = new Vector3();
const _q = new Quaternion();

/** Smallest-ish circle around every island (bounding box center, max reach) plus margin. */
export function missionArea(t: Terrain): MissionArea {
  if (t.islands.length === 0) return { center: new Vector3(), radius: t.halfSize };
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, z, r] of t.islands) {
    x0 = Math.min(x0, x - r);
    x1 = Math.max(x1, x + r);
    z0 = Math.min(z0, z - r);
    z1 = Math.max(z1, z + r);
  }
  const center = new Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
  let radius = 0;
  for (const [x, z, r] of t.islands) radius = Math.max(radius, Math.hypot(x - center.x, z - center.z) + r);
  return { center, radius: radius + config.world.areaMargin };
}

/** Clamp a horizontal point into `frac` of the area radius (for spawn centers). */
export function clampToArea(a: MissionArea, p: Vector3, frac: number): Vector3 {
  const dx = p.x - a.center.x;
  const dz = p.z - a.center.z;
  const d = Math.hypot(dx, dz);
  const max = a.radius * frac;
  if (d > max) {
    p.x = a.center.x + (dx / d) * max;
    p.z = a.center.z + (dz / d) * max;
  }
  return p;
}

export function stepBounds(s: ShipState, a: MissionArea, dt: number): void {
  const w = config.world;
  const dx = s.pos.x - a.center.x;
  const dz = s.pos.z - a.center.z;
  const d = Math.hypot(dx, dz);
  if (d < 1) {
    s.areaWarning = false;
    return;
  }
  _in.set(-dx / d, 0, -dz / d); // inward
  const outward = -(s.vel.x * _in.x + s.vel.z * _in.z);
  s.areaWarning = d > a.radius || (d > a.radius - w.areaWarnInset && outward > 0);
  if (d <= a.radius) return;

  // Soft turn: yaw the aim toward the center, harder the further out.
  const k = Math.min(1, (d - a.radius) / w.areaSoftBand);
  forwardOf(s.aim, _f).setY(0);
  if (_f.lengthSq() > 1e-6) {
    _f.normalize();
    const ang = Math.atan2(_f.x * _in.z - _f.z * _in.x, _f.dot(_in)); // signed, about -Y
    const step = Math.min(Math.abs(ang), (0.25 + 0.75 * k) * w.areaTurnRate * dt);
    s.aim.premultiply(_q.setFromAxisAngle(UP, -Math.sign(ang) * step)).normalize();
  }
  // Wall: past the band, no more outward motion.
  if (d > a.radius + w.areaSoftBand && outward > 0) {
    s.vel.x += _in.x * outward;
    s.vel.z += _in.z * outward;
  }
}
