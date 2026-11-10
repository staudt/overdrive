/**
 * Machine gun and homing missiles. Pure sim: pooled bullets/missiles, swept hit tests, lock-on.
 *
 * Gun (LMB): rounds leave along the ship's nose; when the aim reticle is within assistMax of
 * the nose they bend toward it (fully at assistFull). Random spread makes it a hose, not a rifle.
 * Missiles (hold E): stream from alternating pylons while the rack lasts. Each launch homes on the
 * lock with the fewest missiles already inbound, so a stream spreads over all locks. Locks are
 * the drones inside a cone around the aim. Unlocked missiles fly dumb and grab the first drone
 * that crosses their own seeker cone. Blasts deal falloff splash damage.
 */
import { Quaternion, Vector3 } from 'three';
import { config } from '../core/config';
import type { Rng } from '../core/rng';
import { damageDummy } from './combat';
import { forwardOf } from './flight';
import type { Bullet, Dummy, InputFrame, Missile, ScoreState, ShipState, SimEvent, Terrain, WeaponState } from './types';
import { waveHeight } from './waves';

const BULLET_POOL = 96;
const MISSILE_POOL = 320;
const SEEKER_CONE = 40 * (Math.PI / 180);
const SEEKER_RANGE = 1200;

const _f = new Vector3();
const _a = new Vector3();
const _d = new Vector3();
const _u = new Vector3();
const _v = new Vector3();
const _p = new Vector3();
const _q = new Quaternion();
const _axis = new Vector3();
const FWD = new Vector3(0, 0, -1);

export interface WeaponsCtx {
  ship: ShipState;
  dummies: Dummy[];
  terrain: Terrain;
  score: ScoreState;
  t: number;
  rng: Rng;
  events: SimEvent[];
}

export function createWeapons(): WeaponState {
  const bullets: Bullet[] = [];
  for (let i = 0; i < BULLET_POOL; i++)
    bullets.push({ pos: new Vector3(), prev: new Vector3(), vel: new Vector3(), life: 0, alive: false });
  const missiles: Missile[] = [];
  for (let i = 0; i < MISSILE_POOL; i++)
    missiles.push({ id: i, pos: new Vector3(), vel: new Vector3(), quat: new Quaternion(), target: -1, age: 0, alive: false, seed: 0 });
  return {
    bullets,
    missiles,
    gunCooldown: 0,
    gunSide: 1,
    missileSide: 1,
    firing: false,
    rack: config.missiles.rackMax,
    rackDelay: 0,
    missileCooldown: 0,
    streaming: false,
    locks: [],
    lockAge: [],
  };
}

/** Surface height under (x, z): the higher of terrain and water, and which one it is. */
function surfaceAt(ctx: WeaponsCtx, x: number, z: number): { y: number; water: boolean } {
  const g = ctx.terrain.heightAt(x, z);
  const w = waveHeight(x, z, ctx.t);
  return g >= w ? { y: g, water: false } : { y: w, water: true };
}

/** Squared distance from point c to segment ab, and the closest point into `out`. */
function segPointDist2(a: Vector3, b: Vector3, c: Vector3, out: Vector3): number {
  _u.subVectors(b, a);
  const len2 = _u.lengthSq();
  const t = len2 > 1e-9 ? Math.max(0, Math.min(1, _v.subVectors(c, a).dot(_u) / len2)) : 0;
  out.copy(a).addScaledVector(_u, t);
  return out.distanceToSquared(c);
}

/** Rotate unit vector `dir` by a random angle within `cone` (uniform over the disc). */
function jitter(dir: Vector3, cone: number, rng: Rng): Vector3 {
  if (cone <= 0) return dir;
  _u.set(Math.abs(dir.y) < 0.9 ? 0 : 1, Math.abs(dir.y) < 0.9 ? 1 : 0, 0).cross(dir).normalize();
  _v.crossVectors(dir, _u);
  const r = Math.tan(cone * Math.sqrt(rng()));
  const th = rng() * Math.PI * 2;
  return dir.addScaledVector(_u, Math.cos(th) * r).addScaledVector(_v, Math.sin(th) * r).normalize();
}

/** Direction the gun fires: the nose, pulled onto the aim when the aim is close to it. */
export function gunDirection(s: ShipState, out: Vector3): Vector3 {
  const g = config.gun;
  forwardOf(s.quat, out);
  forwardOf(s.aim, _a);
  const ang = out.angleTo(_a);
  const w = ang <= g.assistFull ? 1 : ang >= g.assistMax ? 0 : 1 - (ang - g.assistFull) / (g.assistMax - g.assistFull);
  if (w > 0) out.lerp(_a, w).normalize();
  return out;
}

