/** Camera-facing triangle-strip trail. World-space points sampled at a fixed interval. */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  type Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  NormalBlending,
  type Scene,
  ShaderMaterial,
  Vector3,
} from 'three';

const VERT = /* glsl */ `
attribute float aA;
attribute float aU;
varying float vA;
varying float vU;
void main() {
  vA = aA; vU = aU;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;
const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
varying float vU;
void main() {
  float e = 1.0 - smoothstep(0.25, 1.0, abs(vU));
  float a = vA * e;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const _s = new Vector3();
const _t = new Vector3();
const _c = new Vector3();

export class Ribbon {
  private readonly n: number;
  private readonly pts: Float32Array;
  private readonly al: Float32Array;
  private head = 0;
  private count = 0;
  private acc = 0;
  private readonly pos: BufferAttribute;
  private readonly aA: BufferAttribute;
  private readonly aU: BufferAttribute;
  private readonly geo = new BufferGeometry();
  readonly mesh: Mesh;

  constructor(
    scene: Scene,
    n: number,
    private readonly interval: number,
    private readonly width: number,
    private readonly grow: number,
    color: Color,
    additive: boolean,
  ) {
    this.n = n;
    this.pts = new Float32Array(n * 3);
    this.al = new Float32Array(n);
    const vc = (n + 2) * 2;
    this.pos = new BufferAttribute(new Float32Array(vc * 3), 3).setUsage(DynamicDrawUsage);
    this.aA = new BufferAttribute(new Float32Array(vc), 1).setUsage(DynamicDrawUsage);
    this.aU = new BufferAttribute(new Float32Array(vc), 1);
    for (let i = 0; i < vc / 2; i++) {
      this.aU.setX(i * 2, -1);
      this.aU.setX(i * 2 + 1, 1);
    }
    const idx: number[] = [];
    for (let i = 0; i < n + 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('aA', this.aA);
    this.geo.setAttribute('aU', this.aU);
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    this.mesh = new Mesh(
      this.geo,
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uColor: { value: color } },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: additive ? AdditiveBlending : NormalBlending,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 12 : 9;
    scene.add(this.mesh);
  }

  clear(): void {
    this.count = 0;
    this.acc = 0;
  }

  /** Advance with the live head position and strength alpha; rebuild strip facing the camera. */
  update(dt: number, x: number, y: number, z: number, alpha: number, cam: Vector3): void {
    this.acc += dt;
    if (this.acc >= this.interval || this.count === 0) {
      this.acc = this.count === 0 ? 0 : this.acc % this.interval;
      const h = this.head;
      this.pts[h * 3] = x;
      this.pts[h * 3 + 1] = y;
      this.pts[h * 3 + 2] = z;
      this.al[h] = alpha;
      this.head = (h + 1) % this.n;
      this.count = Math.min(this.n, this.count + 1);
    }
    // k=0 is the live head, k>=1 are stored points newest first.
    const total = this.count + 1;
    for (let k = 0; k < total; k++) {
      let a = alpha;
      let age = 0;
      this.fetch(k, x, y, z, _c);
      if (k > 0) {
        const j = (this.head - k + this.n * 2) % this.n;
        a = this.al[j]!;
        age = k / this.n;
      }
      this.fetch(Math.max(0, k - 1), x, y, z, _t);
      this.fetch(Math.min(total - 1, k + 1), x, y, z, _s);
      _t.sub(_s);
      const px = _c.x;
      const py = _c.y;
      const pz = _c.z;
      _c.set(cam.x - px, cam.y - py, cam.z - pz);
      _s.crossVectors(_t, _c);
      const l = _s.length();
      if (l > 1e-6) _s.multiplyScalar(1 / l);
      else _s.set(0, 1, 0);
      const taper = Math.min(1, k / 3);
      const w = this.width * (1 + this.grow * age) * (0.3 + 0.7 * taper);
      this.pos.setXYZ(k * 2, px - _s.x * w, py - _s.y * w, pz - _s.z * w);
      this.pos.setXYZ(k * 2 + 1, px + _s.x * w, py + _s.y * w, pz + _s.z * w);
      const fade = Math.pow(1 - age, 1.3) * a;
      this.aA.setX(k * 2, fade);
      this.aA.setX(k * 2 + 1, fade);
    }
    this.geo.setDrawRange(0, Math.max(0, total - 1) * 6);
    this.pos.needsUpdate = true;
    this.aA.needsUpdate = true;
  }

  private fetch(k: number, x: number, y: number, z: number, out: Vector3): void {
    if (k === 0) {
      out.set(x, y, z);
      return;
    }
    const j = (this.head - k + this.n * 2) % this.n;
    out.set(this.pts[j * 3]!, this.pts[j * 3 + 1]!, this.pts[j * 3 + 2]!);
  }
}
