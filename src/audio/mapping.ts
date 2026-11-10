/** Pure parameter mappings for the audio engine (no Web Audio, unit-tested). */

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Normalized speed 0..1 over the boost range. */
export function speedNorm(speed: number, boostSpeed: number): number {
  return clamp01(speed / Math.max(1, boostSpeed));
}

/** Engine whine frequency, Hz. Rises with speed; throttle adds a bit. */
export function engineWhineHz(speed: number, throttleState: number, boostSpeed: number): number {
  const t = speedNorm(speed, boostSpeed);
  const thr = throttleState === 2 ? 60 : throttleState === 1 ? 30 : throttleState === -1 ? -40 : 0;
  return 110 + 330 * t + thr;
}

/** Engine noise-roar lowpass cutoff, Hz. */
export function engineRoarHz(speed: number, throttleState: number, boostSpeed: number): number {
  const t = speedNorm(speed, boostSpeed);
  const thr = throttleState >= 1 ? 500 : 0;
  return 300 + 2200 * t + thr;
}

/** Engine level 0..1: ducked while hanging on the brakes, quiet in free fall. */
export function engineLevel(
  throttleState: number,
  speed: number,
  holdTimer: number,
  stalled: boolean,
  boostSpeed: number,
): number {
  if (holdTimer > 0) return 0.02;
  if (stalled) return 0.12;
  const base = throttleState === -1 ? 0.35 : throttleState === 0 ? 0.5 : throttleState === 1 ? 0.75 : 0.9;
  return base * (0.6 + 0.4 * speedNorm(speed, boostSpeed));
}

/** Wind level 0..1. In free fall it dominates and rises with fall speed. */
export function windLevel(speed: number, stalled: boolean, boostSpeed: number): number {
  const t = speedNorm(speed, boostSpeed);
  if (stalled) return clamp01(0.5 + 0.9 * t);
  return 0.5 * t * t;
}

/** Wind band-pass centre, Hz. */
export function windHz(speed: number, boostSpeed: number): number {
  return 350 + 2600 * speedNorm(speed, boostSpeed);
}

/** Level of the water-skim spray hiss. */
export function skimLevel(speed: number, boostSpeed: number): number {
  return clamp01(0.25 + 0.9 * speedNorm(speed, boostSpeed));
}

/** Airbrake air-tear level: scales with how fast the ship still is. */
export function brakeTearLevel(speed: number, boostSpeed: number): number {
  return clamp01(speed / Math.max(1, boostSpeed * 0.5));
}

/** One-shot impact scale 0..1 (impact speed in m/s). */
export function impactScale(impact: number): number {
  return clamp01(impact / 60);
}

/** Muffling lowpass cutoff, Hz. */
export function muffleHz(submerged: boolean): number {
  return submerged ? 400 : 20000;
}
