/**
 * Luftrausers water: diving in costs speed but a damped buoyancy spring catapults you back out.
 * Water never deals damage.
 */
import { config } from '../core/config';
import type { ShipState, SimEvent } from './types';
import { waveHeight } from './waves';

/** Apply water forces for one step. Call after stepFlight, before integration. */
export function stepWater(s: ShipState, dt: number, t: number, events: SimEvent[]): void {
  const w = config.water;
  const surface = waveHeight(s.pos.x, s.pos.z, t);
  s.depth = surface - s.pos.y;
  const wasSubmerged = s.submerged;
  if (!s.submerged && s.depth > w.enterDepth) {
    s.submerged = true;
    events.push({ type: 'waterEnter', pos: s.pos.clone(), speed: s.vel.length() });
  } else if (s.submerged && s.depth < 0) {
    s.submerged = false;
    if (s.vel.y > 0) s.vel.y *= w.exitKick;
    events.push({ type: 'waterExit', pos: s.pos.clone(), speed: s.vel.length() });
  }
  if (s.submerged || (wasSubmerged && s.depth > 0)) {
    const d = Math.max(0, s.depth);
    s.vel.y += (w.buoyancyK * d - w.damping * s.vel.y) * dt;
    const k = Math.exp(-w.drag * dt);
    s.vel.x *= k;
    s.vel.z *= k;
  }
}
