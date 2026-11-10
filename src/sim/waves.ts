/**
 * Ocean surface height. The sim (water.ts) and the ocean shader (render/ocean.ts) must agree,
 * so the shader gets its GLSL from wavesGLSL() and its uniforms from waveUniformData().
 * Simple sum of directional sines (vertical displacement only) so CPU and GPU match exactly.
 */
import { config } from '../core/config';

const TAU = Math.PI * 2;

/** Water surface height at (x, z) and time t (seconds). */
export function waveHeight(x: number, z: number, t: number): number {
  let h = 0;
  for (const [dx, dz, len, amp, speed] of config.water.waves.list) {
    const inv = 1 / Math.hypot(dx, dz);
    const k = TAU / len;
    h += amp * Math.sin(k * ((dx * x + dz * z) * inv - speed * t));
  }
  return h;
}

export const MAX_WAVES = 4;

/**
 * Packed uniforms: vec4(dirX, dirZ, k, amp) and float speed per wave, normalized directions.
 * Re-read every frame so debug-panel edits apply.
 */
export function waveUniformData(): { a: Float32Array; speed: Float32Array; count: number } {
  const a = new Float32Array(MAX_WAVES * 4);
  const speed = new Float32Array(MAX_WAVES);
  const list = config.water.waves.list.slice(0, MAX_WAVES);
  list.forEach(([dx, dz, len, amp, s], i) => {
    const inv = 1 / Math.hypot(dx, dz);
    a.set([dx * inv, dz * inv, TAU / len, amp], i * 4);
    speed[i] = s;
  });
  return { a, speed, count: list.length };
}

/**
 * GLSL: declares uniforms uWaveA[4], uWaveSpeed[4], uWaveCount, and functions
 *   float waveHeight(vec2 xz, float t);
 *   vec3 waveNormal(vec2 xz, float t);
 */
export function wavesGLSL(): string {
  return /* glsl */ `
uniform vec4 uWaveA[${MAX_WAVES}];
uniform float uWaveSpeed[${MAX_WAVES}];
uniform int uWaveCount;
float waveHeight(vec2 xz, float t) {
  float h = 0.0;
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    if (i >= uWaveCount) break;
    vec4 w = uWaveA[i];
    h += w.w * sin(w.z * (dot(w.xy, xz) - uWaveSpeed[i] * t));
  }
  return h;
}
vec3 waveNormal(vec2 xz, float t) {
  vec2 g = vec2(0.0);
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    if (i >= uWaveCount) break;
    vec4 w = uWaveA[i];
    g += w.w * w.z * cos(w.z * (dot(w.xy, xz) - uWaveSpeed[i] * t)) * w.xy;
  }
  return normalize(vec3(-g.x, 1.0, -g.y));
}
`;
}
