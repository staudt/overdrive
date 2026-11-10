/**
 * STUB (weapons-FX agent): draws world.weapons: bullet tracers (long glowing streaks) and
 * missiles (bodies + smoke trails). Event-driven effects (muzzle flash, impacts, explosions)
 * live in fx/fx.ts.
 */
import type { PerspectiveCamera, Scene } from 'three';
import type { World } from '../sim/world';

export class WeaponsView {
  constructor(
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {
    void this.scene;
    void this.camera;
  }
  update(_dt: number, _world: World): void {}
}
