import { describe, expect, it } from 'vitest';
import { createTerrain } from '../src/sim/terrainGen';

describe('terrainGen', () => {
  const t0 = performance.now();
  const a = createTerrain(1337);
  const ms = performance.now() - t0;

  it('generates quickly', () => expect(ms).toBeLessThan(1500));

  it('is deterministic per seed', () => {
    const b = createTerrain(1337);
    expect(b.heights).toEqual(a.heights);
    expect(b.material).toEqual(a.material);
    const c = createTerrain(7);
    expect(c.heights).not.toEqual(a.heights);
  });

  it('has a flooded canyon', () => {
    expect(a.canyonPath.length).toBeGreaterThan(10);
    for (const [x, z] of a.canyonPath) expect(a.heightAt(x, z)).toBeLessThan(0);
  });

  it('keeps the spawn in open water and has land', () => {
    for (let dx = -150; dx <= 150; dx += 30) for (let dz = -150; dz <= 150; dz += 30) expect(a.heightAt(dx, 600 + dz)).toBeLessThan(-3);
    expect(a.heights.reduce((m, h) => Math.max(m, h), -1e9)).toBeGreaterThan(140);
    expect(a.islands.length).toBeGreaterThanOrEqual(7);
  });
});
