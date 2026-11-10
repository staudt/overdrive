/**
 * Procedural world: open ocean, a scatter of islands (beach, grass, rocky peaks) and one big
 * mesa landmass cut by a winding flooded canyon. Pure sim code (three math + core/noise only).
 * Material ids: 0 seabed, 1 sand, 2 grass, 3 rock, 4 canyon strata.
 */
import { Vector3 } from 'three';
import { config } from '../core/config';
import { Simplex3, fbm, ridged } from '../core/noise';
import type { Terrain } from './types';

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** [x, z, radius, peak height, rockiness 0..1] */
const ISLAND_DEFS: [number, number, number, number, number][] = [
  [-420, -150, 260, 70, 0.2],
  [380, -380, 200, 45, 0.1],
  [-250, -720, 330, 160, 0.8],
  [150, -1120, 170, 120, 0.9],
  [-1150, -300, 300, 60, 0.3],
  [1350, 250, 230, 50, 0.2],
  [-800, 950, 210, 40, 0.1],
  [950, 1350, 270, 190, 0.85],
  [-1350, -1450, 240, 90, 0.4],
];

const MESA = { x: 800, z: -1100, r: 600, top: 165 };

/** Canyon control points [x, z, half width], entry first (south mouth, in open water), winding north through the mesa. */
const CANYON_CTRL: [number, number, number][] = [
  [770, -400, 52],
  [750, -540, 55],
  [830, -690, 42],
  [700, -840, 36],
  [610, -980, 50],
  [730, -1120, 58],
  [890, -1230, 38],
  [820, -1370, 46],
  [680, -1500, 55],
  [720, -1650, 48],
  [740, -1820, 50],
];

