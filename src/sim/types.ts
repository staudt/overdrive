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
  /** Shield hit zero: the run is over (ship explodes, sim stops flying it). */
  dead: boolean;
  /** Near or past the mission-area edge heading out: HUD shows "LEAVING MISSION AREA". */
  areaWarning: boolean;
  /** Height above ground/water directly below. */
  altitude: number;
  shield: number;
  shieldDelay: number;
  /** Throttle state for FX: -1 braking, 0 cruise, 1 W held, 2 boosting. */
  throttleState: -1 | 0 | 1 | 2;
  /** A/D state for FX: -1 left, 0 none, 1 right. */
  breakTurn: -1 | 0 | 1;
}

/**
 * Anything guns and missiles can hit: drones (kind 'drone' | 'gunner') and boss parts
 * (kind 'part'). Boss parts have ids >= BOSS_PART_ID0 and are positioned by the boss each step.
 */
export type TargetKind = 'drone' | 'gunner' | 'part';
export const BOSS_PART_ID0 = 10000;

export interface Dummy {
  id: number;
  kind: TargetKind;
  /** Hit radius, m. */
  radius: number;
  /** Max hp (for health bars). */
  maxHp: number;
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
  /** Gunners: seconds until the next burst. */
  fireTimer: number;
  /** Gunners: machine-gun sweep in progress (see Sweep). */
  sweep?: Sweep;
}

/**
 * A machine-gun barrage that walks a world-fixed line: aim starts ~sweepHalf to one side of
 * where the player will be, crosses it, and ends past it. The line doesn't track the player:
 * you read the tracers coming and get off the line.
 */
export interface Sweep {
  active: boolean;
  p0: Vector3;
  p1: Vector3;
  t: number;
  dur: number;
  /** Fractional rounds owed (fire-rate accumulator). */
  acc: number;
}

/** An enemy orb. Pooled: render only draws `alive` ones. */
export interface EnemyBullet {
  pos: Vector3;
  vel: Vector3;
  /** Visual + hit radius, m. */
  radius: number;
  life: number;
  alive: boolean;
  /** Palette index for render: 0 magenta orb, 1 red aimed shot, 2 violet spiral, 3 amber flak, 4 machine-gun tracer. */
  color: number;
  /** Shield damage on hit. */
  damage: number;
  /** Already counted as a graze (near miss) this life. */
  grazed: boolean;
}

export type TurretKind = 'flak' | 'spiral' | 'ring' | 'fan' | 'gatling';

export interface BossPart {
  /** The hittable target (pos/hp/alive live here; kind 'part'). */
  target: Dummy;
  role: 'turret' | 'engine' | 'core';
  turret?: TurretKind;
  /** Mount point in boss local space (forward -Z, up +Y), m. */
  local: Vector3;
  /** Turret aim (world direction) for render; spiral phase etc. */
  aim: Vector3;
  phase: number;
  cooldown: number;
  /** Gatling turrets: the sweep in progress. */
  sweep?: Sweep;
  /** Alive at the previous step (to emit destruction once). */
  wasAlive: boolean;
}

export interface BossState {
  alive: boolean;
  /** 'arriving' flies in, 'fight' circles and shoots, 'dying' death sequence, 'dead' gone. */
  stage: 'arriving' | 'fight' | 'dying' | 'dead';
  pos: Vector3;
  vel: Vector3;
  quat: Quaternion;
  /** Point it circles during the fight. */
  center: Vector3;
  /** Hull half extents (local box), m. */
  half: Vector3;
  parts: BossPart[];
  /** 0..1, rises as parts are destroyed: fire rate and pattern density scale with it. */
  rage: number;
  /** Seconds into the current stage. */
  stageTime: number;
  /** Total hp across parts (for the boss bar). */
  hp: number;
  maxHp: number;
  name: string;
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
  /** An enemy orb hit the player (shield damage applied by the sim). */
  | { type: 'playerHit'; pos: Vector3; damage: number }
  /** An enemy orb passed within config.enemyFire.grazeRadius (score bonus). */
  | { type: 'graze'; pos: Vector3; points: number }
  /** Enemy fire, for muzzle flashes / audio. kind: what fired. */
  | { type: 'enemyFire'; pos: Vector3; kind: 'gunner' | TurretKind; count: number }
  /** A machine-gun sweep begins: p0 → p1 is the line its aim will walk (HUD/FX/audio cue). */
  | { type: 'sweepStart'; from: Vector3; p0: Vector3; p1: Vector3; duration: number }
  | { type: 'playerDeath'; pos: Vector3 }
  | { type: 'bossWarning'; name: string }
  | { type: 'bossArrive'; name: string }
  | { type: 'bossPartDestroyed'; pos: Vector3; role: 'turret' | 'engine' | 'core'; coreExposed: boolean }
  /** The battleship starts its death sequence (falls, chains explosions, hits the sea). */
  | { type: 'bossDying'; pos: Vector3 }
  /** Final blast when the wreck hits the water / ends the sequence. */
  | { type: 'bossDeath'; pos: Vector3; points: number }
  /** A big ship-vs-boss-hull collision (bounce + damage like terrain). */
  | { type: 'hullHit'; pos: Vector3; normal: Vector3; impact: number }
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
