/**
 * DOM HUD in the concept-art style: slanted navy panels with a magenta/cyan accent edge,
 * segmented bars, italic Chakra Petch, a yellow aim reticle and a cyan nose marker.
 *
 * Pure DOM (no canvas). Element refs are cached once and each frame only writes values that
 * changed. Styles are injected once into <head>. Everything is pointer-events: none.
 */
import { Quaternion, Vector3, type PerspectiveCamera } from 'three';
import { config } from '../core/config';
import type { BossPart, BossState, ShipState, SimEvent } from '../sim/types';
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
const WARN_LIFE = 3;
const ENGAGE_LIFE = 1.6;
const EXPOSE_LIFE = 2.5;
const KBAN_LIFE = 3;
const WEDGE_LIFE = 0.6;
const WEDGES = 6;
const OVER_DELAY = 0.8;
/** Boss bar damage trail: fraction of the bar per second it drains toward the live value. */
const TRAIL_RATE = 0.22;
const MARKERS = 16;
const EDGE_PAD = 70;
/** Segment gaps: a dark 3px notch every 13px. */
const SEG_PAT = 'repeating-linear-gradient(90deg,transparent 0 10px,rgba(6,8,24,.85) 10px 13px)';

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

const BOSS_CSS = `
.hud .ol{font-size:13px;font-weight:700;letter-spacing:.18em;opacity:.85}
.hud .graze{display:none;margin-top:6px;transform-origin:left center;font-size:18px;font-weight:700;letter-spacing:.12em;color:#7dffd0;text-shadow:0 0 8px rgba(67,255,138,.7);white-space:nowrap}
.hud .graze.on{display:block}
.hud .graze.pulse{animation:chainpop .22s ease-out}
.hud .wedge{position:absolute;left:50%;top:50%;width:0;height:0;display:none;transform-origin:0 0}
.hud .wedge.on{display:block}
.hud .wedge i{position:absolute;left:150px;top:-70px;width:130px;height:140px;clip-path:polygon(0 35%,100% 0,100% 100%,0 65%);background:linear-gradient(90deg,rgba(255,56,82,.05),rgba(255,56,82,.95))}
.hud .bossbar{position:absolute;left:50%;top:20px;display:none;width:clamp(300px,calc(100vw - 880px),600px);transform:translateX(-50%) skewX(-10deg);padding:9px 14px 10px;background:linear-gradient(90deg,rgba(24,4,22,.84),rgba(30,6,40,.7));box-shadow:0 8px 20px rgba(0,0,0,.4)}
.hud .bossbar.on{display:block}
.hud .bossbar::before{content:'';position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,${RED},${MAGENTA})}
.hud .bhead{display:flex;align-items:baseline;gap:12px;white-space:nowrap}
.hud .bboss{font-size:14px;font-weight:700;letter-spacing:.22em;color:${RED};text-shadow:0 0 8px rgba(255,56,82,.7)}
.hud .bname{font-size:20px;font-weight:700;letter-spacing:.1em;color:#fff;text-shadow:0 0 10px rgba(255,60,207,.7)}
.hud .bwrap{position:relative;height:20px;margin-top:6px;background:rgba(255,255,255,.1);box-shadow:inset 0 0 0 1px rgba(255,120,160,.35)}
.hud .btrail,.hud .bfill{position:absolute;left:0;top:0;bottom:0;width:0}
.hud .btrail{background:${SEG_PAT},#f2f7ff}
.hud .bfill{background:${SEG_PAT},linear-gradient(90deg,${RED},${MAGENTA});box-shadow:0 0 10px rgba(255,56,82,.7)}
.hud .bpips{display:flex;gap:5px;margin-top:8px;flex-wrap:nowrap}
.hud .bpip{position:relative;padding:1px 7px;font-size:11px;font-weight:700;letter-spacing:.12em;color:#06101f;background:var(--pc)}
.hud .bpip.lock{color:var(--pc);background:transparent;box-shadow:inset 0 0 0 1px var(--pc)}
.hud .bpip.dead{background:rgba(255,255,255,.14);color:#7d6e94;box-shadow:none}
.hud .bpip.dead::after{content:'';position:absolute;left:-3px;right:-3px;top:50%;height:2px;background:${RED};transform:rotate(-14deg)}
.hud .bexp{display:none;margin-top:8px;padding:2px 14px;font-size:22px;font-weight:700;letter-spacing:.2em;text-align:center;color:#fff;background:${RED};box-shadow:0 0 16px rgba(255,56,82,.8)}
.hud .bexp.on{display:block;animation:hudblink .4s linear infinite}
.hud .bm{position:absolute;left:0;top:0;display:none;width:18px;height:18px}
.hud .bm.on{display:block}
.hud .bm i{display:block;width:14px;height:14px;margin:2px;border:2.5px solid var(--mc);box-shadow:0 0 6px var(--mc);transform:rotate(45deg)}
.hud .bm.t{--mc:${YELLOW}}
.hud .bm.e{--mc:${MAGENTA}}
.hud .bm.c{--mc:${RED}}
.hud .bm.c i{animation:bpulse .6s ease-in-out infinite}
.hud .barrow{position:absolute;left:0;top:0;display:none;width:28px;height:28px}
.hud .barrow.on{display:block}
.hud .barrow svg{position:absolute;left:0;top:0;width:28px;height:28px;overflow:visible;filter:drop-shadow(0 0 6px rgba(255,56,82,.9))}
.hud .bd{position:absolute;left:50%;top:32px;transform:translateX(-50%) skewX(-10deg);white-space:nowrap;font-size:15px;font-weight:700;letter-spacing:.1em;color:#fff;text-shadow:0 0 6px rgba(0,0,0,.8)}
.hud .warn{position:absolute;left:50%;top:40%;display:none;flex-direction:column;align-items:center;gap:8px;transform:translate(-50%,-50%) skewX(-10deg);white-space:nowrap}
.hud .warn.on{display:flex}
.hud .wstripe{width:min(620px,70vw);height:22px;background:repeating-linear-gradient(-45deg,${YELLOW} 0 14px,#120a00 14px 28px)}
.hud .warn.on .wstripe,.hud .warn.on .wbig{animation:hudblink .3s linear infinite}
.hud .wbig{font-size:96px;font-weight:700;line-height:1;letter-spacing:.1em;color:${RED};text-shadow:0 0 18px rgba(255,56,82,.8),4px 4px 0 #3a0010}
.hud .wsub{padding:4px 16px;font-size:20px;font-weight:700;letter-spacing:.2em;color:#ffe3e8;background:rgba(40,0,12,.75);box-shadow:inset 4px 0 0 ${RED}}
.hud .engage{position:absolute;left:50%;top:38%;display:none;white-space:nowrap;font-size:120px;font-weight:700;line-height:1;letter-spacing:.1em;color:#43ff8a;text-shadow:0 0 22px rgba(67,255,138,.7),4px 4px 0 #06301a;transform:translate(-50%,-50%) skewX(-10deg)}
.hud .engage.on{display:block;animation:wavefade ${ENGAGE_LIFE}s ease-out forwards}
.hud .kban{position:absolute;left:50%;top:34%;display:none;text-align:center;white-space:nowrap;transform:translate(-50%,-50%) skewX(-10deg)}
.hud .kban.on{display:block;animation:wavefade ${KBAN_LIFE}s ease-out forwards}
.hud .kt{font-size:64px;font-weight:700;line-height:1;letter-spacing:.08em;color:${YELLOW};text-shadow:0 0 18px rgba(255,210,58,.6),4px 4px 0 ${MAGENTA}}
.hud .kp{display:inline-block;margin-top:8px;padding:4px 16px;font-size:34px;font-weight:700;letter-spacing:.14em;color:#fff;background:rgba(8,60,120,.75);box-shadow:inset 4px 0 0 ${CYAN}}
.hud .over{position:absolute;left:50%;top:50%;display:none;width:min(480px,86vw);padding:18px 26px 20px;transform:translate(-50%,-50%) skewX(-10deg);background:linear-gradient(90deg,rgba(18,4,20,.92),rgba(26,8,40,.86));box-shadow:inset 4px 0 0 ${RED},0 16px 40px rgba(0,0,0,.6)}
.hud .over.on{display:block;animation:overin .6s ease-out forwards}
.hud .ohead{font-size:46px;font-weight:700;line-height:1;letter-spacing:.06em;white-space:nowrap;color:${RED};text-shadow:0 0 16px rgba(255,56,82,.7)}
.hud .oscore{font-size:52px;font-weight:700;line-height:1.1;color:${YELLOW};text-shadow:0 0 12px rgba(255,210,58,.5);font-variant-numeric:tabular-nums}
.hud .ohi{display:none;margin-top:8px;padding:3px 12px;font-size:18px;font-weight:700;letter-spacing:.2em;color:#06101f;background:${YELLOW};box-shadow:0 0 12px rgba(255,210,58,.7)}
.hud .ohi.on{display:inline-block}
.hud .orow{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:5px 0;font-size:18px;border-bottom:1px solid rgba(255,255,255,.1)}
.hud .orow .ov{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}
.hud .oretry{margin-top:16px;text-align:center;font-size:20px;font-weight:700;letter-spacing:.22em;color:#fff;animation:txtpulse 1.2s ease-in-out infinite}
@keyframes overin{from{opacity:0}to{opacity:1}}
@keyframes txtpulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes bpulse{0%,100%{transform:rotate(45deg) scale(1)}50%{transform:rotate(45deg) scale(1.4)}}
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

interface Wedge {
  el: HTMLElement;
  t: number;
  on: boolean;
}

interface PipEl {
  el: HTMLElement;
  dead: Toggle;
  lock: Toggle;
  part: BossPart;
}

interface MarkerEl {
  el: HTMLElement;
  on: Toggle;
  tf: string;
}

const PIP_LABEL: Record<BossPart['role'], string> = { turret: 'TUR', engine: 'ENG', core: 'CORE' };
const PIP_COLOR: Record<BossPart['role'], string> = { turret: YELLOW, engine: MAGENTA, core: RED };
const MARKER_CLASS: Record<BossPart['role'], string> = { turret: 't', engine: 'e', core: 'c' };

/**
 * Boss overlay: top-centre health bar with a damage trail and part pips, CORE EXPOSED flash,
 * diamonds on live parts, an edge arrow with distance when the boss is off screen, and the
 * WARNING / ENGAGE / TARGET DESTROYED banners. Keyed on world.boss, so it resets with the run.
 */
class BossHud {
  private readonly bar: HTMLElement;
  private readonly barOn: Toggle;
  private readonly nameTxt: Txt;
  private readonly fill: HTMLElement;
  private readonly trail: HTMLElement;
  private readonly pips: HTMLElement;
  private readonly pipList: PipEl[] = [];
  private readonly expose: HTMLElement;
  private readonly warn: HTMLElement;
  private readonly warnName: Txt;
  private readonly engage: HTMLElement;
  private readonly kban: HTMLElement;
  private readonly kbPts: Txt;
  private readonly markers: MarkerEl[] = [];
  private readonly arrow: HTMLElement;
  private readonly arrowIcon: SVGSVGElement;
  private readonly arrowDist: Txt;
  private readonly arrowOn: Toggle;
  private readonly v = new Vector3();
  private boss: BossState | null = null;
  private trailFrac = 1;
  private fillQ = -1;
  private trailQ = -1;
  private arrowTf = '';
  private arrowRot = '';
  private warnT = 0;
  private engageT = 0;
  private exposeT = 0;
  private kbT = 0;

  constructor(root: HTMLElement) {
    this.bar = make('div', 'bossbar');
    this.barOn = new Toggle(this.bar, 'on');
    const head = make('div', 'bhead');
    head.append(make('span', 'bboss', 'BOSS'));
    const nameEl = make('span', 'bname');
    head.append(nameEl);
    this.nameTxt = new Txt(nameEl);
    const wrap = make('div', 'bwrap');
    this.trail = make('i', 'btrail');
    this.fill = make('i', 'bfill');
    wrap.append(this.trail, this.fill);
    this.pips = make('div', 'bpips');
    this.expose = make('div', 'bexp', 'CORE EXPOSED');
    this.bar.append(head, wrap, this.pips, this.expose);

    this.warn = make('div', 'warn');
    const sub = make('div', 'wsub');
    this.warn.append(make('div', 'wstripe'), make('div', 'wbig', 'WARNING'), make('div', 'wstripe'), sub);
    this.warnName = new Txt(sub);

    this.engage = make('div', 'engage', 'ENGAGE');

    this.kban = make('div', 'kban');
    const kp = make('div', 'kp');
    this.kban.append(make('div', 'kt', 'TARGET DESTROYED'), kp);
    this.kbPts = new Txt(kp);

    this.arrow = make('div', 'barrow');
    this.arrow.innerHTML = `<svg viewBox="0 0 28 28"><path d="M3 4 L24 14 L3 24 L8 14 Z" fill="${RED}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    this.arrowIcon = this.arrow.querySelector('svg')!;
    const dist = make('div', 'bd');
    this.arrow.append(dist);
    this.arrowDist = new Txt(dist);
    this.arrowOn = new Toggle(this.arrow, 'on');

    root.append(this.bar, this.warn, this.engage, this.kban, this.arrow);
    for (let i = 0; i < MARKERS; i++) {
      const el = make('div', 'bm');
      el.append(make('i'));
      root.append(el);
      this.markers.push({ el, on: new Toggle(el, 'on'), tf: '' });
    }
  }

  /** Clears banners and forgets the boss so the next frame re-reads the new run. */
  reset(): void {
    this.warnT = 0;
    this.engageT = 0;
    this.exposeT = 0;
    this.kbT = 0;
    for (const el of [this.warn, this.engage, this.expose, this.kban]) el.classList.remove('on');
    this.boss = null;
  }

  update(world: World, camera: PerspectiveCamera, dt: number, events: readonly SimEvent[]): void {
    for (const e of events) this.handle(e);
    this.tick(dt);
    const boss = world.boss;
    if (boss !== this.boss) this.setBoss(boss);
    if (!boss || !boss.alive) {
      this.barOn.set(false);
      this.hideTargets();
      return;
    }
    this.barOn.set(true);
    this.updateBar(boss, dt);
    if (world.ship.dead) {
      this.hideTargets();
      return;
    }
    this.updateTargets(boss, camera);
  }

  private handle(e: SimEvent): void {
    if (e.type === 'bossWarning') {
      this.warnName.set(e.name);
      restart(this.warn, 'on');
      this.warnT = WARN_LIFE;
    } else if (e.type === 'bossArrive') {
      restart(this.engage, 'on');
      this.engageT = ENGAGE_LIFE;
    } else if (e.type === 'bossPartDestroyed' && e.coreExposed) {
      restart(this.expose, 'on');
      this.exposeT = EXPOSE_LIFE;
    } else if (e.type === 'bossDeath') {
      this.kbPts.set(`+${fmt(e.points)}`);
      restart(this.kban, 'on');
      this.kbT = KBAN_LIFE;
    }
  }

  private tick(dt: number): void {
    if (this.warnT > 0) {
      this.warnT -= dt;
      if (this.warnT <= 0) this.warn.classList.remove('on');
    }
    if (this.engageT > 0) {
      this.engageT -= dt;
      if (this.engageT <= 0) this.engage.classList.remove('on');
    }
    if (this.exposeT > 0) {
      this.exposeT -= dt;
      if (this.exposeT <= 0) this.expose.classList.remove('on');
    }
    if (this.kbT > 0) {
      this.kbT -= dt;
      if (this.kbT <= 0) this.kban.classList.remove('on');
    }
  }

  private setBoss(boss: BossState | null): void {
    this.boss = boss;
    this.trailFrac = 1;
    this.fillQ = -1;
    this.trailQ = -1;
    this.pips.replaceChildren();
    this.pipList.length = 0;
    for (const m of this.markers) {
      m.el.classList.remove('t', 'e', 'c');
      m.on.set(false);
    }
    if (!boss) return;
    boss.parts.forEach((part, i) => {
      const el = make('span', 'bpip', PIP_LABEL[part.role]);
      el.style.setProperty('--pc', PIP_COLOR[part.role]);
      this.pips.append(el);
      this.pipList.push({ el, dead: new Toggle(el, 'dead'), lock: new Toggle(el, 'lock'), part });
      this.markers[i]?.el.classList.add(MARKER_CLASS[part.role]);
    });
  }

  private updateBar(boss: BossState, dt: number): void {
    const frac = boss.maxHp > 0 ? Math.min(1, Math.max(0, boss.hp / boss.maxHp)) : 0;
    // The white trail keeps the last health and drains toward the live value.
    this.trailFrac = this.trailFrac > frac ? Math.max(frac, this.trailFrac - TRAIL_RATE * dt) : frac;
    const fq = Math.round(frac * 1000);
    if (fq !== this.fillQ) {
      this.fillQ = fq;
      this.fill.style.width = `${fq / 10}%`;
    }
    const tq = Math.round(this.trailFrac * 1000);
    if (tq !== this.trailQ) {
      this.trailQ = tq;
      this.trail.style.width = `${tq / 10}%`;
    }
    this.nameTxt.set(boss.name);
    const dying = boss.stage === 'dying';
    for (const p of this.pipList) {
      const t = p.part.target;
      const core = p.part.role === 'core';
      const dead = !t.alive && (!core || t.hp <= 0 || dying);
      p.dead.set(dead);
      p.lock.set(core && !t.alive && !dead);
    }
  }

  private hideTargets(): void {
    for (const m of this.markers) m.on.set(false);
    this.arrowOn.set(false);
  }

  private updateTargets(boss: BossState, camera: PerspectiveCamera): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dying = boss.stage === 'dying';
    for (let i = 0; i < this.markers.length; i++) {
      const m = this.markers[i]!;
      const part = dying ? undefined : boss.parts[i];
      let on = false;
      if (part && part.target.alive) {
        this.v.copy(part.target.pos).project(camera);
        if (this.v.z <= 1 && Math.abs(this.v.x) <= 1 && Math.abs(this.v.y) <= 1) {
          on = true;
          const tf = `translate(${((this.v.x * 0.5 + 0.5) * vw - 9).toFixed(1)}px,${((-this.v.y * 0.5 + 0.5) * vh - 9).toFixed(1)}px)`;
          if (tf !== m.tf) {
            m.tf = tf;
            m.el.style.transform = tf;
          }
        }
      }
      m.on.set(on);
    }

    // Edge arrow when the boss centre is off screen.
    this.v.copy(boss.pos).project(camera);
    const behind = this.v.z > 1;
    const inside = !behind && Math.abs(this.v.x) <= 1 && Math.abs(this.v.y) <= 1;
    if (dying || inside) {
      this.arrowOn.set(false);
      return;
    }
    // Behind the camera the projection mirrors, so flip it back to the true side.
    const nx = behind ? -this.v.x : this.v.x;
    const ny = behind ? -this.v.y : this.v.y;
    const sx = (nx * vw) / 2;
    const sy = (-ny * vh) / 2;
    const k = Math.min((vw / 2 - EDGE_PAD) / Math.max(Math.abs(sx), 1e-6), (vh / 2 - EDGE_PAD) / Math.max(Math.abs(sy), 1e-6));
    const ax = vw / 2 + sx * k;
    const ay = vh / 2 + sy * k;
    this.arrowOn.set(true);
    const tf = `translate(${(ax - 14).toFixed(1)}px,${(ay - 14).toFixed(1)}px)`;
    if (tf !== this.arrowTf) {
      this.arrowTf = tf;
      this.arrow.style.transform = tf;
    }
    const rot = `rotate(${((Math.atan2(sy, sx) * 180) / Math.PI).toFixed(1)}deg)`;
    if (rot !== this.arrowRot) {
      this.arrowRot = rot;
      this.arrowIcon.style.transform = rot;
    }
    this.arrowDist.set(`${fmt(camera.position.distanceTo(boss.pos))} m`);
  }
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
  private readonly dir = new Vector3();
  private readonly qInv = new Quaternion();
  private readonly grazeEl: HTMLElement;
  private readonly grazeBox: Toggle;
  private readonly grazeTxt: Txt;
  private grazes = 0;
  private readonly wedges: Wedge[] = [];
  private readonly overOn: Toggle;
  private readonly overHi: Toggle;
  private readonly overScore: Txt;
  private readonly overBest: Txt;
  private readonly overKills: Txt;
  private readonly overWave: Txt;
  private readonly overGrazes: Txt;
  private readonly bossHud: BossHud;
  /** The world this run belongs to; a new object means a restart. */
  private world: World | null = null;
  private hiAtStart = 0;
  private deadT = 0;

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
    this.grazeEl = make('div', 'graze');
    this.grazeBox = new Toggle(this.grazeEl, 'on');
    this.grazeTxt = new Txt(this.grazeEl);
    top.append(scoreRow, hiRow, chain, this.grazeEl, gain);

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

    // Damage direction wedges (pooled).
    for (let i = 0; i < WEDGES; i++) {
      const el = make('div', 'wedge');
      el.append(make('i'));
      this.wedges.push({ el, t: 0, on: false });
      root.append(el);
    }

    // Mission failed: results panel, shown ~0.8 s after the shield runs out (see updateDeath).
    const overEl = make('div', 'over');
    const hiBadge = make('div', 'ohi', 'NEW HI-SCORE');
    const oScore = make('div', 'oscore');
    overEl.append(make('div', 'ohead', 'MISSION FAILED'), make('div', 'ol', 'FINAL SCORE'), oScore, hiBadge);
    const orow = (label: string): Txt => {
      const val = make('span', 'ov');
      const row = make('div', 'orow');
      row.append(make('span', 'ol', label), val);
      overEl.append(row);
      return new Txt(val);
    };
    this.overScore = new Txt(oScore);
    this.overBest = orow('BEST CHAIN');
    this.overKills = orow('KILLS');
    this.overWave = orow('WAVE REACHED');
    this.overGrazes = orow('GRAZES');
    overEl.append(make('div', 'oretry', 'PRESS R TO RETRY'));
    this.overOn = new Toggle(overEl, 'on');
    this.overHi = new Toggle(hiBadge, 'on');

    this.bossHud = new BossHud(root);
    root.append(top, mp, salvo, this.waveEl, hm, this.brkEl, overEl);
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
    if (world !== this.world) this.resetRun(world);

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
      } else if (e.type === 'playerHit') {
        this.addWedge(e.pos, camera);
      } else if (e.type === 'graze') {
        this.grazes++;
        restart(this.grazeEl, 'pulse');
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
    this.updateWedges(dt);
    this.grazeBox.set(this.grazes > 0);
    this.grazeTxt.set(`GRAZE ×${this.grazes}`);
    this.updateDeath(world, dt);
    this.bossHud.update(world, camera, dt, events);

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

  /** New world object = new run: clear per-run state (grazes, banners, pops, wedges, boss). */
  private resetRun(world: World): void {
    this.world = world;
    this.hiAtStart = this.hiStored;
    this.grazes = 0;
    this.deadT = 0;
    this.lastScore = -1;
    this.lastChain = -1;
    this.gainAcc = 0;
    this.gainT = 0;
    this.breakT = 0;
    this.waveT = 0;
    this.hitT = 0;
    this.hitKill = false;
    this.brkEl.classList.remove('on');
    this.waveEl.classList.remove('on');
    for (const p of this.pops) {
      p.on = false;
      p.el.classList.remove('on');
    }
    for (const w of this.wedges) {
      w.on = false;
      w.el.classList.remove('on');
    }
    this.overOn.set(false);
    this.bossHud.reset();
  }

  /** Damage direction: a wedge at the screen angle of the incoming orb (camera-local x/y). */
  private addWedge(pos: Vector3, camera: PerspectiveCamera): void {
    this.dir.copy(pos).sub(camera.position).applyQuaternion(this.qInv.copy(camera.quaternion).invert());
    const deg = (Math.atan2(-this.dir.y, this.dir.x) * 180) / Math.PI;
    let slot = this.wedges.find((w) => !w.on);
    if (!slot) slot = this.wedges.reduce((a, b) => (b.t > a.t ? b : a));
    slot.on = true;
    slot.t = 0;
    slot.el.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    slot.el.style.opacity = '1';
    slot.el.classList.add('on');
  }

  private updateWedges(dt: number): void {
    for (const w of this.wedges) {
      if (!w.on) continue;
      w.t += dt;
      if (w.t >= WEDGE_LIFE) {
        w.on = false;
        w.el.classList.remove('on');
        continue;
      }
      w.el.style.opacity = (1 - w.t / WEDGE_LIFE).toFixed(3);
    }
  }

  /** Results panel after the shield runs out; the restart keys (R / Enter / click) are in main.ts. */
  private updateDeath(world: World, dt: number): void {
    if (!world.ship.dead) {
      this.deadT = 0;
      this.overOn.set(false);
      return;
    }
    this.deadT += dt;
    const show = this.deadT >= OVER_DELAY;
    this.overOn.set(show);
    if (!show) return;
    const sc = world.score;
    this.overScore.set(fmt(sc.score));
    this.overBest.set(`×${fmt(sc.bestChain)}`);
    this.overKills.set(fmt(sc.kills));
    this.overWave.set(String(sc.wave));
    this.overGrazes.set(fmt(this.grazes));
    this.overHi.set(sc.score > 0 && sc.score > this.hiAtStart);
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
    const dead = world.ship.dead;
    for (let i = 0; i < this.brackets.length; i++) {
      const b = this.brackets[i];
      if (!b) continue;
      const id = w.locks[i];
      // Lock ids are drones or boss parts (ids >= BOSS_PART_ID0): findTarget covers both.
      const d = id !== undefined && !dead ? world.findTarget(id) : undefined;
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
      const size = Math.round(Math.min(LOCK_MAX_PX, Math.max(LOCK_MIN_PX, (d.radius * 3.2 * vh) / (2 * dist * tanHalf))));
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
      style.textContent = CSS + COMBAT_CSS + BOSS_CSS;
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
    this.reticle.set(locked && !s.dead);

    if (noseScreen && !s.dead) {
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
