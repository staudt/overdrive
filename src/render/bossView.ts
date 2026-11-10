/**
 * STUB (battleship agent): the flying battleship model built in code, driven by world.boss
 * (pos, quat, parts with local mounts / aim / alive, stage). Null-safe: no boss, nothing drawn.
 */
import type { Scene } from 'three';
import type { World } from '../sim/world';

export class BossView {
  constructor(private readonly scene: Scene) {
    void this.scene;
  }
  update(_dt: number, _world: World): void {}
}
