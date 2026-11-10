import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { forwardOf, setAim } from '../src/sim/flight';
import type { SimEvent } from '../src/sim/types';
import { gunDirection } from '../src/sim/weapons';
import { World } from '../src/sim/world';
import { flatSea, run, v } from './helpers';

/** A world with `n` stationary drones placed by `place(i)`; no waves. */
function range(n: number, place: (i: number) => [number, number, number]) {
  const w = new World(flatSea(), { shipPos: v(0, 200, 0), shipYaw: 0, dummyCount: n, waves: false });
  w.dummies.forEach((u, i) => {
    u.pos.set(...place(i));
    u.home.copy(u.pos);
    u.vel.set(0, 0, 0);
  });
  // Freeze drones in place for deterministic shooting.
  config.dummies.speed = 0;
  return w;
}

const collect = (w: World, into: SimEvent[]) => () => into.push(...w.drainEvents());
const speed0 = config.dummies.speed;
afterEach(() => {
  config.dummies.speed = speed0;
});

describe('gun', () => {
  it('fires at the configured rate while held', () => {
    const w = new World(flatSea(), { shipPos: v(0, 300, 0), shipYaw: 0, dummyCount: 0 });
    const ev: SimEvent[] = [];
    run(w, 1, { fire: true }, collect(w, ev));
    const shots = ev.filter((e) => e.type === 'gunFire').length;
    expect(Math.abs(shots - config.gun.rate)).toBeLessThanOrEqual(1);
  });

  it('aim assist: close aim pulls rounds onto the reticle, far aim leaves them on the nose', () => {
    const w = new World(flatSea(), { shipPos: v(0, 300, 0), shipYaw: 0, dummyCount: 0 });
    const s = w.ship;
    const nose = forwardOf(s.quat, v(0, 0, 0));
    const d = v(0, 0, 0);
    setAim(s, (2 * Math.PI) / 180, 0);
    gunDirection(s, d);
    expect(d.angleTo(forwardOf(s.aim, v(0, 0, 0)))).toBeLessThan(1e-4);
    setAim(s, (15 * Math.PI) / 180, 0);
    gunDirection(s, d);
    expect(d.angleTo(nose)).toBeLessThan(1e-4);
  });

  it('shooting a drone dead ahead damages and kills it, building a chain and score', () => {
    const w = range(1, () => [0, 200, -400]);
    const ev: SimEvent[] = [];
    run(w, 3, { fire: true }, collect(w, ev));
    expect(ev.some((e) => e.type === 'hit' && e.by === 'gun')).toBe(true);
    expect(ev.some((e) => e.type === 'kill')).toBe(true);
    expect(w.score.bestChain).toBeGreaterThan(5);
    expect(w.score.score).toBeGreaterThan(config.score.killPoints);
  });

  it('rounds that miss everything splash into the water', () => {
    const w = new World(flatSea(), { shipPos: v(0, 60, 0), shipYaw: 0, dummyCount: 0 });
    setAim(w.ship, 0, -0.5);
    const ev: SimEvent[] = [];
    run(w, 1, { fire: true }, collect(w, ev));
    expect(ev.some((e) => e.type === 'bulletImpact' && e.surface === 'water')).toBe(true);
  });
});

describe('missiles', () => {
  it('locks drones inside the aim cone only, best first, capped at maxLocks', () => {
    // 12 drones in a fan ahead (inside the cone) and 3 behind.
    const w = range(15, (i) => (i < 12 ? [(i - 6) * 40, 200, -900] : [i * 30, 200, 900]));
    run(w, 0.1);
    const locks = w.weapons.locks;
    expect(locks.length).toBe(config.missiles.maxLocks);
    for (const id of locks) expect(id).toBeLessThan(12);
    // Best first: the drone closest to the aim line (x nearest 0) leads.
    expect(Math.abs(w.dummies[locks[0]!]!.pos.x)).toBeLessThanOrEqual(40);
  });

  it('holding E streams missiles at the stream rate, spreads them over the locks, and kills', () => {
    const w = range(6, (i) => [(i - 2.5) * 60, 200, -800]);
    const ev: SimEvent[] = [];
    run(w, 1, { missile: true }, collect(w, ev));
    const launched = ev.filter((e) => e.type === 'missileLaunch').length;
    expect(Math.abs(launched - config.missiles.streamRate)).toBeLessThanOrEqual(1);
    // Every lock got at least one missile.
    const targets = new Set(w.weapons.missiles.filter((m) => m.alive).map((m) => m.target));
    for (const id of w.weapons.locks) expect(targets.has(id) || !w.dummies[id]!.alive).toBe(true);
    run(w, 4, {}, collect(w, ev));
    const kills = ev.filter((e) => e.type === 'kill' && e.by === 'missile').length;
    expect(kills).toBe(6);
  });

  it('the rack drains while streaming and refills after release', () => {
    const w = new World(flatSea(), { shipPos: v(0, 400, 0), shipYaw: 0, dummyCount: 0 });
    run(w, 2, { missile: true });
    const low = w.weapons.rack;
    expect(low).toBeLessThan(config.missiles.rackMax - 20);
    run(w, 1 + config.missiles.rackMax / config.missiles.refillRate);
    expect(w.weapons.rack).toBe(config.missiles.rackMax);
  });

  it('a stream stops when the rack is empty', () => {
    const w = new World(flatSea(), { shipPos: v(0, 400, 0), shipYaw: 0, dummyCount: 0 });
    const ev: SimEvent[] = [];
    run(w, 6, { missile: true }, collect(w, ev));
    expect(ev.filter((e) => e.type === 'missileLaunch').length).toBe(config.missiles.rackMax);
    expect(w.weapons.streaming).toBe(false);
  });

  it('unlocked missiles fly dumb and blow up on the water', () => {
    const w = new World(flatSea(), { shipPos: v(0, 80, 0), shipYaw: 0, dummyCount: 0 });
    setAim(w.ship, 0, -0.6);
    run(w, 0.4);
    const ev: SimEvent[] = [];
    run(w, 3, { missile: true }, collect(w, ev));
    expect(ev.some((e) => e.type === 'missileExplode' && e.surface === 'water')).toBe(true);
  });
});

describe('chain and waves', () => {
  it('the chain drops after the window with no hits', () => {
    const w = range(1, () => [0, 200, -300]);
    const ev: SimEvent[] = [];
    run(w, 0.3, { fire: true }, collect(w, ev));
    expect(w.score.chain).toBeGreaterThan(0);
    run(w, config.score.chainWindow + config.gun.life + 0.2, {}, collect(w, ev));
    expect(w.score.chain).toBe(0);
    expect(ev.some((e) => e.type === 'chainEnd')).toBe(true);
  });

  it('a new, bigger wave arrives ahead when most of the current one is dead', () => {
    const w = new World(flatSea(), { shipPos: v(0, 200, 0), shipYaw: 0, waves: true });
    expect(w.score.wave).toBe(1);
    const first = w.dummies.filter((u) => u.alive).length;
    expect(first).toBe(config.dummies.waveSize);
    for (const u of w.dummies) u.alive = false;
    w.drainEvents();
    const ev: SimEvent[] = [];
    run(w, 0.05, {}, collect(w, ev));
    expect(w.score.wave).toBe(2);
    const wave = ev.find((e) => e.type === 'waveStart');
    expect(wave && wave.type === 'waveStart' && wave.count).toBe(config.dummies.waveSize + config.dummies.waveGrowth);
    // Ahead of the ship (ship faces -Z).
    expect(wave && wave.type === 'waveStart' && wave.center.z).toBeLessThan(-500);
  });
});
