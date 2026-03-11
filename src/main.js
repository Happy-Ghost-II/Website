import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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

// ── Camera (low FOV for flat/telephoto look) ─────────
const fov = 39.6; // ~50mm focal length
const camera = new THREE.PerspectiveCamera(
  fov,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

// ── Lighting ──────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

// Sun — Blender rotation x=100°, y=-100°, z=0° converted to Three.js
// Blender -Y front → glTF +Z front; sun direction computed and flipped for position
const sunLight = new THREE.DirectionalLight(0xffeedd, 1.8);
sunLight.position.set(2, 5, 8);
scene.add(sunLight);

const fillLight = new THREE.DirectionalLight(0xddeeff, 0.3);
fillLight.position.set(-2, 1, -2);
scene.add(fillLight);

// ── Model Loader ──────────────────────────────────────
const loader = new GLTFLoader();

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

// ── Load Model ───────────────────────────────────────
loadModel('computer.glb').then((gltf) => {
  const model = gltf.scene;

  // Center the model
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);

  // Fit camera so model fills the screen vertically with a little padding
  const size = box.getSize(new THREE.Vector3());
  const modelHeight = size.y;
  const padding = 1.1; // 10% breathing room top/bottom
  const distance = (modelHeight * padding / 2) / Math.tan(THREE.MathUtils.degToRad(fov / 2));

  // Camera faces +Z → front of computer (Blender -Y → glTF +Z)
  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);

  fitCamera();
});

// ── Resize ────────────────────────────────────────────
function fitCamera() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', fitCamera);

// ── Render Loop ───────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

animate();

// ── Exports for other modules ─────────────────────────
export { scene, camera, renderer, loadModel };
