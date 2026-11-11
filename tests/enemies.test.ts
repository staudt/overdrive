import { describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { fan, ring, spawnOrb } from '../src/sim/enemyFire';
import { setAim } from '../src/sim/flight';
import { BOSS_PART_ID0, type SimEvent } from '../src/sim/types';
import { World } from '../src/sim/world';
import { flatSea, run, v } from './helpers';

const quiet = (pos = v(0, 300, 0), speed?: number) =>
  new World(flatSea(), { shipPos: pos, shipYaw: 0, dummyCount: 0, shipSpeed: speed });
const drain = (w: World, into: SimEvent[]) => () => into.push(...w.drainEvents());

describe('enemy orbs', () => {
  it('an orb flying into the ship hits it and drains the shield', () => {
    const w = quiet();
    spawnOrb(w.enemyFire, v(0, 300, -200), v(0, 0, 100), 2, 0);
    const ev: SimEvent[] = [];
    run(w, 2, {}, drain(w, ev));
    expect(ev.some((e) => e.type === 'playerHit')).toBe(true);
    expect(w.ship.shield).toBeLessThan(config.combat.shieldMax);
  });

  it('a near miss grazes for points without damage', () => {
    const w = quiet();
    // Passes 6 m to the side of the ship's path.
    spawnOrb(w.enemyFire, v(6, 300, -200), v(0, 0, 100), 2, 0);
    const ev: SimEvent[] = [];
    run(w, 2, {}, drain(w, ev));
    expect(ev.some((e) => e.type === 'graze')).toBe(true);
    expect(ev.some((e) => e.type === 'playerHit')).toBe(false);
    expect(w.score.score).toBe(config.enemyFire.grazePoints);
  });

  it('a boosting ship cannot tunnel through a slow orb', () => {
    const w = quiet(v(0, 300, 0), 300);
    spawnOrb(w.enemyFire, v(0, 300, -150), v(0, 0, 0), 2, 0);
    const ev: SimEvent[] = [];
    run(w, 1, { boost: true }, drain(w, ev));
    expect(ev.some((e) => e.type === 'playerHit')).toBe(true);
  });

  it('orbs die on the water', () => {
    const w = quiet();
    spawnOrb(w.enemyFire, v(500, 20, 500), v(0, -50, 0), 2, 0);
    run(w, 1);
    expect(w.enemyFire.bullets.some((b) => b.alive)).toBe(false);
  });

  it('pattern emitters: ring and fan make the requested orbs at the requested speed', () => {
    const w = quiet();
    ring(w.enemyFire, v(0, 0, 0), v(0, 0, -1), v(0, 1, 0), 24, 90, 3, 0);
    fan(w.enemyFire, v(0, 0, 0), v(0, 0, -1), v(0, 1, 0), 9, 1, 80, 2, 1);
    const live = w.enemyFire.bullets.filter((b) => b.alive);
    expect(live.length).toBe(33);
    expect(live.filter((b) => Math.abs(b.vel.length() - 90) < 1e-6).length).toBe(24);
    expect(live.filter((b) => b.color === 1).every((b) => Math.abs(b.vel.y) < 1e-6)).toBe(true);
  });
});

describe('gunners and death', () => {
  it('gunner drones fire aimed bursts only within range', () => {
    const share = config.enemyFire.sweepShare;
    config.enemyFire.sweepShare = 0;
    const w = new World(flatSea(), { shipPos: v(0, 300, 0), shipYaw: 0, dummyCount: 2, waves: false });
    const [near, far] = w.dummies;
    near!.kind = far!.kind = 'gunner';
    near!.pos.set(0, 300, -500);
    far!.pos.set(0, 300, -3000);
    near!.fireTimer = far!.fireTimer = 0.1;
    const ev: SimEvent[] = [];
    run(w, 0.5, {}, drain(w, ev));
    const fire = ev.filter((e) => e.type === 'enemyFire');
    expect(fire.length).toBe(1);
    expect(fire[0]!.type === 'enemyFire' && fire[0]!.pos.z).toBeCloseTo(-500, -2);
    config.enemyFire.sweepShare = share;
  });

  /** A gunner 600 m ahead-left opens a machine-gun sweep on a ship crossing at cruise. */
  const sweepRun = (dodge: boolean) => {
    const ef = config.enemyFire;
    const saved = [ef.sweepShare, ef.sweepAlongShare];
    ef.sweepShare = 1;
    ef.sweepAlongShare = 1; // the line runs along the ship's path
    const w = new World(flatSea(), { shipPos: v(0, 300, 0), shipYaw: -Math.PI / 2, dummyCount: 1, waves: false });
    const g = w.dummies[0]!;
    g.kind = 'gunner';
    g.pos.set(0, 300, -600);
    g.fireTimer = 0.01;
    w.ship.shield = 1e9;
    w.ship.shieldDelay = 1e9;
    let start: SimEvent | undefined;
    let hits = 0;
    let rounds = 0;
    run(w, 3, () => {
      g.vel.set(0, 0, 0);
      g.home.copy(g.pos);
      // Dodge: once the sweep is called, pull up hard off the line.
      if (dodge && start) setAim(w.ship, -Math.PI / 2, 1.2);
      return dodge && start ? { boost: true } : {};
    }, () => {
      for (const e of w.drainEvents()) {
        if (e.type === 'sweepStart' && !start) start = e;
        if (e.type === 'playerHit') hits++;
        if (e.type === 'enemyFire') rounds++;
      }
    });
    [ef.sweepShare, ef.sweepAlongShare] = saved;
    return { start, hits, rounds };
  };

  it('a machine-gun sweep walks a line from one side of the ship, through it, and past it', () => {
    const { start, hits, rounds } = sweepRun(false);
    expect(start).toBeTruthy();
    if (start?.type !== 'sweepStart') return;
    expect(start.p0.distanceTo(start.p1)).toBeCloseTo(2 * config.enemyFire.sweepHalf, 0);
    expect(rounds).toBeGreaterThan(config.enemyFire.sweepRate * config.enemyFire.sweepTime * 0.8);
    expect(hits).toBeGreaterThan(0); // flying straight along the line gets you hit
  });

  it('getting off the line once you see the tracers coming avoids most of the sweep', () => {
    const stay = sweepRun(false);
    const dodge = sweepRun(true);
    expect(dodge.hits).toBeLessThan(stay.hits / 2);
  });

  it('shield at zero kills the run: ship stops flying, one death event', () => {
    const w = quiet();
    w.ship.shield = 5;
    w.ship.shieldDelay = 99; // no regen before the orb lands
    spawnOrb(w.enemyFire, v(0, 300, -100), v(0, 0, 100), 2, 0);
    const ev: SimEvent[] = [];
    run(w, 1.5, { throttle: true, fire: true }, drain(w, ev));
    expect(w.ship.dead).toBe(true);
    expect(ev.filter((e) => e.type === 'playerDeath').length).toBe(1);
    const p = w.ship.pos.clone();
    const shots = w.weapons.bullets.filter((b) => b.alive).length;
    run(w, 1, { throttle: true, fire: true });
    expect(w.ship.pos.distanceTo(p)).toBe(0);
    expect(w.weapons.bullets.filter((b) => b.alive).length).toBeLessThanOrEqual(shots);
  });
});

describe('battleship', () => {
  const bossWorld = () => new World(flatSea(), { shipPos: v(0, 230, 0), shipYaw: 0, dummyCount: 0, boss: true });

  it('arrives, settles into its orbit, and opens fire when the player is in range', () => {
    const w = bossWorld();
    const ev: SimEvent[] = [];
    let t = 0;
    while (w.boss!.stage === 'arriving' && t < 90) {
      run(w, 0.5, {}, drain(w, ev));
      t += 0.5;
    }
    expect(w.boss!.stage).toBe('fight');
    expect(ev.some((e) => e.type === 'bossWarning')).toBe(true);
    expect(ev.some((e) => e.type === 'bossArrive')).toBe(true);
    // Park the player near it and let the turrets work.
    w.ship.pos.copy(w.boss!.pos).add(v(0, 120, 300));
    w.ship.shield = 1e9;
    run(w, 4, {}, drain(w, ev));
    const kinds = new Set(ev.filter((e) => e.type === 'enemyFire').map((e) => (e.type === 'enemyFire' ? e.kind : '')));
    for (const k of ['flak', 'spiral', 'ring', 'fan']) expect(kinds.has(k as never)).toBe(true);
  });

  it('missiles can lock its parts', () => {
    const w = bossWorld();
    const b = w.boss!;
    w.ship.pos.copy(b.pos).addScaledVector(v(0, 0, -1).applyQuaternion(b.quat), -500).add(v(0, 60, 0));
    const to = b.pos.clone().sub(w.ship.pos);
    setAim(w.ship, Math.atan2(-to.x, -to.z), Math.atan2(to.y, Math.hypot(to.x, to.z)));
    run(w, 0.1);
    expect(w.weapons.locks.some((id) => id >= BOSS_PART_ID0)).toBe(true);
  });

  it('killing the engines exposes the core; killing the core sinks the ship for big points', () => {
    const w = bossWorld();
    const b = w.boss!;
    const ev: SimEvent[] = [];
    const core = b.parts.find((p) => p.role === 'core')!;
    expect(core.target.alive).toBe(false);
    for (const p of b.parts) {
      if (p.role !== 'engine') continue;
      p.target.hp = 0;
      p.target.alive = false;
    }
    run(w, 0.1, {}, drain(w, ev));
    expect(core.target.alive).toBe(true);
    expect(ev.some((e) => e.type === 'bossPartDestroyed' && e.coreExposed)).toBe(true);
    core.target.hp = 0;
    core.target.alive = false;
    run(w, 0.1, {}, drain(w, ev));
    expect(b.stage).toBe('dying');
    const before = w.score.score;
    run(w, config.boss.dyingTime + 1, {}, drain(w, ev));
    expect(b.stage).toBe('dead');
    expect(ev.some((e) => e.type === 'bossDeath')).toBe(true);
    expect(w.score.score).toBeGreaterThanOrEqual(before + config.boss.killPoints);
  });

  it('flying into the hull bounces off it (never ends up inside) and costs shield', () => {
    const w = bossWorld();
    const b = w.boss!;
    // Come at the broadside from 150 m out, at speed.
    const side = v(1, 0, 0).applyQuaternion(b.quat);
    w.ship.pos.copy(b.pos).addScaledVector(side, 150);
    const to = side.clone().negate();
    setAim(w.ship, Math.atan2(-to.x, -to.z), 0);
    w.ship.quat.setFromUnitVectors(v(0, 0, -1), to);
    w.ship.vel.copy(to).multiplyScalar(150);
    w.ship.shield = 1e9;
    const ev: SimEvent[] = [];
    run(w, 1.5, () => (setAim(w.ship, Math.atan2(-to.x, -to.z), 0), {}), () => {
      ev.push(...w.drainEvents());
      const local = w.ship.pos.clone().sub(b.pos).applyQuaternion(b.quat.clone().invert());
      const inside = Math.abs(local.x) < b.half.x && Math.abs(local.y) < b.half.y && Math.abs(local.z) < b.half.z;
      expect(inside).toBe(false);
    });
    expect(ev.some((e) => e.type === 'hullHit')).toBe(true);
  });

  it('arrives with the configured wave', () => {
    const w = new World(flatSea(), { shipPos: v(0, 230, 0), shipYaw: 0, waves: true });
    const ev: SimEvent[] = [];
    for (let i = 0; i < 6 && !w.boss; i++) {
      for (const u of w.dummies) u.alive = false;
      run(w, 0.05, {}, drain(w, ev));
    }
    expect(w.boss).not.toBeNull();
    expect(w.score.wave).toBe(config.boss.firstWave);
  });
});