function fireRound(ws: WeaponState, ctx: WeaponsCtx): void {
  const g = config.gun;
  const s = ctx.ship;
  let b = ws.bullets.find((x) => !x.alive);
  if (!b) b = ws.bullets.reduce((m, x) => (x.life < m.life ? x : m));
  ws.gunSide = -ws.gunSide;
  b.pos.set(g.muzzle[0] * ws.gunSide, g.muzzle[1], g.muzzle[2]).applyQuaternion(s.quat).add(s.pos);
  b.prev.copy(b.pos);
  jitter(gunDirection(s, _d), g.spread, ctx.rng);
  b.vel.copy(s.vel).addScaledVector(_d, g.speed);
  b.life = g.life;
  b.alive = true;
  ctx.events.push({ type: 'gunFire', pos: b.pos.clone(), dir: _d.clone() });
}

function stepBullets(ws: WeaponState, ctx: WeaponsCtx, dt: number): void {
  const r2 = config.dummies.radius ** 2;
  for (const b of ws.bullets) {
    if (!b.alive) continue;
    b.prev.copy(b.pos);
    b.pos.addScaledVector(b.vel, dt);
    b.life -= dt;
    if (b.life <= 0) {
      b.alive = false;
      continue;
    }
    let hit = false;
    for (const u of ctx.dummies) {
      if (!u.alive) continue;
      if (segPointDist2(b.prev, b.pos, u.pos, _p) < r2) {
        damageDummy(ctx.score, u, config.gun.damage, 'gun', ctx.events);
        hit = true;
        break;
      }
    }
    if (hit) {
      b.alive = false;
      continue;
    }
    const surf = surfaceAt(ctx, b.pos.x, b.pos.z);
    if (b.pos.y < surf.y) {
      b.alive = false;
      ctx.events.push({ type: 'bulletImpact', pos: new Vector3(b.pos.x, surf.y, b.pos.z), surface: surf.water ? 'water' : 'ground' });
    }
  }
}

/** Recompute locks: alive drones inside the aim cone and range, best (smallest angle) first. */
function updateLocks(ws: WeaponState, ctx: WeaponsCtx, dt: number): void {
  const m = config.missiles;
  forwardOf(ctx.ship.aim, _a);
  const cands: { id: number; ang: number }[] = [];
  for (const u of ctx.dummies) {
    if (!u.alive) continue;
    _d.subVectors(u.pos, ctx.ship.pos);
    const dist = _d.length();
    if (dist > m.lockRange || dist < 1) continue;
    const ang = _a.angleTo(_d);
    if (ang < m.lockCone) cands.push({ id: u.id, ang });
  }
  cands.sort((x, y) => x.ang - y.ang);
  const prevIds = ws.locks;
  const prevAge = ws.lockAge;
  const ids: number[] = [];
  const ages: number[] = [];
  for (const c of cands.slice(0, m.maxLocks)) {
    const i = prevIds.indexOf(c.id);
    ids.push(c.id);
    ages.push(i >= 0 ? prevAge[i]! + dt : 0);
  }
  ws.locks = ids;
  ws.lockAge = ages;
}

/** The lock with the fewest missiles already inbound (ties: best lock). -1 if no locks. */
function pickTarget(ws: WeaponState): number {
  if (ws.locks.length === 0) return -1;
  let best = ws.locks[0]!;
  let bestN = Infinity;
  for (const id of ws.locks) {
    let n = 0;
    for (const m of ws.missiles) if (m.alive && m.target === id) n++;
    if (n < bestN) {
      bestN = n;
      best = id;
    }
  }
  return best;
}

function launchMissile(ws: WeaponState, ctx: WeaponsCtx): void {
  const mc = config.missiles;
  const s = ctx.ship;
  let m = ws.missiles.find((x) => !x.alive);
  if (!m) m = ws.missiles.reduce((a, x) => (x.age > a.age ? x : a));
  ws.missileSide = -ws.missileSide;
  m.pos.set(mc.pylon[0] * ws.missileSide, mc.pylon[1], mc.pylon[2]).applyQuaternion(s.quat).add(s.pos);
  // Eject sideways and down so the swarm fans out before the motors light.
  _u.set(ws.missileSide, 0, 0).applyQuaternion(s.quat);
  _v.set(0, -1, 0).applyQuaternion(s.quat);
  const r = ctx.rng;
  m.vel
    .copy(s.vel)
    .addScaledVector(_u, mc.ejectSpeed * (0.5 + r()))
    .addScaledVector(_v, mc.ejectSpeed * (0.2 + 0.5 * r()));
  m.quat.copy(s.quat);
  m.target = pickTarget(ws);
  m.age = 0;
  m.seed = r();
  m.alive = true;
  ctx.events.push({ type: 'missileLaunch', pos: m.pos.clone(), missileId: m.id });
}

function explode(m: Missile, ctx: WeaponsCtx, at: Vector3, surface: 'air' | 'water' | 'ground'): void {
  const mc = config.missiles;
  m.alive = false;
  for (const u of ctx.dummies) {
    if (!u.alive) continue;
    const d = u.pos.distanceTo(at) - config.dummies.radius;
    if (d < mc.blastRadius) damageDummy(ctx.score, u, mc.damage * (1 - 0.6 * Math.max(0, d) / mc.blastRadius), 'missile', ctx.events);
  }
  ctx.events.push({ type: 'missileExplode', pos: at.clone(), surface });
}

