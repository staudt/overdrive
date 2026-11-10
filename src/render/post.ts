/**
 * Postprocessing stack (pmndrs): scene -> [distortion: boost CA + radial blur + underwater wobble/grade]
 * -> [bloom + ACES tone mapping + shield/damage vignette]. Tone mapping lives here, not in the renderer.
 */
import {
  BloomEffect,
  BlendFunction,
  Effect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import { HalfFloatType, NoToneMapping, Uniform, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { config } from '../core/config';

export interface PostState {
  /** 0..1 boost intensity (FOV kick handled by camera; this drives CA / speed grading). */
  boost: number;
  /** 0..1 missing shield fraction: red vignette strength, pulsing as it grows. */
  shieldLoss: number;
  /** 0..1 decaying flash on terrain hit / ram. */
  damageFlash: number;
  underwater: boolean;
  /** Seconds, for pulses. */
  time: number;
}

const distortFrag = /* glsl */ `
uniform float uBoost;
uniform float uUnder;
uniform float uTime;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  vec2 p = uv + uUnder * 0.0022 * vec2(sin(uv.y * 34.0 + uTime * 2.1), cos(uv.x * 28.0 + uTime * 1.7));
  float amt = uBoost * r2;
  vec3 col;
  vec2 dir = c * amt;
  if (uBoost > 0.001) {
    // radial blur toward the centre + chromatic split
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      float f = float(i) * 0.09;
      vec2 q = p - c * f * amt * 1.6;
      acc.r += texture2D(inputBuffer, q + dir * 0.25).r;
      acc.g += texture2D(inputBuffer, q).g;
      acc.b += texture2D(inputBuffer, q - dir * 0.25).b;
    }
    col = acc * 0.25;
  } else {
    col = texture2D(inputBuffer, p).rgb;
  }
  // Underwater grade: teal shift, slightly lifted blacks.
  vec3 tint = col * vec3(0.55, 0.95, 1.1) + vec3(0.0, 0.025, 0.04);
  col = mix(col, tint, uUnder * 0.7);
  outputColor = vec4(col, inputColor.a);
}
`;

const finalFrag = /* glsl */ `
uniform float uLoss;
uniform float uFlash;
uniform float uTime;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 c = (uv - 0.5) * vec2(1.0, 0.82);
  float d = length(c) * 1.45;
  vec3 col = inputColor.rgb;
  // Shield depletion: red vignette growing inward and pulsing faster as the shield drops.
  float s = smoothstep(0.03, 0.9, uLoss);
  float pulse = 0.5 + 0.5 * sin(uTime * (3.0 + 12.0 * uLoss));
  float inner = mix(0.85, 0.28, s);
  float v = smoothstep(inner, inner + 0.5, d);
  col = mix(col, vec3(0.95, 0.03, 0.06), clamp(v * s * (0.6 + 0.4 * pulse) * 1.15, 0.0, 0.95));
  col *= 1.0 - 0.22 * smoothstep(0.55, 1.2, d);
  // Damage flash: white core fading to red at the edges.
  vec3 fl = mix(vec3(1.0, 0.92, 0.9), vec3(1.0, 0.1, 0.08), smoothstep(0.2, 0.9, d));
  col = mix(col, fl, uFlash * (0.22 + 0.5 * smoothstep(0.2, 1.0, d)));
  outputColor = vec4(col, inputColor.a);
}
`;

class DistortEffect extends Effect {
  constructor() {
    super('OverdriveDistort', distortFrag, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uBoost', new Uniform(0)],
        ['uUnder', new Uniform(0)],
        ['uTime', new Uniform(0)],
      ]),
    });
  }
  set(boost: number, under: number, time: number): void {
    this.uniforms.get('uBoost')!.value = boost;
    this.uniforms.get('uUnder')!.value = under;
    this.uniforms.get('uTime')!.value = time;
  }
}

class FinalEffect extends Effect {
  constructor() {
    super('OverdriveFinal', finalFrag, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uLoss', new Uniform(0)],
        ['uFlash', new Uniform(0)],
        ['uTime', new Uniform(0)],
      ]),
    });
  }
  set(loss: number, flash: number, time: number): void {
    this.uniforms.get('uLoss')!.value = loss;
    this.uniforms.get('uFlash')!.value = flash;
    this.uniforms.get('uTime')!.value = time;
  }
}

export class Post {
  private readonly composer: EffectComposer;
  private readonly bloom: BloomEffect;
  private readonly distort = new DistortEffect();
  private readonly final = new FinalEffect();
  private readonly smaaPass: EffectPass;
  private boost = 0;
  private under = 0;

  constructor(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
  ) {
    renderer.toneMapping = NoToneMapping;
    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: config.render.bloomThreshold,
      luminanceSmoothing: 0.25,
      intensity: config.render.bloomStrength,
      radius: 0.72,
    });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.composer.addPass(new EffectPass(camera, this.distort));
    this.composer.addPass(new EffectPass(camera, this.bloom, tone, this.final));
    // Anti-aliasing last, on the tone-mapped image (cleans canyon rims and wing edges).
    this.smaaPass = new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH }));
    this.composer.addPass(this.smaaPass);
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  render(dt: number, state: PostState): void {
    const k = 1 - Math.exp(-dt * 8);
    this.boost += (state.boost - this.boost) * k;
    this.under += ((state.underwater ? 1 : 0) - this.under) * k;
    this.smaaPass.enabled = config.render.smaa;
    this.bloom.intensity = config.render.bloomStrength;
    this.bloom.luminanceMaterial.threshold = config.render.bloomThreshold;
    this.distort.set(this.boost, this.under, state.time);
    this.final.set(state.shieldLoss, state.damageFlash, state.time);
    this.composer.render(dt);
  }
}
