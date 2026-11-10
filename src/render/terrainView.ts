/** STUB (world-visuals agent): flat-shaded vertex-coloured island/canyon meshes. */
import { BufferAttribute, Mesh, MeshStandardMaterial, PlaneGeometry, type PerspectiveCamera, type Scene } from 'three';
import type { Terrain } from '../sim/types';

export class TerrainView {
  constructor(scene: Scene, terrain: Terrain) {
    const seg = 256;
    const g = new PlaneGeometry(terrain.halfSize * 2, terrain.halfSize * 2, seg, seg).rotateX(-Math.PI / 2);
    const p = g.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, terrain.heightAt(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    scene.add(new Mesh(g, new MeshStandardMaterial({ color: '#6aa84f', flatShading: true })));
  }
  update(_camera: PerspectiveCamera): void {}
}
