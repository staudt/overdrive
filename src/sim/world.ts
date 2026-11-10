/**
 * Owns the simulation state and steps it at a fixed rate. Render/fx/ui read from it and
 * drain `events` once per rendered frame.
 */
import { Vector3 } from 'three';
import { config } from '../core/config';
import { mulberry32, type Rng } from '../core/rng';
import { collideTerrain } from './collision';
import { collideDummies, spawnDummy, stepDummies } from './dummies';
import { createShip, setAim, stepFlight } from './flight';
import { stepShield } from './shield';
import type { Dummy, InputFrame, ShipState, SimEvent, Terrain } from './types';
import { waveHeight } from './waves';
import { stepWater } from './water';

const _prev = new Vector3();

export interface WorldOptions {
  shipPos: Vector3;
  shipYaw: number;
  shipSpeed?: number;
  shipPitch?: number;
  dummyCount?: number;
  dummyCenter?: Vector3;
}

export class World {
  t = 0;
  readonly ship: ShipState;
  readonly dummies: Dummy[] = [];
  readonly events: SimEvent[] = [];
  /** Remaining hit-stop time; the sim freezes while > 0. */
  hitStop = 0;
  readonly dummyCenter: Vector3;
  private readonly rng: Rng;

  constructor(
    readonly terrain: Terrain,
    opts: WorldOptions,
  ) {
    this.rng = mulberry32(config.world.seed + 7);
    this.ship = createShip(opts.shipPos, opts.shipYaw, opts.shipSpeed);
    if (opts.shipPitch) setAim(this.ship, opts.shipYaw, opts.shipPitch);
    this.dummyCenter = (opts.dummyCenter ?? opts.shipPos).clone();
    const n = opts.dummyCount ?? config.dummies.count;
    for (let i = 0; i < n; i++) this.dummies.push(spawnDummy(i, this.dummyCenter, this.rng));
  }

  step(inp: InputFrame, dt: number): void {
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }
    const s = this.ship;
    this.t += dt;
    stepFlight(s, inp, dt, this.events);
    stepWater(s, dt, this.t, this.events);
    _prev.copy(s.pos);
    s.pos.addScaledVector(s.vel, dt);
    collideTerrain(s, _prev, this.terrain, this.events);
    stepShield(s, dt);
    stepDummies(this.dummies, this.dummyCenter, dt, this.t, this.rng);
    if (collideDummies(s, this.dummies, this.events)) this.hitStop = config.combat.hitStop;
    const ground = Math.max(this.terrain.heightAt(s.pos.x, s.pos.z), waveHeight(s.pos.x, s.pos.z, this.t));
    s.altitude = s.pos.y - ground;
  }

  drainEvents(): SimEvent[] {
    return this.events.splice(0, this.events.length);
  }
}
