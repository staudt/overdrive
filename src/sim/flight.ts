/**
 * Arcade flight model with momentum. Mouse-aim: the player steers an aim direction; the ship
 * chases it with a speed-dependent turn-rate cap and auto-banks into the turn.
 * See config.flight for every tunable. Pure: no DOM, no renderer.
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { config } from '../core/config';
import type { InputFrame, ShipState, SimEvent } from './types';

const UP = new Vector3(0, 1, 0);
const _f = new Vector3();
const _d = new Vector3();
const _axis = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _back = new Vector3();
const _dir = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _aimUp = new Vector3();
const _t = new Vector3();
const X = new Vector3(1, 0, 0);

/** Point the aim at yaw (0 = -Z, + = left) and pitch (+ = up), level. */
export function setAim(s: ShipState, yaw: number, pitch: number): void {
  s.aim.setFromEuler(new Euler(pitch, yaw, 0, 'YXZ'));
}

export function forwardOf(q: Quaternion, out: Vector3): Vector3 {
  return out.set(0, 0, -1).applyQuaternion(q);
}

export function upOf(q: Quaternion, out: Vector3): Vector3 {
  return out.set(0, 1, 0).applyQuaternion(q);
}

export function createShip(pos: Vector3, yaw = 0, speed = config.flight.cruiseSpeed): ShipState {
  const quat = new Quaternion().setFromAxisAngle(UP, yaw);
  const vel = forwardOf(quat, new Vector3()).multiplyScalar(speed);
  return {
    pos: pos.clone(),
    vel,
    quat,
    aim: quat.clone(),
    speed,
    bank: 0,
    turnRate: 0,
    boostMeter: 1,
    boosting: false,
    boostLockout: false,
    boostDelay: 0,
    stalled: false,
    stallTimer: 0,
    depth: -pos.y,
    submerged: false,
    diveSpeed: 0,
    diveAngle: 0,
    diveK: config.water.buoyancyK,
    diveAim: quat.clone(),
    skimming: false,
    bounceTimer: 0,
    altitude: pos.y,
    shield: config.combat.shieldMax,
    shieldDelay: 0,
    throttleState: 0,
    breakTurn: 0,
  };
}

/** Max turn rate for a given speed: piecewise linear min → best → max → boost. */
export function maxTurnRate(speed: number): number {
  const f = config.flight;
  const pts: [number, number][] = [
    [f.minSpeed, f.turnRateAtMin],
    [f.bestTurnSpeed, f.turnRateBest],
    [f.maxSpeed, f.turnRateAtMax],
    [f.boostSpeed, f.turnRateAtBoost],
  ];
  if (speed <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [s1, r1] = pts[i];
    if (speed <= s1) {
      const [s0, r0] = pts[i - 1];
      return r0 + ((r1 - r0) * (speed - s0)) / (s1 - s0);
    }
  }
  return pts[pts.length - 1][1];
}

const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

function stepBoost(s: ShipState, inp: InputFrame, dt: number, events: SimEvent[]): void {
  const b = config.boost;
  const want = inp.boost && !s.boostLockout && s.boostMeter > 0 && !s.submerged;
  if (want && !s.boosting) events.push({ type: 'boostStart' });
  if (!want && s.boosting) events.push({ type: 'boostEnd' });
  s.boosting = want;
  if (s.boosting) {
    s.boostMeter -= b.drainPerSec * dt;
    s.boostDelay = b.rechargeDelay;
    if (s.boostMeter <= 0) {
      s.boostMeter = 0;
      s.boostLockout = true;
      s.boosting = false;
      events.push({ type: 'boostEnd' });
    }
  } else if (s.boostDelay > 0) {
    s.boostDelay -= dt;
  } else {
    s.boostMeter = Math.min(1, s.boostMeter + b.rechargePerSec * dt);
  }
  if (s.boostLockout && s.boostMeter >= b.minToStart) s.boostLockout = false;
}

