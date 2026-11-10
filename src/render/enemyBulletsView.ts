/**
 * Draws world.enemyFire.bullets (alive orbs) as ONE instanced draw call of camera-facing quads.
 * Each orb: hot white core, saturated coloured rim, dark thin outline (so it reads against white
 * clouds and bright sky) and a soft additive halo, plus a short streak behind it along the screen
 * projection of its velocity. Premultiplied blending: the rim/outline occlude, the halo adds.
 * Orbs pulse, near ones (< ~60 m) swell and brighten, far ones keep a minimum angular size.
 */
import {
  BufferAttribute,
  CustomBlending,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
} from 'three';
import type { World } from '../sim/world';

const MAX = 1500;

const VERT = /* glsl */ `
attribute vec4 aPos;  // xyz, radius
attribute vec4 aVel;  // xyz, color index
uniform float uTime;
varying vec2 vP;
varying vec3 vCol;
varying float vNear;
varying float vTail;
varying float vSt;
varying float vPulse;
void main() {
  float ci = aVel.w;
  vec3 col = ci < 0.5 ? vec3(1.0, 0.12, 0.62)
           : ci < 1.5 ? vec3(1.0, 0.1, 0.08)
           : ci < 2.5 ? vec3(0.5, 0.22, 1.0)
                      : vec3(1.0, 0.55, 0.08);
  vCol = col;
  vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0);
  float dist = length(mv.xyz);
  float near = 1.0 - smoothstep(12.0, 60.0, dist);
  float ph = fract(aPos.x * 0.173 + aPos.z * 0.291 + aPos.y * 0.077) * 6.2831;
  float pulse = 0.5 + 0.5 * sin(uTime * 9.0 + ph);
  vPulse = pulse;
  float st = ci > 0.5 && ci < 1.5 ? 1.5 : 1.0;
  vSt = st;
  float R = aPos.w * 2.4 * (1.0 + 0.06 * pulse + 0.2 * near);
  // Minimum angular size so far orbs never vanish.
  R = max(R, dist * 0.0085);
  vNear = near;
  vec3 vv = (viewMatrix * vec4(aVel.xyz, 0.0)).xyz;
  float sp = max(length(vv), 0.001);
  float proj = length(vv.xy) / sp;
  vec2 along = length(vv.xy) > 0.001 ? normalize(vv.xy) : vec2(1.0, 0.0);
  vec2 perp = vec2(-along.y, along.x);
  float tail = min(sp * 0.07, R * 3.0) * proj;
  vTail = tail / R;
  float head = R * st;
  float lx = mix(-(head + tail), head, position.x * 0.5 + 0.5);
  float ly = position.y * R;
  vP = vec2(lx, ly) / R;
  mv.xy += along * lx + perp * ly;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying vec2 vP;
varying vec3 vCol;
varying float vNear;
varying float vTail;
varying float vSt;
varying float vPulse;
void main() {
  // Orb radius is 1/2.4 of the quad half-size (vP is in halo units).
  float ro = 1.0 / 2.4;
  vec2 q = vec2(vP.x / vSt, vP.y);
  float d = length(q);
  float k = 1.0 + 0.25 * vNear + 0.1 * vPulse;
  // Soft additive halo.
  float halo = pow(max(1.0 - d, 0.0), 2.2) * 0.55;
  // Opaque body: rim then white core, with a thin dark outline just outside.
  float body = 1.0 - smoothstep(ro * 0.92, ro * 1.02, d);
  float outline = (1.0 - smoothstep(ro * 1.0, ro * 1.28, d)) * (1.0 - body);
  float core = 1.0 - smoothstep(ro * 0.25, ro * 0.5, d);
  vec3 rim = vCol * 1.0 * k;
  vec3 bodyCol = mix(rim, vec3(1.9, 1.6, 1.6) * k, core);
  // Streak behind the orb (vP.x < 0), thin along the velocity.
  float behind = max(-vP.x / vSt - ro * 0.5, 0.0);
  float len = max(vTail, 0.01);
  float sw = exp(-pow(vP.y / (ro * 0.55), 2.0)) * clamp(1.0 - behind / len, 0.0, 1.0) * step(0.0, -vP.x);
  sw *= 0.8 * smoothstep(0.0, 0.4, vTail);
  // Compose premultiplied: dark outline, halo/streak additive, body opaque on top.
  vec3 rgb = vec3(0.02, 0.0, 0.05) * outline * 0.6;
  float a = outline * 0.45;
  vec3 add = vCol * (halo * 0.9 * k + sw * 1.2);
  rgb += add;
  a += (halo + sw) * 0.25;
  rgb = mix(rgb, bodyCol, body);
  a = mix(a, 1.0, body);
  if (a < 0.003 && dot(rgb, rgb) < 1e-5) discard;
  gl_FragColor = vec4(rgb, a);
}
`;

export class EnemyBulletsView {
  private readonly mesh: Mesh;
  private readonly geo: InstancedBufferGeometry;
  private readonly aPos: InstancedBufferAttribute;
  private readonly aVel: InstancedBufferAttribute;
  private readonly mat: ShaderMaterial;
  private t = 0;

  constructor(
    scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {
    void this.camera;
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    this.aPos = new InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(35048);
    this.aVel = new InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(35048);
    g.setAttribute('aPos', this.aPos);
    g.setAttribute('aVel', this.aVel);
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    this.mesh = new Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;
    scene.add(this.mesh);
  }

  update(dt: number, world: World): void {
    this.t += dt;
    this.mat.uniforms.uTime!.value = this.t;
    const p = this.aPos.array as Float32Array;
    const v = this.aVel.array as Float32Array;
    let n = 0;
    const bl = world.enemyFire.bullets;
    for (let i = 0; i < bl.length && n < MAX; i++) {
      const b = bl[i]!;
      if (!b.alive) continue;
      const o = n * 4;
      p[o] = b.pos.x;
      p[o + 1] = b.pos.y;
      p[o + 2] = b.pos.z;
      p[o + 3] = b.radius;
      v[o] = b.vel.x;
      v[o + 1] = b.vel.y;
      v[o + 2] = b.vel.z;
      v[o + 3] = b.color;
      n++;
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.aPos.clearUpdateRanges();
      this.aPos.addUpdateRange(0, n * 4);
      this.aVel.clearUpdateRanges();
      this.aVel.addUpdateRange(0, n * 4);
      this.aPos.needsUpdate = true;
      this.aVel.needsUpdate = true;
    }
  }
}
