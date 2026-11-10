/** Wiring only: fixed-step sim, variable-rate render, window.__game for tests and smoke. */
import '@fontsource/chakra-petch/500-italic.css';
import '@fontsource/chakra-petch/700-italic.css';
import { ACESFilmicToneMapping, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { config } from './core/config';
import { Fx } from './fx/fx';
import { Input } from './input/input';
import { ChaseCamera } from './render/camera';
import { DummyView } from './render/dummyView';
import { Ocean } from './render/ocean';
import { Post } from './render/post';
import { createShipModel } from './render/ship/model';
import { Sky } from './render/sky';
import { TerrainView } from './render/terrainView';
import { forwardOf } from './sim/flight';
import { getScenario } from './sim/scenarios';
import { createTerrain } from './sim/terrainGen';
import { World } from './sim/world';
import { Hud } from './ui/hud';
import { DebugPanel } from './ui/debugPanel';

const params = new URLSearchParams(window.location.search);
const scenarioName = params.get('scenario') ?? 'default';
/** ?shot: screenshot mode (smoke tests): hides the click-to-fly gate. */
const shotMode = params.has('shot');
window.__game = { ready: false, frames: 0, scenario: scenarioName, errors: [] };
window.addEventListener('error', (e) => window.__game.errors.push(String(e.message)));

const app = document.getElementById('app')!;
const hudRoot = document.getElementById('hud')!;

const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
app.appendChild(renderer.domElement);

const terrain = createTerrain(config.world.seed);
const scenario = getScenario(scenarioName, terrain);
const world = new World(terrain, scenario.world);

const scene = new Scene();
const chase = new ChaseCamera(window.innerWidth / window.innerHeight);
const camera = chase.camera;
const sky = new Sky(scene);
const ocean = new Ocean(scene, terrain);
const terrainView = new TerrainView(scene, terrain);
const ship = createShipModel();
scene.add(ship.group);
const dummyView = new DummyView(scene);
const fx = new Fx(scene, camera);
const post = new Post(renderer, scene, camera);
const hud = new Hud(hudRoot);
new DebugPanel(config);
const input = new Input(renderer.domElement);
if (scenario.hold) input.external = scenario.hold;

let damageFlash = 0;
const _nose = new Vector3();

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSize(w, h);
}
window.addEventListener('resize', resize);

chase.snap(world.ship);
let last = performance.now();
let acc = 0;

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const step = 1 / config.sim.rate;
  acc += dt;
  let n = 0;
  while (acc >= step && n < config.sim.maxSteps) {
    world.step(input.sample(n === 0), step);
    acc -= step;
    n++;
  }
  if (n === config.sim.maxSteps) acc = 0;

  for (const e of world.drainEvents()) {
    fx.handle(e, world);
    if (e.type === 'terrainHit') damageFlash = Math.min(1, damageFlash + e.impact / 40);
    if (e.type === 'ram') damageFlash = Math.min(1, damageFlash + 0.25);
  }
  damageFlash = Math.max(0, damageFlash - dt * 2.5);

  const s = world.ship;
  ship.group.position.copy(s.pos);
  ship.group.quaternion.copy(s.quat);
  ship.update(dt, s);
  dummyView.update(dt, world.dummies);

  chase.trauma = Math.min(1, chase.trauma + fx.trauma);
  fx.trauma = 0;
  chase.update(dt, s);
  const underwater = camera.position.y < 0;
  sky.update(camera, world.t);
  ocean.update(camera, world.t, underwater);
  terrainView.update(camera);
  fx.update(dt, world, ship);

  forwardOf(s.quat, _nose).multiplyScalar(600).add(s.pos).project(camera);
  hud.update(s, camera, _nose.z < 1 ? { x: _nose.x, y: _nose.y } : null, input.locked || shotMode);

  post.render(dt, {
    boost: s.boosting ? 1 : 0,
    shieldLoss: 1 - s.shield / config.combat.shieldMax,
    damageFlash,
    underwater,
    time: world.t,
  });
  window.__game.frames++;
  requestAnimationFrame(frame);
}

Object.assign(window.__game, { world, input, config, renderer, camera });
window.__game.ready = true;
requestAnimationFrame(frame);
