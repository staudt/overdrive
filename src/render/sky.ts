/** STUB (world-visuals agent): gradient sky dome, sun disc, toon cloud puffs, scene lights. */
import { Color, DirectionalLight, HemisphereLight, type PerspectiveCamera, type Scene, Vector3 } from 'three';
import { config } from '../core/config';

export class Sky {
  readonly sun: DirectionalLight;
  constructor(scene: Scene) {
    scene.background = new Color('#5fa8ff');
    scene.add(new HemisphereLight('#bfe3ff', '#2a5a7a', 1.2));
    this.sun = new DirectionalLight('#fff4e0', 2.5);
    this.sun.position.copy(new Vector3(...config.render.sunDir).multiplyScalar(1000));
    scene.add(this.sun);
  }
  update(_camera: PerspectiveCamera, _t: number): void {}
}
