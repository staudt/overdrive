/**
 * STUB (ship+fx agent): all particle/trail/glow effects.
 * Splash columns (waterEnter/Exit), spray wake when skimming, bubbles underwater, sparks on
 * terrainHit, explosions on ram kill, wingtip contrails, engine plumes + afterburner, speed lines.
 */
import type { PerspectiveCamera, Scene } from 'three';
import type { ShipModel } from '../render/ship/model';
import type { SimEvent } from '../sim/types';
import type { World } from '../sim/world';

export class Fx {
  /** Camera shake trauma 0..1 added by events; the camera reads and decays it. */
  trauma = 0;
  constructor(
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {
    void this.scene;
    void this.camera;
  }
  handle(e: SimEvent, _world: World): void {
    if (e.type === 'terrainHit') this.trauma = Math.min(1, this.trauma + e.impact / 60);
    if (e.type === 'ram') this.trauma = Math.min(1, this.trauma + 0.4);
    if (e.type === 'waterEnter') this.trauma = Math.min(1, this.trauma + 0.25);
  }
  update(_dt: number, _world: World, _ship: ShipModel): void {}
}
