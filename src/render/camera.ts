/**
 * Mouse-aim chase camera: looks exactly along the aim (so the aim reticle is screen center),
 * sits behind and above the ship. Height is derived from distance and FOV so the ship always
 * sits at config.camera.shipScreenY below center, clear of the reticle. The mouse wheel sets the
 * distance; boosting pulls the camera back (zoom out). The ship "pulls away" on acceleration via
 * a smoothed-velocity lag. Shake from trauma.
 */
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { config } from '../core/config';
import type { ShipState } from '../sim/types';

const _off = new Vector3();
const _q = new Quaternion();
const Z = new Vector3(0, 0, 1);
const DEG = Math.PI / 180;

export class ChaseCamera {
  readonly camera: PerspectiveCamera;
  private readonly smoothVel = new Vector3();
  private fov = config.camera.fov;
  private pull = 1;
  private roll = 0;
  private time = 0;
  trauma = 0;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(config.camera.fov, aspect, 0.5, 30000);
  }

  /** Mouse wheel: positive deltaY zooms out. */
  zoom(deltaY: number): void {
    const c = config.camera;
    const d = c.distance * Math.exp((deltaY / 100) * c.wheelZoom);
    c.distance = Math.max(c.minDistance, Math.min(c.maxDistance, d));
  }

  snap(s: ShipState): void {
    this.smoothVel.copy(s.vel);
    this.update(0, s);
  }

  update(dt: number, s: ShipState): void {
    const c = config.camera;
    this.time += dt;
    this.smoothVel.lerp(s.vel, 1 - Math.exp(-c.followResponse * dt));
    this.roll += (s.bank * c.rollFollow - this.roll) * (1 - Math.exp(-6 * dt));
    this.camera.quaternion.copy(s.aim).multiply(_q.setFromAxisAngle(Z, -this.roll));

    const fovTarget = c.fov + (s.boosting ? c.fovBoostAdd : 0) + Math.max(-6, Math.min(10, (s.speed - config.flight.cruiseSpeed) * c.fovPerSpeed));
    this.fov += (fovTarget - this.fov) * (1 - Math.exp(-(s.boosting ? 5 : 3) * dt));
    this.pull += ((s.boosting ? c.boostPullback : 1) - this.pull) * (1 - Math.exp(-(s.boosting ? 3 : 2) * dt));

    const dist = c.distance * this.pull;
    const height = dist * c.shipScreenY * Math.tan((this.fov * DEG) / 2);
    _off.set(0, height, dist).applyQuaternion(s.aim);
    this.camera.position.copy(s.pos).add(_off);
    // Lag: positive when accelerating (ship pulls ahead).
    this.camera.position.addScaledVector(_off.subVectors(this.smoothVel, s.vel), 0.12);

    this.trauma = Math.max(0, this.trauma - c.shakeDecay * dt);
    const sh = this.trauma * this.trauma;
    if (sh > 0) {
      const t = this.time * 40;
      this.camera.position.x += Math.sin(t * 1.3) * sh * 1.5;
      this.camera.position.y += Math.sin(t * 1.7 + 1) * sh * 1.5;
      this.camera.rotateZ(Math.sin(t * 1.1 + 2) * sh * 0.05);
    }

    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
