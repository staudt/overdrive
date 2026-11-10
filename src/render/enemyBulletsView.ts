/**
 * STUB (enemy-fire FX agent): draws world.enemyFire.bullets (alive orbs): big glowing orbs by
 * palette index (EnemyBullet.color), readable against sky, sea and terrain.
 */
import type { PerspectiveCamera, Scene } from 'three';
import type { World } from '../sim/world';

export class EnemyBulletsView {
  constructor(
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {
    void this.scene;
    void this.camera;
  }
  update(_dt: number, _world: World): void {}
}
