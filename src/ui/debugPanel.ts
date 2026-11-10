/**
 * Live tuning panel (lil-gui). Edits the config object in place, so the game picks up changes
 * immediately. Hidden by default: F3 toggles it, and `?debug` in the URL opens it.
 */
import { GUI } from 'lil-gui';
import type { Config } from '../core/config';

type Rec = Record<string, unknown>;

const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Copies src into dst in place, keeping object and array identity so GUI bindings stay valid. */
function assignDeep(dst: Rec, src: Rec): void {
  for (const key of Object.keys(src)) {
    const sv = src[key];
    const dv = dst[key];
    if (isObj(sv) && isObj(dv)) assignDeep(dv, sv);
    else dst[key] = sv;
  }
}

/** Slider range derived from the current value: 0..4v for positive, 4v..0 for negative. */
function addNumber(gui: GUI, obj: Rec, key: string, label: string, v: number): void {
  let min: number;
  let max: number;
  if (v > 0) {
    min = 0;
    max = v * 4;
  } else if (v < 0) {
    min = v * 4;
    max = 0;
  } else {
    min = -1;
    max = 1;
  }
  const span = max - min || 1;
  const step = Number.isInteger(v) ? 1 : 10 ** (Math.floor(Math.log10(span)) - 3);
  gui.add(obj, key, min, max, step).name(label);
}

function addField(gui: GUI, obj: Rec, key: string, label: string): void {
  const v = obj[key];
  if (typeof v === 'boolean') {
    gui.add(obj, key).name(label);
  } else if (typeof v === 'number') {
    addNumber(gui, obj, key, label, v);
  } else if (typeof v === 'string') {
    if (HEX_COLOR.test(v)) gui.addColor(obj, key).name(label);
    else gui.add(obj, key).name(label);
  } else if (isObj(v)) {
    // Objects and arrays both become folders. Array entries are labelled [i].
    const folder = gui.addFolder(label);
    addFields(folder, v);
    folder.close();
  }
}

function addFields(gui: GUI, obj: Rec): void {
  const isArr = Array.isArray(obj);
  for (const key of Object.keys(obj)) {
    addField(gui, obj, key, isArr ? `[${key}]` : key);
  }
}

export class DebugPanel {
  private readonly gui: GUI;
  private readonly fps = { fps: 0 };
  private visible = false;

  constructor(config: Config) {
    const root = config as unknown as Rec;
    const defaults = structuredClone(root);

    this.gui = new GUI({ title: 'Overdrive tuning (F3)', width: 300 });
    const fpsCtrl = this.gui.add(this.fps, 'fps').name('FPS').disable();
    addFields(this.gui, root);

    const actions = {
      copyConfig: () => {
        const json = JSON.stringify(config, null, 2);
        console.log(json);
        navigator.clipboard.writeText(json).catch(() => console.warn('clipboard unavailable; JSON is in the console'));
      },
      resetDefaults: () => {
        assignDeep(root, structuredClone(defaults));
        this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
      },
    };
    this.gui.add(actions, 'copyConfig').name('Copy config JSON');
    this.gui.add(actions, 'resetDefaults').name('Reset to defaults');

    // Smoothed FPS over half-second windows; only touches the DOM while visible.
    let last = performance.now();
    let acc = 0;
    let frames = 0;
    const tick = (now: number): void => {
      acc += now - last;
      last = now;
      frames++;
      if (acc >= 500) {
        this.fps.fps = Math.round((frames * 1000) / acc);
        frames = 0;
        acc = 0;
        if (this.visible) fpsCtrl.updateDisplay();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    // Typing in GUI fields must not reach the game's key handling (WASD, Shift). F3 still passes.
    const stopKeys = (e: KeyboardEvent): void => {
      if (e.code !== 'F3') e.stopPropagation();
    };
    this.gui.domElement.addEventListener('keydown', stopKeys);
    this.gui.domElement.addEventListener('keyup', stopKeys);

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F3') return;
      e.preventDefault();
      if (!e.repeat) this.setVisible(!this.visible);
    });

    this.setVisible(new URLSearchParams(window.location.search).has('debug'));
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.gui.show(visible);
  }
}
