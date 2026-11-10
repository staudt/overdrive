/** Luftrausers-style auto-healing shield. */
import { config } from '../core/config';
import type { ShipState } from './types';

export function damageShield(s: ShipState, amount: number): void {
  if (amount <= 0) return;
  s.shield = Math.max(0, s.shield - amount);
  s.shieldDelay = config.combat.regenDelay;
}

export function stepShield(s: ShipState, dt: number): void {
  const c = config.combat;
  if (s.shieldDelay > 0) s.shieldDelay -= dt;
  else s.shield = Math.min(c.shieldMax, s.shield + c.regenPerSec * dt);
}
