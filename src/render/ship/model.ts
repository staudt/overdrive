/**
 * Procedural anime fighter jet: faceted toon shading with an inverted-hull outline.
 * Forward -Z, up +Y, right +X. About 14 m long, ~11 m span.
 */
import {
  BackSide,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  Color,
  DataTexture,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  Object3D,
  RedFormat,
  Shape,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ShipState } from '../../sim/types';
import { config } from '../../core/config';

export interface ShipModel {
  group: Group;
  /** Engine exhaust anchor points (local, pointing +Z backwards). */
  engines: Object3D[];
  /** Boost thruster anchors (yellow jets, only fire while boosting; pods deploy on boost). */
  boosters: Object3D[];
  /** Wingtip anchors for contrail ribbons. */
  wingtips: Object3D[];
  /** Animate flaps, engine glow intensity, etc. Position/orientation are set by the caller. */
  update(dt: number, s: ShipState): void;
}

/** Finish a geometry for merging: non-indexed, flat normals, position+normal only. */
function flat(g: BufferGeometry): BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  n.computeVertexNormals();
  return n;
}

/** Flat polygon (x, z points) extruded to a thickness along Y, centred on y. */
function slab(pts: [number, number][], thick: number, y = 0): BufferGeometry {
  const sh = new Shape();
  pts.forEach(([x, z], i) => (i === 0 ? sh.moveTo(x, z) : sh.lineTo(x, z)));
  const g = new ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false });
  // shape (x,y,ez) -> (x, -ez, y): shape y becomes world z, extrusion goes to -y.
  g.rotateX(Math.PI / 2);
  g.translate(0, y + thick / 2, 0);
  return flat(g);
}

/** Vertical fin: polygon in (z, y), extruded across X, centred on x=0. */
function fin(pts: [number, number][], thick: number): BufferGeometry {
  const sh = new Shape();
  pts.forEach(([z, y], i) => (i === 0 ? sh.moveTo(z, y) : sh.lineTo(z, y)));
  const g = new ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false });
  g.rotateY(-Math.PI / 2); // shape x -> z, extrusion -> x
  g.translate(thick / 2, 0, 0);
  return flat(g);
}

interface Section {
  z: number;
  w: number; // half width
  top: number;
  bot: number;
}

/** Lofted hexagonal-section body along Z (flat shaded). */
function loft(secs: Section[], cx = 0, cy = 0, cap = true): BufferGeometry {
  const ring = (s: Section): [number, number, number][] => [
    [cx, cy + s.top, s.z],
    [cx + s.w * 0.62, cy + s.top * 0.8, s.z],
    [cx + s.w, cy + (s.top + s.bot) * 0.25, s.z],
    [cx + s.w * 0.6, cy + s.bot, s.z],
    [cx - s.w * 0.6, cy + s.bot, s.z],
    [cx - s.w, cy + (s.top + s.bot) * 0.25, s.z],
    [cx - s.w * 0.62, cy + s.top * 0.8, s.z],
  ];
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  const N = 7;
  for (let i = 0; i < secs.length - 1; i++) {
    const a = ring(secs[i]!);
    const b = ring(secs[i + 1]!);
    for (let k = 0; k < N; k++) {
      const k2 = (k + 1) % N;
      // facing outward (nose at -z, ring ordered clockwise seen from -z)
      tri(a[k]!, b[k]!, b[k2]!);
      tri(a[k]!, b[k2]!, a[k2]!);
    }
  }
  if (cap) {
    const last = ring(secs[secs.length - 1]!);
    for (let k = 1; k < N - 1; k++) tri(last[0]!, last[k + 1]!, last[k]!);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function mirrorX(g: BufferGeometry): BufferGeometry {
  const m = g.clone();
  m.scale(-1, 1, 1);
  // flip winding
  const p = m.getAttribute('position');
  for (let i = 0; i < p.count; i += 3) {
    const x = p.getX(i + 1);
    const y = p.getY(i + 1);
    const z = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, y, z);
  }
  m.computeVertexNormals();
  return m;
}

const both = (g: BufferGeometry): BufferGeometry[] => [g, mirrorX(g)];

/** Inverted hull: smooth normals via vertex welding, pushed outward. */
function outlineOf(parts: BufferGeometry[], thick: number): BufferGeometry {
  const merged = mergeGeometries(parts.map((p) => p.clone()))!;
  merged.deleteAttribute('normal');
  const w = mergeVertices(merged, 1e-3);
  w.computeVertexNormals();
  const p = w.getAttribute('position');
  const n = w.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + n.getX(i) * thick, p.getY(i) + n.getY(i) * thick, p.getZ(i) + n.getZ(i) * thick);
  }
  return w;
}

