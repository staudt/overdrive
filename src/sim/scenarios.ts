/** Start presets, chosen with ?scenario=name. Placements are data; they may use terrain hints. */
import { Vector3 } from 'three';
import type { InputFrame, Terrain } from './types';
import type { WorldOptions } from './world';

export interface Scenario {
  world: WorldOptions;
  /** Input held for the whole run (smoke tests / demos). */
  hold?: Partial<InputFrame>;
}

/** Yaw that faces from (x0,z0) toward (x1,z1). */
export const yawToward = (x0: number, z0: number, x1: number, z1: number) => Math.atan2(-(x1 - x0), -(z1 - z0));

export const scenarios: Record<string, (t: Terrain) => Scenario> = {
  default: () => ({ world: { shipPos: new Vector3(0, 120, 600), shipYaw: 0 } }),
  'low-water': () => ({ world: { shipPos: new Vector3(0, 2.5, 600), shipYaw: 0, shipSpeed: 95, shipPitch: -0.08 } }),
  'canyon-run': (t) => {
    const [a, b] = t.canyonPath;
    const [x0, z0] = a!;
    const [x1, z1] = b!;
    // Start 300 m out to sea before the mouth, lined up with the first canyon leg.
    const len = Math.hypot(x1 - x0, z1 - z0) || 1;
    const sx = x0 - ((x1 - x0) / len) * 300;
    const sz = z0 - ((z1 - z0) / len) * 300;
    const y = Math.max(0, t.heightAt(sx, sz)) + 30;
    return { world: { shipPos: new Vector3(sx, y, sz), shipYaw: yawToward(sx, sz, x1, z1), dummyCount: 0 } };
  },
  'stall-test': () => ({ world: { shipPos: new Vector3(0, 300, 600), shipYaw: 0 }, hold: { brake: true } }),
  'dive-test': () => ({ world: { shipPos: new Vector3(0, 90, 600), shipYaw: 0, shipPitch: -0.7, shipSpeed: 90 } }),
  boss: () => ({ world: { shipPos: new Vector3(0, 230, 900), shipYaw: 0, dummyCount: 6, waves: true, boss: 'fight' } }),
  dummies: () => ({
    world: { shipPos: new Vector3(0, 140, 700), shipYaw: 0, waves: true },
  }),
};

export function getScenario(name: string, t: Terrain): Scenario {
  return (scenarios[name] ?? scenarios.default!)(t);
}
