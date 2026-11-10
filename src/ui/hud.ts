/**
 * DOM HUD in the concept-art style: slanted navy panels with a magenta/cyan accent edge,
 * segmented bars, italic Chakra Petch, a yellow aim reticle and a cyan nose marker.
 *
 * Pure DOM (no canvas). Element refs are cached once and each frame only writes values that
 * changed. Styles are injected once into <head>. Everything is pointer-events: none.
 */
import type { PerspectiveCamera } from 'three';
import { config } from '../core/config';
import type { ShipState } from '../sim/types';

const SEGS = 20;
const GREEN = '#43ff8a';
const YELLOW = '#ffd23a';
const RED = '#ff3852';
const CYAN = '#2ee9ff';
const MAGENTA = '#ff3ccf';
const DIM = '#6e5a84';

const CSS = `
.hud{position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:'Chakra Petch',system-ui,sans-serif;font-style:italic;font-weight:500;color:#eef8ff;user-select:none}
.hud *{pointer-events:none;box-sizing:border-box}
.hud .panel{position:absolute;bottom:24px;padding:12px 18px 12px 20px;transform:skewX(-10deg);background:linear-gradient(90deg,rgba(7,16,48,.86),rgba(9,24,70,.64));box-shadow:0 8px 20px rgba(0,0,0,.35)}
.hud .panel::before{content:'';position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--a1),var(--a2))}
.hud .panel::after{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,var(--a1),var(--a2))}
.hud .panel-l{left:24px;width:min(330px,46vw);--a1:#2ee9ff;--a2:#ff3ccf}
.hud .panel-r{right:24px;width:min(250px,34vw);--a1:#ff3ccf;--a2:#ff8ad8}
.hud .panel-r.lock{opacity:.6}
.hud .row{display:flex;align-items:center;gap:10px;height:24px}
.hud .row+.row{margin-top:4px}
.hud .lbl{width:62px;font-size:13px;font-weight:700;letter-spacing:.14em;opacity:.9;white-space:nowrap}
.hud .val{min-width:58px;text-align:right;font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.hud .val small{font-size:12px;opacity:.75;margin-left:3px}
.hud .bar{flex:1;display:flex;gap:3px;height:13px;--c:${GREEN}}
.hud .seg{flex:1;background:rgba(255,255,255,.12)}
.hud .seg.on{background:var(--c);box-shadow:0 0 6px var(--c)}
.hud .bar.flash .seg.on{animation:hudblink .6s linear infinite}
.hud .tag{display:none;margin-left:auto;font-size:11px;font-weight:700;letter-spacing:.16em;padding:1px 7px;color:#06101f;background:${YELLOW}}
.hud .tag.on{display:inline-block}
.hud .tag.regen{background:${GREEN}}
.hud .tag.recharge{background:${MAGENTA};color:#fff;animation:hudblink 1s linear infinite}
.hud .tag.recharge.on{display:inline-block}
.hud .stall{position:absolute;left:50%;top:34%;display:none;text-align:center;transform:translate(-50%,-50%) skewX(-10deg);white-space:nowrap}
.hud .stall.on{display:block;animation:stallflash .45s linear infinite}
.hud .stall .big{font-size:72px;font-weight:700;line-height:1;letter-spacing:.1em;color:${RED};text-shadow:0 0 18px rgba(255,56,82,.85),0 0 2px #fff}
.hud .stall .sub{display:inline-block;margin-top:8px;padding:4px 14px;font-size:20px;font-weight:700;letter-spacing:.22em;color:#ffe3e8;background:rgba(40,0,12,.7);box-shadow:inset 3px 0 0 ${RED}}
.hud .reticle{display:none;position:absolute;left:50%;top:50%;width:76px;height:76px;transform:translate(-50%,-50%);filter:drop-shadow(0 0 4px rgba(255,210,0,.75))}
.hud .reticle.on{display:block}
.hud .nose{position:absolute;left:0;top:0;display:none;width:22px;height:22px;transform:translate(-50%,-50%);border:2px solid ${CYAN};border-radius:50%;box-shadow:0 0 6px ${CYAN}}
.hud .nose.on{display:block}
.hud .nose::after{content:'';position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;background:${CYAN}}
.hud .under{position:absolute;left:50%;bottom:160px;display:none;transform:translateX(-50%) skewX(-10deg);padding:4px 16px;font-size:14px;font-weight:700;letter-spacing:.24em;color:#c8f8ff;background:rgba(8,60,120,.72);box-shadow:inset 3px 0 0 ${CYAN};white-space:nowrap}
.hud .under.on{display:block}
.hud .gate{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:radial-gradient(ellipse at center,rgba(5,10,30,.25),rgba(5,10,30,.72))}
.hud .gate.on{display:flex}
.hud .gate h1{margin:0;font-size:clamp(40px,7vw,72px);font-weight:700;letter-spacing:.12em;color:${YELLOW};text-shadow:0 0 16px rgba(255,210,58,.6),4px 4px 0 ${MAGENTA};transform:skewX(-10deg);animation:hudpulse 1.4s ease-in-out infinite}
.hud .card{display:grid;grid-template-columns:auto auto;gap:7px 20px;padding:14px 22px;transform:skewX(-10deg);font-size:16px;background:linear-gradient(90deg,rgba(7,16,48,.9),rgba(9,24,70,.72));box-shadow:inset 3px 0 0 ${MAGENTA},0 8px 20px rgba(0,0,0,.4)}
.hud .card kbd{display:inline-block;min-width:44px;padding:1px 8px;font:inherit;font-weight:700;font-style:italic;text-align:center;color:#06101f;background:#eef8ff}
.hud .card span{align-self:center;opacity:.92}
.hud .card .warn{color:${RED};font-weight:700}
@keyframes hudblink{0%,100%{opacity:1}50%{opacity:.15}}
@keyframes stallflash{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes hudpulse{0%,100%{transform:skewX(-10deg) scale(1)}50%{transform:skewX(-10deg) scale(1.04)}}
`;

