/**
 * The flying battleship. It arrives from far ahead, then circles an orbit center at altitude.
 * Turrets fire bullet-hell patterns at the player (faster as `rage` rises with destroyed parts).
 * Engines are weak points; destroying all of them exposes the core; killing the core starts the
 * death sequence: the wreck noses down, chains explosions and hits the sea.
 * The hull is an oriented box: the player bounces off it (damage like terrain).
 */
import { Quaternion, Vector3 } from 'three';
import { config } from '../core/config';
import type { Rng } from '../core/rng';
import { makeDummy } from './dummies';
import { aimedBurst, fan, leadDir, ring, spiral, type EnemyFire } from './enemyFire';
import { damageShield } from './shield';
import { BOSS_PART_ID0, type BossPart, type BossState, type ScoreState, type ShipState, type SimEvent, type TurretKind } from './types';

const UP = new Vector3(0, 1, 0);
const FWD = new Vector3(0, 0, -1);
const _a = new Vector3();
const _b = new Vector3();
const _d = new Vector3();
const _n = new Vector3();
const _q = new Quaternion();
const _inv = new Quaternion();

/** Part layout in boss local space (forward -Z, up +Y), scaled to config.boss.length (authored at 420 m). */
const LAYOUT: { role: BossPart['role']; turret?: TurretKind; at: [number, number, number] }[] = [
  { role: 'turret', turret: 'flak', at: [0, 27, -150] },
  { role: 'turret', turret: 'spiral', at: [0, 32, -75] },
  { role: 'turret', turret: 'ring', at: [0, 30, 15] },
  { role: 'turret', turret: 'fan', at: [0, 27, 105] },
  { role: 'turret', turret: 'flak', at: [-33, 4, -35] },
  { role: 'turret', turret: 'flak', at: [33, 4, -35] },
  { role: 'turret', turret: 'fan', at: [-33, 4, 70] },
  { role: 'turret', turret: 'fan', at: [33, 4, 70] },
  { role: 'turret', turret: 'spiral', at: [0, -26, 0] },
  { role: 'engine', at: [-21, 0, 214] },
  { role: 'engine', at: [21, 0, 214] },
  { role: 'engine', at: [0, 16, 214] },
  { role: 'core', at: [0, 10, 20] },
];

export function createBoss(ship: ShipState, rng: Rng): BossState {
  const b = config.boss;
  const k = b.length / 420;
  // Orbit center ahead of the player; the ship arrives from further out on a slight angle.
  _d.copy(ship.vel).setY(0);
  if (_d.lengthSq() < 1) _d.set(0, 0, -1).applyQuaternion(ship.quat).setY(0);
  _d.normalize();
  const center = new Vector3(ship.pos.x + _d.x * 900, b.altitude, ship.pos.z + _d.z * 900);
  const side = rng() < 0.5 ? -1 : 1;
  _a.copy(_d).applyAxisAngle(UP, side * 0.5);
  const pos = center.clone().addScaledVector(_a, b.arriveDistance);
  const vel = center.clone().sub(pos).setY(0).normalize().multiplyScalar(b.cruiseSpeed * 2.5);
  const quat = new Quaternion().setFromUnitVectors(FWD, _n.copy(vel).normalize());
  const parts: BossPart[] = LAYOUT.map((p, i) => {
    const t = makeDummy(BOSS_PART_ID0 + i, 'part');
    const hp = p.role === 'turret' ? b.turretHp : p.role === 'engine' ? b.engineHp : b.coreHp;
    t.hp = t.maxHp = hp;
    t.radius = p.role === 'turret' ? 10 : p.role === 'engine' ? 13 : 16;
    t.alive = p.role !== 'core'; // the core opens once the engines are gone
    t.hitFlash = 99;
    return { target: t, role: p.role, turret: p.turret, local: new Vector3(...p.at).multiplyScalar(k), aim: new Vector3(0, 0, -1), phase: rng() * 6, cooldown: 1 + rng() * 2, wasAlive: t.alive };
  });
  const boss: BossState = {
    alive: true,
    stage: 'arriving',
    pos,
    vel,
    quat,
    center,
    half: new Vector3(30, 22, 212).multiplyScalar(k),
    parts,
    rage: 0,
    stageTime: 0,
    hp: 0,
    maxHp: 0,
    name: 'DREADNOUGHT VALKYRIE',
  };
  placeParts(boss);
  updateHp(boss);
  return boss;
}

function placeParts(b: BossState): void {
  for (const p of b.parts) {
    p.target.pos.copy(p.local).applyQuaternion(b.quat).add(b.pos);
    p.target.vel.copy(b.vel);
  }
}

