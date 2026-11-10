/** Sky dome shader, scene lights, fog and toon cumulus clouds (instanced spheres, dithered fade up close). */
import {
  BackSide,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { config } from '../core/config';
import { mulberry32 } from '../core/rng';

export const SKY_HORIZON = new Color('#c4ecff');
export const SKY_ZENITH = new Color('#1456e0');
export const SKY_MID = new Color('#3b95f5');
export const UNDERWATER_FOG = new Color('#0a6e8c');

/** GLSL: vec3 skyColor(vec3 dir) using uniforms uHorizon/uMid/uZenith, plus uSunDir. Shared with the ocean. */
export const skyGLSL = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uMid;
uniform vec3 uZenith;
uniform vec3 uSunDir;
vec3 skyColor(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
  c = mix(c, uZenith, smoothstep(0.15, 0.85, h));
  float s = max(dot(d, uSunDir), 0.0);
  c += vec3(1.0, 0.85, 0.55) * (pow(s, 6.0) * 0.28 + pow(s, 64.0) * 0.5);
  c += vec3(4.0, 3.6, 3.0) * smoothstep(0.9985, 0.9993, s);
  return c;
}
`;

const domeVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;
const domeFrag = /* glsl */ `
varying vec3 vDir;
${skyGLSL}
void main() {
  vec3 c = skyColor(normalize(vDir));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

const cloudVert = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vN;
varying vec3 vW;
varying float vH;
void main() {
  mat3 im = mat3(instanceMatrix);
  vec3 sc = vec3(length(im[0]), length(im[1]), length(im[2]));
  vN = normalize(mat3(modelMatrix) * (normal / sc));
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vH = (instanceMatrix * vec4(position, 1.0)).y - instanceMatrix[3].y;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const cloudFrag = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uLit;
uniform vec3 uShade;
uniform float uFadeNear;
#include <fog_pars_fragment>
varying vec3 vN;
varying vec3 vW;
varying float vH;
void main() {
  float dist = distance(cameraPosition, vW);
  // dithered fade when the camera is inside / near a puff
  float f = smoothstep(uFadeNear * 0.3, uFadeNear, dist);
  float bayer = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (f < bayer) discard;
  vec3 n = normalize(vN);
  float ndl = dot(n, uSun) * 0.5 + 0.5;
  float band = smoothstep(0.46, 0.58, ndl) * 0.7 + smoothstep(0.7, 0.8, ndl) * 0.3;
  vec3 c = mix(uShade, uLit, band);
  c = mix(c * 0.92, c, smoothstep(-0.6, 0.6, vH));
  float rim = pow(1.0 - abs(dot(n, normalize(cameraPosition - vW))), 3.0);
  c += vec3(0.25, 0.22, 0.15) * rim * band;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

interface CloudSpec {
  x: number;
  y: number;
  z: number;
  size: number;
  puffs: number;
}

export class Sky {
  readonly sun: DirectionalLight;
  private readonly scene: Scene;
  private readonly dome: Mesh;
  private readonly ring: Group;
  private readonly near: Group;
  private readonly sunDir = new Vector3();
  private readonly fog: FogExp2;
  private readonly horizonLinear = new Color();

  constructor(scene: Scene) {
    this.scene = scene;
    const sunDir = this.sunDir.set(...config.render.sunDir).normalize();
    this.horizonLinear.copy(SKY_HORIZON);
    scene.background = this.horizonLinear.clone();
    this.fog = new FogExp2(SKY_HORIZON.getHex(), config.render.fogDensity);
    this.fog.color.copy(SKY_HORIZON);
    scene.fog = this.fog;

    scene.add(new HemisphereLight('#a9d4ff', '#4a8fb0', 1.6));
    this.sun = new DirectionalLight('#fff1d6', 3.2);
    this.sun.position.copy(sunDir).multiplyScalar(1000);
    scene.add(this.sun);

    const skyUniforms = {
      uHorizon: { value: SKY_HORIZON },
      uMid: { value: SKY_MID },
      uZenith: { value: SKY_ZENITH },
      uSunDir: { value: sunDir },
    };
    this.dome = new Mesh(
      new SphereGeometry(1000, 32, 16),
      new ShaderMaterial({ uniforms: skyUniforms, vertexShader: domeVert, fragmentShader: domeFrag, side: BackSide, depthWrite: false, fog: false }),
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    const cloudMat = (fadeNear: number) =>
      new ShaderMaterial({
        uniforms: UniformsUtils.merge([
          UniformsLib.fog,
          {
            uSun: { value: sunDir.clone() },
            uLit: { value: new Color('#ffffff').multiplyScalar(1.05) },
            uShade: { value: new Color('#bcd2f7') },
            uFadeNear: { value: fadeNear },
          },
        ]),
        vertexShader: cloudVert,
        fragmentShader: cloudFrag,
        fog: true,
      });

    const rng = mulberry32(config.world.seed + 99);
    const mk = (specs: CloudSpec[], fadeNear: number): Group => {
      const total = specs.reduce((a, s) => a + s.puffs, 0);
      const mesh = new InstancedMesh(new IcosahedronGeometry(1, 2), cloudMat(fadeNear), total);
      const m = new Matrix4();
      let idx = 0;
      for (const s of specs) {
        for (let p = 0; p < s.puffs; p++) {
          const u = p / s.puffs;
          // Wide, flat-bottomed cluster: bigger puffs in the middle, smaller on top and edges.
          const ang = rng() * Math.PI * 2;
          const rad = Math.sqrt(rng()) * s.size * 0.9;
          const px = s.x + Math.cos(ang) * rad;
          const pz = s.z + Math.sin(ang) * rad * 0.7;
          const core = 1 - rad / (s.size * 0.9);
          const ps = s.size * (0.28 + 0.3 * core) * (0.7 + 0.5 * rng());
          const py = s.y + ps * 0.45 + core * s.size * 0.32 * (0.4 + u * 0.6);
          m.makeScale(ps, ps * 0.78, ps);
          m.setPosition(px, py, pz);
          mesh.setMatrixAt(idx++, m);
        }
      }
      mesh.frustumCulled = false;
      const g = new Group();
      g.add(mesh);
      return g;
    };

    const nearSpecs: CloudSpec[] = [];
    for (let i = 0; i < 46; i++) {
      nearSpecs.push({
        x: (rng() * 2 - 1) * 2600,
        y: 250 + rng() * 450,
        z: (rng() * 2 - 1) * 2600,
        size: 70 + rng() * 130,
        puffs: 9 + Math.floor(rng() * 5),
      });
    }
    this.near = mk(nearSpecs, 55);
    scene.add(this.near);

    const ringSpecs: CloudSpec[] = [];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rng() * 0.2;
      const r = 4800 + rng() * 2200;
      ringSpecs.push({ x: Math.cos(a) * r, y: 180 + rng() * 600, z: Math.sin(a) * r, size: 450 + rng() * 450, puffs: 12 });
    }
    this.ring = mk(ringSpecs, 300);
    scene.add(this.ring);
  }

  update(camera: PerspectiveCamera, _t: number): void {
    const under = this.scene.userData.underwater === true;
    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(Math.max(1, camera.far * 0.5) / 1000);
    this.dome.visible = !under;
    this.near.visible = !under;
    this.ring.visible = !under;
    this.ring.position.set(camera.position.x, 0, camera.position.z);
    if (this.scene.background instanceof Color) {
      this.scene.background.copy(under ? UNDERWATER_FOG : this.horizonLinear);
    }
    this.sun.position.copy(camera.position).addScaledVector(this.sunDir.set(...config.render.sunDir).normalize(), 1000);
    this.sun.target.position.copy(camera.position);
    this.sun.target.updateMatrixWorld();
  }
}
