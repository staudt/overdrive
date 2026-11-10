/** Wiring only: fixed-step sim, variable-rate render, window.__game for tests and smoke. */
import '@fontsource/chakra-petch/500-italic.css';
import '@fontsource/chakra-petch/700-italic.css';
import { ACESFilmicToneMapping, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { GameAudio } from './audio/audio';
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
import { WeaponsView } from './render/weaponsView';
import { EnemyBulletsView } from './render/enemyBulletsView';
import { BossView } from './render/bossView';
import { BossFx } from './fx/bossFx';
import { forwardOf } from './sim/flight';
import { getScenario } from './sim/scenarios';
import { createTerrain } from './sim/terrainGen';
import { waveHeight } from './sim/waves';
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
let world = new World(terrain, scenario.world);

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
const weaponsView = new WeaponsView(scene, camera);
const enemyBulletsView = new EnemyBulletsView(scene, camera);
const bossView = new BossView(scene);
const bossFx = new BossFx(scene, camera);
const post = new Post(renderer, scene, camera);
const hud = new Hud(hudRoot);
new DebugPanel(config);
const input = new Input(renderer.domElement);
const audio = new GameAudio();
window.addEventListener('pointerdown', () => audio.resume());
window.addEventListener('keydown', () => audio.resume());
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

chase.snap(world.ship, world.t);

/** Luftrausers loop: after death, R / Enter (or a click) starts a fresh run. */
let deadFor = 0;
function restart(): void {
  world = new World(terrain, getScenario(scenarioName, terrain).world);
  window.__game.world = world;
  deadFor = 0;
  chase.snap(world.ship, world.t);
}
window.addEventListener('keydown', (e) => {
  if (world.ship.dead && deadFor > 0.8 && (e.code === 'KeyR' || e.code === 'Enter')) restart();
});
window.addEventListener('mousedown', () => {
  if (world.ship.dead && deadFor > 0.8) restart();
});
let last = performance.now();
let acc = 0;

function frame(now: number): void {
  // rAF timestamps can predate the performance.now() taken at startup: never go negative.
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
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

  const events = world.drainEvents();
  for (const e of events) {
    fx.handle(e, world);
    bossFx.handle(e, world);
    audio.handle(e);
    if (e.type === 'terrainHit') damageFlash = Math.min(1, damageFlash + e.impact / 40);
    if (e.type === 'ram') damageFlash = Math.min(1, damageFlash + 0.25);
    if (e.type === 'playerHit') damageFlash = Math.min(1, damageFlash + 0.35);
    if (e.type === 'hullHit') damageFlash = Math.min(1, damageFlash + e.impact / 40);
  }
  damageFlash = Math.max(0, damageFlash - dt * 2.5);
  if (world.ship.dead) deadFor += dt;

  const s = world.ship;
  ship.group.position.copy(s.pos);
  ship.group.quaternion.copy(s.quat);
  ship.update(dt, s);
  audio.update(dt, s);
  dummyView.update(dt, world.dummies);
  weaponsView.update(dt, world);
  enemyBulletsView.update(dt, world);
  bossView.update(dt, world);
  bossFx.update(dt, world);
  ship.group.visible = !world.ship.dead;

  chase.zoom(input.takeWheel());
  chase.trauma = Math.min(1, chase.trauma + fx.trauma + bossFx.trauma);
  fx.trauma = 0;
  bossFx.trauma = 0;
  chase.update(dt, s, world.t);
  const underwater = camera.position.y < waveHeight(camera.position.x, camera.position.z, world.t);
  sky.update(camera, world.t);
  ocean.update(camera, world.t, underwater);
  terrainView.update(camera);
  fx.update(dt, world, ship);

  forwardOf(s.quat, _nose).multiplyScalar(600).add(s.pos).project(camera);
  hud.update(s, camera, _nose.z < 1 ? { x: _nose.x, y: _nose.y } : null, input.locked || shotMode);
  hud.updateCombat(world, camera, events);

  const postState = {
    boost: s.boosting ? 1 : 0,
    shieldLoss: 1 - s.shield / config.combat.shieldMax,
    damageFlash,
    underwater,
    time: world.t,
  };
  window.__game.post = postState;
  post.render(dt, postState);
  window.__game.frames++;
  requestAnimationFrame(frame);
}

Object.assign(window.__game, { world, input, config, renderer, camera, audio });
window.__game.ready = true;
requestAnimationFrame(frame);