function updateHp(b: BossState): void {
  let hp = 0;
  let max = 0;
  for (const p of b.parts) {
    max += p.target.maxHp;
    hp += Math.max(0, p.target.hp);
  }
  b.hp = hp;
  b.maxHp = max;
}

/** Live hittable parts (for weapons / locks). */
export function bossTargets(b: BossState | null, out: BossPart['target'][]): void {
  if (!b || b.stage === 'dying' || b.stage === 'dead') return;
  for (const p of b.parts) if (p.target.alive) out.push(p.target);
}

function fireTurret(p: BossPart, b: BossState, ship: ShipState, f: EnemyFire, rng: Rng, dt: number, events: SimEvent[]): void {
  const c = config.boss;
  const from = p.target.pos;
  const speedUp = 1 + b.rage * c.rageFire;
  p.cooldown -= dt * speedUp;
  _d.subVectors(ship.pos, from).normalize();
  p.aim.copy(_d);
  if (p.cooldown > 0) return;
  switch (p.turret) {
    case 'flak':
      leadDir(from, ship.pos, ship.vel, c.flakSpeed, _d);
      aimedBurst(f, from, _d, 6, 4 * (Math.PI / 180), c.flakSpeed, 2, 3, rng);
      p.cooldown = c.flakInterval * (0.85 + 0.3 * rng());
      events.push({ type: 'enemyFire', pos: from.clone(), kind: 'flak', count: 6 });
      break;
    case 'spiral': {
      // Bursts: 2.8 s on, 2.2 s off, phase-shifted per turret.
      const on = (b.stageTime + p.local.z * 0.01) % 5 < 2.8;
      p.cooldown = c.spiralInterval;
      if (!on) return;
      p.phase += 0.33;
      spiral(f, from, _d, 3, 0.42, p.phase, c.orbSpeed, 2.4, 2);
      if (Math.floor(p.phase * 3) % 6 === 0) events.push({ type: 'enemyFire', pos: from.clone(), kind: 'spiral', count: 3 });
      break;
    }
    case 'ring':
      ring(f, from, _d, UP, Math.round(c.ringCount * (1 + 0.5 * b.rage)), c.orbSpeed * 0.85, 3, 0);
      p.cooldown = c.ringInterval;
      events.push({ type: 'enemyFire', pos: from.clone(), kind: 'ring', count: c.ringCount });
      break;
    case 'fan':
      leadDir(from, ship.pos, ship.vel, c.orbSpeed * 1.1, _d);
      fan(f, from, _d, UP, c.fanCount, c.fanArc, c.orbSpeed * 1.1, 2.5, 1);
      p.cooldown = c.fanInterval * (0.85 + 0.3 * rng());
      events.push({ type: 'enemyFire', pos: from.clone(), kind: 'fan', count: c.fanCount });
      break;
  }
}

/** Ship vs hull box: push out along the least-penetration axis, bounce, damage. */
function collideHull(b: BossState, ship: ShipState, events: SimEvent[]): void {
  const r = config.combat.shipRadius;
  _inv.copy(b.quat).invert();
  _a.subVectors(ship.pos, b.pos).applyQuaternion(_inv); // ship in hull space
  const h = b.half;
  const px = h.x + r - Math.abs(_a.x);
  const py = h.y + r - Math.abs(_a.y);
  const pz = h.z + r - Math.abs(_a.z);
  if (px <= 0 || py <= 0 || pz <= 0) return;
  // Least penetration axis → local normal; push the ship out along it.
  const sx = _a.x < 0 ? -1 : 1;
  const sy = _a.y < 0 ? -1 : 1;
  const sz = _a.z < 0 ? -1 : 1;
  if (px < py && px < pz) {
    _n.set(sx, 0, 0);
    _a.x += sx * px;
  } else if (py < pz) {
    _n.set(0, sy, 0);
    _a.y += sy * py;
  } else {
    _n.set(0, 0, sz);
    _a.z += sz * pz;
  }
  _n.applyQuaternion(b.quat);
  ship.pos.copy(_a.applyQuaternion(b.quat).add(b.pos));
  // Bounce relative to the hull's motion.
  _b.subVectors(ship.vel, b.vel);
  const vn = _b.dot(_n);
  if (vn < config.combat.minBounce) {
    const c = config.combat;
    const impact = Math.max(0, -vn);
    _d.copy(_b).addScaledVector(_n, -vn).multiplyScalar(c.terrainFriction);
    ship.vel.copy(_d).addScaledVector(_n, Math.max(impact * c.terrainRestitution, c.minBounce)).add(b.vel);
    ship.bounceTimer = c.bounceRecovery;
    ship.stalled = false;
    if (impact > 0.5) {
      damageShield(ship, impact * config.boss.hullDamagePerMps);
      events.push({ type: 'hullHit', pos: ship.pos.clone(), normal: _n.clone(), impact });
    }
  }
}

