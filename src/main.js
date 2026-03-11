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
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ── Scene ─────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

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
const sunLight = new THREE.DirectionalLight(0xffeedd, 1);
sunLight.position.set(1, 0, 8);
sunLight.castShadow = false;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.1;
sunLight.shadow.camera.far = 50;
sunLight.shadow.camera.left = -5;
sunLight.shadow.camera.right = 5;
sunLight.shadow.camera.top = 5;
sunLight.shadow.camera.bottom = -5;
sunLight.shadow.bias = -0.002;
sunLight.shadow.normalBias = 0.05;
scene.add(sunLight);

const topLight = new THREE.DirectionalLight(0xffffff, 1);
topLight.position.set(0, 3, 8);
topLight.castShadow = true;
topLight.shadow.mapSize.width = 4096;
topLight.shadow.mapSize.height = 4096;
topLight.shadow.camera.near = 0.1;
topLight.shadow.camera.far = 50;
topLight.shadow.camera.left = -1.5;
topLight.shadow.camera.right = 1.5;
topLight.shadow.camera.top = 1.5;
topLight.shadow.camera.bottom = -1.5;
topLight.shadow.bias = -0.002;
topLight.shadow.normalBias = 0.05;
scene.add(topLight);

const fillLight = new THREE.DirectionalLight(0xddeeff, 0.0);
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

// ── Ghost wandering state ────────────────────────────
let ghost = null;
let ghostBounds = null;
let ghostTarget = new THREE.Vector3();
let ghostVelocity = new THREE.Vector3();
const ghostSpeed = 0.15;
const ghostBobSpeed = 1.5;
const ghostBobAmount = 0.02;

function pickNewGhostTarget() {
  if (!ghostBounds) return;
  ghostTarget.set(
    THREE.MathUtils.lerp(ghostBounds.min.x, ghostBounds.max.x, Math.random()),
    THREE.MathUtils.lerp(ghostBounds.min.y, ghostBounds.max.y, Math.random()),
    THREE.MathUtils.lerp(ghostBounds.min.z, ghostBounds.max.z, Math.random()),
  );
}

// ── Load Models ──────────────────────────────────────
Promise.all([
  loadModel('computer.glb'),
  loadModel('webghost.glb'),
]).then(([computerGltf, ghostGltf]) => {
  const model = computerGltf.scene;

  // Enable shadows on all meshes
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) {
        child.material.side = THREE.DoubleSide;
      }
    }
  });

  // Center the computer model
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);

  // Find the monitor interior bounds by looking for the sky-textured mesh
  // Log mesh names so we can identify the monitor interior
  let monitorMesh = null;
  model.traverse((child) => {
    if (child.isMesh) {
      console.log('Mesh:', child.name, 'pos:', child.position);
      // The sky/cloud mesh is likely the monitor interior
      if (child.material && child.material.map) {
        monitorMesh = child;
      }
    }
  });

  // Set up ghost
  ghost = ghostGltf.scene;
  ghost.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  // Scale ghost to fit inside the monitor
  const ghostBox = new THREE.Box3().setFromObject(ghost);
  const ghostSize = ghostBox.getSize(new THREE.Vector3());
  const monitorSize = box.getSize(new THREE.Vector3());
  const ghostScale = (monitorSize.y * 0.15) / ghostSize.y;
  ghost.scale.setScalar(ghostScale);

  // Define the monitor interior bounds for wandering
  // Shrink inward from the full model bounds, focusing on the upper portion (monitor)
  const margin = 0.03;
  ghostBounds = new THREE.Box3(
    new THREE.Vector3(
      box.min.x + monitorSize.x * 0.15,
      center.y + monitorSize.y * 0.05,
      box.min.z + monitorSize.z * 0.15,
    ),
    new THREE.Vector3(
      box.max.x - monitorSize.x * 0.15,
      box.max.y - monitorSize.y * 0.1,
      box.max.z - margin,
    ),
  );

  // Offset ghost position by the same centering offset as the computer
  ghost.position.copy(ghostBounds.getCenter(new THREE.Vector3()));
  pickNewGhostTarget();

  // Fit shadow cameras to model bounds
  const maxDim = Math.max(monitorSize.x, monitorSize.y, monitorSize.z);
  const shadowMargin = maxDim * 3;

  for (const light of [sunLight, topLight]) {
    const dist = light.position.length();
    light.shadow.camera.left = -shadowMargin;
    light.shadow.camera.right = shadowMargin;
    light.shadow.camera.top = shadowMargin;
    light.shadow.camera.bottom = -shadowMargin;
    light.shadow.camera.near = Math.max(0.1, dist - shadowMargin);
    light.shadow.camera.far = dist + shadowMargin;
    light.shadow.camera.updateProjectionMatrix();
  }

  // Point both shadow lights at the model center
  sunLight.target.position.set(0, 0, 0);
  scene.add(sunLight.target);
  topLight.target.position.set(0, 0, 0);
  scene.add(topLight.target);

  // Fit camera so model fills the screen vertically with a little padding
  const modelHeight = monitorSize.y;
  const padding = 1.1;
  const distance = (modelHeight * padding / 2) / Math.tan(THREE.MathUtils.degToRad(fov / 2));

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
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  // Animate ghost wandering
  if (ghost && ghostBounds) {
    const dir = new THREE.Vector3().subVectors(ghostTarget, ghost.position);
    const dist = dir.length();

    if (dist < 0.02) {
      pickNewGhostTarget();
    } else {
      dir.normalize();
      // Smooth acceleration toward target
      ghostVelocity.lerp(dir.multiplyScalar(ghostSpeed), delta * 2);
      ghost.position.add(ghostVelocity.clone().multiplyScalar(delta));

      // Clamp to bounds
      ghost.position.clamp(ghostBounds.min, ghostBounds.max);

      // Gentle bobbing
      ghost.position.y += Math.sin(elapsed * ghostBobSpeed) * ghostBobAmount * delta;

      // Face movement direction slightly
      if (ghostVelocity.length() > 0.01) {
        const lookTarget = ghost.position.clone().add(ghostVelocity);
        ghost.lookAt(lookTarget);
      }
    }
  }

  renderer.render(scene, camera);
}

animate();

// ── Exports for other modules ─────────────────────────
export { scene, camera, renderer, loadModel };
