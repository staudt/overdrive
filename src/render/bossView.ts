/**
 * The flying battleship, built entirely in code: a faceted toon dreadnought (merged geometry per
 * material, split into a front and a rear half so the wreck can break its back while dying),
 * animated turrets, magenta engines, an armoured reactor hatch and glowing window lights.
 * Driven by world.boss; null-safe (nothing is built or drawn without a boss).
 */
import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RedFormat,
  type Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Flame, coneGeo } from '../fx/flame';
import type { BossPart, BossState, TurretKind } from '../sim/types';
import type { World } from '../sim/world';

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

/** Emitter colours per turret kind (HDR). */
const KIND_COL: Record<TurretKind, [number, number, number]> = {
  flak: [3.4, 1.9, 0.3],
  spiral: [2.2, 0.6, 3.8],
  ring: [3.6, 0.4, 2.4],
  fan: [3.8, 0.4, 0.5],
  gatling: [4, 2.6, 0.8],
};

function flat(g: BufferGeometry): BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  n.computeVertexNormals();
  return n;
}
function box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): BufferGeometry {
  const g = new BoxGeometry(sx, sy, sz);
  g.translate(cx, cy, cz);
  return flat(g);
}
function cyl(cx: number, cy: number, cz: number, rt: number, rb: number, h: number, seg = 8, open = false): BufferGeometry {
  const g = new CylinderGeometry(rt, rb, h, seg, 1, open);
  g.translate(cx, cy, cz);
  return flat(g);
}

interface Sec {
  z: number;
  wT: number;
  wM: number;
  wB: number;
  top: number;
  mid: number;
  bot: number;
}
const SECS: Sec[] = [
  { z: -214, wT: 0.5, wM: 0.5, wB: 0.3, top: 3, mid: -1, bot: -5 },
  { z: -195, wT: 7, wM: 9, wB: 3, top: 8, mid: 1, bot: -10 },
  { z: -150, wT: 18, wM: 22, wB: 7, top: 11, mid: 0, bot: -16 },
  { z: -100, wT: 24, wM: 28, wB: 9, top: 12, mid: 0, bot: -18 },
  { z: 20, wT: 26, wM: 30, wB: 10, top: 13, mid: 0, bot: -18 },
  { z: 120, wT: 26, wM: 30, wB: 10, top: 13, mid: 0, bot: -18 },
  { z: 175, wT: 22, wM: 26, wB: 10, top: 12, mid: 0, bot: -16 },
  { z: 214, wT: 20, wM: 22, wB: 10, top: 11, mid: 0, bot: -14 },
];
const _sec: Sec = { z: 0, wT: 0, wM: 0, wB: 0, top: 0, mid: 0, bot: 0 };
function secAt(z: number): Sec {
  let i = 0;
  while (i < SECS.length - 2 && z > SECS[i + 1]!.z) i++;
  const a = SECS[i]!;
  const b = SECS[i + 1]!;
  const t = clamp((z - a.z) / (b.z - a.z), 0, 1);
  _sec.z = z;
  for (const k of ['wT', 'wM', 'wB', 'top', 'mid', 'bot'] as const) _sec[k] = a[k] + (b[k] - a[k]) * t;
  return _sec;
}

/** Lofted 7-point hull between z0 and z1 (same winding as the player jet loft). */
function loft(z0: number, z1: number, cap: boolean): BufferGeometry {
  const zs: number[] = [z0];
  for (const s of SECS) if (s.z > z0 && s.z < z1) zs.push(s.z);
  zs.push(z1);
  const ring = (z: number): number[][] => {
    const s = secAt(z);
    return [
      [0, s.top, z],
      [s.wT, s.top, z],
      [s.wM, s.mid, z],
      [s.wB, s.bot, z],
      [-s.wB, s.bot, z],
      [-s.wM, s.mid, z],
      [-s.wT, s.top, z],
    ].map((p) => p.slice());
  };
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]): void => void pos.push(...a, ...b, ...c);
  const N = 7;
  for (let i = 0; i < zs.length - 1; i++) {
    const a = ring(zs[i]!);
    const b = ring(zs[i + 1]!);
    for (let k = 0; k < N; k++) {
      const k2 = (k + 1) % N;
      tri(a[k]!, b[k]!, b[k2]!);
      tri(a[k]!, b[k2]!, a[k2]!);
    }
  }
  if (cap) {
    const last = ring(z1);
    for (let k = 1; k < N - 1; k++) tri(last[0]!, last[k + 1]!, last[k]!);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function outlineOf(parts: BufferGeometry[], thick: number): BufferGeometry {
  const merged = mergeGeometries(parts.map((p) => p.clone()))!;
  merged.deleteAttribute('normal');
  const w = mergeVertices(merged, 1e-2);
  w.computeVertexNormals();
  const p = w.getAttribute('position');
  const n = w.getAttribute('normal');
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * thick, p.getY(i) + n.getY(i) * thick, p.getZ(i) + n.getZ(i) * thick);
  return w;
}

