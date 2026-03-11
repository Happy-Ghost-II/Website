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

const sunLight = new THREE.DirectionalLight(0xffeedd, 1);
sunLight.position.set(1, 0, 8);
sunLight.castShadow = false;
scene.add(sunLight);

const topLight = new THREE.DirectionalLight(0xffffff, 1);
topLight.position.set(0, 3, 8);
topLight.castShadow = true;
topLight.shadow.mapSize.width = 4096;
topLight.shadow.mapSize.height = 4096;
topLight.shadow.camera.near = 0.1;
topLight.shadow.camera.far = 50;
topLight.shadow.bias = -0.002;
topLight.shadow.normalBias = 0.05;
scene.add(topLight);

// ── Model Loader ──────────────────────────────────────
const loader = new GLTFLoader();

function loadModel(filename, addToScene = true) {
  return new Promise((resolve, reject) => {
    loader.load(
      `/models/${filename}`,
      (gltf) => {
        if (addToScene) scene.add(gltf.scene);
        resolve(gltf);
      },
      undefined,
      (error) => {
        console.error(`Failed to load ${filename}:`, error);
        reject(error);
      }
    );
  });
}

// ── Ghost state ──────────────────────────────────────
let ghost = null;
let ghostBounds = null;
let ghostTarget = new THREE.Vector3();
let ghostVelocity = new THREE.Vector3();
const ghostSpeed = 0.15;
const ghostBobSpeed = 1.5;
const ghostBobAmount = 0.02;
let ghostBaseY = 0;
let ghostPauseTimer = 0;
let ghostState = 'moving'; // 'moving' or 'paused'

function pickNewGhostTarget() {
  if (!ghostBounds) return;
  ghostTarget.set(
    THREE.MathUtils.lerp(ghostBounds.min.x, ghostBounds.max.x, Math.random()),
    ghostBaseY,
    THREE.MathUtils.lerp(ghostBounds.min.z, ghostBounds.max.z, Math.random()),
  );
}

// ── Load Models ──────────────────────────────────────
Promise.all([
  loadModel('computer.glb'),
  loadModel('webghost.glb', false),
]).then(([computerGltf, ghostGltf]) => {
  const model = computerGltf.scene;

  // Enable shadows on all meshes (skip MonitorBounds)
  model.traverse((child) => {
    if (child.name === 'MonitorBounds') return;
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) {
        child.material.side = THREE.DoubleSide;
        child.material.transparent = true;
        child.material.opacity = 0.3;
      }
    }
  });

  // Center the computer model
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  model.updateMatrixWorld(true);

  // Find MonitorBounds
  let boundsObj = null;
  model.traverse((child) => {
    if (child.name === 'MonitorBounds') {
      boundsObj = child;
    }
  });

  // Set up ghost — remove everything except the ghost body mesh
  ghost = ghostGltf.scene;
  const toRemove = [];
  ghost.traverse((child) => {
    console.log('Ghost node:', child.name, child.type, child.isMesh ? 'MESH' : '');
    // Remove lights and cameras from Blender
    if (child.isLight || child.isCamera) {
      toRemove.push(child);
    }
    // Remove cone meshes — keep only what looks like the ghost body
    if (child.isMesh && child.geometry) {
      const geo = child.geometry;
      // Cones typically have far fewer vertices than the ghost body
      const vertCount = geo.attributes.position?.count || 0;
      console.log(`  Mesh "${child.name}" verts:${vertCount}`);
    }
  });
  toRemove.forEach((obj) => obj.parent?.remove(obj));

  // Set up remaining ghost meshes
  ghost.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  if (boundsObj) {
    ghostBounds = new THREE.Box3().setFromObject(boundsObj);

    // Hide the bounds object
    boundsObj.traverse((child) => {
      child.visible = false;
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });

    // Scale ghost down to half size
    ghost.scale.multiplyScalar(0.5);

    // Shrink bounds inward by the ghost's radius
    const ghostBox = new THREE.Box3().setFromObject(ghost);
    const ghostHalf = ghostBox.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    ghostBounds.min.add(ghostHalf);
    ghostBounds.max.sub(ghostHalf);

    // Start ghost near the floor
    ghostBaseY = ghostBounds.min.y;
    ghost.position.set(
      ghostBounds.getCenter(new THREE.Vector3()).x,
      ghostBaseY,
      ghostBounds.getCenter(new THREE.Vector3()).z,
    );
    scene.add(ghost);
    pickNewGhostTarget();
  }

  // Fit shadow cameras to full computer model bounds
  const fullSize = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(fullSize.x, fullSize.y, fullSize.z);
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

  sunLight.target.position.set(0, 0, 0);
  scene.add(sunLight.target);
  topLight.target.position.set(0, 0, 0);
  scene.add(topLight.target);

  // Fit camera
  const modelHeight = fullSize.y;
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

  if (ghost && ghostBounds) {
    if (ghostState === 'paused') {
      ghostPauseTimer -= delta;
      if (ghostPauseTimer <= 0) {
        ghostState = 'moving';
        pickNewGhostTarget();
      }
    } else {
      const dir = new THREE.Vector3().subVectors(ghostTarget, ghost.position);
      dir.y = 0;
      const dist = dir.length();

      if (dist < 0.02) {
        // Arrived — pause for 1–4 seconds
        ghostState = 'paused';
        ghostPauseTimer = 1 + Math.random() * 3;
        ghostVelocity.set(0, 0, 0);
      } else {
        dir.normalize();
        ghostVelocity.lerp(dir.multiplyScalar(ghostSpeed), delta * 2);
        ghost.position.add(ghostVelocity.clone().multiplyScalar(delta));

        ghost.position.x = THREE.MathUtils.clamp(ghost.position.x, ghostBounds.min.x, ghostBounds.max.x);
        ghost.position.z = THREE.MathUtils.clamp(ghost.position.z, ghostBounds.min.z, ghostBounds.max.z);

        // Turn toward movement direction (Y-axis rotation only)
        if (ghostVelocity.length() > 0.001) {
          const targetAngle = Math.atan2(ghostVelocity.x, ghostVelocity.z);
          // Smooth rotation
          let currentAngle = ghost.rotation.y;
          let angleDiff = targetAngle - currentAngle;
          // Normalize to -PI..PI
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          ghost.rotation.y += angleDiff * delta * 4;
        }
      }
    }

    // Bob up and down always
    ghost.position.y = ghostBaseY + Math.sin(elapsed * ghostBobSpeed) * ghostBobAmount;
  }

  renderer.render(scene, camera);
}

animate();

export { scene, camera, renderer, loadModel };