function make(tag: string, cls = '', text = ''): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** Text node writer that skips the DOM write when the string has not changed. */
class Txt {
  private v = '';
  constructor(private readonly node: HTMLElement) {}
  set(v: string): void {
    if (v !== this.v) {
      this.v = v;
      this.node.textContent = v;
    }
  }
}

/** Class toggle that only touches the DOM on change. */
class Toggle {
  private on = false;
  constructor(
    private readonly node: HTMLElement,
    private readonly cls: string,
  ) {}
  set(on: boolean): void {
    if (on !== this.on) {
      this.on = on;
      this.node.classList.toggle(this.cls, on);
    }
  }
}

/** Segmented bar. Lit segments are the first round(frac * SEGS). */
class SegBar {
  private lit = 0;
  private color = '';
  private readonly segs: HTMLElement[] = [];
  constructor(readonly node: HTMLElement) {
    for (let i = 0; i < SEGS; i++) {
      const seg = make('i', 'seg');
      node.appendChild(seg);
      this.segs.push(seg);
    }
  }
  set(frac: number, color: string): void {
    const n = Math.round(Math.min(1, Math.max(0, frac)) * SEGS);
    if (n !== this.lit) {
      const prev = this.lit;
      this.lit = n;
      const lo = Math.min(prev, n);
      const hi = Math.max(prev, n);
      for (let i = lo; i < hi; i++) this.segs[i]!.classList.toggle('on', n > prev);
    }
    if (color !== this.color) {
      this.color = color;
      this.node.style.setProperty('--c', color);
    }
  }
}

export class Hud {
  private readonly el: HTMLElement;
  private readonly shieldBar: SegBar;
  private readonly speedBar: SegBar;
  private readonly boostBar: SegBar;
  private readonly shieldFlash: Toggle;
  private readonly shieldNum: Txt;
  private readonly speedNum: Txt;
  private readonly altNum: Txt;
  private readonly boostNum: Txt;
  private readonly regenTag: Toggle;
  private readonly rechargeTag: Toggle;
  private readonly boostPanel: Toggle;
  private readonly stall: Toggle;
  private readonly under: Toggle;
  private readonly gate: Toggle;
  private readonly nose: Toggle;
  private readonly noseNode: HTMLElement;
  private readonly reticle: Toggle;
  private noseX = NaN;
  private noseY = NaN;