function stepStall(s: ShipState, dt: number, events: SimEvent[]): void {
  const f = config.flight;
  if (s.speed < f.stallSpeed && !s.submerged) s.stallTimer += dt;
  else s.stallTimer = Math.max(0, s.stallTimer - 2 * dt);
  if (!s.stalled && s.stallTimer > f.stallTime) {
    s.stalled = true;
    events.push({ type: 'stallStart' });
  } else if (s.stalled && (s.speed > f.stallRecoverSpeed || s.submerged)) {
    s.stalled = false;
    s.stallTimer = 0;
    events.push({ type: 'stallEnd' });
  }
}

/** Control authority 0..1 from stall, water and the soft ceiling. */
function authority(s: ShipState): number {
  const f = config.flight;
  let a = 1;
  if (s.stalled) a *= f.stallAuthority;
  if (s.submerged) a *= config.water.authority;
  const over = (s.pos.y - f.ceiling) / f.ceilingSoft;
  if (over > 0) a *= 1 - 0.8 * Math.min(1, over);
  return a;
}

/** Rotate the nose toward the aim and apply bank. */
function stepAttitude(s: ShipState, dt: number): void {
  const f = config.flight;
  const auth = authority(s);
  forwardOf(s.quat, _f);
  forwardOf(s.aim, _d);

  let cap = maxTurnRate(s.speed) * auth;
  if (s.breakTurn !== 0) cap *= f.breakTurnMult;
  if (s.bounceTimer > 0 && s.speed > 1) {
    // Just bounced off terrain: follow the rebound so the nose can't dig back in.
    _d.copy(s.vel).normalize();
    cap = Math.max(cap, f.turnRateBest * 1.5);
  } else if (s.stalled) {
    // Nose drops: target mostly straight down, with a little player authority left.
    _d.multiplyScalar(f.stallAuthority).addScaledVector(UP, -(1 - f.stallAuthority)).normalize();
    cap = Math.max(cap, f.stallNoseDropRate);
  } else if (s.submerged && s.speed > 1) {
    // Underwater the hull weathervanes into its motion, like a dolphin.
    _dir.copy(s.vel).normalize();
    _d.lerp(_dir, 1 - auth).normalize();
  }

  const angle = _f.angleTo(_d);
  const desiredRate = Math.min(angle * f.turnGain, cap);
  s.turnRate += (desiredRate - s.turnRate) * ease(f.turnResponse, dt);
  let yawRate = 0;
  if (angle > 1e-5) {
    _axis.crossVectors(_f, _d);
    if (_axis.lengthSq() < 1e-12) _axis.copy(upOf(s.quat, _axis)); // exactly opposite: turn about up
    _axis.normalize();
    const step = Math.min(s.turnRate * dt, angle);
    _f.applyAxisAngle(_axis, step).normalize();
    yawRate = _axis.dot(upOf(s.aim, _aimUp)) * s.turnRate; // + = turning left (in the aim frame)
  }

  // Bank: auto-bank from yaw rate, or the hard A/D break bank.
  let desiredBank =
    s.breakTurn !== 0
      ? s.breakTurn * f.breakBank
      : Math.max(-f.maxAutoBank, Math.min(f.maxAutoBank, -yawRate * f.bankGain));
  if (s.stalled) desiredBank *= 0.3;
  s.bank += (desiredBank - s.bank) * ease(f.bankResponse, dt);

  // Rebuild orientation from forward + bank around the aim's up (so loops stay inverted
  // over the top instead of half-rolling), projected perpendicular to the nose.
  upOf(s.aim, _aimUp);
  const along = _aimUp.dot(_f);
  if (Math.abs(along) < 0.97) {
    _up.copy(_aimUp).addScaledVector(_f, -along).normalize();
  } else {
    // Nose points along the aim's up (extreme lag): keep the previous up.
    upOf(s.quat, _up);
    _up.addScaledVector(_f, -_up.dot(_f)).normalize();
  }
  _up.applyAxisAngle(_f, s.bank);
  _back.copy(_f).negate();
  _right.crossVectors(_up, _back).normalize();
  _up.crossVectors(_back, _right);
  _m.makeBasis(_right, _up, _back);
  s.quat.setFromRotationMatrix(_m);
}

