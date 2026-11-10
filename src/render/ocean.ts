/** STUB (world-visuals agent): wave shader ocean following the camera, underwater look. */
import { Mesh, MeshStandardMaterial, PlaneGeometry, type PerspectiveCamera, type Scene } from 'three';

export class Ocean {
  private readonly mesh: Mesh;
  constructor(scene: Scene) {
    this.mesh = new Mesh(new PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: '#1f6fd1' }));
    scene.add(this.mesh);
  }
  update(camera: PerspectiveCamera, _t: number, _underwater: boolean): void {
    this.mesh.position.set(camera.position.x, 0, camera.position.z);
  }
}
