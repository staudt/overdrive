/**
 * DOM HUD in the concept-art style: slanted navy panels with a magenta/cyan accent edge,
 * segmented bars, italic Chakra Petch, a yellow aim reticle and a cyan nose marker.
 *
 * Pure DOM (no canvas). Element refs are cached once and each frame only writes values that
 * changed. Styles are injected once into <head>. Everything is pointer-events: none.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import { config } from '../core/config';
import type { ShipState, SimEvent } from '../sim/types';
import type { World } from '../sim/world';

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

const HI_KEY = 'overdrive.hiscore';
const HI_SAVE_MS = 1000;
const GAIN_LIFE = 1.0;
const BREAK_LIFE = 1.4;
const WAVE_LIFE = 1.5;
const HIT_LIFE = 0.18;
const KILL_LIFE = 0.32;
const LOCK_ANIM = 0.25;
const POP_LIFE = 0.8;
const POP_COUNT = 12;
const BREAK_MIN = 10;
const LOCK_MIN_PX = 36;
const LOCK_MAX_PX = 180;
const RACK_CELLS = 12;

const COMBAT_CSS = `
.hud .panel.top{top:24px;bottom:auto;left:24px;width:min(380px,52vw);--a1:#2ee9ff;--a2:#ff3ccf;padding:10px 18px 12px 20px}
.hud .panel.mpanel{bottom:112px}
.hud .panel.mpanel.stream{animation:hudglow .5s ease-in-out infinite}
.hud .row.big{height:38px}
.hud .lbl.w{width:96px}
.hud .score{flex:1;text-align:right;font-size:32px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;text-shadow:0 0 12px rgba(46,233,255,.4)}
.hud .hi{flex:1;text-align:right;font-size:16px;font-weight:500;opacity:.85;font-variant-numeric:tabular-nums;white-space:nowrap}
.hud .chain{display:none;margin-top:8px}
.hud .chain.on{display:block}
.hud .chainrow{display:flex;align-items:baseline;gap:6px;line-height:1;transform-origin:left center}
.hud .chainrow.pulse{animation:chainpop .22s ease-out}
.hud .cx{font-size:26px;font-weight:700;color:${YELLOW};text-shadow:0 0 10px rgba(255,210,58,.5),2px 2px 0 #3a2400;white-space:nowrap}
.hud .cn{font-size:50px;font-weight:700;color:${YELLOW};text-shadow:0 0 12px rgba(255,210,58,.5),2px 2px 0 #3a2400;font-variant-numeric:tabular-nums}
.hud .cbar{height:5px;margin-top:8px;background:rgba(255,255,255,.14)}
.hud .cfill{display:block;height:100%;background:${YELLOW};box-shadow:0 0 6px rgba(255,210,58,.8);transform-origin:left center}
.hud .gain{display:none;margin-top:4px;text-align:right;font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 0 8px rgba(255,60,207,.8)}
.hud .gain.on{display:block}
.hud .mhead .val{margin-left:auto}
.hud .tgt{margin-top:2px;font-size:12px;font-weight:700;letter-spacing:.18em;opacity:.9;white-space:nowrap}
.hud .rack{display:flex;gap:3px;height:18px;margin-top:6px}
.hud .mi{flex:1;background:rgba(255,255,255,.12);clip-path:polygon(0 0,100% 0,100% 60%,50% 100%,0 60%)}
.hud .mi.on{background:${YELLOW};box-shadow:0 0 6px rgba(255,210,58,.8)}
.hud .salvo{position:absolute;left:50%;bottom:17%;display:flex;align-items:center;gap:16px;white-space:nowrap;opacity:0;transform:translateX(-50%) skewX(-10deg);transition:opacity .3s}
.hud .salvo.on{opacity:1}
.hud .hz{width:84px;height:30px;background:repeating-linear-gradient(-60deg,${YELLOW} 0 9px,transparent 9px 16px)}
.hud .box{padding:6px 22px;font-size:28px;font-weight:700;letter-spacing:.12em;color:${YELLOW};border:3px solid ${YELLOW};background:rgba(8,14,40,.6);box-shadow:0 0 16px rgba(255,210,58,.4),inset 0 0 10px rgba(255,210,58,.2)}
.hud .hm{position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;color:#fff;opacity:0;transition:opacity .06s}
.hud .hm.on{opacity:1}
.hud .hm.kill{color:${RED};transform:scale(1.5)}
.hud .hm svg{display:block;width:100%;height:100%;overflow:visible;filter:drop-shadow(0 0 3px rgba(0,0,0,.6))}
.hud .pop{position:absolute;left:0;top:0;display:none;font-size:24px;font-weight:700;white-space:nowrap;color:#fff;font-variant-numeric:tabular-nums;text-shadow:0 0 8px rgba(255,210,58,.9),2px 2px 0 #3a1a00}
.hud .pop.on{display:block}
.hud .lk{position:absolute;left:0;top:0;display:none;filter:drop-shadow(0 0 4px rgba(255,56,82,.8));background:
  linear-gradient(${RED},${RED}) left top/14px 3px no-repeat,
  linear-gradient(${RED},${RED}) left top/3px 14px no-repeat,
  linear-gradient(${RED},${RED}) right top/14px 3px no-repeat,
  linear-gradient(${RED},${RED}) right top/3px 14px no-repeat,
  linear-gradient(${RED},${RED}) left bottom/14px 3px no-repeat,
  linear-gradient(${RED},${RED}) left bottom/3px 14px no-repeat,
  linear-gradient(${RED},${RED}) right bottom/14px 3px no-repeat,
  linear-gradient(${RED},${RED}) right bottom/3px 14px no-repeat}
.hud .lk.on{display:block}
.hud .wave{position:absolute;left:50%;top:30%;display:none;text-align:center;white-space:nowrap;transform:translate(-50%,-50%) skewX(-10deg)}
.hud .wave.on{display:block;animation:wavefade ${WAVE_LIFE}s ease-out forwards}
.hud .wave .wt{font-size:84px;font-weight:700;line-height:1;letter-spacing:.08em;color:${YELLOW};text-shadow:0 0 18px rgba(255,210,58,.6),4px 4px 0 ${MAGENTA}}
.hud .wave .ws{display:inline-block;margin-top:6px;padding:4px 16px;font-size:22px;font-weight:700;letter-spacing:.22em;color:#e8fbff;background:rgba(8,60,120,.75);box-shadow:inset 4px 0 0 ${CYAN}}
.hud .brk{position:absolute;left:50%;top:26%;display:none;white-space:nowrap;padding:6px 22px;font-size:40px;font-weight:700;letter-spacing:.08em;color:${YELLOW};background:rgba(20,10,40,.75);box-shadow:inset 4px 0 0 ${MAGENTA};text-shadow:0 0 12px rgba(255,210,58,.5);transform:translate(-50%,-50%) skewX(-10deg)}
.hud .brk.on{display:block;animation:brkfade ${BREAK_LIFE}s ease-out forwards}
@keyframes chainpop{0%{transform:scale(1.35)}100%{transform:scale(1)}}
@keyframes hudglow{0%,100%{box-shadow:0 8px 20px rgba(0,0,0,.35)}50%{box-shadow:0 0 24px rgba(255,60,207,.9),0 8px 20px rgba(0,0,0,.35)}}
@keyframes wavefade{0%{opacity:0;transform:translate(-50%,-50%) skewX(-10deg) scale(1.25)}10%{opacity:1;transform:translate(-50%,-50%) skewX(-10deg) scale(1)}80%{opacity:1;transform:translate(-50%,-50%) skewX(-10deg) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) skewX(-10deg) scale(1)}}
@keyframes brkfade{0%{opacity:0;transform:translate(-50%,-50%) skewX(-10deg) scale(1.4)}10%{opacity:1;transform:translate(-50%,-50%) skewX(-10deg) scale(1)}75%{opacity:1;transform:translate(-50%,-50%) skewX(-10deg) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) skewX(-10deg) scale(1)}}
`;

/** Restarts a CSS animation by removing and re-adding its class. */
function restart(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

const fmt = (n: number): string => Math.floor(n).toLocaleString('en-US');

interface Bracket {
  el: HTMLElement;
  on: boolean;
  size: number;
  tf: string;
}

interface Popup {
  el: HTMLElement;
  on: boolean;
  age: number;
  x: number;
  y: number;
}

/** Combat overlay: score and chain, missile rack, lock brackets, salvo banner, hit marks, popups, waves. */
class CombatHud {
  private readonly scoreNum: Txt;
  private readonly hiNum: Txt;
  private readonly chainBox: Toggle;
  private readonly chainRowEl: HTMLElement;
  private readonly chainNum: Txt;
  private readonly chainFill: HTMLElement;
  private fillQ = -1;
  private readonly gainBox: Toggle;
  private readonly gainNum: Txt;
  private readonly brkEl: HTMLElement;
  private readonly brkTxt: Txt;
  private readonly mPanelStream: Toggle;
  private readonly rackNum: Txt;
  private readonly targets: Txt;
  private readonly cells: HTMLElement[] = [];
  private litCells = 0;
  private readonly salvo: Toggle;
  private readonly waveEl: HTMLElement;
  private readonly waveTitle: Txt;
  private readonly waveSub: Txt;
  private readonly hmOn: Toggle;
  private readonly hmKill: Toggle;
  private readonly brackets: Bracket[] = [];
  private readonly pops: Popup[] = [];
  private readonly v = new Vector3();

  private lastScore = -1;
  private lastChain = -1;
  private gainAcc = 0;
  private gainT = 0;
  private breakT = 0;
  private waveT = 0;
  private hitT = 0;
  private hitKill = false;
  private hiStored = 0;
  private dirty = false;
  private lastSave = 0;
  private lastNow = performance.now();

  constructor(root: HTMLElement) {
    // Top-left: score, hi-score, chain, last gain.
    const top = make('div', 'panel top');
    const scoreRow = make('div', 'row big');
    scoreRow.append(make('span', 'lbl w', 'SCORE'));
    const scoreVal = make('span', 'score');
    scoreRow.append(scoreVal);
    this.scoreNum = new Txt(scoreVal);

    const hiRow = make('div', 'row');
    hiRow.append(make('span', 'lbl w', 'HI-SCORE'));
    const hiVal = make('span', 'hi');
    hiRow.append(hiVal);
    this.hiNum = new Txt(hiVal);

    const chain = make('div', 'chain');
    this.chainBox = new Toggle(chain, 'on');
    this.chainRowEl = make('div', 'chainrow');
    this.chainRowEl.append(make('span', 'cx', 'CHAIN ×'));
    const cn = make('span', 'cn');
    this.chainRowEl.append(cn);
    this.chainNum = new Txt(cn);
    const cbar = make('div', 'cbar');
    this.chainFill = make('i', 'cfill');
    cbar.append(this.chainFill);
    chain.append(this.chainRowEl, cbar);

    const gain = make('div', 'gain');
    this.gainBox = new Toggle(gain, 'on');
    this.gainNum = new Txt(gain);
    top.append(scoreRow, hiRow, chain, gain);

    // Bottom-right, above BOOST: missile rack.
    const mp = make('div', 'panel panel-r mpanel');
    this.mPanelStream = new Toggle(mp, 'stream');
    const mhead = make('div', 'row mhead');
    mhead.append(make('span', 'lbl w', 'MISSILES'));
    const rackVal = make('span', 'val');
    mhead.append(rackVal);
    this.rackNum = new Txt(rackVal);
    const tgt = make('div', 'tgt');
    this.targets = new Txt(tgt);
    const rack = make('div', 'rack');
    for (let i = 0; i < RACK_CELLS; i++) {
      const cell = make('i', 'mi');
      rack.append(cell);
      this.cells.push(cell);
    }
    mp.append(mhead, tgt, rack);

    // Center: salvo banner, wave banner, hit marker, chain break.
    const salvo = make('div', 'salvo');
    salvo.append(make('span', 'hz'), make('span', 'box', 'MISSILE SALVO'), make('span', 'hz'));
    this.salvo = new Toggle(salvo, 'on');

    this.waveEl = make('div', 'wave');
    const wt = make('div', 'wt');
    const ws = make('div', 'ws');
    this.waveEl.append(wt, ws);
    this.waveTitle = new Txt(wt);
    this.waveSub = new Txt(ws);

    const hm = make('div', 'hm');
    hm.innerHTML = `<svg viewBox="0 0 44 44" stroke="currentColor" stroke-width="4" stroke-linecap="square" fill="none"><path d="M8 8 L16 16 M36 8 L28 16 M8 36 L16 28 M36 36 L28 28"/></svg>`;
    this.hmOn = new Toggle(hm, 'on');
    this.hmKill = new Toggle(hm, 'kill');

    this.brkEl = make('div', 'brk');
    this.brkTxt = new Txt(this.brkEl);

    for (let i = 0; i < config.missiles.maxLocks; i++) {
      const el = make('div', 'lk');
      this.brackets.push({ el, on: false, size: 0, tf: '' });
    }
    for (let i = 0; i < POP_COUNT; i++) {
      const el = make('div', 'pop');
      this.pops.push({ el, on: false, age: 0, x: 0, y: 0 });
    }

    root.append(top, mp, salvo, this.waveEl, hm, this.brkEl);
    for (const b of this.brackets) root.append(b.el);
    for (const p of this.pops) root.append(p.el);

    // Hi-score from localStorage; the save is throttled and flushed on page hide.
    try {
      const v = Number(localStorage.getItem(HI_KEY));
      this.hiStored = Number.isFinite(v) ? v : 0;
    } catch {
      this.hiStored = 0;
    }
    window.addEventListener('pagehide', () => {
      if (this.dirty) this.saveHi(performance.now());
    });
  }

  update(world: World, camera: PerspectiveCamera, events: readonly SimEvent[]): void {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;

    for (const e of events) {
      if (e.type === 'hit') {
        if ((e.by === 'gun' || e.by === 'missile') && !(this.hitKill && this.hitT > 0)) {
          this.hitT = HIT_LIFE;
          this.hitKill = false;
        }
      } else if (e.type === 'kill') {
        this.hitT = KILL_LIFE;
        this.hitKill = true;
        this.spawnPop(e.pos, camera, e.points);
      } else if (e.type === 'chainEnd') {
        if (e.chain >= BREAK_MIN) {
          this.brkTxt.set(`CHAIN BREAK ×${e.chain}`);
          restart(this.brkEl, 'on');
          this.breakT = BREAK_LIFE;
        }
      } else if (e.type === 'waveStart') {
        this.waveTitle.set(`WAVE ${e.wave}`);
        this.waveSub.set(`${e.count} HOSTILES`);
        restart(this.waveEl, 'on');
        this.waveT = WAVE_LIFE;
      }
    }

    this.updateScore(world, now, dt);
    this.updateMissiles(world);
    this.updateLocks(world, camera);
    this.updatePops(dt);

    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) this.hitKill = false;
    }
    this.hmOn.set(this.hitT > 0);
    this.hmKill.set(this.hitKill && this.hitT > 0);

    if (this.breakT > 0) {
      this.breakT -= dt;
      if (this.breakT <= 0) this.brkEl.classList.remove('on');
    }
    if (this.waveT > 0) {
      this.waveT -= dt;
      if (this.waveT <= 0) this.waveEl.classList.remove('on');
    }
  }

  private updateScore(world: World, now: number, dt: number): void {
    const sc = world.score;
    if (this.lastScore >= 0 && sc.score > this.lastScore) {
      this.gainAcc += sc.score - this.lastScore;
      this.gainT = GAIN_LIFE;
    }
    this.lastScore = sc.score;
    if (this.gainT > 0) {
      this.gainT -= dt;
      if (this.gainT <= 0) this.gainAcc = 0;
    }
    this.gainBox.set(this.gainT > 0);
    this.gainNum.set(`+${fmt(this.gainAcc)}`);

    if (sc.score > this.hiStored) {
      this.hiStored = sc.score;
      this.dirty = true;
    }
    if (this.dirty && now - this.lastSave >= HI_SAVE_MS) this.saveHi(now);
    this.scoreNum.set(fmt(sc.score));
    this.hiNum.set(fmt(this.hiStored));

    const chain = sc.chain;
    this.chainBox.set(chain > 0);
    if (chain > 0) {
      this.chainNum.set(String(chain));
      if (this.lastChain >= 0 && chain > this.lastChain) restart(this.chainRowEl, 'pulse');
      const f = Math.round(Math.min(1, Math.max(0, sc.chainTimer / config.score.chainWindow)) * 200) / 200;
      if (f !== this.fillQ) {
        this.fillQ = f;
        this.chainFill.style.transform = `scaleX(${f})`;
      }
    }
    this.lastChain = chain;
  }

  private saveHi(now: number): void {
    try {
      localStorage.setItem(HI_KEY, String(this.hiStored));
    } catch {
      // Storage unavailable (private window, blocked): the hi-score just lives for this session.
    }
    this.dirty = false;
    this.lastSave = now;
  }

  private updateMissiles(world: World): void {
    const w = world.weapons;
    const max = config.missiles.rackMax;
    this.rackNum.set(`${Math.floor(Math.max(0, w.rack))} / ${max}`);
    const lit = Math.min(RACK_CELLS, Math.floor(Math.max(0, w.rack) / (max / RACK_CELLS)));
    if (lit !== this.litCells) {
      const lo = Math.min(lit, this.litCells);
      const hi = Math.max(lit, this.litCells);
      for (let i = lo; i < hi; i++) this.cells[i]?.classList.toggle('on', i < lit);
      this.litCells = lit;
    }
    this.mPanelStream.set(w.streaming);
    this.salvo.set(w.streaming);

    let alive = 0;
    for (const d of world.dummies) if (d.alive) alive++;
    this.targets.set(`TARGETS ${alive}`);
  }

  private updateLocks(world: World, camera: PerspectiveCamera): void {
    const w = world.weapons;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    const worldSize = config.dummies.radius * 3.2;
    for (let i = 0; i < this.brackets.length; i++) {
      const b = this.brackets[i];
      if (!b) continue;
      const id = w.locks[i];
      const d = id !== undefined ? world.dummies[id] : undefined;
      if (!d || !d.alive) {
        this.setBracket(b, false);
        continue;
      }
      this.v.copy(d.pos).project(camera);
      if (this.v.z > 1) {
        this.setBracket(b, false);
        continue;
      }
      this.setBracket(b, true);

      const dist = Math.max(1, camera.position.distanceTo(d.pos));
      const size = Math.round(Math.min(LOCK_MAX_PX, Math.max(LOCK_MIN_PX, (worldSize * vh) / (2 * dist * tanHalf))));
      const age = w.lockAge[i] ?? LOCK_ANIM;
      const p = Math.min(1, Math.max(0, age / LOCK_ANIM));
      const e = 1 - (1 - p) ** 3;
      const sc = 1 + 1.6 * (1 - e);
      const rot = 45 * (1 - e);
      const x = (this.v.x * 0.5 + 0.5) * vw - size / 2;
      const y = (-this.v.y * 0.5 + 0.5) * vh - size / 2;
      if (size !== b.size) {
        b.size = size;
        b.el.style.width = `${size}px`;
        b.el.style.height = `${size}px`;
      }
      const tf = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${sc.toFixed(3)})`;
      if (tf !== b.tf) {
        b.tf = tf;
        b.el.style.transform = tf;
      }
    }
  }

  private setBracket(b: Bracket, on: boolean): void {
    if (on !== b.on) {
      b.on = on;
      b.el.classList.toggle('on', on);
    }
  }

  private spawnPop(pos: Vector3, camera: PerspectiveCamera, points: number): void {
    this.v.copy(pos).project(camera);
    if (this.v.z > 1) return;
    let slot: Popup | undefined;
    for (const p of this.pops) {
      if (!p.on) {
        slot = p;
        break;
      }
      if (!slot || p.age > slot.age) slot = p;
    }
    if (!slot) return;
    slot.on = true;
    slot.age = 0;
    slot.x = (this.v.x * 0.5 + 0.5) * window.innerWidth;
    slot.y = (-this.v.y * 0.5 + 0.5) * window.innerHeight;
    slot.el.textContent = `+${fmt(points)}`;
    slot.el.classList.add('on');
  }

  private updatePops(dt: number): void {
    for (const p of this.pops) {
      if (!p.on) continue;
      p.age += dt;
      if (p.age >= POP_LIFE) {
        p.on = false;
        p.el.classList.remove('on');
        continue;
      }
      const t = p.age / POP_LIFE;
      p.el.style.transform = `translate(${p.x.toFixed(1)}px,${(p.y - 70 * t).toFixed(1)}px) translate(-50%,-50%)`;
      p.el.style.opacity = (1 - t * t).toFixed(3);
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
  private readonly combat: CombatHud;

  constructor(root: HTMLElement) {
    if (!document.getElementById('hud-style')) {
      const style = make('style');
      style.id = 'hud-style';
      style.textContent = CSS + COMBAT_CSS;
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

    // Combat overlay goes on top of the flight HUD.
    this.combat = new CombatHud(this.el);
  }

  /**
   * Combat overlay from world.score / world.weapons: score, hi-score, chain, missile rack, lock
   * brackets, MISSILE SALVO banner while streaming, hit marker, kill popups, wave banner. `events`
   * are this frame's SimEvents (hit, kill, chainEnd, waveStart, ...).
   */
  updateCombat(world: World, camera: PerspectiveCamera, events: readonly SimEvent[]): void {
    this.combat.update(world, camera, events);
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
