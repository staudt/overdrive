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
    /**
     * Turn-rate multiplier by throttle state (on top of the speed curve): coasting turns
     * tighter than throttling, braking tightest, boosting widest.
     */
    turnMulCruise: 1.5,
    turnMulThrottle: 1.0,
    turnMulBrake: 2.2,
    turnMulBoost: 0.6,
    /** Proportional gain from aim error angle to desired turn rate, 1/s (higher = nose tracks the aim tighter). */
    turnGain: 13,
    /** First-order response of actual turn rate to desired, 1/s. */
    turnResponse: 22,

    /** Bank angle per rad/s of yaw rate, and its clamp. */
    bankGain: 0.55,
    maxAutoBank: 75 * DEG,
    bankResponse: 12,

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
    timeBase: 0.37,
    timePerMps: 0.0053,
    timeMax: 1.75,
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

  /** Owned by sim/dummies.ts. Drones come in waves ahead of the player. */
  dummies: {
    speed: 25,
    hp: 100,
    radius: 6,
    /** First wave size; each wave adds waveGrowth, up to maxDummies alive. */
    waveSize: 12,
    waveGrowth: 4,
    maxDummies: 48,
    /** Next wave spawns when fewer than this fraction of the current wave is alive. */
    nextWaveAt: 0.25,
    /** Wave center distance ahead of the player, m, and drone scatter radius around it. */
    waveDistMin: 700,
    waveDistMax: 1300,
    waveSpread: 260,
    /** Drones beyond this distance from home steer back toward it. */
    leash: 350,
  },

  /** Owned by sim/weapons.ts. Machine gun (LMB). */
  gun: {
    /** Rounds per second (alternating barrels). */
    rate: 24,
    /** Muzzle speed added to the ship's velocity, m/s. */
    speed: 1100,
    /** Random cone half-angle (inaccuracy). */
    spread: 1.0 * DEG,
    life: 1.3,
    damage: 7,
    /** Aim assist: within assistFull of the nose the rounds go exactly to the aim; fades out by assistMax. */
    assistFull: 6 * DEG,
    assistMax: 12 * DEG,
    /**
     * Target assist: a drone within targetCone of the firing line (and within targetRange) pulls
     * the rounds onto its lead point (where it will be when they arrive), with spread scaled by
     * targetSpread. Set targetCone to 0 to disable.
     */
    targetCone: 7 * DEG,
    targetRange: 1000,
    targetSpread: 0.6,
    /** Extra hit radius on drones for rounds, m. */
    hitBonus: 2,
    /** Barrel offsets in ship space (x is mirrored), m. */
    muzzle: [1.1, -0.2, -6.5] as [number, number, number],
  },

  /** Owned by sim/weapons.ts. Missiles (hold E to stream). */
  missiles: {
    rackMax: 48,
    /** Missiles per second while E is held. */
    streamRate: 14,
    /** Rack refill (only while E is released): delay after the last launch, then missiles per second. */
    refillDelay: 0.8,
    refillRate: 9,
    /** Lock-on: cone half-angle around the aim, range, and max simultaneous locks. */
    lockCone: 25 * DEG,
    lockRange: 700,
    maxLocks: 8,
    /** Launch kick (sideways/down, m/s) and free-fall time before the motor lights, s. */
    ejectSpeed: 22,
    dropTime: 0.14,
    accel: 520,
    maxSpeed: 480,
    /** Homing turn rate, rad/s, and swarm wobble amplitude (rad/s). */
    turnRate: 5,
    wobble: 1.4,
    life: 5,
    /** Detonates within this distance of its target (plus the target radius), m. */
    proximity: 4,
    blastRadius: 16,
    damage: 110,
    /** Pylon offsets in ship space (x mirrored), m. */
    pylon: [3.4, -0.6, 1.0] as [number, number, number],
  },

  /** Owned by sim/combat.ts. */
  score: {
    /** Hits within this window keep the chain alive, s. */
    chainWindow: 2.0,
    hitPoints: 10,
    killPoints: 1000,
    /** Extra kill points per chain step. */
    killPerChain: 100,
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
    /** SMAA anti-aliasing pass (toggle to compare / save GPU). */
    smaa: true,
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
    /** Weapons: tracer length/width (m), missile flare, smoke trail sampling/life/width/alpha. */
    tracerLength: 80,
    tracerWidth: 3.6,
    /** Tracers widen with distance so far streaks stay visible (extra width per 100 m). */
    tracerWidthPerDist: 0.9,
    /** Multiplier on explosion size (kills and missile blasts). */
    explosionScale: 1.5,
    /** Smoke trails fade out within this distance of the camera, m (keeps launches from whiting out the view). */
    trailNearFade: 40,
    flareLength: 9,
    flareWidth: 1,
    trailInterval: 0.035,
    trailLife: 2.5,
    trailWidth: 0.35,
    trailAlpha: 0.75,
  },

  /** Owned by audio/audio.ts. Volumes are linear gains. */
  audio: {
    master: 0.7,
    engine: 1,
    wind: 1,
    boost: 1,
    sfx: 1,
    water: 1,
    /** Weapons: gun, missile launch whoosh, explosions/hits. */
    gun: 0.5,
    /** Gun reverb/space send (0 = dry). */
    gunReverb: 0.55,
    missile: 0.6,
    explosion: 1,
  },
};

export type Config = typeof config;
