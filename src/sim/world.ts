/**
 * Owns the simulation state and steps it at a fixed rate. Render/fx/ui read from it and
 * drain `events` once per rendered frame.
 */
import { Vector3 } from 'three';
import { config } from '../core/config';
import { mulberry32, type Rng } from '../core/rng';
import { collideTerrain } from './collision';
import { createScore, stepScore } from './combat';
import { collideDummies, spawnWave, stepDummies } from './dummies';
import { createShip, setAim, stepFlight } from './flight';
import { stepShield } from './shield';
import type { Dummy, InputFrame, ScoreState, ShipState, SimEvent, Terrain, WeaponState } from './types';
import { createWeapons, stepWeapons, type WeaponsCtx } from './weapons';
import { waveHeight } from './waves';
import { stepWater } from './water';

const _prev = new Vector3();

export interface WorldOptions {
  shipPos: Vector3;
  shipYaw: number;
  shipSpeed?: number;
  shipPitch?: number;
  /** Drones in the first group (0 = none). Default: config.dummies.waveSize. */
  dummyCount?: number;
  /** Keep spawning new waves as drones die. Default: true unless dummyCount is given. */
  waves?: boolean;
}

export class World {
  t = 0;
  readonly ship: ShipState;
  readonly dummies: Dummy[] = [];
  readonly events: SimEvent[] = [];
  /** Remaining hit-stop time; the sim freezes while > 0. */
  hitStop = 0;
  readonly weapons: WeaponState = createWeapons();
  readonly score: ScoreState = createScore();
  private readonly waves: boolean;
  private waveCount = 0;
  private readonly rng: Rng;
  private readonly ctx: WeaponsCtx;

  constructor(
    readonly terrain: Terrain,
    opts: WorldOptions,
  ) {
    this.rng = mulberry32(config.world.seed + 7);
    this.ship = createShip(opts.shipPos, opts.shipYaw, opts.shipSpeed);
    if (opts.shipPitch) setAim(this.ship, opts.shipYaw, opts.shipPitch);
    this.waves = opts.waves ?? opts.dummyCount === undefined;
    const n = opts.dummyCount ?? config.dummies.waveSize;
    if (n > 0) this.startWave(n);
    this.ctx = { ship: this.ship, dummies: this.dummies, terrain, score: this.score, t: 0, rng: this.rng, events: this.events };
  }

  private startWave(count: number): void {
    this.score.wave++;
    this.waveCount = count;
    const center = spawnWave(this.dummies, this.ship, count, this.rng);
    this.events.push({ type: 'waveStart', wave: this.score.wave, count, center });
  }

  private stepWaves(): void {
    if (!this.waves) return;
    let alive = 0;
    for (const u of this.dummies) if (u.alive) alive++;
    if (alive < Math.max(1, Math.ceil(this.waveCount * config.dummies.nextWaveAt))) {
      const d = config.dummies;
      this.startWave(Math.min(d.maxDummies - alive, d.waveSize + d.waveGrowth * this.score.wave));
    }
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
    stepDummies(this.dummies, dt, this.t);
    this.ctx.t = this.t;
    stepWeapons(this.weapons, this.ctx, inp, dt);
    if (collideDummies(s, this.dummies, this.score, this.events)) this.hitStop = config.combat.hitStop;
    stepScore(this.score, dt, this.events);
    this.stepWaves();
    const ground = Math.max(this.terrain.heightAt(s.pos.x, s.pos.z), waveHeight(s.pos.x, s.pos.z, this.t));
    s.altitude = s.pos.y - ground;
  }

  drainEvents(): SimEvent[] {
    return this.events.splice(0, this.events.length);
  }
}
