/** Procedural game audio: everything synthesized with Web Audio, no files. */
import { config } from '../core/config';
import type { ShipState, SimEvent } from '../sim/types';
import {
  brakeTearLevel,
  engineLevel,
  engineRoarHz,
  engineWhineHz,
  impactScale,
  muffleHz,
  skimLevel,
  windHz,
  windLevel,
} from './mapping';

const MUTE_KEY = 'overdrive.muted';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private started = false;
  private muted = false;
  private noise: AudioBuffer | null = null;
  /** Brown (1/f²) noise: energy in the lows, the base for booms, punches and rumbles. */
  private brown: AudioBuffer | null = null;

  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private bus!: GainNode;
  private busEngine!: GainNode;
  private busWind!: GainNode;
  private busBoost!: GainNode;
  private busSfx!: GainNode;
  private busWater!: GainNode;

  private roar!: GainNode;
  private roarFilter!: BiquadFilterNode;
  private whine!: GainNode;
  private whineOscs: OscillatorNode[] = [];
  private whineFilter!: BiquadFilterNode;
  private boost!: GainNode;
  private boostThump!: GainNode;
  private wind!: GainNode;
  private windFilter!: BiquadFilterNode;
  private tear!: GainNode;
  private tearFilter!: BiquadFilterNode;
  private spray!: GainNode;

  private busGun!: GainNode;
  private gunVerbIn!: GainNode;
  private busMissile!: GainNode;
  private rumble!: GainNode;
  private lastGun = -10;
  private lastLaunch = -10;
  private lastBoom = -10;
  private lastHit = -10;
  private readonly gunVoices: number[] = [];
  private readonly launchVoices: number[] = [];
  private readonly boomVoices: number[] = [];
  private readonly shipPos = { x: 0, y: 0, z: 0 };
  private prevThrottle = 0;
  private bubbleT = 0;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* storage unavailable */
    }
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat) this.toggleMute();
    });
    // Silence everything while the app is in the background; pick back up on return.
    const away = () => void this.ctx?.suspend().catch(() => undefined);
    const back = () => {
      if (this.started && this.ctx && !document.hidden && document.hasFocus()) void this.ctx.resume().catch(() => undefined);
    };
    window.addEventListener('blur', away);
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', () => (document.hidden ? away() : back()));
    try {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) this.ctx = new AC();
    } catch {
      this.ctx = null;
    }
  }

  toggleMute(): void {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  resume(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (!this.started) {
        this.build(ctx);
        this.started = true;
      }
      if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    } catch {
      this.ctx = null;
    }
  }

  // ---------- graph construction ----------

  private mkNoise(ctx: AudioContext): AudioBuffer {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private mkBrown(ctx: AudioContext): AudioBuffer {
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  /** Generated reverb impulse: decaying noise, low-passed more as it decays (dark tail). */
  private mkVerb(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        const k = 0.5 * Math.exp(-t * 6); // one-pole coefficient shrinks: darker over time
        lp += (Math.random() * 2 - 1 - lp) * (0.05 + k);
        d[i] = lp * Math.exp(-t / decay);
      }
    }
    return buf;
  }

  private noiseSrc(ctx: AudioContext): AudioBufferSourceNode {
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    return n;
  }

  private mkGain(ctx: AudioContext, v: number, dest: AudioNode): GainNode {
    const g = ctx.createGain();
    g.gain.value = v;
    g.connect(dest);
    return g;
  }

  private mkFilter(ctx: AudioContext, type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  private mkCurve(amount: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * amount);
    return c;
  }

  private build(ctx: AudioContext): void {
    this.noise = this.mkNoise(ctx);
    this.brown = this.mkBrown(ctx);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = this.mkGain(ctx, 0, comp);
    this.muffle = this.mkFilter(ctx, 'lowpass', 20000, 0.5);
    this.muffle.connect(this.master);
    this.bus = this.mkGain(ctx, 1, this.muffle);
    this.busEngine = this.mkGain(ctx, config.audio.engine, this.bus);
    this.busWind = this.mkGain(ctx, config.audio.wind, this.bus);
    this.busBoost = this.mkGain(ctx, config.audio.boost, this.bus);
    this.busSfx = this.mkGain(ctx, config.audio.sfx, this.bus);
    this.busWater = this.mkGain(ctx, config.audio.water, this.bus);
    this.busGun = this.mkGain(ctx, 1, this.bus);
    // Gun space: a dark generated reverb plus a low slapback echo, so shots bloom instead of
    // sounding dry. Both are sends from the gun bus.
    const verb = ctx.createConvolver();
    verb.buffer = this.mkVerb(ctx, 0.9, 0.22);
    this.gunVerbIn = this.mkGain(ctx, config.audio.gunReverb, verb);
    this.busGun.connect(this.gunVerbIn);
    verb.connect(this.mkFilter(ctx, 'lowpass', 2200, 0.5)).connect(this.bus);
    const slap = ctx.createDelay(0.5);
    slap.delayTime.value = 0.13;
    const slapFb = this.mkGain(ctx, 0.28, slap);
    const slapLp = this.mkFilter(ctx, 'lowpass', 900, 0.5);
    this.busGun.connect(this.mkGain(ctx, 0.35, slap));
    slap.connect(slapLp);
    slapLp.connect(slapFb);
    slapLp.connect(this.bus);
    this.busMissile = this.mkGain(ctx, 1, this.bus);

    // Gun mechanical rumble: lowpassed noise, gated by recent gunFire events.
    // (An AudioBufferSourceNode's buffer can only be set once: build this one directly.)
    const rSrc = ctx.createBufferSource();
    rSrc.buffer = this.brown;
    rSrc.loop = true;
    const rLp = this.mkFilter(ctx, 'lowpass', 300, 1.2);
    this.rumble = this.mkGain(ctx, 0, this.busGun);
    rSrc.connect(rLp).connect(this.rumble);
    rSrc.start();

    // Engine roar: lowpassed noise.
    const roarSrc = this.noiseSrc(ctx);
    this.roarFilter = this.mkFilter(ctx, 'lowpass', 500, 1);
    this.roar = this.mkGain(ctx, 0, this.busEngine);
    roarSrc.connect(this.roarFilter).connect(this.roar);
    roarSrc.start();

    // Engine whine: two detuned saws + a square, lowpassed.
    this.whineFilter = this.mkFilter(ctx, 'lowpass', 1200, 2);
    this.whine = this.mkGain(ctx, 0, this.busEngine);
    this.whineFilter.connect(this.whine);
    for (const [type, det] of [
      ['sawtooth', -9],
      ['sawtooth', 9],
      ['square', 1200],
    ] as [OscillatorType, number][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = det;
      o.connect(this.mkGain(ctx, type === 'square' ? 0.25 : 0.5, this.whineFilter));
      o.start();
      this.whineOscs.push(o);
    }

    // Boost: distorted noise with a square crackle LFO, plus a wobbling low thump.
    const bSrc = this.noiseSrc(ctx);
    const bLp = this.mkFilter(ctx, 'lowpass', 1800, 0.8);
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.mkCurve(6);
    this.boost = this.mkGain(ctx, 0, this.busBoost);
    const crackle = this.mkGain(ctx, 0.6, this.boost);
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 23;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.4;
    lfo.connect(lfoG).connect(crackle.gain);
    lfo.start();
    bSrc.connect(shaper).connect(bLp).connect(crackle);
    bSrc.start();
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.value = 44;
    const thumpLfo = ctx.createOscillator();
    thumpLfo.frequency.value = 9;
    const tlG = ctx.createGain();
    tlG.gain.value = 12;
    thumpLfo.connect(tlG).connect(thump.frequency);
    thumpLfo.start();
    this.boostThump = this.mkGain(ctx, 0, this.busBoost);
    thump.connect(this.boostThump);
    thump.start();

    // Wind: bandpassed noise.
    const wSrc = this.noiseSrc(ctx);
    this.windFilter = this.mkFilter(ctx, 'bandpass', 500, 0.8);
    this.wind = this.mkGain(ctx, 0, this.busWind);
    wSrc.connect(this.windFilter).connect(this.wind);
    wSrc.start();

    // Airbrake air tear.
    const tSrc = this.noiseSrc(ctx);
    this.tearFilter = this.mkFilter(ctx, 'bandpass', 2200, 0.6);
    this.tear = this.mkGain(ctx, 0, this.busSfx);
    tSrc.connect(this.tearFilter).connect(this.tear);
    tSrc.start();

    // Skim spray hiss.
    const sSrc = this.noiseSrc(ctx);
    const sHp = this.mkFilter(ctx, 'highpass', 3500, 0.5);
    this.spray = this.mkGain(ctx, 0, this.busWater);
    sSrc.connect(sHp).connect(this.spray);
    sSrc.start();
  }

  // ---------- per-frame ----------

  update(dt: number, s: ShipState): void {
    const ctx = this.ctx;
    if (!ctx || !this.started || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const a = config.audio;
    const bs = config.flight.boostSpeed;
    const tc = 0.08;
    this.shipPos.x = s.pos.x;
    this.shipPos.y = s.pos.y;
    this.shipPos.z = s.pos.z;
    this.rumble.gain.setTargetAtTime(t - this.lastGun < 0.12 ? a.gun * 0.9 : 0, t, 0.04);
    this.gunVerbIn.gain.setTargetAtTime(a.gunReverb, t, 0.05);

    this.master.gain.setTargetAtTime(this.muted ? 0 : a.master, t, 0.05);
    this.busEngine.gain.setTargetAtTime(a.engine, t, 0.1);
    this.busWind.gain.setTargetAtTime(a.wind, t, 0.1);
    this.busBoost.gain.setTargetAtTime(a.boost, t, 0.1);
    this.busSfx.gain.setTargetAtTime(a.sfx, t, 0.1);
    this.busWater.gain.setTargetAtTime(a.water, t, 0.1);
    this.muffle.frequency.setTargetAtTime(muffleHz(s.submerged), t, 0.04);

    const lvl = engineLevel(s.throttleState, s.speed, s.holdTimer, s.stalled, bs);
    const whineHz = engineWhineHz(s.speed, s.throttleState, bs);
    for (const o of this.whineOscs) o.frequency.setTargetAtTime(whineHz, t, tc);
    this.whineFilter.frequency.setTargetAtTime(whineHz * 3, t, tc);
    this.whine.gain.setTargetAtTime(lvl * 0.12, t, tc);
    this.roarFilter.frequency.setTargetAtTime(engineRoarHz(s.speed, s.throttleState, bs), t, tc);
    this.roar.gain.setTargetAtTime(lvl * 0.5, t, tc);

    const boosting = s.boosting && !s.submerged ? 1 : 0;
    this.boost.gain.setTargetAtTime(boosting * 0.6, t, boosting ? 0.15 : 0.3);
    this.boostThump.gain.setTargetAtTime(boosting * 0.7, t, 0.2);

    this.wind.gain.setTargetAtTime(windLevel(s.speed, s.stalled, bs) * 0.7, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(windHz(s.speed, bs), t, 0.15);

    const braking = s.throttleState === -1 && !s.stalled ? 1 : 0;
    if (braking && this.prevThrottle !== -1) this.brakeWhump();
    this.prevThrottle = s.throttleState;
    const tear = brakeTearLevel(s.speed, bs);
    this.tear.gain.setTargetAtTime(braking * tear * 0.5, t, braking ? 0.03 : 0.15);
    this.tearFilter.frequency.setTargetAtTime(900 + 2500 * tear, t, 0.1);

    this.spray.gain.setTargetAtTime((s.skimming ? skimLevel(s.speed, bs) : 0) * 0.8, t, 0.08);

    if (s.submerged) {
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) {
        const f = 300 + Math.random() * 500;
        this.tone(this.busWater, 'sine', f, f * 2, 0.15 + Math.random() * 0.15, 0.06 + Math.random() * 0.05);
        this.bubbleT = 0.05 + Math.random() * 0.25;
      }
    }
  }

  // ---------- one-shots ----------

  handle(e: SimEvent): void {
    const ctx = this.ctx;
    if (!ctx || !this.started || ctx.state !== 'running') return;
    switch (e.type) {
      case 'waterEnter': {
        const k = Math.min(1, e.speed / 120);
        this.noiseBurst(this.busWater, 'lowpass', 1500, 0.7, 0.5 + k * 0.5, 0.01, 0.5 + k * 0.5, 200);
        this.tone(this.busWater, 'sine', 140, 35, 0.5 + k, 0.7);
        break;
      }
      case 'waterExit': {
        const k = Math.min(1, e.speed / 120);
        this.noiseBurst(this.busWater, 'bandpass', 3500, 0.5, 0.5 + k * 0.4, 0.005, 0.6, 6000);
        this.noiseBurst(this.busWater, 'highpass', 6000, 0.5, 0.3 + k * 0.3, 0.05, 0.9);
        this.tone(this.busWater, 'sine', 300, 120, 0.3, 0.3);
        break;
      }
      case 'terrainHit': {
        const k = impactScale(e.impact);
        this.noiseBurst(this.busSfx, 'lowpass', 2500, 0.8, 0.4 + k * 0.6, 0.002, 0.3 + k * 0.4, 300);
        this.tone(this.busSfx, 'sine', 110, 28, 0.5 + k, 0.35 + k * 0.3, 5);
        if (e.impact < 25) this.noiseBurst(this.busSfx, 'bandpass', 3000, 6, 0.4, 0.005, 0.35, 1800);
        break;
      }
      case 'ram': {
        const k = 0.5 + impactScale(e.impact) * 0.5;
        const base = 180 + Math.random() * 40;
        for (const r of [1, 2.76, 5.4, 8.93]) {
          this.tone(
            this.busSfx,
            'square',
            base * r,
            base * r * 0.97,
            (0.18 * k) / Math.sqrt(r),
            0.5 + 0.3 / r,
          );
        }
        this.noiseBurst(this.busSfx, 'bandpass', 4000, 1.5, 0.7 * k, 0.001, 0.12);
        this.tone(this.busSfx, 'sine', 90, 40, 0.8 * k, 0.25, 3);
        break;
      }
      case 'kill':
        this.explosion(1);
        break;
      case 'gunFire':
        this.gunShot();
        break;
      case 'missileLaunch':
        this.launchWhoosh();
        break;
      case 'missileExplode':
        this.missileBoom(e.pos, e.surface);
        break;
      case 'hit':
        this.hitTick(e.by);
        break;
      case 'stallStart':
        for (let i = 0; i < 4; i++)
          this.noiseBurst(this.busEngine, 'lowpass', 600 - i * 100, 1, 0.5, 0.002, 0.06, 120, 3);
        this.tone(this.busEngine, 'sawtooth', 220, 50, 0.3, 0.5);
        this.tone(this.busSfx, 'square', 90, 30, 0.25, 0.35, 4);
        break;
      case 'stallEnd':
        this.tone(this.busEngine, 'sawtooth', 70, 320, 0.25, 0.6);
        this.noiseBurst(this.busEngine, 'lowpass', 300, 1, 0.6, 0.15, 0.5, 2500);
        this.tone(this.busSfx, 'square', 60, 110, 0.2, 0.2, 3);
        break;
      case 'boostStart':
        this.noiseBurst(this.busBoost, 'bandpass', 600, 0.8, 0.9, 0.04, 0.7, 4000);
        this.tone(this.busBoost, 'sine', 160, 38, 1, 0.5, 4);
        this.noiseBurst(this.busBoost, 'lowpass', 3000, 0.7, 0.5, 0.001, 0.12);
        break;
      default:
        break;
    }
  }

  /** Big drone explosion (also scaled down for missile booms). */
  private explosion(k: number): void {
    // Punch: a short, saturated low-mid crack that sells the instant of the blast.
    this.noiseBurst(this.busSfx, 'lowpass', 1800, 0.7, 0.9 * k, 0.002, 0.14, 250, 4, true);
    // Body: deep brown-noise roar sinking toward the sub range.
    this.noiseBurst(this.busSfx, 'lowpass', 520, 0.9, 1.5 * k, 0.006, 1.7, 55, 3, true);
    // Sub drop: felt more than heard.
    this.tone(this.busSfx, 'sine', 58, 24, 1.5 * k, 1.3, 2);
    // Rolling tail: slow-swelling low rumble, like thunder after the flash.
    this.noiseBurst(this.busSfx, 'lowpass', 180, 0.7, 0.8 * k, 0.12, 2.6, 60, 0, true);
  }

  private voiceFree(list: number[], cap: number, now: number): boolean {
    while (list.length && list[0]! < now) list.shift();
    return list.length < cap;
  }

  private gunShot(): void {
    const t = this.ctx!.currentTime;
    this.lastGun = t;
    if (!this.voiceFree(this.gunVoices, 6, t)) return;
    this.gunVoices.push(t + 0.09);
    const v = config.audio.gun;
    const r = Math.random();
    // Report: a short, wide-band (low Q, so no "knock") burst, kept under 2.5 kHz so it isn't shrill.
    this.noiseBurst(this.busGun, 'bandpass', 900 + r * 300, 0.35, 0.9 * v, 0.0008, 0.035, 500, 2);
    // Body: a heavy, saturated low blast that sinks fast: most of the shot.
    this.noiseBurst(this.busGun, 'lowpass', 750 + r * 150, 0.6, 1.0 * v, 0.001, 0.12, 120, 4, true);
    // Thump: the round leaving the barrel, felt in the chest.
    this.tone(this.busGun, 'sine', 68 + r * 10, 32, 1.0 * v, 0.1, 2);
  }

  private launchWhoosh(): void {
    const t = this.ctx!.currentTime;
    if (t - this.lastLaunch < 0.04 || !this.voiceFree(this.launchVoices, 8, t)) return;
    this.lastLaunch = t;
    this.launchVoices.push(t + 0.35);
    const f = 900 + Math.random() * 1400;
    this.noiseBurst(this.busMissile, 'bandpass', f, 1.2, config.audio.missile * (0.6 + Math.random() * 0.4), 0.015, 0.28, f * 3);
    this.tone(this.busMissile, 'sawtooth', 160 + Math.random() * 80, 500 + Math.random() * 300, 0.05, 0.2);
  }

  private missileBoom(pos: { x: number; y: number; z: number }, surface: string): void {
    const t = this.ctx!.currentTime;
    const dx = pos.x - this.shipPos.x;
    const dy = pos.y - this.shipPos.y;
    const dz = pos.z - this.shipPos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const vol = 1 / (1 + (d / 140) * (d / 140));
    if (vol < 0.03 || t - this.lastBoom < 0.03 || !this.voiceFree(this.boomVoices, 8, t)) return;
    this.lastBoom = t;
    this.boomVoices.push(t + 0.7);
    const k = vol * 0.8 * config.audio.explosion;
    // Distance darkens the boom (air absorbs highs); close ones get the crack.
    const lp = 260 + 900 * vol;
    if (vol > 0.4) this.noiseBurst(this.busSfx, 'lowpass', 1500, 0.7, k * 0.7, 0.002, 0.1, 250, 4, true);
    this.noiseBurst(this.busSfx, 'lowpass', lp, 0.8, k * 1.3, 0.005, 0.9, 50, 3, true);
    this.tone(this.busSfx, 'sine', 62 + Math.random() * 12, 26, k * 1.3, 0.7, 2);
    if (surface === 'water') this.noiseBurst(this.busWater, 'highpass', 3000, 0.5, k * 0.5, 0.03, 0.6);
  }

  private hitTick(by: string): void {
    const t = this.ctx!.currentTime;
    if (t - this.lastHit < 0.035) return;
    this.lastHit = t;
    const f = 1500 + Math.random() * 900;
    this.tone(this.busSfx, 'triangle', f, f * 0.6, by === 'gun' ? 0.14 : 0.25, 0.07);
    this.noiseBurst(this.busSfx, 'bandpass', 4500, 2, 0.1, 0.001, 0.02);
  }

  private brakeWhump(): void {
    this.tone(this.busSfx, 'sine', 120, 40, 1, 0.3, 3);
    this.noiseBurst(this.busSfx, 'lowpass', 900, 1, 0.7, 0.003, 0.2, 150);
    this.tone(this.busSfx, 'square', 70, 45, 0.15, 0.15);
  }

  /** Filtered noise burst. sweepTo: filter end frequency (exponential); drive: distortion amount. */
  private noiseBurst(
    dest: AudioNode,
    type: BiquadFilterType,
    f0: number,
    q: number,
    vol: number,
    attack: number,
    decay: number,
    sweepTo?: number,
    drive = 0,
    brown = false,
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = brown ? this.brown : this.noise;
    const f = this.mkFilter(ctx, type, f0, q);
    if (sweepTo) {
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + attack + decay);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f);
    if (drive > 0) {
      const sh = ctx.createWaveShaper();
      sh.curve = this.mkCurve(drive);
      f.connect(sh);
      sh.connect(g);
    } else f.connect(g);
    g.connect(dest);
    src.start(t, Math.random());
    src.stop(t + attack + decay + 0.05);
  }

  /** Oscillator with an exponential pitch drop; drive adds distortion. */
  private tone(
    dest: AudioNode,
    type: OscillatorType,
    f0: number,
    f1: number,
    vol: number,
    dur: number,
    drive = 0,
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (drive > 0) {
      const sh = ctx.createWaveShaper();
      sh.curve = this.mkCurve(drive);
      o.connect(sh);
      sh.connect(g);
    } else o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}