export function createTerrain(seed = config.world.seed): Terrain {
  const halfSize = config.world.halfSize;
  const cell = config.world.cell;
  const seabed = config.world.seabed;
  const n = Math.floor((2 * halfSize) / cell) + 1;
  const heights = new Float32Array(n * n);
  const material = new Uint8Array(n * n);
  const sx = new Simplex3(seed);
  const sy = new Simplex3(seed ^ 0x9e3779b1);

  // Seabed: gentle swells.
  for (let j = 0; j < n; j++) {
    const z = -halfSize + j * cell;
    for (let i = 0; i < n; i++) {
      const x = -halfSize + i * cell;
      heights[j * n + i] = seabed + 8 * sy.noise(x * 0.002, 0.5, z * 0.002);
    }
  }

  const islands: [number, number, number][] = [];
  const cellRange = (c: number, r: number): [number, number] => [
    Math.max(0, Math.floor((c - r + halfSize) / cell)),
    Math.min(n - 1, Math.ceil((c + r + halfSize) / cell)),
  ];

  // Islands.
  ISLAND_DEFS.forEach(([cx, cz, R, H, rock], idx) => {
    islands.push([cx, cz, R]);
    const reach = R * 1.9;
    const [i0, i1] = cellRange(cx, reach);
    const [j0, j1] = cellRange(cz, reach);
    const off = idx * 17.3;
    for (let j = j0; j <= j1; j++) {
      const z = -halfSize + j * cell;
      for (let i = i0; i <= i1; i++) {
        const x = -halfSize + i * cell;
        const dx = x - cx;
        const dz = z - cz;
        // Warped radius for organic outlines.
        const ang = fbm(sx, dx * 0.004 + off, 1.7, dz * 0.004, 3);
        const d = Math.hypot(dx, dz) / (R * (1 + 0.35 * ang));
        let h: number;
        if (d >= 1) {
          const dm = (d - 1) * R;
          h = -dm * 0.22;
          if (h < -40) continue;
        } else {
          const t = 1 - d;
          const lump = fbm(sx, dx * 0.012 + off, 3.3, dz * 0.012, 4);
          const ridge = ridged(sy, dx * 0.008 + off, 2.2, dz * 0.008, 4);
          h = 2.5 * smooth(0, 0.12, t) + H * Math.pow(t, 1.4) * (1 + 0.3 * lump);
          h += H * rock * 0.55 * ridge * smooth(0.1, 0.6, t) * t;
          h += 3 * lump * smooth(0.05, 0.3, t);
        }
        const k = j * n + i;
        if (h > heights[k]!) heights[k] = h;
      }
    }
  });

  // Mesa with terraced walls.
  islands.push([MESA.x, MESA.z, MESA.r]);
  const mesaMask = new Uint8Array(n * n);
  {
    const reach = MESA.r * 1.9;
    const [i0, i1] = cellRange(MESA.x, reach);
    const [j0, j1] = cellRange(MESA.z, reach);
    for (let j = j0; j <= j1; j++) {
      const z = -halfSize + j * cell;
      for (let i = i0; i <= i1; i++) {
        const x = -halfSize + i * cell;
        const dx = x - MESA.x;
        const dz = z - MESA.z;
        const len = Math.hypot(dx, dz) + 1e-6;
        const ux = dx / len;
        const uz = dz / len;
        const rr = MESA.r * (1 + 0.24 * sx.noise(ux * 1.3 + 9, 0.3, uz * 1.3) + 0.09 * sx.noise(ux * 3.7, 5.1, uz * 3.7));
        const rough = 14 * fbm(sy, x * 0.02, 8.8, z * 0.02, 3);
        const d = (len + rough) / rr;
        const k = j * n + i;
        let h: number;
        if (d >= 1) {
          h = -(d - 1) * rr * 0.25;
          if (h < -40) continue;
        } else {
          const e = 1 - d;
          const topNoise = 10 * fbm(sx, x * 0.006, 4.4, z * 0.006, 4);
          const tableTop = MESA.top + topNoise;
          h = tableTop * smooth(0, 0.085, e);
          if (h > 6) {
            const step = 15;
            const q = h / step;
            const f = q - Math.floor(q);
            const terr = (Math.floor(q) + smooth(0.55, 1, f)) * step;
            h = h * 0.25 + terr * 0.75;
          }
          mesaMask[k] = 1;
        }
        if (h > heights[k]!) heights[k] = h;
      }
    }
  }

  // Canyon: Catmull-Rom spline, dense samples with per-sample half width.
  const canyonPath: [number, number][] = [];
  const dense: [number, number, number][] = [];
  const cp = (a: number, b: number, c: number, d: number, t: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  for (let s = 0; s < CANYON_CTRL.length - 1; s++) {
    const p0 = CANYON_CTRL[Math.max(0, s - 1)]!;
    const p1 = CANYON_CTRL[s]!;
    const p2 = CANYON_CTRL[s + 1]!;
    const p3 = CANYON_CTRL[Math.min(CANYON_CTRL.length - 1, s + 2)]!;
    const steps = 20;
    for (let q = 0; q < steps; q++) {
      const t = q / steps;
      const px = cp(p0[0], p1[0], p2[0], p3[0], t);
      const pz = cp(p0[1], p1[1], p2[1], p3[1], t);
      const hw = cp(p0[2], p1[2], p2[2], p3[2], t);
      dense.push([px, pz, hw]);
      if (q % 4 === 0) canyonPath.push([px, pz]);
    }
  }
  const last = CANYON_CTRL[CANYON_CTRL.length - 1]!;
  dense.push([last[0], last[1], last[2]]);
  canyonPath.push([last[0], last[1]]);

  const WALL = 10;
  const canyonK = new Float32Array(n * n);
  for (const [px, pz, hw] of dense) {
    const reach = hw + WALL + 6;
    const [i0, i1] = cellRange(px, reach);
    const [j0, j1] = cellRange(pz, reach);
    for (let j = j0; j <= j1; j++) {
      const z = -halfSize + j * cell;
      for (let i = i0; i <= i1; i++) {
        const x = -halfSize + i * cell;
        const k = j * n + i;
        const wob = 5 * sx.noise(x * 0.05, 1.1, z * 0.05);
        const d = Math.hypot(x - px, z - pz) + wob;
        const kk = 1 - smooth(hw, hw + WALL, d);
        if (kk > canyonK[k]!) canyonK[k] = kk;
      }
    }
  }
  for (let k = 0; k < n * n; k++) {
    const ck = canyonK[k]!;
    if (ck <= 0) continue;
    const h = heights[k]!;
    const floor = -14 + 3 * sy.noise((k % n) * 0.05, 2, Math.floor(k / n) * 0.05);
    if (h > floor) heights[k] = h + (floor - h) * ck;
  }

  // Material pass (slope + height rules, mesa/canyon strata).
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const k = j * n + i;
      const h = heights[k]!;
      if (h < 0) {
        material[k] = canyonK[k]! > 0 ? 4 : 0;
        continue;
      }
      const gx = (heights[k + 1]! - heights[k - 1]!) / (2 * cell);
      const gz = (heights[k + n]! - heights[k - n]!) / (2 * cell);
      const slope = Math.hypot(gx, gz);
      if (mesaMask[k] || canyonK[k]! > 0) {
        material[k] = slope < 0.25 && h > MESA.top - 30 && canyonK[k]! <= 0 ? 3 : 4;
      } else if (h < 5) material[k] = 1;
      else if (slope > 0.85 || h > 95) material[k] = 3;
      else material[k] = 2;
    }
  }

  const heightAt = (x: number, z: number): number => {
    const fx = (x + halfSize) / cell;
    const fz = (z + halfSize) / cell;
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return seabed;
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

  return { heightAt, normalAt, halfSize, cell, n, heights, material, canyonPath, islands };
}