function gradientMap(): DataTexture {
  const t = new DataTexture(new Uint8Array([80, 170, 255]), 3, 1, RedFormat);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.4)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

type MatKey = 'steel' | 'steel2' | 'dark' | 'red';
const MAT_KEYS: MatKey[] = ['steel', 'steel2', 'dark', 'red'];
const PIVOT_Z = 22;

/** Collects static geometry per material and per half (0 front, 1 rear). */
class Collector {
  readonly lists: Record<MatKey, BufferGeometry[][]> = {
    steel: [[], []],
    steel2: [[], []],
    dark: [[], []],
    red: [[], []],
  };
  readonly outline: BufferGeometry[][] = [[], []];
  readonly lights: [number, number, number, number, number, number, number][][] = [[], []]; // x y z sx sy sz colour
  add(key: MatKey, g: BufferGeometry, outlined = true, half?: number): void {
    g.computeBoundingBox();
    const h = half ?? ((g.boundingBox!.min.z + g.boundingBox!.max.z) / 2 < PIVOT_Z ? 0 : 1);
    this.lists[key][h]!.push(g);
    if (outlined) this.outline[h]!.push(g);
  }
}

interface TurretRig {
  part: BossPart;
  root: Group;
  yaw: Group;
  pitch: Group;
  live: Mesh;
  wreck: Mesh;
  emit: Mesh;
  emitMat: MeshBasicMaterial;
  headMat: MeshToonMaterial;
  base: Color;
  mountQ: Quaternion;
  yawA: number;
  pitchA: number;
  muzzle: number;
  lastCd: number;
  dead: boolean;
  tilt: number;
}
interface EngineRig {
  part: BossPart;
  anchor: Object3D;
  disc: Mesh;
  discMat: MeshBasicMaterial;
  flame: Flame;
  seed: number;
  power: number;
}

export class BossView {
  private root: Group | null = null;
  private built = false;
  private readonly halves: Group[] = [];
  private readonly turrets: TurretRig[] = [];
  private readonly engines: EngineRig[] = [];
  private readonly mats = {} as Record<MatKey, MeshToonMaterial>;
  private readonly baseCol = {} as Record<MatKey, Color>;
  private windowMats: MeshBasicMaterial[] = [];
  private blinkMat: MeshBasicMaterial | null = null;
  private reactor: Mesh | null = null;
  private reactorMat: MeshBasicMaterial | null = null;
  private hatches: Group[] = [];
  private open = 0;
  private shadow: Mesh | null = null;
  private shadowMat: MeshBasicMaterial | null = null;
  private time = 0;
  private scorch = 0;
  private readonly char = new Color('#1c1a20');
  private readonly _q = new Quaternion();
  private readonly _v = new Vector3();
  private readonly tmpCol = new Color();
  private readonly demo: boolean;
  private demoT = 0;

  constructor(private readonly scene: Scene) {
    this.demo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('bossdemo');
  }