  constructor(root: HTMLElement) {
    if (!document.getElementById('hud-style')) {
      const style = make('style');
      style.id = 'hud-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    this.el = make('div', 'hud');
    root.appendChild(this.el);

    // Bottom-left: shield, speed, altitude.
    const left = make('div', 'panel panel-l');
    const shieldRow = make('div', 'row');
    shieldRow.append(make('span', 'lbl', 'SHIELD'));
    const shieldBarNode = make('div', 'bar');
    this.shieldBar = new SegBar(shieldBarNode);
    this.shieldFlash = new Toggle(shieldBarNode, 'flash');
    const shieldVal = make('span', 'val');
    this.shieldNum = new Txt(shieldVal);
    const regen = make('span', 'tag regen', 'REGEN');
    this.regenTag = new Toggle(regen, 'on');
    shieldRow.append(shieldBarNode, shieldVal, regen);

    const speedRow = make('div', 'row');
    speedRow.append(make('span', 'lbl', 'SPD'));
    const speedBarNode = make('div', 'bar');
    this.speedBar = new SegBar(speedBarNode);
    const speedVal = make('span', 'val');
    this.speedNum = new Txt(speedVal);
    speedVal.appendChild(make('small', '', 'm/s'));
    speedRow.append(speedBarNode, speedVal);

    const altRow = make('div', 'row');
    altRow.append(make('span', 'lbl', 'ALT'));
    const altVal = make('span', 'val');
    this.altNum = new Txt(altVal);
    altVal.appendChild(make('small', '', 'm'));
    altRow.append(altVal);
    left.append(shieldRow, speedRow, altRow);

    // Bottom-right: boost.
    const right = make('div', 'panel panel-r');
    const boostHead = make('div', 'row');
    boostHead.append(make('span', 'lbl', 'BOOST'));
    const rechargeNode = make('span', 'tag recharge', 'RECHARGE');
    this.rechargeTag = new Toggle(rechargeNode, 'on');
    boostHead.append(rechargeNode);
    const boostRow = make('div', 'row');
    const boostBarNode = make('div', 'bar');
    this.boostBar = new SegBar(boostBarNode);
    const boostVal = make('span', 'val');
    this.boostNum = new Txt(boostVal);
    boostVal.appendChild(make('small', '', '%'));
    boostRow.append(boostBarNode, boostVal);
    right.append(boostHead, boostRow);
    this.boostPanel = new Toggle(right, 'lock');

    // Center: reticle, nose marker, stall warning.
    const reticle = make('div', 'reticle');
    this.reticle = new Toggle(reticle, 'on');
    reticle.innerHTML = `
      <svg viewBox="0 0 64 64" width="76" height="76" fill="none" stroke="#ffd400" stroke-width="2.6" stroke-linecap="round">
        <path d="M22 6 C12 6 11 16 11 24 C11 29 9 31 6 32 C9 33 11 35 11 40 C11 48 12 58 22 58"/>
        <path d="M42 6 C52 6 53 16 53 24 C53 29 55 31 58 32 C55 33 53 35 53 40 C53 48 52 58 42 58"/>
        <path d="M32 19 L45 32 L32 45 L19 32 Z" stroke-width="2.4"/>
        <path d="M32 2 V14 M32 50 V62" stroke-width="2"/>
      </svg>`;
    this.noseNode = make('div', 'nose');
    this.nose = new Toggle(this.noseNode, 'on');

    const stall = make('div', 'stall');
    stall.append(make('div', 'big', 'FREE FALL'), make('div', 'sub', 'RELEASE S TO FLY'));
    this.stall = new Toggle(stall, 'on');

    const under = make('div', 'under', 'UNDERWATER');
    this.under = new Toggle(under, 'on');

    // Controls gate shown until the mouse is captured.
    const gate = make('div', 'gate');
    gate.appendChild(make('h1', '', 'CLICK TO FLY'));
    const card = make('div', 'card');
    const rows: [string, string][] = [
      ['Mouse', 'aim'],
      ['W', 'throttle'],
      ['S', 'brake (stall!)'],
      ['A / D', 'break turn'],
      ['Shift', 'boost'],
      ['F3', 'tuning'],
    ];
    for (const [key, what] of rows) {
      const k = make('kbd', '', key);
      const w = make('span', what.includes('stall') ? 'warn' : '', what);
      card.append(k, w);
    }
    gate.appendChild(card);
    this.gate = new Toggle(gate, 'on');

    // Gate first (backdrop), then the flight HUD above it so STALL and the aim marks stay readable.
    this.el.append(gate, left, right, reticle, this.noseNode, stall, under);
  }

  /** noseScreen: projected nose aim point in NDC (-1..1), or null if behind camera. */
  update(s: ShipState, _camera: PerspectiveCamera, noseScreen: { x: number; y: number } | null, locked: boolean): void {
    const shieldMax = Math.max(1e-6, config.combat.shieldMax);
    const shieldFrac = s.shield / shieldMax;
    const shieldColor = shieldFrac < 0.25 ? RED : shieldFrac < 0.5 ? YELLOW : GREEN;
    const regen = s.shieldDelay <= 0 && s.shield < shieldMax;
    this.shieldBar.set(shieldFrac, shieldColor);
    this.shieldFlash.set(regen);
    this.regenTag.set(regen);
    this.shieldNum.set(String(Math.round(s.shield)));

    this.speedBar.set(s.speed / Math.max(1e-6, config.flight.boostSpeed), CYAN);
    this.speedNum.set(String(Math.round(s.speed)));
    this.altNum.set(Math.max(0, Math.round(s.altitude)).toLocaleString('en-US'));

    const locked2 = s.boostLockout;
    this.boostBar.set(s.boostMeter, locked2 ? DIM : MAGENTA);
    this.boostPanel.set(locked2);
    this.rechargeTag.set(locked2);
    this.boostNum.set(String(Math.round(s.boostMeter * 100)));

    this.stall.set(s.stalled);
    this.under.set(s.submerged);
    this.gate.set(!locked);
    this.reticle.set(locked);

    if (noseScreen) {
      const px = Math.round((noseScreen.x * 0.5 + 0.5) * window.innerWidth);
      const py = Math.round((-noseScreen.y * 0.5 + 0.5) * window.innerHeight);
      if (px !== this.noseX) {
        this.noseX = px;
        this.noseNode.style.left = `${px}px`;
      }
      if (py !== this.noseY) {
        this.noseY = py;
        this.noseNode.style.top = `${py}px`;
      }
      this.nose.set(true);
    } else {
      this.nose.set(false);
    }
  }
}
