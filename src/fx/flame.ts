/** Afterburner flame: layered additive cones with flickering shader noise, plus a heat-glow sprite. */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Mesh,
  type Object3D,
  Sprite,
  SpriteMaterial,
  ShaderMaterial,
} from 'three';

const VERT = /* glsl */ `
uniform float uLen;
uniform float uRad;
uniform float uTime;
varying float vU;
varying float vAng;
void main() {
  float u = position.z;
  vU = u;
  vAng = atan(position.y, position.x);
  float wob = 1.0 + 0.12 * sin(u * 9.0 - uTime * 55.0 + vAng * 3.0) + 0.06 * sin(uTime * 83.0 + u * 20.0);
  float r = uRad * pow(1.0 - u, 0.75) * (0.55 + 0.45 * smoothstep(0.0, 0.25, u) + 0.25 * sin(u * 3.14159)) * wob;
  vec3 p = vec3(position.xy * r, u * uLen);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
const FRAG = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uI;
uniform float uLen;
uniform float uTime;
uniform float uDiamond;
varying float vU;
varying float vAng;
void main() {
  float fall = pow(1.0 - vU, 1.3);
  float flick = 0.8 + 0.2 * sin(vU * 14.0 - uTime * 70.0 + vAng * 2.0) * sin(uTime * 41.0 + vAng);
  float dia = pow(abs(sin(vU * uLen * 1.25)), 6.0) * uDiamond * (1.0 - vU);
  vec3 c = mix(uColB, uColA, smoothstep(0.0, 0.7, vU));
  c *= uI * (fall * flick + dia * 1.5);
  float a = clamp(fall * 1.1 + dia, 0.0, 1.0) * smoothstep(0.0, 0.04, vU + 0.02);
  gl_FragColor = vec4(c, a);
}
`;

function coneGeo(): BufferGeometry {
  const seg = 14;
  const rings = 10;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos.push(Math.cos(a), Math.sin(a), j / rings);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * seg + i;
      const b = j * seg + ((i + 1) % seg);
      idx.push(a, b, a + seg, b, b + seg, a + seg);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}

let glowTex: CanvasTexture | null = null;
function glowTexture(): CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new CanvasTexture(c);
  return glowTex;
}

interface Layer {
  mesh: Mesh;
  mat: ShaderMaterial;
  lenMul: number;
}

export class Flame {
  private readonly layers: Layer[] = [];
  private readonly sprite: Sprite;
  private readonly spriteMat: SpriteMaterial;
  len = 0;
  intensity = 1;
  private readonly seed: number;

  private readonly glowColor: Color;

  /** palette: 'magenta' main engines, 'yellow' boost thrusters. scale: radius multiplier. */
  constructor(anchor: Object3D, geo: BufferGeometry, seed: number, palette: 'magenta' | 'yellow' = 'magenta', scale = 1) {
    this.seed = seed;
    const defs: [number, number, Color, Color, number][] =
      palette === 'yellow'
        ? [
            [0.62, 1.0, new Color(3.2, 1.7, 0.15), new Color(3.8, 2.6, 0.5), 1],
            [0.34, 0.75, new Color(4.6, 4.0, 1.4), new Color(5.0, 4.8, 3.2), 0.8],
          ]
        : [
            [0.62, 1.0, new Color(2.6, 0.35, 2.0), new Color(3.4, 0.9, 3.0), 1],
            [0.36, 0.7, new Color(4.5, 2.4, 4.2), new Color(5.0, 4.2, 5.0), 0.8],
          ];
    this.glowColor = palette === 'yellow' ? new Color(3, 2.2, 0.4) : new Color(3, 0.7, 2.6);
    for (const [rad0, lenMul, a, b, i] of defs) {
      const rad = rad0 * scale;
      const mat = new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uLen: { value: 1 },
          uRad: { value: rad },
          uTime: { value: 0 },
          uI: { value: i },
          uDiamond: { value: 0 },
          uColA: { value: a },
          uColB: { value: b },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      });
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 13;
      anchor.add(mesh);
      this.layers.push({ mesh, mat, lenMul });
    }
    this.spriteMat = new SpriteMaterial({
      map: glowTexture(),
      color: new Color(3, 0.7, 2.6),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    });
    this.sprite = new Sprite(this.spriteMat);
    this.sprite.renderOrder = 14;
    this.sprite.position.z = 0.4;
    anchor.add(this.sprite);
  }

  update(time: number, len: number, intensity: number, diamond: number): void {
    this.len = len;
    const flick = 0.9 + 0.1 * Math.sin(time * 57 + this.seed) + 0.05 * Math.sin(time * 91 + this.seed * 3);
    for (const l of this.layers) {
      const L = Math.max(0.01, len * l.lenMul * flick);
      l.mesh.visible = len > 0.05;
      l.mat.uniforms.uLen!.value = L;
      l.mat.uniforms.uTime!.value = time + this.seed;
      l.mat.uniforms.uI!.value = intensity;
      l.mat.uniforms.uDiamond!.value = diamond;
    }
    const sz = (1.4 + len * 0.22) * flick;
    this.sprite.scale.set(sz, sz, 1);
    this.spriteMat.color.copy(this.glowColor).multiplyScalar(intensity);
    this.sprite.visible = len > 0.05;
  }
}

export { coneGeo };
