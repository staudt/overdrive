/**
 * Shared contracts between sim, render, fx and ui. Sim modules are pure (no DOM, no renderer),
 * using only three's math classes so they run in vitest.
 *
 * Conventions: world +Y is up, sea level is y = 0 (plus waves, see sim/waves.ts).
 * Ship local space: forward is -Z, up is +Y, right is +X (three.js camera convention).
 */
import type { Quaternion, Vector3 } from 'three';

/** One fixed-step worth of player input. Produced by input/ from the keyboard+mouse, or by tests. */
export interface InputFrame {
  /** Mouse aim deltas this step, radians (already scaled by sensitivity). +yaw = left, +pitch = up. */
  aimDYaw: number;
  aimDPitch: number;
  throttle: boolean; // W
  brake: boolean; // S
  left: boolean; // A
  right: boolean; // D
  boost: boolean; // Shift
  fire: boolean; // LMB (M2)
  missile: boolean; // E (M2)
}

export const emptyInput = (): InputFrame => ({
  aimDYaw: 0,
  aimDPitch: 0,
  throttle: false,
  brake: false,
  left: false,
  right: false,
  boost: false,
  fire: false,
  missile: false,
});

export interface ShipState {
  pos: Vector3;
  vel: Vector3;
  /** Ship orientation. */
  quat: Quaternion;
  /**
   * Aim orientation (forward -Z = where the player wants to go; the camera looks along it).
   * A free quaternion so loops work; it auto-levels roll unless inverted.
   */
  aim: Quaternion;
  /** |vel|, cached each step. */
  speed: number;
  /** Signed bank angle relative to horizon, rad (+ = right wing down). */
  bank: number;
  /** Current turn rate magnitude, rad/s. */
  turnRate: number;
  /** 0..1 */
  boostMeter: number;
  boosting: boolean;
  boostLockout: boolean;
  boostDelay: number;
  stalled: boolean;
  stallTimer: number;
  /** Seconds spent hanging in place on the airbrakes (S held, stopped); free fall after brakeHoldTime. */
  holdTimer: number;
  /** Depth below the wave surface (positive = underwater). */
  depth: number;
  submerged: boolean;
  /** Dive bookkeeping: speed and angle (rad below horizontal) at entry, upward push used (m/s²). */
  /** (diveAccel = 8·depth/time², chosen at entry so depth and time follow config.water.) */
  diveSpeed: number;
  diveAngle: number;
  diveAccel: number;
  /** Aim the dive flips toward (the entry angle mirrored upward). */
  diveAim: Quaternion;
  /** Riding the surface after a too-shallow contact (no dive). */
  skimming: boolean;
  /** Seconds left of post-impact recovery (nose follows velocity, aim ignored). */
  bounceTimer: number;
  /** Height above ground/water directly below. */
  altitude: number;
  shield: number;
  shieldDelay: number;
  /** Throttle state for FX: -1 braking, 0 cruise, 1 W held, 2 boosting. */
  throttleState: -1 | 0 | 1 | 2;
  /** A/D state for FX: -1 left, 0 none, 1 right. */
  breakTurn: -1 | 0 | 1;
}

export interface Dummy {
  id: number;
  pos: Vector3;
  vel: Vector3;
  quat: Quaternion;
  hp: number;
  alive: boolean;
  respawnTimer: number;
  /** Center the drone loiters around (its wave's spawn point). */
  home: Vector3;
  /** Seconds since last hit, for flash FX. */
  hitFlash: number;
}

/** A machine-gun round. Pooled: render only draws `alive` ones. */
export interface Bullet {
  pos: Vector3;
  /** Position at the previous step (tracer tail / swept hit test). */
  prev: Vector3;
  vel: Vector3;
  /** Seconds left. */
  life: number;
  alive: boolean;
}

/** A homing missile. Pooled: render only draws `alive` ones. */
export interface Missile {
  id: number;
  pos: Vector3;
  vel: Vector3;
  /** Orientation, forward -Z (render the body and trail from this). */
  quat: Quaternion;
  /** Dummy id it homes on, or -1 (dumbfire / searching). */
  target: number;
  /** Seconds since launch (motor ignites after config.missiles.dropTime). */
  age: number;
  alive: boolean;
  /** Per-missile random seed for wobble / visuals. */
  seed: number;
}

