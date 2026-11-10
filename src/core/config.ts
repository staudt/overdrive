/**
 * Every tunable lives here. The debug panel (F3) edits this object live, so code must read
 * values at use time (`config.flight.accel` inside the function), never cache them in
 * module-level constants. Units: meters, seconds, radians unless noted.
 *
 * Ownership: each section is owned by one module family. Add fields to your own section only.
 */
const DEG = Math.PI / 180;

export const config = {
  sim: {
    /** Fixed simulation step, Hz. */
    rate: 120,
    /** Max sim steps per rendered frame (spiral-of-death guard). */
    maxSteps: 8,
  },

  /** Owned by sim/flight.ts. */
  flight: {
    minSpeed: 15,
    cruiseSpeed: 70,
    maxSpeed: 110,
    boostSpeed: 190,
    /** Speed controller rates, m/s². */
    accel: 45,
    boostAccel: 170,
    /** Easing back to cruise when W/boost released. */
    settleAccel: 25,
    brakeDecel: 70,
    /** Diving speeds you up, climbing slows you (fraction of gravity along the nose). */
    slopeGain: 0.5,
    gravity: 18,
    /** Below this speed gravity starts to bite (scaled 1 - speed/liftSpeed). */
    liftSpeed: 45,

    /** Max turn rate (rad/s) by speed: interpolated min → best → max → boost. */
    turnRateAtMin: 2.0,
    turnRateBest: 2.4,
    bestTurnSpeed: 55,
    turnRateAtMax: 1.8,
    turnRateAtBoost: 1.1,
    /** Proportional gain from aim error angle to desired turn rate, 1/s. */
    turnGain: 7,
    /** First-order response of actual turn rate to desired, 1/s. */
    turnResponse: 14,

    /** Bank angle per rad/s of yaw rate, and its clamp. */
    bankGain: 0.55,
    maxAutoBank: 75 * DEG,
    bankResponse: 9,

    /** A/D break turn. */
    breakYawRate: 2.3,
    breakTurnMult: 1.6,
    breakBank: 85 * DEG,
    breakGrip: 2.2,

    /** Velocity direction blends toward the nose at this rate, 1/s (lower = more drift). */
    grip: 7,
    gripAtBoost: 3.5,

    stallSpeed: 24,
    stallTime: 1.2,
    stallRecoverSpeed: 48,
    stallAuthority: 0.2,
    stallNoseDropRate: 1.6,

    /** Soft ceiling: authority and thrust fade over ceilingSoft meters above ceiling. */
    ceiling: 900,
    ceilingSoft: 250,

    mouseSens: 0.0022,
    /** Aim auto-levels its roll toward the horizon at this rate, 1/s (off while inverted, so loops work). */
    aimLevelRate: 3.5,
  },

  /** Owned by sim/flight.ts. */
  boost: {
    drainPerSec: 0.38,
    rechargePerSec: 0.28,
    rechargeDelay: 0.8,
    /** Meter needed to (re)start a boost after it ran dry. */
    minToStart: 0.2,
  },

  /** Owned by sim/water.ts + sim/waves.ts (render/ocean.ts must use the same wave params). */
  water: {
    /** Spring: upward accel = buoyancyK * depth - damping * vel.y. */
    buoyancyK: 25,
    damping: 1.0,
    /** Horizontal velocity drag underwater, 1/s. */
    drag: 0.8,
    /** Depth hysteresis before counting as submerged, m. */
    enterDepth: 0.4,
    /** Steering authority underwater. */
    authority: 0.45,
    /** Upward kick multiplier on exit (Luftrausers spring). */
    exitKick: 1.15,
    /** Skim height for spray wake, m. */
    skimHeight: 6,
    waves: {
      /** Each wave: [dirX, dirZ, wavelength m, amplitude m, speed m/s]. */
      list: [
        [1, 0.3, 120, 1.6, 9],
        [0.4, 1, 60, 0.8, 7],
        [-0.7, 0.6, 28, 0.35, 5],
        [0.2, -1, 14, 0.15, 3.5],
      ] as [number, number, number, number, number][],
    },
  },

  /** Owned by sim/collision.ts + sim/shield.ts. */
  combat: {
    shieldMax: 100,
    regenDelay: 2,
    regenPerSec: 45,
    /** Shield damage per m/s of normal impact speed against terrain. */
    terrainDamagePerMps: 0.9,
    terrainRestitution: 0.45,
    /** Tangential speed kept after a terrain hit. */
    terrainFriction: 0.85,
    /** Ship collision radius, m. */
    shipRadius: 4,
    /** Ram damage to target per m/s of closing speed. */
    ramDamagePerMps: 1.2,
    ramPush: 25,
    hitStop: 0.06,
  },

  /** Owned by sim/dummies.ts. */
  dummies: {
    count: 10,
    speed: 25,
    hp: 100,
    radius: 6,
    respawnTime: 4,
  },

  /** Owned by sim/terrainGen.ts. */
  world: {
    seed: 1337,
    /** Half extent of the authored area, m (play area is 2*halfSize square). */
    halfSize: 2048,
    /** Heightfield cell size, m. */
    cell: 4,
    seabed: -60,
  },

  /** Owned by render/camera.ts. */
  camera: {
    fov: 70,
    fovBoost: 92,
    fovPerSpeed: 0.08,
    distance: 18,
    height: 4.5,
    /** Look-ahead along aim, m. */
    lookAhead: 30,
    followResponse: 10,
    /** Trauma (0..1) lost per second. */
    shakeDecay: 1.6,
    /** How much camera roll follows ship bank (0..1). */
    rollFollow: 0.15,
  },

  /** Owned by render/* (sky, ocean, terrain, post). Agents may add fields. */
  render: {
    sunDir: [0.35, 0.55, -0.75] as [number, number, number],
    exposure: 1.0,
    bloomStrength: 0.8,
    bloomThreshold: 0.9,
    fogDensity: 0.00018,
  },

  /** Owned by render/ship + fx/*. Agents may add fields. */
  fx: {
    particleBudget: 20000,
    /** Share of the budget used by the additive (glow/spark) buffer; the rest is alpha (smoke/water). */
    additiveFraction: 0.5,
    /** Wingtip contrail length, seconds. */
    contrailSeconds: 1.5,
    /** Global multiplier on spawn counts for events and trails. */
    density: 1,
    /** Multiplier on engine flame + nozzle glow brightness (bloom amplifies it). */
    flameGlow: 0.45,
    /** Multiplier on engine flame length. */
    flameLength: 0.75,
  },
};

export type Config = typeof config;