export function stepBoss(
  b: BossState,
  ship: ShipState,
  f: EnemyFire,
  score: ScoreState,
  rng: Rng,
  dt: number,
  events: SimEvent[],
): void {
  const c = config.boss;
  b.stageTime += dt;
  const center = b.center;

  if (b.stage === 'arriving' || b.stage === 'fight') {
    // Steer: arrive toward the center, then circle it at orbitRadius.
    _a.subVectors(center, b.pos).setY(0);
    const dist = _a.length();
    if (b.stage === 'arriving' && dist < c.orbitRadius * 1.05) {
      b.stage = 'fight';
      b.stageTime = 0;
      events.push({ type: 'bossArrive', name: b.name });
    }
    const speed = b.stage === 'arriving' ? c.cruiseSpeed * 2.5 : c.cruiseSpeed;
    if (b.stage === 'fight') {
      // Tangent of the orbit plus a radial correction toward orbitRadius.
      _d.set(-_a.z, 0, _a.x).normalize();
      _d.addScaledVector(_a.normalize(), (dist - c.orbitRadius) / c.orbitRadius).normalize();
    } else _d.copy(_a).normalize();
    _b.copy(b.vel).setY(0).normalize();
    _b.lerp(_d, 1 - Math.exp(-0.4 * dt)).normalize();
    b.vel.copy(_b).multiplyScalar(speed);
    b.vel.y = (c.altitude - b.pos.y) * 0.3;
    b.pos.addScaledVector(b.vel, dt);
    // Heading with a gentle bank into the turn.
    const turn = _b.x * _d.z - _b.z * _d.x;
    _q.setFromUnitVectors(FWD, _b);
    b.quat.copy(_q).multiply(_inv.setFromAxisAngle(FWD, -turn * 0.6));
    placeParts(b);

    // Parts: destruction bookkeeping, core exposure, turret fire.
    let destroyed = 0;
    let total = 0;
    let enginesUp = 0;
    for (const p of b.parts) {
      if (p.role === 'core') continue;
      total++;
      if (!p.target.alive) destroyed++;
      else if (p.role === 'engine') enginesUp++;
    }
    b.rage = total ? destroyed / total : 0;
    const core = b.parts.find((p) => p.role === 'core')!;
    if (enginesUp === 0 && core.target.hp > 0 && !core.target.alive) {
      core.target.alive = true;
      events.push({ type: 'bossPartDestroyed', pos: core.target.pos.clone(), role: 'engine', coreExposed: true });
    }
    for (const p of b.parts) {
      if (p.wasAlive && !p.target.alive && p.target.hp <= 0) {
        events.push({ type: 'bossPartDestroyed', pos: p.target.pos.clone(), role: p.role, coreExposed: false });
        if (p.role === 'core') {
          b.stage = 'dying';
          b.stageTime = 0;
          events.push({ type: 'bossDying', pos: b.pos.clone() });
        }
      }
      p.wasAlive = p.target.alive;
    }
    if (b.stage === 'fight' && !ship.dead && ship.pos.distanceTo(b.pos) < c.range + c.length / 2) {
      for (const p of b.parts) if (p.role === 'turret' && p.target.alive) fireTurret(p, b, ship, f, rng, dt, events);
    }
    if (!ship.dead) collideHull(b, ship, events);
    updateHp(b);
    return;
  }

  if (b.stage === 'dying') {
    // Nose down, sink faster and faster, chain explosions along the hull.
    b.vel.y -= 14 * dt;
    b.vel.x *= Math.exp(-0.3 * dt);
    b.vel.z *= Math.exp(-0.3 * dt);
    b.pos.addScaledVector(b.vel, dt);
    _q.setFromAxisAngle(_a.set(1, 0, 0), -0.12 * dt);
    b.quat.multiply(_q);
    placeParts(b);
    for (const p of b.parts) p.target.alive = false;
    if (rng() < dt * 9) {
      _a.set((rng() * 2 - 1) * b.half.x, (rng() * 2 - 1) * b.half.y, (rng() * 2 - 1) * b.half.z).applyQuaternion(b.quat).add(b.pos);
      events.push({ type: 'missileExplode', pos: _a.clone(), surface: 'air' });
    }
    if (b.stageTime > c.dyingTime || b.pos.y < 5) {
      b.stage = 'dead';
      b.alive = false;
      score.score += c.killPoints;
      score.kills++;
      events.push({ type: 'bossDeath', pos: b.pos.clone(), points: c.killPoints });
    }
    b.hp = 0;
  }
}

