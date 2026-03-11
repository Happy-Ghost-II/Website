import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── Renderer ──────────────────────────────────────────
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ── Scene ─────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

// ── Camera ────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0, 5);

// ── Controls (dev only — remove or lock for production) ──
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// ── Lighting ──────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffeedd, 1.0);
keyLight.position.set(2, 3, 4);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xddeeff, 0.3);
fillLight.position.set(-2, 1, -2);
scene.add(fillLight);

// ── Model Loader ──────────────────────────────────────
const loader = new GLTFLoader();

/**
 * Load a GLB/GLTF model from public/models/
 * Usage: loadModel('panel-frame.glb').then(model => { ... })
 */
function loadModel(filename) {
  return new Promise((resolve, reject) => {
    loader.load(
      `/models/${filename}`,
      (gltf) => {
        scene.add(gltf.scene);
        resolve(gltf);
      },
      (progress) => {
        const pct = (progress.loaded / progress.total * 100).toFixed(0);
        console.log(`Loading ${filename}: ${pct}%`);
      },
      (error) => {
        console.error(`Failed to load ${filename}:`, error);
        reject(error);
      }
    );
  });
}

// ── Placeholder geometry (remove once real models arrive) ──
const placeholderGeo = new THREE.BoxGeometry(1, 1, 1);
const placeholderMat = new THREE.MeshStandardMaterial({
  color: 0x444444,
  metalness: 0.3,
  roughness: 0.7,
});
const placeholder = new THREE.Mesh(placeholderGeo, placeholderMat);
scene.add(placeholder);

// ── Resize ────────────────────────────────────────────
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// ── Render Loop ───────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  // Slow rotation on placeholder (remove later)
  placeholder.rotation.y = elapsed * 0.3;
  placeholder.rotation.x = elapsed * 0.15;

  controls.update();
  renderer.render(scene, camera);
}

animate();

// ── Exports for other modules ─────────────────────────
export { scene, camera, renderer, loadModel };
