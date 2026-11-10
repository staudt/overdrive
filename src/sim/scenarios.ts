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
  'low-water': () => ({ world: { shipPos: new Vector3(0, 7, 600), shipYaw: 0, shipSpeed: 95 } }),
  'canyon-run': (t) => {
    const [a, b] = t.canyonPath;
    const [x0, z0] = a!;
    const [x1, z1] = b!;
    const y = Math.max(0, t.heightAt(x0, z0)) + 35;
    return { world: { shipPos: new Vector3(x0, y, z0), shipYaw: yawToward(x0, z0, x1, z1), dummyCount: 0 } };
  },
  'stall-test': () => ({ world: { shipPos: new Vector3(0, 300, 600), shipYaw: 0 }, hold: { brake: true } }),
  'dive-test': () => ({ world: { shipPos: new Vector3(0, 90, 600), shipYaw: 0, shipPitch: -0.7, shipSpeed: 90 } }),
  dummies: () => ({
    world: { shipPos: new Vector3(0, 140, 700), shipYaw: 0, dummyCount: 16, dummyCenter: new Vector3(0, 0, 0) },
  }),
};

export function getScenario(name: string, t: Terrain): Scenario {
  return (scenarios[name] ?? scenarios.default!)(t);
}
