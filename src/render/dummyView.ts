/** STUB (ship+fx agent): drone models with hit flash, explosion on kill handled by fx. */
import { Mesh, MeshStandardMaterial, OctahedronGeometry, type Scene } from 'three';
import type { Dummy } from '../sim/types';

export class DummyView {
  private readonly meshes: Mesh[] = [];
  constructor(private readonly scene: Scene) {}
  update(_dt: number, dummies: Dummy[]): void {
    while (this.meshes.length < dummies.length) {
      const m = new Mesh(new OctahedronGeometry(5), new MeshStandardMaterial({ color: '#ff3b6b' }));
      this.scene.add(m);
      this.meshes.push(m);
    }
    dummies.forEach((d, i) => {
      const m = this.meshes[i]!;
      m.visible = d.alive;
      m.position.copy(d.pos);
      m.quaternion.copy(d.quat);
    });
  }
}
