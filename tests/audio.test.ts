import { describe, expect, it } from 'vitest';
import {
  brakeTearLevel,
  engineLevel,
  engineWhineHz,
  impactScale,
  muffleHz,
  windLevel,
} from '../src/audio/mapping';

describe('audio mapping', () => {
  it('whine rises with speed', () => {
    expect(engineWhineHz(300, 2, 300)).toBeGreaterThan(engineWhineHz(70, 0, 300));
  });
  it('engine is ducked on hold and quiet in free fall', () => {
    const cruise = engineLevel(0, 70, 0, false, 300);
    expect(engineLevel(-1, 0, 0.5, false, 300)).toBeLessThan(0.05);
    expect(engineLevel(0, 70, 0, true, 300)).toBeLessThan(cruise / 2);
  });
  it('wind dominates in free fall and rises with speed', () => {
    expect(windLevel(100, true, 300)).toBeGreaterThan(windLevel(100, false, 300));
    expect(windLevel(200, true, 300)).toBeGreaterThan(windLevel(50, true, 300));
  });
  it('brake tear decays with speed', () => {
    expect(brakeTearLevel(0, 300)).toBe(0);
    expect(brakeTearLevel(100, 300)).toBeGreaterThan(brakeTearLevel(20, 300));
  });
  it('clamps and muffle', () => {
    expect(impactScale(1000)).toBe(1);
    expect(muffleHz(true)).toBe(400);
    expect(muffleHz(false)).toBeGreaterThan(10000);
  });
});