function findDummy(list: Dummy[], id: number): Dummy | undefined {
  const u = list[id];
  return u && u.id === id ? u : list.find((x) => x.id === id);
}

function stepMissiles(ws: WeaponState, ctx: WeaponsCtx, dt: number): void {
  const mc = config.missiles;
  const rad = config.dummies.radius;
  for (const m of ws.missiles) {
    if (!m.alive) continue;
    m.age += dt;
    if (m.age > mc.life) {
      explode(m, ctx, m.pos, 'air');
      continue;
    }
    _p.copy(m.pos); // prev
    if (m.age < mc.dropTime) {
      m.vel.y -= 9.8 * dt;
    } else {
      // Target upkeep: re-acquire through the missile's own seeker if the target is gone.
      let tgt = m.target >= 0 ? findDummy(ctx.dummies, m.target) : undefined;
      if (!tgt || !tgt.alive) {
        tgt = undefined;
        m.target = -1;
        forwardOf(m.quat, _f);
        let bestAng = SEEKER_CONE;
        for (const u of ctx.dummies) {
          if (!u.alive) continue;
          _d.subVectors(u.pos, m.pos);
          if (_d.lengthSq() > SEEKER_RANGE * SEEKER_RANGE) continue;
          const ang = _f.angleTo(_d);
          if (ang < bestAng) {
            bestAng = ang;
            tgt = u;
          }
        }
        if (tgt) m.target = tgt.id;
      }
      forwardOf(m.quat, _f);
      if (tgt) {
        // Lead pursuit.
        const sp = Math.max(m.vel.length(), 100);
        const tGo = Math.min(2, tgt.pos.distanceTo(m.pos) / sp);
        _d.copy(tgt.vel).multiplyScalar(tGo).add(tgt.pos).sub(m.pos).normalize();
      } else {
        _d.copy(_f);
      }
      // Swarm wobble: a lazy corkscrew around the heading, fading as it closes in.
      const w = mc.wobble * Math.max(0.25, 1 - m.age / 1.5);
      _u.set(1, 0, 0).applyQuaternion(m.quat);
      _v.set(0, 1, 0).applyQuaternion(m.quat);
      const ph = m.age * (6 + 4 * m.seed) + m.seed * 20;
      _d.addScaledVector(_u, Math.sin(ph) * w * 0.15).addScaledVector(_v, Math.cos(ph * 1.3) * w * 0.15).normalize();
      const ang = _f.angleTo(_d);
      if (ang > 1e-5) {
        _axis.crossVectors(_f, _d);
        if (_axis.lengthSq() > 1e-12) {
          _axis.normalize();
          _f.applyAxisAngle(_axis, Math.min(ang, mc.turnRate * dt));
        }
      }
      const sp = Math.min(mc.maxSpeed, m.vel.length() + mc.accel * dt);
      m.vel.copy(_f).multiplyScalar(sp);
    }
    m.pos.addScaledVector(m.vel, dt);
    _q.setFromUnitVectors(FWD, _d.copy(m.vel).normalize());
    m.quat.copy(_q);

    // Proximity fuse / direct hit on any drone along this step.
    let boom = false;
    for (const u of ctx.dummies) {
      if (!u.alive) continue;
      const fuse = u.id === m.target ? mc.proximity + rad : rad;
      if (segPointDist2(_p, m.pos, u.pos, _a) < fuse * fuse) {
        explode(m, ctx, _a, 'air');
        boom = true;
        break;
      }
    }
    if (boom) continue;
    const surf = surfaceAt(ctx, m.pos.x, m.pos.z);
    if (m.pos.y < surf.y) explode(m, ctx, _a.set(m.pos.x, surf.y, m.pos.z), surf.water ? 'water' : 'ground');
  }
}

export function stepWeapons(ws: WeaponState, ctx: WeaponsCtx, inp: InputFrame, dt: number): void {
  const s = ctx.ship;
  const mc = config.missiles;

  // Gun.
  ws.firing = inp.fire && !s.submerged;
  ws.gunCooldown = Math.max(ws.gunCooldown - dt, ws.firing ? -1 : 0);
  while (ws.firing && ws.gunCooldown <= 0) {
    fireRound(ws, ctx);
    ws.gunCooldown += 1 / config.gun.rate;
  }
  stepBullets(ws, ctx, dt);

  // Missiles.
  updateLocks(ws, ctx, dt);
  ws.streaming = inp.missile && ws.rack >= 1 && !s.submerged;
  if (!inp.missile) ws.missileCooldown = 0;
  else ws.missileCooldown -= dt;
  while (ws.streaming && ws.missileCooldown <= 0 && ws.rack >= 1) {
    launchMissile(ws, ctx);
    ws.rack -= 1;
    ws.rackDelay = mc.refillDelay;
    ws.missileCooldown += 1 / mc.streamRate;
  }
  // The rack only refills once E is released (hold to empty it, let go to reload).
  if (!inp.missile) {
    if (ws.rackDelay > 0) ws.rackDelay -= dt;
    else ws.rack = Math.min(mc.rackMax, ws.rack + mc.refillRate * dt);
  }
  stepMissiles(ws, ctx, dt);
}