function gradientMap(): DataTexture {
  const t = new DataTexture(new Uint8Array([70, 160, 255]), 3, 1, RedFormat);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

/** Wide cranked delta (concept art): span ~17 m. */
const WING: [number, number][] = [
  [0.8, -4.2],
  [3.2, -0.9],
  [8.5, 3.3],
  [8.5, 4.6],
  [0.8, 5.4],
];
const STRIPE: [number, number][] = [
  [0.8, -4.2],
  [3.2, -0.9],
  [8.5, 3.3],
  [8.5, 4.0],
  [3.3, 0.0],
  [0.8, -3.3],
];

export function createShipModel(): ShipModel {
  const group = new Group();
  const rig = new Group();
  group.add(rig);
  const grad = gradientMap();
  const white = new MeshToonMaterial({ color: '#f2f4fa', gradientMap: grad });
  const red = new MeshToonMaterial({ color: '#e8203a', gradientMap: grad });
  const dark = new MeshToonMaterial({ color: '#3a3f52', gradientMap: grad });
  const gold = new MeshToonMaterial({ color: '#f5b536', emissive: '#7a4a08', gradientMap: grad });
  const outlineMat = new MeshBasicMaterial({ color: '#1a1830', side: BackSide });

  const whiteParts: BufferGeometry[] = [];
  const redParts: BufferGeometry[] = [];
  const darkParts: BufferGeometry[] = [];

  // Fuselage and canopy.
  whiteParts.push(
    loft([
      { z: -7.2, w: 0.0, top: 0.1, bot: 0.0 },
      { z: -5.2, w: 0.5, top: 0.4, bot: -0.3 },
      { z: -3.0, w: 0.95, top: 0.7, bot: -0.6 },
      { z: 0.5, w: 1.3, top: 0.85, bot: -0.75 },
      { z: 4.5, w: 1.35, top: 0.7, bot: -0.7 },
    ]),
  );
  const canopy = loft(
    [
      { z: -4.4, w: 0.05, top: 0.55, bot: 0.3 },
      { z: -3.4, w: 0.5, top: 1.15, bot: 0.4 },
      { z: -1.6, w: 0.62, top: 1.3, bot: 0.4 },
      { z: 0.2, w: 0.45, top: 0.95, bot: 0.45 },
    ],
    0,
    0.1,
  );
  // Nacelles with a darker intake mouth.
  for (const sx of [-1, 1]) {
    whiteParts.push(
      loft(
        [
          { z: -1.2, w: 0.55, top: 0.55, bot: -0.55 },
          { z: 1.5, w: 0.75, top: 0.65, bot: -0.65 },
          { z: 6.6, w: 0.8, top: 0.6, bot: -0.6 },
        ],
        sx * 1.45,
        -0.05,
      ),
    );
    darkParts.push(
      loft(
        [
          { z: -1.28, w: 0.4, top: 0.4, bot: -0.4 },
          { z: -1.15, w: 0.5, top: 0.5, bot: -0.5 },
        ],
        sx * 1.45,
        -0.05,
      ),
    );
    // nozzle collar
    darkParts.push(
      loft(
        [
          { z: 6.5, w: 0.75, top: 0.6, bot: -0.6 },
          { z: 7.15, w: 0.65, top: 0.52, bot: -0.52 },
        ],
        sx * 1.45,
        -0.05,
      ),
    );
  }

  // Wings with red leading-edge stripe.
  whiteParts.push(...both(slab(WING, 0.18, -0.15)));
  redParts.push(...both(slab(STRIPE, 0.22, -0.15)));

  // Roundel on the right wing.
  const disc = (r: number, y: number) => flat(new CircleGeometry(r, 14).rotateX(-Math.PI / 2).translate(5.2, y, 2.9));
  redParts.push(disc(0.7, 0.01));
  whiteParts.push(disc(0.42, 0.03));
  redParts.push(disc(0.2, 0.05));

  // Rear dark engine bay panel (cosmetic).
  darkParts.push(slab([[-0.8, 3.0], [0.8, 3.0], [0.6, 5.2], [-0.6, 5.2]], 0.1, 0.78));

  // Static meshes (merged per material).
  const add = (parent: Object3D, g: BufferGeometry, m: MeshToonMaterial): Mesh => {
    const mesh = new Mesh(g, m);
    parent.add(mesh);
    return mesh;
  };
  add(rig, mergeGeometries(whiteParts)!, white);
  add(rig, mergeGeometries(redParts)!, red);
  add(rig, mergeGeometries(darkParts)!, dark);
  add(rig, canopy, gold);
  rig.add(new Mesh(outlineOf([...whiteParts, ...redParts, ...darkParts, canopy], 0.07), outlineMat));

  // Animated parts: each is a pivot Object3D carrying mesh + outline.
  const animated = (g: BufferGeometry, m: MeshToonMaterial, x: number, y: number, z: number): Object3D => {
    const pivot = new Object3D();
    pivot.position.set(x, y, z);
    pivot.add(new Mesh(g, m));
    pivot.add(new Mesh(outlineOf([g], 0.05), outlineMat));
    rig.add(pivot);
    return pivot;
  };

  // Elevons (red flaps behind the wing trailing edge), pivot z=4.6.
  const elevon = (sx: number) => {
    const g = slab(
      [
        [0.9, 0.7],
        [8.3, 0.1],
        [8.3, 0.9],
        [0.9, 1.5],
      ],
      0.12,
      -0.15,
    ).translate(0, 0, 0);
    return animated(sx < 0 ? mirrorX(g) : g, red, 0, 0, 4.4);
  };
  const elevons = [elevon(-1), elevon(1)];

  // Airbrakes (S): big red spine panels plus wing spoilers, hinged at the front, flip up hard.
  const airbrakeGeo = slab(
    [
      [0.15, 0],
      [1.35, 0],
      [1.2, 2.7],
      [0.15, 2.7],
    ],
    0.1,
    0,
  );
  const airbrakes = [-1, 1].map((sx) => animated(sx < 0 ? mirrorX(airbrakeGeo) : airbrakeGeo, red, 0, 0.82, 2.0));
  const spoilerGeo = slab(
    [
      [0, 0],
      [4.4, 0],
      [4.4, 1.1],
      [0, 1.4],
    ],
    0.08,
    0,
  );
  const spoilers = [-1, 1].map((sx) => animated(sx < 0 ? mirrorX(spoilerGeo) : spoilerGeo, white, sx * 2.7, 0.06, 2.5));
  let brake = 0;

  // Canards.
  const canard = (sx: number) => {
    const g = slab(
      [
        [0, -0.5],
        [1.9, 0.4],
        [1.9, 1.0],
        [0, 0.8],
      ],
      0.1,
      0,
    );
    return animated(sx < 0 ? mirrorX(g) : g, white, sx * 0.8, 0.1, -3.4);
  };
  const canards = [canard(-1), canard(1)];

  // Twin canted red tail fins.
  const tailGeo = fin(
    [
      [2.2, 0],
      [6.6, 0],
      [6.9, 3.4],
      [5.4, 3.4],
    ],
    0.16,
  );
  const tailInner = fin(
    [
      [3.0, 0.9],
      [5.0, 0.9],
      [5.2, 1.6],
      [3.4, 1.6],
    ],
    0.2,
  );
  const tails = [-1, 1].map((sx) => {
    const p = animated(tailGeo, red, sx * 1.9, 0.3, 0);
    p.rotation.z = -sx * 0.3;
    const stripe = new Mesh(tailInner, white);
    p.add(stripe);
    return p;
  });

  // Glowing nozzles.
  const nozzleMats = [0, 1].map(() => new MeshBasicMaterial({ color: new Color(3, 0.7, 2.4), toneMapped: false }));
  const engines = [-1, 1].map((sx, i) => {
    const nz = new Mesh(new CircleGeometry(0.5, 12), nozzleMats[i]);
    nz.position.set(sx * 1.45, -0.05, 7.18);
    rig.add(nz);
    const anchor = new Object3D();
    anchor.position.set(sx * 1.45, -0.05, 7.2);
    group.add(anchor);
    return anchor;
  });

  // Boost pods: stubby yellow-banded thrusters that slide out of the wing roots on boost.
  const podMat = new MeshToonMaterial({ color: '#3a3f4c', gradientMap: grad });
  const bandMat = new MeshToonMaterial({ color: '#ffc21a', gradientMap: grad });
  const podNozzleMat = new MeshBasicMaterial({ color: new Color(3, 2.2, 0.4), toneMapped: false });
  const podGeo = new CylinderGeometry(0.42, 0.55, 3.2, 10).rotateX(Math.PI / 2);
  const bandGeo = new CylinderGeometry(0.58, 0.58, 0.5, 10).rotateX(Math.PI / 2);
  const pods: Group[] = [];
  const boosters = [-1, 1].map((sx) => {
    const pod = new Group();
    pod.position.set(sx * 2.0, 0.42, 5.0);
    pod.add(new Mesh(podGeo, podMat));
    const band = new Mesh(bandGeo, bandMat);
    band.position.z = 0.9;
    pod.add(band);
    const nz = new Mesh(new CircleGeometry(0.42, 10), podNozzleMat);
    nz.position.z = 1.61;
    pod.add(nz);
    const anchor = new Object3D();
    anchor.position.z = 1.62;
    pod.add(anchor);
    pod.scale.setScalar(0.01);
    group.add(pod);
    pods.push(pod);
    return anchor;
  });
  let deploy = 0;

  const wingtips = [-1, 1].map((sx) => {
    const o = new Object3D();
    o.position.set(sx * 8.5, -0.05, 4.0);
    group.add(o);
    return o;
  });

  let glow = 1;
  let t = 0;
  let bank = 0;
  let turn = 0;
  const target = new Color();

  return {
    group,
    engines,
    boosters,
    wingtips,
    update(dt: number, s: ShipState): void {
      t += dt;
      deploy += ((s.boosting ? 1 : 0) - deploy) * Math.min(1, dt * (s.boosting ? 14 : 4));
      pods.forEach((p, i) => {
        const sx = i === 0 ? -1 : 1;
        p.scale.setScalar(Math.max(0.01, deploy));
        p.position.x = sx * (2.0 + 1.1 * deploy);
        p.visible = deploy > 0.02;
      });
      podNozzleMat.color.setRGB(3 * deploy, 2.2 * deploy, 0.4 * deploy).multiplyScalar(config.fx.flameGlow * 2);
      const want = s.throttleState === -1 ? 0.4 : s.throttleState === 0 ? 1 : s.throttleState === 1 ? 1.9 : 3.6;
      glow += (want - glow) * Math.min(1, dt * 8);
      const flick = glow * (0.92 + 0.08 * Math.sin(t * 60) + 0.05 * Math.sin(t * 97));
      const g = config.fx.flameGlow * 2;
      target.setRGB(3.2 * flick * g, (0.6 * flick + 0.25) * g, 2.4 * flick * g);
      for (const m of nozzleMats) m.color.copy(target);

      const k = Math.min(1, dt * 10);
      bank += (s.bank - bank) * k;
      turn += (s.turnRate - turn) * k;
      const ail = Math.max(-0.5, Math.min(0.5, bank * 0.6));
      elevons[0]!.rotation.x = ail;
      elevons[1]!.rotation.x = -ail;
      const pitchCue = s.throttleState === -1 ? 0.25 : 0;
      canards[0]!.rotation.x = -ail * 0.4 + pitchCue;
      canards[1]!.rotation.x = ail * 0.4 + pitchCue;
      const yawCue = Math.max(-0.3, Math.min(0.3, s.breakTurn * 0.25 + turn * 0.02 * Math.sign(bank)));
      tails[0]!.rotation.y = yawCue;
      tails[1]!.rotation.y = yawCue;

      brake += ((s.throttleState === -1 ? 1 : 0) - brake) * Math.min(1, dt * 12);
      airbrakes[0]!.rotation.set(-1.35 * brake, 0, 0.45 * brake);
      airbrakes[1]!.rotation.set(-1.35 * brake, 0, -0.45 * brake);
      spoilers[0]!.rotation.x = -1.3 * brake;
      spoilers[1]!.rotation.x = -1.3 * brake;
      for (const sp of spoilers) sp.visible = brake > 0.02;
      elevons[0]!.rotation.x += -0.95 * brake;
      elevons[1]!.rotation.x += -0.95 * brake;
      canards[0]!.rotation.x += 0.8 * brake;
      canards[1]!.rotation.x += 0.8 * brake;
    },
  };
}
