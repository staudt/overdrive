import { Vector3 } from 'three';
import { emptyInput, type InputFrame, type Terrain } from '../src/sim/types';
import type { World } from '../src/sim/world';

/** Analytic terrain for tests (heights from a function, normals by central differences). */
export function fnTerrain(h: (x: number, z: number) => number): Terrain {
  return {
    heightAt: h,
    normalAt: (x, z, out) => {
      const e = 1;
      return out.set(-(h(x + e, z) - h(x - e, z)), 2 * e, -(h(x, z + e) - h(x, z - e))).normalize();
    },
    halfSize: 2048,
    cell: 4,
    n: 0,
    heights: new Float32Array(0),
    material: new Uint8Array(0),
    canyonPath: [
      [0, 0],
      [0, -100],
    ],
    islands: [],
  };
}

export const flatSea = () => fnTerrain(() => -60);

export const DT = 1 / 120;

/** Run the world for `seconds` with input from `inp` (object or per-step function). */
export function run(
  w: World,
  seconds: number,
  inp: Partial<InputFrame> | ((t: number) => Partial<InputFrame>) = {},
  each?: (t: number) => void,
): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    w.step({ ...emptyInput(), ...(typeof inp === 'function' ? inp(t) : inp) }, DT);
    each?.(t);
  }
}

export const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
