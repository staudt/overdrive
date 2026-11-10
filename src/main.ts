// TEMPORARY placeholder: a spinning box, to be replaced.
import * as THREE from 'three';

const scenario = new URLSearchParams(window.location.search).get('scenario') ?? 'default';

window.__game = { ready: false, frames: 0, scenario, errors: [] };

const container = document.getElementById('app');
if (!container) throw new Error('#app container missing');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#87ceeb');

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1, 4);
camera.lookAt(0, 0, 0);

const box = new THREE.Mesh(
  new THREE.BoxGeometry(1.5, 1.5, 1.5),
  new THREE.MeshNormalMaterial(),
);
scene.add(box);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__game.ready = true;

function frame(): void {
  box.rotation.x += 0.01;
  box.rotation.y += 0.015;
  renderer.render(scene, camera);
  window.__game.frames += 1;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