export interface WeaponState {
  bullets: Bullet[];
  missiles: Missile[];
  gunCooldown: number;
  /** Alternates left/right gun barrel and missile pylon. */
  gunSide: number;
  missileSide: number;
  /** True this step if the trigger is held (for FX/audio loops). */
  firing: boolean;
  /** Missiles in the rack (float; refills). */
  rack: number;
  rackDelay: number;
  missileCooldown: number;
  /** True while E is held and missiles are streaming out. */
  streaming: boolean;
  /** Dummy ids currently locked (best first), max config.missiles.maxLocks. */
  locks: number[];
  /** Seconds each lock has been held, parallel to `locks` (for lock-on animation). */
  lockAge: number[];
}

/** Score and chain (chain = consecutive hits within config.score.chainWindow). */
export interface ScoreState {
  score: number;
  chain: number;
  /** Seconds left before the chain drops. */
  chainTimer: number;
  bestChain: number;
  kills: number;
  wave: number;
}

export type HitSource = 'gun' | 'missile' | 'ram';

/** Events emitted by the sim during a step; render/fx/audio drain them each frame. */
export type SimEvent =
  | { type: 'waterEnter'; pos: Vector3; speed: number }
  | { type: 'waterExit'; pos: Vector3; speed: number }
  | { type: 'terrainHit'; pos: Vector3; normal: Vector3; impact: number }
  | { type: 'ram'; pos: Vector3; dummyId: number; impact: number; killed: boolean }
  | { type: 'stallStart' }
  | { type: 'stallEnd' }
  | { type: 'boostStart' }
  | { type: 'boostEnd' }
  /** One gun round fired from `pos` along `dir` (muzzle flash, gun audio). */
  | { type: 'gunFire'; pos: Vector3; dir: Vector3 }
  /** A bullet or missile hit a world surface (spark/dust on ground, spurt on water, puff in air on expiry is not sent). */
  | { type: 'bulletImpact'; pos: Vector3; surface: 'water' | 'ground' }
  | { type: 'missileLaunch'; pos: Vector3; missileId: number }
  /** Missile detonation (proximity, impact, or end of fuel). Blast damage is applied by the sim. */
  | { type: 'missileExplode'; pos: Vector3; surface: 'air' | 'water' | 'ground' }
  /** Any damage to a drone (gun round, missile blast, ram). points = score gained. */
  | { type: 'hit'; pos: Vector3; dummyId: number; by: HitSource; points: number; chain: number }
  /** A drone destroyed: the big explosion goes here (not on 'ram'). */
  | { type: 'kill'; pos: Vector3; dummyId: number; by: HitSource; points: number; chain: number }
  | { type: 'chainEnd'; chain: number }
  | { type: 'waveStart'; wave: number; count: number; center: Vector3 };

/** Heightfield world. Generated by sim/terrainGen.ts. */
export interface Terrain {
  /** Ground height at (x, z). Below 0 is seabed. Outside the authored area returns config.world.seabed. */
  heightAt(x: number, z: number): number;
  /** Unit surface normal at (x, z), written into out. */
  normalAt(x: number, z: number, out: Vector3): Vector3;
  /** Grid resolution and data, for building render meshes. */
  readonly halfSize: number;
  readonly cell: number;
  /** Samples per side (grid is n×n, row-major by z then x, origin at (-halfSize, -halfSize)). */
  readonly n: number;
  readonly heights: Float32Array;
  /** Per-sample material id: 0 seabed, 1 sand, 2 grass, 3 rock, 4 canyon strata. */
  readonly material: Uint8Array;
  /** Canyon centerline polyline in XZ, for scenarios and later level design. */
  readonly canyonPath: [number, number][];
  /** Island centers [x, z, radius], for scenarios. */
  readonly islands: [number, number, number][];
}
