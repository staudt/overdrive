/** STUB (ship+fx agent): procedural code-built jet, white/red, twin glowing engines. Forward -Z. */
import { BoxGeometry, ConeGeometry, Group, Mesh, MeshStandardMaterial, Object3D } from 'three';
import type { ShipState } from '../../sim/types';

export interface ShipModel {
  group: Group;
  /** Engine exhaust anchor points (local, pointing +Z backwards). */
  engines: Object3D[];
  /** Wingtip anchors for contrail ribbons. */
  wingtips: Object3D[];
  /** Animate flaps, engine glow intensity, etc. Position/orientation are set by the caller. */
  update(dt: number, s: ShipState): void;
}

export function createShipModel(): ShipModel {
  const group = new Group();
  const mat = new MeshStandardMaterial({ color: '#eeeeee' });
  group.add(new Mesh(new ConeGeometry(1, 8, 6).rotateX(-Math.PI / 2), mat));
  group.add(new Mesh(new BoxGeometry(10, 0.3, 3), mat));
  const engines = [new Object3D(), new Object3D()];
  engines[0]!.position.set(-0.7, 0, 4);
  engines[1]!.position.set(0.7, 0, 4);
  const wingtips = [new Object3D(), new Object3D()];
  wingtips[0]!.position.set(-5, 0, 1);
  wingtips[1]!.position.set(5, 0, 1);
  for (const o of [...engines, ...wingtips]) group.add(o);
  return { group, engines, wingtips, update: () => {} };
}
