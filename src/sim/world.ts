/**
 * Owns the simulation state and steps it at a fixed rate. Render/fx/ui read from it and
 * drain `events` once per rendered frame.
 */
import { Vector3 } from 'three';
import { config } from '../core/config';
import { mulberry32, type Rng } from '../core/rng';
import { bossTargets, createBoss, stepBoss } from './boss';
import { missionArea, stepBounds, type MissionArea } from './bounds';
import { collideTerrain } from './collision';
import { createScore, stepScore } from './combat';
import { collideDummies, spawnWave, stepDummies } from './dummies';
import { createEnemyFire, stepEnemyBullets, stepGunners, type EnemyFire } from './enemyFire';
import { createShip, setAim, stepFlight } from './flight';
import { stepShield } from './shield';
import type { BossState, Dummy, InputFrame, ScoreState, ShipState, SimEvent, Terrain, WeaponState } from './types';
import { waveHeight } from './waves';
import { stepWater } from './water';
import { createWeapons, stepWeapons, type WeaponsCtx } from './weapons';

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
  /** Bring the battleship in immediately ('fight' = already on station, guns hot). */
  boss?: boolean | 'fight';
}

export class World {
  t = 0;
  readonly ship: ShipState;
  readonly dummies: Dummy[] = [];
  readonly events: SimEvent[] = [];
  /** Remaining hit-stop time; the sim freezes while > 0. */
  hitStop = 0;
  readonly weapons: WeaponState = createWeapons();
  readonly enemyFire: EnemyFire = createEnemyFire();
  readonly score: ScoreState = createScore();
  boss: BossState | null = null;
  /** Invisible circle around the islands that keeps the action contained. */
  readonly area: MissionArea;
  /** Everything guns/missiles can hit this step: drones + live boss parts. */
  readonly targets: Dummy[] = [];
  private readonly waves: boolean;
  private waveCount = 0;
  private readonly rng: Rng;
  private readonly ctx: WeaponsCtx;

  constructor(
    readonly terrain: Terrain,
    opts: WorldOptions,
  ) {
    this.rng = mulberry32(config.world.seed + 7);
    this.area = missionArea(terrain);
    this.ship = createShip(opts.shipPos, opts.shipYaw, opts.shipSpeed);
    if (opts.shipPitch) setAim(this.ship, opts.shipYaw, opts.shipPitch);
    this.waves = opts.waves ?? opts.dummyCount === undefined;
    const n = opts.dummyCount ?? config.dummies.waveSize;
    if (n > 0) this.startWave(n);
    if (opts.boss) this.spawnBoss();
    if (opts.boss === 'fight' && this.boss) {
      const b = this.boss;
      b.pos.sub(b.center).setY(0).setLength(config.boss.orbitRadius).add(b.center);
      b.pos.y = config.boss.altitude;
      b.stage = 'fight';
      // Put the player 550 m off its beam, slightly above, facing it.
      const side = new Vector3(1, 0, 0).applyQuaternion(b.quat).setY(0).normalize();
      this.ship.pos.copy(b.pos).addScaledVector(side, 550).add(new Vector3(0, 50, 0));
      const yaw = Math.atan2(side.x, side.z);
      this.ship.quat.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
      this.ship.vel.set(0, 0, -1).applyQuaternion(this.ship.quat).multiplyScalar(config.flight.cruiseSpeed);
      setAim(this.ship, yaw, -0.08);
    }
    this.ctx = { ship: this.ship, targets: this.targets, terrain, score: this.score, t: 0, rng: this.rng, events: this.events };
  }

  /** Find any target (drone or boss part) by id. */
  findTarget(id: number): Dummy | undefined {
    return this.targets.find((u) => u.id === id) ?? this.dummies.find((u) => u.id === id);
  }

  private startWave(count: number): void {
    this.score.wave++;
    this.waveCount = count;
    const center = spawnWave(this.dummies, this.ship, count, this.rng, this.area);
    this.events.push({ type: 'waveStart', wave: this.score.wave, count, center });
    const b = config.boss;
    const w = this.score.wave;
    if (w >= b.firstWave && (w - b.firstWave) % b.every === 0 && (!this.boss || !this.boss.alive)) this.spawnBoss();
  }

  private spawnBoss(): void {
    this.boss = createBoss(this.ship, this.rng, this.area);
    this.events.push({ type: 'bossWarning', name: this.boss.name });
  }

  private stepWaves(): void {
    if (!this.waves) return;
    let alive = 0;
    for (const u of this.dummies) if (u.alive) alive++;
    if (alive < Math.max(1, Math.ceil(this.waveCount * config.dummies.nextWaveAt))) {
      const d = config.dummies;
      // While the battleship is up, waves are thinner escorts.
      const base = d.waveSize + d.waveGrowth * this.score.wave;
      const size = this.boss?.alive ? Math.ceil(base * 0.4) : base;
      this.startWave(Math.min(d.maxDummies - alive, size));
    }
  }

  step(inp: InputFrame, dt: number): void {
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }
    const s = this.ship;
    this.t += dt;
    this.ctx.t = this.t;
    if (!s.dead) {
      stepFlight(s, inp, dt, this.events);
      stepBounds(s, this.area, dt);
      stepWater(s, dt, this.t, this.events);
      _prev.copy(s.pos);
      s.pos.addScaledVector(s.vel, dt);
      collideTerrain(s, _prev, this.terrain, this.events);
      stepShield(s, dt);
    }
    stepDummies(this.dummies, dt, this.t);
    if (this.boss?.alive) stepBoss(this.boss, s, this.enemyFire, this.score, this.rng, dt, this.events);

    this.targets.length = 0;
    for (const u of this.dummies) if (u.alive) this.targets.push(u);
    bossTargets(this.boss, this.targets);

    stepWeapons(this.weapons, this.ctx, s.dead ? EMPTY : inp, dt);
    if (!s.dead && collideDummies(s, this.dummies, this.score, this.events)) this.hitStop = config.combat.hitStop;
    stepGunners(this.enemyFire, this.dummies, s, dt, this.rng, this.events);
    stepEnemyBullets(this.enemyFire, s, this.terrain, this.score, this.t, dt, this.events);
    stepScore(this.score, dt, this.events);
    this.stepWaves();

    if (!s.dead && s.shield <= 0) {
      s.dead = true;
      s.boosting = false;
      this.events.push({ type: 'playerDeath', pos: s.pos.clone() });
    }
    const ground = Math.max(this.terrain.heightAt(s.pos.x, s.pos.z), waveHeight(s.pos.x, s.pos.z, this.t));
    s.altitude = s.pos.y - ground;
  }

  drainEvents(): SimEvent[] {
    return this.events.splice(0, this.events.length);
  }
}

const EMPTY: InputFrame = {
  aimDYaw: 0,
  aimDPitch: 0,
  throttle: false,
  brake: false,
  left: false,
  right: false,
  boost: false,
  fire: false,
  missile: false,
};
