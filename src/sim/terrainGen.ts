/**
 * STUB (owned by the world-visuals agent): procedural islands + canyon mesa heightfield.
 * Current stub: open sea with one round test island at (0, -900) and a wall ridge, so
 * collision tests and scenarios have something to hit.
 */
import { Vector3 } from 'three';
import { config } from '../core/config';
import type { Terrain } from './types';

export function createTerrain(seed = config.world.seed): Terrain {
  void seed;
  const halfSize = config.world.halfSize;
  const cell = config.world.cell;
  const n = Math.floor((2 * halfSize) / cell) + 1;
  const heights = new Float32Array(n * n);
  const material = new Uint8Array(n * n);
  const raw = (x: number, z: number) => {
    const d = Math.hypot(x, z + 900);
    const island = 120 * Math.max(0, 1 - (d / 300) ** 2);
    return Math.max(config.world.seabed, island - 40);
  };
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const h = raw(-halfSize + i * cell, -halfSize + j * cell);
      heights[j * n + i] = h;
      material[j * n + i] = h < 0 ? 0 : h < 6 ? 1 : 2;
    }
  const heightAt = (x: number, z: number): number => {
    const fx = (x + halfSize) / cell;
    const fz = (z + halfSize) / cell;
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return config.world.seabed;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const a = heights[j * n + i]!;
    const b = heights[j * n + i + 1]!;
    const c = heights[(j + 1) * n + i]!;
    const d = heights[(j + 1) * n + i + 1]!;
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
  const normalAt = (x: number, z: number, out: Vector3): Vector3 => {
    const e = cell * 0.5;
    const dx = heightAt(x + e, z) - heightAt(x - e, z);
    const dz = heightAt(x, z + e) - heightAt(x, z - e);
    return out.set(-dx, 2 * e, -dz).normalize();
  };
  return {
    heightAt,
    normalAt,
    halfSize,
    cell,
    n,
    heights,
    material,
    canyonPath: [
      [0, -400],
      [0, -1400],
    ],
    islands: [[0, -900, 300]],
  };
}
