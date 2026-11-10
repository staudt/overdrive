import { describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { setAim } from '../src/sim/flight';
import { World } from '../src/sim/world';
import { flatSea, fnTerrain, run, v } from './helpers';

const heading = (w: World) => Math.atan2(w.ship.vel.x, w.ship.vel.z);
const unwrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

describe('stall', () => {
  it('holding S stalls the ship and it falls; diving recovers', () => {
    const w = new World(flatSea(), { shipPos: v(0, 400, 0), shipYaw: 0, dummyCount: 0 });
    run(w, 3, { brake: true });
    expect(w.ship.stalled).toBe(true);
    const y0 = w.ship.pos.y;
    run(w, 0.5, { brake: true });
    expect(w.ship.pos.y).toBeLessThan(y0 - 3);
    setAim(w.ship, 0, -1.2);
    run(w, 4);
    expect(w.ship.stalled).toBe(false);
  });

  it('does not stall at cruise', () => {
    const w = new World(flatSea(), { shipPos: v(0, 300, 0), shipYaw: 0, dummyCount: 0 });
    run(w, 5);
    expect(w.ship.stalled).toBe(false);
    expect(Math.abs(w.ship.pos.y - 300)).toBeLessThan(15);
  });
});

describe('water spring', () => {
  it('a dive is catapulted back out with upward speed, never too deep', () => {
    const w = new World(flatSea(), { shipPos: v(0, 3, 0), shipYaw: 0, dummyCount: 0, shipSpeed: 80 });
    w.ship.vel.set(0, -40, -69.3);
    setAim(w.ship, 0, -0.52);
    w.ship.quat.setFromAxisAngle(v(1, 0, 0), -0.52);
    let entered = false;
    let maxDepth = 0;
    let exitT = -1;
    let exitVy = 0;
    run(w, 3, {}, (t) => {
      if (w.ship.submerged) {
        entered = true;
        setAim(w.ship, 0, 0); // pilot pulls up once under
      }
      maxDepth = Math.max(maxDepth, w.ship.depth);
      if (entered && !w.ship.submerged && exitT < 0) {
        exitT = t;
        exitVy = w.ship.vel.y;
      }
    });
    expect(entered).toBe(true);
    expect(maxDepth).toBeLessThan(20);
    expect(maxDepth).toBeGreaterThan(2);
    expect(exitT).toBeGreaterThan(0);
    expect(exitT).toBeLessThan(2);
    expect(exitVy).toBeGreaterThan(10);
  });
});

describe('dive mirror bounce', () => {
  const dive = (deg: number, speed: number) => {
    const w = new World(flatSea(), { shipPos: v(0, 8, 0), shipYaw: 0, dummyCount: 0, shipSpeed: speed });
    const a = (deg * Math.PI) / 180;
    w.ship.vel.set(0, -Math.sin(a) * speed, -Math.cos(a) * speed);
    setAim(w.ship, 0, -a);
    w.ship.quat.setFromAxisAngle(v(1, 0, 0), -a);
    let enter: { speed: number; angle: number } | null = null;
    let exit: { speed: number; angle: number } | null = null;
    let maxDepth = 0;
    run(w, 3, {}, () => {
      maxDepth = Math.max(maxDepth, w.ship.depth);
      for (const e of w.drainEvents()) {
        const sp = w.ship.vel.length();
        if (e.type === 'waterEnter' && !enter) enter = { speed: sp, angle: Math.asin(-w.ship.vel.y / sp) };
        if (e.type === 'waterExit' && !exit) exit = { speed: sp, angle: Math.asin(w.ship.vel.y / sp) };
      }
    });
    return { enter: enter!, exit: exit!, maxDepth, w };
  };

  it('45° dive exits at 45° up with the entry speed', () => {
    const { enter, exit, maxDepth } = dive(45, 100);
    expect(enter).toBeTruthy();
    expect(exit).toBeTruthy();
    expect(maxDepth).toBeGreaterThan(3);
    expect(maxDepth).toBeLessThan(config.water.maxDepth + 5);
    expect(Math.abs(exit.angle - enter.angle)).toBeLessThan(0.05);
    expect(Math.abs(exit.speed - enter.speed) / enter.speed).toBeLessThan(0.03);
  });

  it('the aim flips up with the launch, so the ship keeps climbing', () => {
    const { w } = dive(45, 100);
    expect(w.ship.pos.y).toBeGreaterThan(40);
  });

  it('a boosted vertical dive stays above maxDepth and comes back up', () => {
    const { exit, maxDepth } = dive(85, 300);
    expect(exit).toBeTruthy();
    expect(maxDepth).toBeLessThan(config.water.maxDepth + 5);
  });

  it('a shallow contact skims the surface instead of diving', () => {
    const w = new World(flatSea(), { shipPos: v(0, 3, 0), shipYaw: 0, dummyCount: 0, shipSpeed: 90 });
    const a = (5 * Math.PI) / 180;
    w.ship.vel.set(0, -Math.sin(a) * 90, -Math.cos(a) * 90);
    setAim(w.ship, 0, -a);
    w.ship.quat.setFromAxisAngle(v(1, 0, 0), -a);
    let skimmed = false;
    run(w, 2, {}, () => {
      expect(w.ship.submerged).toBe(false);
      expect(w.ship.depth).toBeLessThan(-config.water.hoverHeight + 0.01);
      if (w.ship.skimming) skimmed = true;
    });
    expect(skimmed).toBe(true);
  });
});

describe('terrain collision', () => {
  it('a stalled ship falling nose-first into a hillside never gets stuck', () => {
    // 35° slope rising toward -Z.
    const hill = fnTerrain((_x, z) => Math.max(-60, -z * 0.7));
    const w = new World(hill, { shipPos: v(0, 160, -200), shipYaw: 0, dummyCount: 0, shipSpeed: 10 });
    w.ship.stalled = true;
    const pos = v(0, 0, 0);
    run(w, 4, (t) => {
      if (t > 3) pos.copy(w.ship.pos);
      setAim(w.ship, 0, -1.3); // player keeps aiming into the hill
      return { brake: true };
    });
    const p3 = pos.clone();
    run(w, 1, () => (setAim(w.ship, 0, -1.3), { brake: true }));
    expect(w.ship.pos.distanceTo(p3)).toBeGreaterThan(8); // still moving, not pinned
    const nose = v(0, 0, -config.combat.noseLength).applyQuaternion(w.ship.quat).add(w.ship.pos);
    expect(nose.y).toBeGreaterThan(hill.heightAt(nose.x, nose.z));
  });

  it('a boosted head-on wall hit bounces back without tunnelling and costs shield', () => {
    const wall = fnTerrain((_x, z) => (z < -100 ? 300 : -60));
    const w = new World(wall, { shipPos: v(0, 50, 0), shipYaw: 0, dummyCount: 0, shipSpeed: 190 });
    let hits = 0;
    run(w, 1.2, { boost: true }, () => {
      for (const e of w.drainEvents()) if (e.type === 'terrainHit') hits++;
      expect(w.ship.pos.z).toBeGreaterThan(-100);
    });
    expect(hits).toBeGreaterThan(0);
    expect(w.ship.shield).toBeLessThan(config.combat.shieldMax);
  });

  it('reflects velocity outward on impact', () => {
    const wall = fnTerrain((_x, z) => (z < -100 ? 300 : -60));
    const w = new World(wall, { shipPos: v(0, 50, -80), shipYaw: 0, dummyCount: 0, shipSpeed: 150 });
    let vzAfter = -1;
    run(w, 0.3, {}, () => {
      for (const e of w.drainEvents()) if (e.type === 'terrainHit' && vzAfter < 0) vzAfter = w.ship.vel.z;
    });
    expect(vzAfter).toBeGreaterThan(0);
  });
});

describe('turning', () => {
  /** Horizontal turn radius while chasing an aim held far to the left. */
  const radius = (inp: { brake?: boolean; boost?: boolean }, warm: number, measure: number) => {
    const w = new World(flatSea(), { shipPos: v(0, 500, 0), shipYaw: 0, dummyCount: 0 });
    const turnInput = () => {
      setAim(w.ship, Math.atan2(-w.ship.vel.x, -w.ship.vel.z) + 1.2, 0);
      return inp;
    };
    run(w, warm, turnInput);
    const h0 = heading(w);
    let speedSum = 0;
    let n = 0;
    run(w, measure, turnInput, () => {
      speedSum += Math.hypot(w.ship.vel.x, w.ship.vel.z);
      n++;
    });
    const omega = Math.abs(unwrap(heading(w) - h0)) / measure;
    return speedSum / n / omega;
  };

  it('turn radius: braking < cruise < boost', () => {
    const brake = radius({ brake: true }, 0.9, 0.5);
    const cruise = radius({}, 1, 0.5);
    const boost = radius({ boost: true }, 1.2, 0.4);
    expect(brake).toBeLessThan(cruise);
    expect(cruise).toBeLessThan(boost);
  });

  it('A/D break turn snaps to a hard bank', () => {
    const w = new World(flatSea(), { shipPos: v(0, 300, 0), shipYaw: 0, dummyCount: 0 });
    run(w, 1, { right: true });
    expect(w.ship.bank).toBeGreaterThan(config.flight.breakBank * 0.85);
    run(w, 1, { left: true });
    expect(w.ship.bank).toBeLessThan(-config.flight.breakBank * 0.85);
  });
});

describe('loops', () => {
  it('pulling the mouse up loops the ship without a half-roll over the top', () => {
    const w = new World(flatSea(), { shipPos: v(0, 600, 0), shipYaw: 0, dummyCount: 0, shipSpeed: 100 });
    const right = v(0, 0, 0);
    let minRightX = 1;
    let maxUpY = 0;
    let minUpY = 1;
    const up = v(0, 0, 0);
    // ~1.6 rad/s of mouse pitch for 4.5 s is a bit over a full loop of aim.
    run(w, 4.5, { aimDPitch: 1.6 / 120, throttle: true }, () => {
      right.set(1, 0, 0).applyQuaternion(w.ship.quat);
      up.set(0, 1, 0).applyQuaternion(w.ship.quat);
      minRightX = Math.min(minRightX, right.x);
      maxUpY = Math.max(maxUpY, up.y);
      minUpY = Math.min(minUpY, up.y);
    });
    expect(minUpY).toBeLessThan(-0.8); // went inverted over the top
    expect(minRightX).toBeGreaterThan(0.8); // never rolled: right wing stayed right
  });
});

describe('boost', () => {
  it('drains, locks out, then recharges', () => {
    const w = new World(flatSea(), { shipPos: v(0, 300, 0), shipYaw: 0, dummyCount: 0 });
    run(w, 1.5, { boost: true });
    expect(w.ship.speed).toBeGreaterThan(config.flight.maxSpeed);
    run(w, 1.4, { boost: true });
    expect(w.ship.boostMeter).toBeLessThan(0.05);
    expect(w.ship.boosting).toBe(false);
    expect(w.ship.boostLockout).toBe(true);
    run(w, 3);
    expect(w.ship.boostMeter).toBeGreaterThan(0.5);
  });
});

describe('ram and shield', () => {
  it('ramming damages the dummy, not the player shield', () => {
    const w = new World(flatSea(), { shipPos: v(0, 200, 0), shipYaw: 0, dummyCount: 1 });
    const d = w.dummies[0]!;
    d.pos.set(0, 200, -30);
    d.vel.set(0, 0, 0);
    let rams = 0;
    run(w, 1, {}, () => {
      for (const e of w.drainEvents()) if (e.type === 'ram') rams++;
    });
    expect(rams).toBeGreaterThan(0);
    expect(d.hp).toBeLessThan(config.dummies.hp);
    expect(w.ship.shield).toBe(config.combat.shieldMax);
  });

  it('shield regen waits for the delay, then refills', () => {
    const w = new World(flatSea(), { shipPos: v(0, 300, 0), shipYaw: 0, dummyCount: 0 });
    w.ship.shield = 20;
    w.ship.shieldDelay = config.combat.regenDelay;
    run(w, config.combat.regenDelay - 0.1);
    expect(w.ship.shield).toBe(20);
    run(w, 3);
    expect(w.ship.shield).toBe(config.combat.shieldMax);
  });
});

