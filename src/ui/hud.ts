/**
 * STUB (HUD agent): DOM overlay in the concept-art style (slanted panels, italic Chakra Petch):
 * speed, altitude, boost bar, shield bar, STALL warning, center aim reticle, nose marker.
 */
import type { PerspectiveCamera } from 'three';
import type { ShipState } from '../sim/types';

export class Hud {
  private readonly el: HTMLElement;
  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:absolute;left:16px;bottom:16px;color:#fff;font:16px monospace;pointer-events:none';
    root.appendChild(this.el);
  }
  /** noseScreen: projected nose aim point in NDC (-1..1), or null if behind camera. */
  update(s: ShipState, _camera: PerspectiveCamera, _noseScreen: { x: number; y: number } | null, locked: boolean): void {
    this.el.textContent =
      `SPD ${s.speed.toFixed(0)}  ALT ${s.altitude.toFixed(0)}  BOOST ${(s.boostMeter * 100).toFixed(0)}  ` +
      `SHIELD ${s.shield.toFixed(0)}${s.stalled ? '  STALL' : ''}${locked ? '' : '  [click to fly]'}`;
  }
}
