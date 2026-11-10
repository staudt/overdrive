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
    /** Brake target speed (S held): a full stop. */
    minSpeed: 0,
    cruiseSpeed: 70,
    maxSpeed: 110,
    boostSpeed: 300,
    /** Speed controller rates, m/s². */
    accel: 45,
    boostAccel: 260,
    /** Easing back to cruise when W/boost released. */
    settleAccel: 25,
    /** Airbrakes: S decelerates this hard, m/s². */
    brakeDecel: 260,
    /** Once stopped with S held, the ship hangs in place this long before free-falling, s. */
    brakeHoldTime: 1.0,
    /** How hard the hold bleeds the last bit of motion, 1/s. */
    brakeHoldDamp: 6,
    /** Diving speeds you up, climbing slows you (fraction of gravity along the nose). */
    slopeGain: 0.5,
    gravity: 18,
    /** Below this speed gravity starts to bite (scaled 1 - speed/liftSpeed). */
    liftSpeed: 45,

    /** Max turn rate (rad/s) by speed: interpolated min → best → max → boost. */
    turnRateAtMin: 2.2,
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

    /**
     * Stall = free fall (Luftrausers): below stallSpeed for stallTime, wings stop flying. Full
     * steering stays; gravity takes over, the velocity no longer follows the nose (stallGrip),
     * and thrust (when not braking) pushes along the nose. Recover once speed along the nose
     * exceeds stallRecoverSpeed (point into the fall, or throttle out).
     */
    stallSpeed: 20,
    stallTime: 0.3,
    stallRecoverSpeed: 40,
    stallGrip: 0.25,

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
    /**
     * Dive: entering steeper than minDiveAngle goes under, follows a parabola down and back
     * up, and exits at the mirrored angle with exitSpeedMul * entry speed. Both depth and time
     * under grow with the entry vertical speed vy (steeper or faster = deeper and longer):
     *   depth = clamp(vy * depthPerMps, minDepth, maxDepth)
     *   time  = clamp(timeBase + vy * timePerMps, timeBase, timeMax)
     */
    minDiveAngle: 25 * DEG,
    depthPerMps: 0.35,
    minDepth: 6,
    maxDepth: 45,
    timeBase: 0.55,
    timePerMps: 0.008,
    timeMax: 2.6,
    /** Horizontal velocity drag underwater, 1/s. */
    drag: 0.8,
    exitSpeedMul: 1.0,
    /** How fast the aim flips to the mirrored exit angle while under, 1/s. */
    aimFlipRate: 9,
    /** Shallow contacts ride the surface at this height (ship center above the wave), m. */
    hoverHeight: 2.0,
    /** Still counts as skimming (spray, slowdown) this far above hoverHeight, m. */
    skimGrace: 1.5,
    /** While skimming, the speed target is scaled by this (a small fixed loss, not a drag). */
    skimSpeedMul: 0.88,
    /** Camera stays at least this far above the waves, m. */
    cameraClearance: 1.5,
    /** Steering authority underwater. */
    authority: 0.45,
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
    /** Nose probe: distance ahead of center and its radius, m (stops the nose sinking into hills). */
    noseLength: 6.5,
    noseRadius: 1.2,
    /** Minimum push-off speed along the surface normal after any terrain hit, m/s. */
    minBounce: 14,
    /** Seconds after a hit where the nose follows the bounce instead of the aim. */
    bounceRecovery: 0.35,
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
    fov: 110,
    /** Extra FOV while boosting, degrees. */
    fovBoostAdd: 6,
    /** FOV degrees per m/s above cruise. */
    fovPerSpeed: 0.03,
    /** Camera distance behind the ship (mouse wheel), m. */
    distance: 16,
    minDistance: 6,
    maxDistance: 90,
    /** Wheel zoom sensitivity (fraction per wheel notch of 100). */
    wheelZoom: 0.12,
    /** Ship's on-screen position below center, as a fraction of the half-height (keeps the aim clear). */
    shipScreenY: 0.42,
    /** Camera pulls back by this factor while boosting. */
    boostPullback: 1.35,
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
    /** Global multiplier on spawn counts for events and trails. */
    density: 1,
    /** Multiplier on engine flame + nozzle glow brightness (bloom amplifies it). */
    flameGlow: 0.45,
    /** Multiplier on engine flame length. */
    flameLength: 0.75,
  },
};

export type Config = typeof config;
