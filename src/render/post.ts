/** STUB (world-visuals agent): postprocessing stack (bloom, ACES, vignette, CA, underwater grade). */
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

export interface PostState {
  /** 0..1 boost intensity (FOV kick handled by camera; this drives CA / speed grading). */
  boost: number;
  /** 0..1 missing shield fraction: red vignette strength, pulsing as it grows. */
  shieldLoss: number;
  /** 0..1 decaying flash on terrain hit / ram. */
  damageFlash: number;
  underwater: boolean;
  /** Seconds, for pulses. */
  time: number;
}

export class Post {
  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {}
  setSize(_w: number, _h: number): void {}
  render(_dt: number, _state: PostState): void {
    this.renderer.render(this.scene, this.camera);
  }
}