/** Thrust/brake speed controller and velocity grip (skipped underwater, see water.ts). */
function stepVelocity(s: ShipState, inp: InputFrame, dt: number): void {
  const f = config.flight;
  forwardOf(s.quat, _f);
  const speed = s.vel.length();
  if (speed > 1e-3) _dir.copy(s.vel).divideScalar(speed);
  else _dir.copy(_f);

  if (!s.submerged) {
    let target = f.cruiseSpeed;
    let up = f.accel;
    let down = f.settleAccel;
    if (s.boosting) {
      target = f.boostSpeed;
      up = f.boostAccel;
    } else if (inp.brake) {
      target = f.minSpeed;
      down = f.brakeDecel;
    } else if (inp.throttle) {
      target = f.maxSpeed;
    }
    const over = (s.pos.y - f.ceiling) / f.ceilingSoft;
    if (over > 0) up *= Math.max(0, 1 - over);
    if (s.stalled) down = 0; // never fight the fall that recovers you
    let ns = speed + Math.max(-down * dt, Math.min(up * dt, target - speed));
    // Diving builds speed, climbing bleeds it.
    ns += -_f.y * f.gravity * f.slopeGain * dt;
    ns = Math.max(0, ns);

    // Grip: velocity direction swings toward the nose.
    const fast = Math.max(0, Math.min(1, (speed - f.maxSpeed) / (f.boostSpeed - f.maxSpeed)));
    let grip = f.grip + (f.gripAtBoost - f.grip) * fast;
    if (s.breakTurn !== 0) grip = Math.min(grip, f.breakGrip);
    if (s.stalled) grip *= f.stallAuthority;
    _dir.lerp(_f, ease(grip, dt)).normalize();
    s.vel.copy(_dir).multiplyScalar(ns);

    // Gravity only bites when slow (or stalled).
    const g = s.stalled ? 1 : Math.max(0, 1 - ns / f.liftSpeed);
    s.vel.y -= f.gravity * g * dt;
  }
}

/** Mouse and A/D rotate the aim in its own frame; roll auto-levels unless inverted. */
function stepAim(s: ShipState, inp: InputFrame, dt: number): void {
  const f = config.flight;
  let yaw = inp.aimDYaw;
  if (s.breakTurn !== 0) yaw -= s.breakTurn * f.breakYawRate * dt * (s.stalled ? f.stallAuthority : 1);
  if (yaw !== 0) s.aim.multiply(_q.setFromAxisAngle(UP, yaw));
  if (inp.aimDPitch !== 0) s.aim.multiply(_q.setFromAxisAngle(X, inp.aimDPitch));

  forwardOf(s.aim, _f);
  upOf(s.aim, _aimUp);
  if (_aimUp.y > 0 && Math.abs(_f.y) < 0.97) {
    _t.copy(UP).addScaledVector(_f, -_f.y).normalize();
    const ang = Math.atan2(_f.dot(_up.crossVectors(_aimUp, _t)), _aimUp.dot(_t));
    s.aim.premultiply(_q.setFromAxisAngle(_f, ang * ease(f.aimLevelRate, dt)));
  }
  s.aim.normalize();
}

/**
 * One fixed step of player flight (aim, boost, stall, attitude, velocity).
 * Water forces, integration and collision are applied by world.ts after this.
 */
export function stepFlight(s: ShipState, inp: InputFrame, dt: number, events: SimEvent[]): void {
  s.breakTurn = inp.left === inp.right ? 0 : inp.left ? -1 : 1;
  if (s.bounceTimer > 0) s.bounceTimer -= dt;
  stepAim(s, inp, dt);

  s.speed = s.vel.length();
  stepBoost(s, inp, dt, events);
  stepStall(s, dt, events);
  s.throttleState = s.boosting ? 2 : inp.brake ? -1 : inp.throttle ? 1 : 0;
  stepAttitude(s, dt);
  stepVelocity(s, inp, dt);
  s.speed = s.vel.length();
}

