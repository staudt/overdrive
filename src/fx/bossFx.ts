/**
 * STUB (battleship agent): effects for the battleship's events: bossPartDestroyed (turret/engine
 * blows, core exposed), bossDying (chain explosions, smoke, falling wreck), bossDeath (huge
 * blast + sea splash), hullHit (sparks on the hull). May create its own ParticleSystem(s) from
 * fx/particles.ts. `trauma` is added to the camera shake by main.ts.
 */
import type { PerspectiveCamera, Scene } from 'three';
import type { SimEvent } from '../sim/types';
import type { World } from '../sim/world';

export class BossFx {
  trauma = 0;
  constructor(
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {
    void this.scene;
    void this.camera;
  }
  handle(_e: SimEvent, _world: World): void {}
  update(_dt: number, _world: World): void {}
}
