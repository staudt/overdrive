/** Damage, chain and score. Every damage instance extends the chain; kills pay big. */
import { config } from '../core/config';
import type { Dummy, HitSource, ScoreState, SimEvent } from './types';

export const createScore = (): ScoreState => ({ score: 0, chain: 0, chainTimer: 0, bestChain: 0, kills: 0, wave: 0 });

/** Apply damage to a drone. Returns true if it died. */
export function damageDummy(score: ScoreState, u: Dummy, dmg: number, by: HitSource, events: SimEvent[]): boolean {
  if (!u.alive || dmg <= 0) return false;
  const sc = config.score;
  score.chain++;
  score.chainTimer = sc.chainWindow;
  score.bestChain = Math.max(score.bestChain, score.chain);
  u.hp -= dmg;
  u.hitFlash = 0;
  let points = sc.hitPoints * score.chain;
  score.score += points;
  events.push({ type: 'hit', pos: u.pos.clone(), dummyId: u.id, by, points, chain: score.chain });
  if (u.hp > 0) return false;
  u.alive = false;
  score.kills++;
  points = (u.kind === 'part' ? config.boss.partPoints : sc.killPoints) + sc.killPerChain * score.chain;
  score.score += points;
  events.push({ type: 'kill', pos: u.pos.clone(), dummyId: u.id, by, points, chain: score.chain });
  return true;
}

export function stepScore(score: ScoreState, dt: number, events: SimEvent[]): void {
  if (score.chainTimer <= 0) return;
  score.chainTimer -= dt;
  if (score.chainTimer <= 0) {
    events.push({ type: 'chainEnd', chain: score.chain });
    score.chain = 0;
    score.chainTimer = 0;
  }
}