  private build(boss: BossState): void {
    this.built = true;
    const grad = gradientMap();
    const toon = (c: string, e = '#000000'): MeshToonMaterial => new MeshToonMaterial({ color: c, emissive: e, gradientMap: grad });
    this.mats.steel = toon('#5a6f96');
    this.mats.steel2 = toon('#7f93b8');
    this.mats.dark = toon('#283250');
    this.mats.red = toon('#d8213a', '#3a0610');
    for (const k of MAT_KEYS) this.baseCol[k] = this.mats[k].color.clone();
    const outlineMat = new MeshBasicMaterial({ color: '#10152b', side: BackSide });

    const root = new Group();
    this.root = root;
    const k = boss.half.z / 212;
    root.scale.setScalar(k);
    this.scene.add(root);
    for (let i = 0; i < 2; i++) {
      const g = new Group();
      root.add(g);
      this.halves.push(g);
    }
    this.halves[1]!.position.z = PIVOT_Z;
    // Rear half geometry is authored in boss space; offset by -PIVOT_Z inside the pivot group.
    const rearInner = new Group();
    rearInner.position.z = -PIVOT_Z;
    this.halves[1]!.add(rearInner);
    const holder = [this.halves[0]!, rearInner];

    const C = new Collector();
    // ---- hull ----
    C.add('steel', loft(-214, PIVOT_Z, true), true, 0);
    C.add('steel', loft(PIVOT_Z, 214, true), true, 1);
    // Keel fin, prow spike.
    C.add('dark', box(0, -20, 0, 5, 5, 300));
    C.add('dark', box(0, 0, -222, 3, 3, 24), false, 0);
    C.add('red', box(0, 7, -196, 12, 3, 24), true, 0);
    // Decks (with a channel for the reactor bay).
    const deck = (z0: number, z1: number, hw: number, y0: number, y1: number, key: MatKey = 'steel2'): void => {
      C.add(key, box(0, (y0 + y1) / 2, (z0 + z1) / 2, hw * 2, y1 - y0, z1 - z0));
    };
    deck(-172, -112, 9, 12, 16);
    deck(-150, -108, 12, 16, 19);
    deck(-112, 24, 18, 12, 17);
    deck(42, 180, 18, 12, 17);
    deck(-100, 24, 12, 17, 21);
    deck(42, 150, 12, 17, 21);
    deck(180, 206, 14, 10, 15, 'steel');
    // Red racing stripes along the decks.
    for (const sg of [-1, 1]) {
      C.add('red', box(sg * 11.5, 21.15, -30, 1.6, 0.4, 130), false, 0);
      C.add('red', box(sg * 17, 17.15, 110, 1.6, 0.4, 130), false, 1);
    }
    C.add('red', box(0, 16.2, -140, 4, 0.4, 28), false, 0);
    // Reactor bay frame.
    C.add('dark', box(0, 12.5, 33, 36, 1, 18), false);
    C.add('dark', box(-18.5, 15, 33, 1.5, 4, 18));
    C.add('dark', box(18.5, 15, 33, 1.5, 4, 18));
    // Superstructure: stepped bridge tower and forward block.
    C.add('steel', box(0, 26, 70, 24, 18, 46));
    C.add('steel2', box(0, 41, 70, 16, 12, 34));
    C.add('steel', box(0, 53, 66, 20, 5, 22));
    C.add('steel2', box(0, 59, 66, 10, 7, 12));
    C.add('dark', box(0, 66, 66, 6, 5, 8));
    C.add('steel', box(0, 24, -113, 18, 14, 22));
    C.add('steel2', box(0, 34, -113, 12, 7, 14));
    C.add('steel', box(0, 22, 128, 14, 8, 14));
    C.add('red', box(0, 48, 52.6, 16.5, 1.2, 0.8), false);
    C.add('red', box(0, 36, 87.5, 17, 1.2, 0.8), false);
    // Masts and antennas (not outlined: thin).
    C.add('dark', box(0, 80, 66, 0.9, 22, 0.9), false);
    C.add('dark', box(0, 76, 66, 9, 0.7, 0.7), false);
    C.add('dark', box(3, 72, 64, 0.6, 14, 0.6), false);
    C.add('dark', box(-3, 72, 68, 0.6, 14, 0.6), false);
    C.add('dark', box(0, 44, -113, 0.8, 18, 0.8), false);
    C.add('dark', box(0, 36, 128, 0.8, 16, 0.8), false);
    const dish = cyl(0, 74, 62, 6, 1.5, 1.4, 12);
    dish.rotateX(0.5);
    C.add('steel2', dish, false);
    // Sponsons where the side turrets sit, plus gun-deck armour belt and plating bands.
    for (const p of boss.parts) {
      if (p.role !== 'turret') continue;
      const l = p.local.clone().divideScalar(k);
      if (Math.abs(l.x) > 20) {
        const s = Math.sign(l.x);
        C.add('steel2', box(s * 33, -3, l.z, 15, 10, 30));
        C.add('red', box(s * 33, -7.9, l.z, 15.4, 1.2, 30.4), false);
      }
      // Turret base ring plus pedestal down to the hull.
      const bot = l.y > 15 ? 14 : l.y;
      if (l.y > 15) C.add('dark', cyl(l.x, (l.y - 6 + bot) / 2, l.z, 6.5, 8, l.y - 6 - bot, 10));
      const baseY = l.y < -10 ? l.y + 3 : l.y - 4;
      C.add('dark', cyl(l.x, baseY, l.z, 8.5, 9, 3, 12));
    }
    for (let z = -190; z < 200; z += 20) {
      const s = secAt(z + 8);
      for (const sg of [-1, 1]) {
        C.add('dark', box(sg * (s.wM + 0.2), -6, z + 8, 1.4, 6, 17), false);
        C.add('red', box(sg * (s.wM + 0.2), -1.4, z + 8, 1.5, 1, 17), false);
        // darker plating band across the top deck
        if (sg === 1 && z > -150 && z < 190 && (z < 20 || z > 44)) C.add('dark', box(0, s.top + 0.12, z + 8, s.wT * 1.5, 0.35, 2.2), false);
      }
    }
    // Stern: engine block.
    C.add('dark', box(0, 5, 207, 48, 28, 14));
    C.add('steel', box(0, 18, 200, 16, 10, 18));
    for (const p of boss.parts) {
      if (p.role !== 'engine') continue;
      const l = p.local.clone().divideScalar(k);
      C.add('dark', cyl(l.x, l.y, l.z + 4, 12.5, 14, 10, 12, true).rotateX(Math.PI / 2).translate(0, 0, 0));
    }
    // Wing-like stabiliser fins at the stern.
    C.add('steel2', box(-27, 10, 190, 14, 1.4, 24));
    C.add('steel2', box(27, 10, 190, 14, 1.4, 24));
    C.add('red', box(-33, 10, 190, 2, 1.6, 24), false);
    C.add('red', box(33, 10, 190, 2, 1.6, 24), false);

    for (let h = 0; h < 2; h++) {
      for (const key of MAT_KEYS) {
        const list = C.lists[key][h]!;
        if (!list.length) continue;
        holder[h]!.add(new Mesh(mergeGeometries(list)!, this.mats[key]));
      }
      holder[h]!.add(new Mesh(outlineOf(C.outline[h]!, 1.1), outlineMat));
    }

    this.buildWindows(holder);
    this.buildTurrets(boss, root, holder, k);
    this.buildEngines(boss, holder, k);
    this.buildCore(boss, holder);

    // Blinking running lights.
    this.blinkMat = new MeshBasicMaterial({ color: new Color(5, 0.4, 0.5) });
    const blinkG: BufferGeometry[] = [];
    for (const [x, y, z] of [[0, 84, 66], [-36, 6, -30], [36, 6, -30], [-27, 11.5, 196], [27, 11.5, 196], [0, 38, -113], [0, 44, 128], [0, 8, -232]] as [number, number, number][]) {
      blinkG.push(box(x, y, z, 1.6, 1.6, 1.6));
    }
    holder[0]!.add(new Mesh(mergeGeometries(blinkG)!, this.blinkMat));

    // Soft shadow under the hull on the sea.
    this.shadowMat = new MeshBasicMaterial({ color: '#001028', map: glowTexture(), transparent: true, opacity: 0.4, depthWrite: false });
    this.shadow = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.shadowMat);
    this.shadow.renderOrder = 3;
    this.shadow.frustumCulled = false;
    this.scene.add(this.shadow);
  }

  private buildWindows(holder: Group[]): void {
    const geo = box(0, 0, 0, 0.5, 1.1, 2.2);
    const glowCols = [new Color(4, 0.35, 1.8), new Color(4.2, 0.4, 0.4), new Color(4, 1.4, 2.4), new Color(3.2, 0.5, 3.4)];
    const rows: { h: number; m: Matrix4; c: Color }[] = [];
    const m4 = new Matrix4();
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const push = (x: number, y: number, z: number, sy = 1, sz = 1): void => {
      m4.makeScale(1, sy, sz).setPosition(x, y, z);
      rows.push({ h: z < PIVOT_Z ? 0 : 1, m: m4.clone(), c: glowCols[Math.floor(rnd() * 4)]! });
    };
    for (let z = -185; z < 205; z += 4.5) {
      const s = secAt(z);
      for (const sg of [-1, 1]) {
        for (const [yy, p] of [[2.5, 0.55], [-3.2, 0.5]] as [number, number][]) {
          if (rnd() < p) push(sg * (s.wM * (1 - Math.abs(yy) * 0.02) + 0.3), yy, z);
        }
      }
    }
    for (let z = 52; z < 90; z += 4) for (const sg of [-1, 1]) if (rnd() < 0.7) push(sg * 12.3, 26 + rnd() * 6, z);
    for (let z = 58; z < 76; z += 3.5) push(0, 53.5, z * 0 + 55.5 + (z - 58) * 0.0);
    for (let x = -9; x <= 9; x += 3) push(x, 55, 55.1);
    for (let z = -120; z < -104; z += 4) for (const sg of [-1, 1]) push(sg * 9.3, 24, z);
    for (let h = 0; h < 2; h++) {
      const list = rows.filter((r) => r.h === h);
      if (!list.length) continue;
      const mat = new MeshBasicMaterial({ color: 0xffffff });
      const im = new InstancedMesh(geo, mat, list.length);
      list.forEach((r, i) => {
        im.setMatrixAt(i, r.m);
        im.setColorAt(i, r.c);
      });
      im.frustumCulled = false;
      holder[h]!.add(im);
      this.windowMats.push(mat);
    }
  }

  private buildTurrets(boss: BossState, _root: Group, holder: Group[], k: number): void {
    const cache = new Map<TurretKind, { live: BufferGeometry; liveOut: BufferGeometry; wreck: BufferGeometry; emit: BufferGeometry }>();
    const make = (kind: TurretKind) => {
      const head: BufferGeometry[] = [cyl(0, 0.5, 0, 5, 6.8, 5, 8), box(0, 4, -1, 7, 2.2, 8)];
      const barrels: BufferGeometry[] = [];
      const emit: BufferGeometry[] = [];
      const addBarrel = (x: number, y: number, len: number, yaw = 0): void => {
        const b = box(0, 0, -len / 2, 1.5, 1.5, len);
        const tip = new SphereGeometry(1.3, 6, 4);
        tip.translate(0, 0, -len - 0.3);
        b.rotateY(yaw);
        tip.rotateY(yaw);
        b.translate(x, y, -3);
        tip.translate(x, y, -3);
        barrels.push(b);
        emit.push(flat(tip));
      };
      if (kind === 'flak') {
        addBarrel(-2.2, 1.8, 15);
        addBarrel(2.2, 1.8, 15);
        head.push(box(0, 0.5, -4, 7, 2.6, 3));
      } else if (kind === 'spiral') {
        for (let i = 0; i < 3; i++) addBarrel(Math.cos(i * 2.094) * 2, 1.5 + Math.sin(i * 2.094) * 1.6, 9);
        head.push(cyl(0, 2, -4, 3.6, 3.6, 3, 8).rotateX(Math.PI / 2));
      } else if (kind === 'gatling') {
        // Rotary cannon: six long barrels in a tight ring.
        for (let i = 0; i < 6; i++) addBarrel(Math.cos(i * 1.047) * 1.1, 1.8 + Math.sin(i * 1.047) * 1.1, 13);
        head.push(cyl(0, 1.8, -4, 2.4, 2.4, 3.4, 8).rotateX(Math.PI / 2));
      } else if (kind === 'ring') {
        for (let i = -1; i <= 1; i += 2) addBarrel(i * 2.4, 1.8, 6);
        const ringBulb = new SphereGeometry(2.8, 8, 6);
        ringBulb.translate(0, 5.2, 0);
        head.push(flat(ringBulb));
        const crown = new SphereGeometry(3.3, 8, 6);
        crown.scale(1, 0.35, 1);
        crown.translate(0, 5.2, 0);
        emit.push(flat(crown));
      } else {
        for (let i = -2; i <= 2; i++) addBarrel(i * 1.8, 1.8, 9, i * 0.17);
        head.push(box(0, 0.5, -3.5, 9, 2.6, 3));
      }
      const wreckHead = mergeGeometries(head.map((g) => g.clone()))!;
      const live = mergeGeometries([...head, ...barrels])!;
      return { live, liveOut: outlineOf([live], 0.6), wreck: wreckHead, emit: mergeGeometries(emit)! };
    };
    const wreckMat = new MeshToonMaterial({ color: '#17161a', emissive: '#2a0a02', gradientMap: (this.mats.steel.gradientMap as DataTexture) });
    const outMat = new MeshBasicMaterial({ color: '#10152b', side: BackSide });
    for (const p of boss.parts) {
      if (p.role !== 'turret' || !p.turret) continue;
      let c = cache.get(p.turret);
      if (!c) {
        c = make(p.turret);
        cache.set(p.turret, c);
      }
      const l = p.local.clone().divideScalar(k);
      const rig = new Group();
      rig.position.copy(l);
      rig.scale.setScalar(1.45);
      const mountQ = new Quaternion();
      if (l.y < -10) {
        rig.rotation.z = Math.PI;
        mountQ.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
      }
      const h = l.z < PIVOT_Z ? 0 : 1;
      holder[h]!.add(rig);
      const yaw = new Group();
      const pitch = new Group();
      rig.add(yaw);
      yaw.add(pitch);
      const headMat = new MeshToonMaterial({ color: '#8a9db8', emissive: '#000000', gradientMap: (this.mats.steel.gradientMap as DataTexture) });
      const live = new Mesh(c.live, headMat);
      live.add(new Mesh(c.liveOut, outMat));
      const wreck = new Mesh(c.wreck, wreckMat);
      wreck.visible = false;
      const kc = KIND_COL[p.turret];
      const emitMat = new MeshBasicMaterial({ color: new Color(kc[0], kc[1], kc[2]) });
      const emit = new Mesh(c.emit, emitMat);
      pitch.add(live, wreck, emit);
      this.turrets.push({ part: p, root: rig, yaw, pitch, live, wreck, emit, emitMat, headMat, base: new Color(kc[0], kc[1], kc[2]), mountQ, yawA: 0, pitchA: 0, muzzle: 0, lastCd: p.cooldown, dead: false, tilt: 0 });
    }
  }

  private buildEngines(boss: BossState, holder: Group[], k: number): void {
    const geo = coneGeo();
    let i = 0;
    for (const p of boss.parts) {
      if (p.role !== 'engine') continue;
      const l = p.local.clone().divideScalar(k);
      const anchor = new Object3D();
      anchor.position.set(l.x, l.y, l.z + 9.5);
      holder[1]!.add(anchor);
      const discMat = new MeshBasicMaterial({ color: new Color(5, 0.8, 4), side: 2 });
      const disc = new Mesh(new CircleGeometry(10.5, 16), discMat);
      anchor.add(disc);
      const flame = new Flame(anchor, geo, i * 2.3, 'magenta', 14);
      this.engines.push({ part: p, anchor, disc, discMat, flame, seed: i * 2.3, power: 1 });
      i++;
    }
  }

  private buildCore(boss: BossState, holder: Group[]): void {
    const core = boss.parts.find((p) => p.role === 'core');
    if (!core) return;
    this.reactorMat = new MeshBasicMaterial({ color: new Color(4, 0.5, 0.3) });
    this.reactor = new Mesh(new SphereGeometry(6.5, 12, 8), this.reactorMat);
    this.reactor.position.set(0, 16, 33);
    holder[1]!.add(this.reactor);
    for (const s of [-1, 1]) {
      const pivot = new Group();
      pivot.position.set(s * 18, 17.6, 33);
      const slab = new Mesh(box(-s * 9, 0, 0, 18, 1.6, 17.6), this.mats.steel2);
      const out = new Mesh(box(-s * 9, 0, 0, 18.8, 2.4, 18.4), new MeshBasicMaterial({ color: '#10152b', side: BackSide }));
      const stripe = new Mesh(box(-s * 9, 0.9, 0, 3, 0.4, 17.8), this.mats.red);
      pivot.add(slab, out, stripe);
      holder[1]!.add(pivot);
      this.hatches.push(pivot);
    }
  }

  update(dt: number, world: World): void {
    const boss = world.boss;
    if (!boss || boss.stage === 'dead' || !boss.alive && boss.stage !== 'dying') {
      if (this.root) this.root.visible = false;
      if (this.shadow) this.shadow.visible = false;
      return;
    }
    if (!this.built) this.build(boss);
    const root = this.root!;
    root.visible = true;
    this.time += dt;
    const T = this.time;
    const dying = boss.stage === 'dying';
    const dyingT = dying ? clamp(boss.stageTime / 4, 0, 1) : 0;

    if (this.demo) {
      this.demoT += dt;
      if (this.demoT > 2) {
        this.demoT = 0;
        const p = boss.parts.find((q) => q.target.hp > 0 && q.role !== 'core');
        if (p) {
          p.target.hp = 0;
          p.target.alive = false;
        }
      }
    }

    root.position.copy(boss.pos);
    root.quaternion.copy(boss.quat);
    if (dying) {
      // Violent shake and a broken back: the rear half folds down and twists away.
      const sh = 0.6 + dyingT * 2.2;
      root.position.x += Math.sin(T * 61) * sh;
      root.position.y += Math.sin(T * 47) * sh;
      const e = dyingT * dyingT;
      this.halves[1]!.rotation.x = e * 0.42;
      this.halves[1]!.rotation.z = e * 0.18;
      this.halves[1]!.position.y = -e * 14;
      this.halves[0]!.rotation.z = -e * 0.1;
    } else {
      this.halves[1]!.rotation.set(0, 0, 0);
      this.halves[1]!.position.y = 0;
      this.halves[0]!.rotation.z = 0;
    }

    // Damage: scorch the plating as rage rises (and a lot while dying).
    const target = boss.rage * 0.45 + dyingT * 0.5;
    this.scorch += (target - this.scorch) * Math.min(1, dt * 2);
    let flash = 99;
    for (const p of boss.parts) flash = Math.min(flash, p.target.hitFlash);
    const hullFlash = flash < 0.08 ? 0.14 : 0;
    for (const key of MAT_KEYS) {
      this.mats[key].color.copy(this.baseCol[key]).lerp(this.char, this.scorch);
      this.mats[key].emissive.setScalar(hullFlash);
    }
    this.mats.red.emissive.setRGB(0.23 + hullFlash, 0.04 + hullFlash, 0.06 + hullFlash);

    // Lights: window pulse, flicker while dying, blinking running lights.
    const wp = 0.8 + 0.25 * Math.sin(T * 2.2) + (dying ? (Math.sin(T * 40) > 0.3 ? -0.6 : 0.4) * dyingT : 0);
    for (const m of this.windowMats) m.color.setScalar(Math.max(0.05, wp));
    this.blinkMat?.color.setRGB(5, 0.4, 0.5).multiplyScalar(Math.sin(T * 4) > 0.2 ? 1 : 0.1);

    this.updateTurrets(dt, boss);
    this.updateEngines(T, boss, dying);
    this.updateCore(dt, boss, T);

    if (this.shadow && this.shadowMat) {
      const alt = boss.pos.y;
      this.shadow.visible = true;
      this.shadow.position.set(boss.pos.x, 2.2, boss.pos.z);
      this._v.set(0, 0, -1).applyQuaternion(boss.quat);
      this.shadow.rotation.y = Math.atan2(-this._v.x, -this._v.z);
      this.shadow.scale.set(boss.half.x * 4.5, 1, boss.half.z * 2.6);
      this.shadowMat.opacity = 0.42 * clamp(1 - alt / 700, 0.1, 1);
    }
  }

  private updateTurrets(dt: number, boss: BossState): void {
    this._q.copy(boss.quat).invert();
    const smooth = 1 - Math.exp(-8 * dt);
    for (const t of this.turrets) {
      const p = t.part;
      const dead = p.target.hp <= 0 && !p.target.alive;
      if (dead !== t.dead) {
        t.dead = dead;
        t.live.visible = !dead;
        t.emit.visible = !dead;
        t.wreck.visible = dead;
        t.tilt = (Math.sin(p.local.x * 3.1 + p.local.z) > 0 ? 1 : -1) * (0.35 + 0.25 * Math.abs(Math.sin(p.local.z)));
      }
      if (dead) {
        t.pitch.rotation.set(0.4 + Math.abs(t.tilt) * 0.5, t.yaw.rotation.y, t.tilt);
        continue;
      }
      // Aim: world -> boss local -> mount local.
      this._v.copy(p.aim).applyQuaternion(this._q).applyQuaternion(this._w2(t.mountQ));
      const ty = Math.atan2(-this._v.x, -this._v.z);
      const tp = Math.atan2(this._v.y, Math.hypot(this._v.x, this._v.z));
      let dy = ty - t.yawA;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      t.yawA += dy * smooth;
      t.pitchA += (clamp(tp, -0.3, 1.3) - t.pitchA) * smooth;
      t.yaw.rotation.y = t.yawA;
      t.pitch.rotation.x = t.pitchA;
      // Muzzle pulse when the cooldown resets upward.
      if (p.cooldown > t.lastCd + 0.0005) t.muzzle = 1;
      t.lastCd = p.cooldown;
      t.muzzle = Math.max(0, t.muzzle - dt * 5);
      const flashing = p.target.hitFlash < 0.08;
      t.headMat.emissive.setScalar(flashing ? 0.7 : 0);
      this.tmpCol.copy(t.base).multiplyScalar(0.7 + t.muzzle * 3.2 + (flashing ? 1 : 0));
      t.emitMat.color.copy(this.tmpCol);
      t.emit.scale.setScalar(1 + t.muzzle * 0.35);
    }
  }

  private readonly _mq = new Quaternion();
  private _w2(q: Quaternion): Quaternion {
    return this._mq.copy(q).invert();
  }

  private updateEngines(T: number, boss: BossState, dying: boolean): void {
    for (const e of this.engines) {
      const dead = e.part.target.hp <= 0 && !e.part.target.alive;
      const want = dead || dying ? 0 : 1;
      e.power += (want - e.power) * 0.08;
      const flick = 0.85 + 0.15 * Math.sin(T * 30 + e.seed);
      const pw = e.power * (e.part.target.hitFlash < 0.08 ? 1.5 : 1);
      e.flame.update(T, 95 * e.power * (1 + boss.rage * 0.15), 1.5 * pw * flick, 1);
      e.disc.visible = e.power > 0.02;
      e.discMat.color.setRGB(5, 0.8, 4).multiplyScalar(pw * flick);
    }
  }

  private updateCore(dt: number, boss: BossState, T: number): void {
    const core = boss.parts.find((p) => p.role === 'core');
    if (!core || !this.reactorMat || !this.reactor) return;
    const destroyed = core.target.hp <= 0;
    const exposed = core.target.alive;
    this.open += ((exposed || destroyed ? 1 : 0) - this.open) * Math.min(1, dt * 2.2);
    this.hatches.forEach((h, i) => {
      h.rotation.z = (i === 0 ? -1 : 1) * this.open * 1.35;
    });
    const pulse = 0.75 + 0.25 * Math.sin(T * (exposed ? 7 : 2.5));
    if (destroyed) this.reactorMat.color.setRGB(0.12, 0.03, 0.02);
    else this.reactorMat.color.setRGB(4, 0.5, 0.3).multiplyScalar((0.35 + 1.4 * this.open) * pulse * (core.target.hitFlash < 0.08 ? 1.6 : 1));
    this.reactor.scale.setScalar(0.9 + 0.12 * Math.sin(T * 6) * this.open);
  }
}
