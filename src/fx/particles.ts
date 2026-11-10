/**
 * GPU particle system: one instanced quad buffer per blend mode. The CPU writes a particle once
 * on spawn (ring buffer); the vertex shader evaluates position analytically (linear drag + gravity).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  type Scene,
  ShaderMaterial,
} from 'three';

export interface Col {
  r: number;
  g: number;
  b: number;
  a: number;
}
export const col = (r: number, g: number, b: number, a = 1): Col => ({ r, g, b, a });

const VERT = /* glsl */ `
attribute vec4 aP;   // spawn pos, spawn time
attribute vec4 aV;   // velocity, life
attribute vec4 aS;   // size0, size1, gravity, drag
attribute vec4 aC0;
attribute vec4 aC1;
attribute float aStretch;
uniform float uTime;
varying vec2 vUv;
varying vec4 vCol;
varying float vSeed;
void main() {
  float age = uTime - aP.w;
  float t = age / aV.w;
  vUv = position.xy;
  vSeed = fract(aP.w * 7.31 + aP.x * 0.173 + aP.z * 0.291);
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); return; }
  float k = max(aS.w, 0.001);
  float e = exp(-k * age);
  vec3 g = vec3(0.0, -aS.z, 0.0);
  vec3 vel = g / k + (aV.xyz - g / k) * e;
  vec3 pos = aP.xyz + g / k * age + (aV.xyz - g / k) * (1.0 - e) / k;
  float size = mix(aS.x, aS.y, t);
  vec4 c = mix(aC0, aC1, t);
  c.a *= smoothstep(0.0, 0.05, t);
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  c.a *= smoothstep(1.0, 7.0, -mv.z);
  vCol = c;
  vec3 world;
  if (aStretch > 0.0) {
    float sp = max(length(vel), 0.001);
    vec3 axis = vel / sp;
    vec3 side = normalize(cross(axis, cameraPosition - pos));
    float len = max(sp * aStretch, size);
    world = pos + side * position.x * size * 0.5 + axis * position.y * len * 0.5;
  } else {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float a = vSeed * 6.2831 + age * (vSeed - 0.5) * 1.5;
    float ca = cos(a), sa = sin(a);
    vec2 q = vec2(ca * position.x - sa * position.y, sa * position.x + ca * position.y);
    world = pos + (right * q.x + up * q.y) * size * 0.5;
    vUv = position.xy;
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uCloud;
varying vec2 vUv;
varying vec4 vCol;
varying float vSeed;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  if (vCol.a <= 0.001) discard;
  float r = length(vUv);
  float shape;
  if (uCloud > 0.5) {
    float n = vn(vUv * 2.5 + vSeed * 40.0);
    shape = smoothstep(1.0, 0.35, r + (n - 0.5) * 0.55);
  } else {
    shape = pow(max(1.0 - r, 0.0), 1.6);
  }
  float a = vCol.a * shape;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol.rgb, a);
}
`;

export class ParticleSystem {
  readonly mesh: Mesh;
  private readonly cap: number;
  private head = 0;
  private dMin = Infinity;
  private dMax = -1;
  private readonly attrs: InstancedBufferAttribute[];
  private readonly aP: InstancedBufferAttribute;
  private readonly aV: InstancedBufferAttribute;
  private readonly aS: InstancedBufferAttribute;
  private readonly aC0: InstancedBufferAttribute;
  private readonly aC1: InstancedBufferAttribute;
  private readonly aSt: InstancedBufferAttribute;
  private readonly mat: ShaderMaterial;
  /** Particles spawned since construction (debug). */
  spawned = 0;

  constructor(scene: Scene, cap: number, additive: boolean, cloud: boolean, renderOrder: number) {
    this.cap = cap;
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    g.instanceCount = cap;
    const mk = (n: number) => new InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(35048);
    this.aP = mk(4);
    this.aV = mk(4);
    this.aS = mk(4);
    this.aC0 = mk(4);
    this.aC1 = mk(4);
    this.aSt = mk(1);
    this.attrs = [this.aP, this.aV, this.aS, this.aC0, this.aC1, this.aSt];
    for (let i = 0; i < cap; i++) {
      this.aP.setW(i, -1000);
      this.aV.setW(i, 1);
    }
    g.setAttribute('aP', this.aP);
    g.setAttribute('aV', this.aV);
    g.setAttribute('aS', this.aS);
    g.setAttribute('aC0', this.aC0);
    g.setAttribute('aC1', this.aC1);
    g.setAttribute('aStretch', this.aSt);
    this.mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uCloud: { value: cloud ? 1 : 0 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.mesh = new Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
    for (const a of this.attrs) a.needsUpdate = true;
  }

  emit(
    time: number,
    px: number,
    py: number,
    pz: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    s0: number,
    s1: number,
    grav: number,
    drag: number,
    stretch: number,
    c0: Col,
    c1: Col,
  ): void {
    const i = this.head;
    this.head = (i + 1) % this.cap;
    this.aP.setXYZW(i, px, py, pz, time);
    this.aV.setXYZW(i, vx, vy, vz, life);
    this.aS.setXYZW(i, s0, s1, grav, drag);
    this.aC0.setXYZW(i, c0.r, c0.g, c0.b, c0.a);
    this.aC1.setXYZW(i, c1.r, c1.g, c1.b, c1.a);
    this.aSt.setX(i, stretch);
    if (i < this.dMin) this.dMin = i;
    if (i > this.dMax) this.dMax = i;
    this.spawned++;
  }

  /** Upload dirty range and set the clock. */
  flush(time: number): void {
    this.mat.uniforms.uTime!.value = time;
    if (this.dMax < 0) return;
    const n = this.dMax - this.dMin + 1;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(this.dMin * a.itemSize, n * a.itemSize);
      a.needsUpdate = true;
    }
    this.dMin = Infinity;
    this.dMax = -1;
  }
}
