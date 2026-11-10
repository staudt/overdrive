/**
 * Luftrausers water. A dive steeper than minDiveAngle goes under: you slow down, a stiff spring
 * turns you around, and you're launched back out at the mirrored angle with your entry speed
 * (the aim flips up with you). A shallower contact skims: the ship rides the surface.
 * Water never deals damage.
 */
import { Euler, Quaternion, Vector3 } from 'three';
import { config } from '../core/config';
import { forwardOf } from './flight';
import type { ShipState, SimEvent } from './types';
import { waveHeight } from './waves';

const _f = new Vector3();
const _h = new Vector3();
const _q = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');

/** Angle below horizontal of a direction (positive = descending). */
const descent = (v: Vector3) => Math.asin(Math.max(-1, Math.min(1, -v.y / Math.max(v.length(), 1e-6))));

/** Apply water contact for one step. Call after stepFlight, before integration. */
export function stepWater(s: ShipState, dt: number, t: number, events: SimEvent[]): void {
  const w = config.water;
  const surface = waveHeight(s.pos.x, s.pos.z, t);
  s.depth = surface - s.pos.y;
  const wasSkimming = s.skimming;
  s.skimming = false;

  if (!s.submerged) {
    if (s.depth <= -w.hoverHeight) {
      // Just above the ride height (waves dropping away): still skimming, no clamp.
      s.skimming = wasSkimming && s.depth > -w.hoverHeight - w.skimGrace;
      return;
    }
    // Touching the surface: dive or skim?
    const speed = s.vel.length();
    const velAngle = speed > 1 ? descent(s.vel) : 0;
    const noseAngle = descent(forwardOf(s.quat, _f));
    // Dive only on a decent descent. While riding the surface the velocity is held flat, so
    // there the nose decides (pitch down past the same angle to break through).
    const angle = wasSkimming ? Math.max(velAngle, noseAngle) : velAngle;
    if (angle > w.minDiveAngle && (s.vel.y < 0 || s.stalled || wasSkimming)) {
      s.submerged = true;
      s.diveSpeed = speed;
      s.diveAngle = Math.max(w.minDiveAngle, angle);
      const vy = Math.max(1, -s.vel.y, Math.sin(angle) * speed);
      if (s.vel.y > -vy) s.vel.y = -vy; // breaking through from a skim: go in at the nose angle
      s.diveAccel = Math.max(w.riseAccel, (vy * vy) / (2 * w.maxDepth));
      // Aim target: same heading, mirrored pitch.
      _h.copy(s.vel).setY(0);
      if (_h.lengthSq() < 1e-6) _h.copy(_f).setY(0);
      if (_h.lengthSq() < 1e-6) _h.set(0, 0, -1);
      _e.set(s.diveAngle, Math.atan2(-_h.x, -_h.z), 0);
      s.diveAim.setFromEuler(_e);
      events.push({ type: 'waterEnter', pos: s.pos.clone(), speed });
    } else {
      // Skim: ride the surface, never sink below it.
      s.skimming = true;
      s.pos.y = surface + w.hoverHeight;
      s.depth = -w.hoverHeight;
      if (s.vel.y < 0) s.vel.y = 0;
      return;
    }
  }

  // Underwater: constant push back up, drag horizontally, flip the aim toward the exit angle.
  s.vel.y += s.diveAccel * dt;
  const k = Math.exp(-w.drag * dt);
  s.vel.x *= k;
  s.vel.z *= k;
  s.aim.slerp(s.diveAim, 1 - Math.exp(-w.aimFlipRate * dt));

  if (s.vel.y > 0 && s.depth < 0) {
    // Launch: mirrored entry angle, current heading, entry speed.
    s.submerged = false;
    _h.copy(s.vel).setY(0);
    if (_h.lengthSq() < 1e-6) _h.copy(forwardOf(s.quat, _f)).setY(0);
    if (_h.lengthSq() < 1e-6) _h.set(0, 0, -1);
    _h.normalize();
    const sp = s.diveSpeed * w.exitSpeedMul;
    s.vel.copy(_h).multiplyScalar(Math.cos(s.diveAngle) * sp);
    s.vel.y = Math.sin(s.diveAngle) * sp;
    // Point the nose along the launch.
    forwardOf(s.quat, _f);
    _q.setFromUnitVectors(_f, _h.copy(s.vel).normalize());
    s.quat.premultiply(_q);
    s.aim.copy(s.diveAim);
    events.push({ type: 'waterExit', pos: s.pos.clone(), speed: sp });
  }
}
