/** Target drones: dark angular attack drones with glowing magenta lights. Two instanced meshes. */
import {
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  Matrix4,
  RedFormat,
  type Scene,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Dummy } from '../sim/types';

const MAX = 64;

function tris(points: number[][], faces: number[][]): BufferGeometry {
  const pos: number[] = [];
  for (const f of faces) for (const i of f) pos.push(...points[i]!);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function droneBody(): BufferGeometry {
  // Angular fuselage (forward -Z): a flat diamond with a nose spike and swept blade wings.
  const fuse = tris(
    [
      [0, 0.1, -4], // 0 nose
      [-1.1, 0.0, 0.2], // 1
      [1.1, 0.0, 0.2], // 2
      [0, 0.9, 0.6], // 3 top
      [0, -0.6, 0.6], // 4 bottom
      [0, 0.1, 3], // 5 tail
    ],
    [
      [0, 3, 1],
      [0, 2, 3],
      [0, 1, 4],
      [0, 4, 2],
      [5, 1, 3],
      [5, 3, 2],
      [5, 4, 1],
      [5, 2, 4],
    ],
  );
  const wing = (s: number) =>
    tris(
      [
        [s * 0.9, 0.1, -1.0],
        [s * 4.0, -0.2, 1.8],
        [s * 4.0, -0.2, 2.8],
        [s * 0.9, 0.1, 2.2],
        [s * 3.4, -1.4, 2.4], // downward tip blade
      ],
      s > 0
        ? [
            [0, 3, 1],
            [1, 3, 2],
            [3, 0, 1],
            [1, 2, 4],
          ]
        : [
            [0, 1, 3],
            [1, 2, 3],
            [3, 1, 0],
            [1, 4, 2],
          ],
    );
  const g = mergeGeometries([fuse, wing(1), wing(-1)])!;
  g.computeVertexNormals();
  return g;
}

function lights(): BufferGeometry {
  const box = (x: number, y: number, z: number, s: number) =>
    tris(
      [
        [x, y + s, z],
        [x - s, y - s, z + s],
        [x + s, y - s, z + s],
        [x, y - s, z - s],
      ],
      [
        [0, 1, 2],
        [0, 2, 3],
        [0, 3, 1],
        [1, 3, 2],
      ],
    );
  return mergeGeometries([box(0, 0.95, 0.6, 0.35), box(3.9, -0.2, 2.8, 0.3), box(-3.9, -0.2, 2.8, 0.3), box(0, 0.1, -3.7, 0.25)])!;
}

export class DummyView {
  private readonly body: InstancedMesh;
  private readonly glow: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly scale = new Vector3(1, 1, 1);
  private readonly c = new Color();
  private t = 0;

  constructor(scene: Scene) {
    const grad = new DataTexture(new Uint8Array([70, 150, 255]), 3, 1, RedFormat);
    grad.minFilter = NearestFilter;
    grad.magFilter = NearestFilter;
    grad.needsUpdate = true;
    this.body = new InstancedMesh(
      droneBody(),
      new MeshToonMaterial({ color: '#ffffff', gradientMap: grad }),
      MAX,
    );
    this.glow = new InstancedMesh(lights(), new MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), MAX);
    for (const im of [this.body, this.glow]) {
      im.frustumCulled = false;
      im.count = 0;
      im.instanceMatrix.setUsage(35048);
      im.setColorAt(0, this.c.setRGB(1, 1, 1));
      scene.add(im);
    }
  }

  update(dt: number, dummies: Dummy[]): void {
    this.t += dt;
    let n = 0;
    for (const d of dummies) {
      if (!d.alive || n >= MAX) continue;
      this.m.compose(d.pos, d.quat, this.scale);
      this.body.setMatrixAt(n, this.m);
      this.glow.setMatrixAt(n, this.m);
      const f = Math.max(0, 1 - d.hitFlash / 0.18);
      this.body.setColorAt(n, this.c.setRGB(0.1 + f * 5, 0.11 + f * 5, 0.15 + f * 5));
      const pulse = 0.75 + 0.25 * Math.sin(this.t * 6 + d.id * 1.9);
      this.glow.setColorAt(n, this.c.setRGB(3.2 * pulse + f * 4, 0.25 * pulse + f * 4, 1.3 * pulse + f * 4));
      n++;
    }
    this.body.count = n;
    this.glow.count = n;
    this.body.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
  }
}
