/**
 * Mouse-aim chase camera: looks exactly along the aim direction (so the aim reticle is screen
 * center), sits behind and above the ship. Ship "pulls away" on acceleration and sinks toward
 * the lens on braking via a smoothed-velocity lag. FOV kicks with speed and boost. Shake from trauma.
 */
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { config } from '../core/config';
import type { ShipState } from '../sim/types';

const _off = new Vector3();
const _e = new Euler(0, 0, 0, 'YXZ');
const _q = new Quaternion();

export class ChaseCamera {
  readonly camera: PerspectiveCamera;
  private readonly smoothVel = new Vector3();
  private fov = config.camera.fov;
  private roll = 0;
  private time = 0;
  trauma = 0;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(config.camera.fov, aspect, 0.5, 30000);
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
    _e.set(s.aimPitch, s.aimYaw, -this.roll);
    this.camera.quaternion.setFromEuler(_e);

    _off.set(0, c.height, c.distance).applyQuaternion(_q.setFromEuler(_e.set(s.aimPitch, s.aimYaw, 0)));
    this.camera.position.copy(s.pos).add(_off);
    // Lag: positive when accelerating (ship pulls ahead).
    this.camera.position.addScaledVector(_off.subVectors(this.smoothVel, s.vel), 0.12);

    // Shake.
    this.trauma = Math.max(0, this.trauma - c.shakeDecay * dt);
    const sh = this.trauma * this.trauma;
    if (sh > 0) {
      const t = this.time * 40;
      this.camera.position.x += Math.sin(t * 1.3) * sh * 1.5;
      this.camera.position.y += Math.sin(t * 1.7 + 1) * sh * 1.5;
      this.camera.rotateZ(Math.sin(t * 1.1 + 2) * sh * 0.05);
    }

    const target = s.boosting
      ? c.fovBoost
      : c.fov + Math.max(-8, (s.speed - config.flight.cruiseSpeed) * c.fovPerSpeed);
    this.fov += (target - this.fov) * (1 - Math.exp(-(s.boosting ? 6 : 3) * dt));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
