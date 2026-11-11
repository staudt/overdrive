import { describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { missionArea } from '../src/sim/bounds';
import { setAim } from '../src/sim/flight';
import { createTerrain } from '../src/sim/terrainGen';
import { World } from '../src/sim/world';
import { flatSea, run, v } from './helpers';

const dist = (w: World) => Math.hypot(w.ship.pos.x - w.area.center.x, w.ship.pos.z - w.area.center.z);

describe('mission area', () => {
  it('wraps every island of the real terrain', () => {
    const t = createTerrain();
    const a = missionArea(t);
    for (const [x, z, r] of t.islands) expect(Math.hypot(x - a.center.x, z - a.center.z) + r).toBeLessThanOrEqual(a.radius);
    expect(a.radius).toBeLessThan(t.halfSize * 1.5);
  });

  it('flying out warns, then a soft turn brings the ship back inside', () => {
    const w = new World(flatSea(), { shipPos: v(0, 300, 0), shipYaw: 0, dummyCount: 0 });
    // Start just inside the edge heading straight out (+X).
    w.ship.pos.set(w.area.radius - 150, 300, 0);
    setAim(w.ship, -Math.PI / 2, 0);
    w.ship.quat.setFromAxisAngle(v(0, 1, 0), -Math.PI / 2);
    w.ship.vel.set(70, 0, 0);
    let warned = false;
    let maxD = 0;
    run(w, 30, {}, () => {
      if (w.ship.areaWarning) warned = true;
      maxD = Math.max(maxD, dist(w));
    });
    expect(warned).toBe(true);
    expect(maxD).toBeLessThan(w.area.radius + config.world.areaSoftBand);
    expect(dist(w)).toBeLessThan(w.area.radius);
  });

  it('fighting the turn at boost speed still cannot get past the outer wall', () => {
    const w = new World(flatSea(), { shipPos: v(0, 300, 0), shipYaw: 0, dummyCount: 0, shipSpeed: 300 });
    w.ship.pos.set(w.area.radius - 50, 300, 0);
    let maxD = 0;
    run(w, 10, () => (setAim(w.ship, -Math.PI / 2, 0), { boost: true }), () => (maxD = Math.max(maxD, dist(w))));
    expect(maxD).toBeLessThan(w.area.radius + config.world.areaSoftBand + 30);
  });
});
