import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GhostMind } from './ghost/ghost-mind.js';

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

// ── Camera (orthographic with slight downward angle) ──
const cameraPitch = THREE.MathUtils.degToRad(20); // slight downward tilt
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
let cameraFitSize = 1; // will be set after model loads

// ── Lighting ──────────────────────────────────────────
// Ambient — neutral, well-lit, like a normal room
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

// Monitor glow — subtle warmth from the screen
const monitorGlow = new THREE.PointLight(0xddccbb, 1.2, 4, 1.5);
scene.add(monitorGlow); // position set after model loads

// Fill light from above-right — neutral, soft
const edgeLight = new THREE.DirectionalLight(0xffffff, 0.3);
edgeLight.position.set(2, 3, 1);
scene.add(edgeLight);

// Soft top-down shadow caster — keeps shadows grounded
const shadowLight = new THREE.DirectionalLight(0x111118, 0.4);
shadowLight.position.set(0, 4, 3);
shadowLight.castShadow = true;
shadowLight.shadow.mapSize.width = 2048;
shadowLight.shadow.mapSize.height = 2048;
shadowLight.shadow.camera.near = 0.1;
shadowLight.shadow.camera.far = 50;
shadowLight.shadow.bias = -0.002;
shadowLight.shadow.normalBias = 0.05;
scene.add(shadowLight);

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
// Ghost mind — cognitive architecture
const mind = new GhostMind();
const thoughtsContent = document.getElementById('thoughts-content');

let currentThoughtEl = null;

mind.thoughtGenerator.addListener({
  onToken(text) {
    if (!currentThoughtEl) {
      currentThoughtEl = document.createElement('p');
      currentThoughtEl.className = 'thought-entry';
      thoughtsContent.insertBefore(currentThoughtEl, document.getElementById('thoughts-cursor'));
    }
    currentThoughtEl.textContent = text;
    thoughtsContent.scrollTop = thoughtsContent.scrollHeight;
  },
  onComplete() {
    currentThoughtEl = null;
  },
});
let ghostBaseY = 0;
let ghostBaseZ = 0;
let ghostPauseTimer = 0;
let ghostState = 'moving'; // 'moving' or 'paused'
// Pre-allocated temp vectors to avoid per-frame allocation
const _dir = new THREE.Vector3();
const _scaled = new THREE.Vector3();

function pickNewGhostTarget() {
  if (!ghostBounds) return;
  ghostTarget.set(
    THREE.MathUtils.lerp(ghostBounds.min.x, ghostBounds.max.x, Math.random()),
    ghostBaseY,
    ghostBaseZ,
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
        // child.material.transparent = true;
        // child.material.opacity = 0.3;
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
    if (child.isLight || child.isCamera || child.name === 'Cone') {
      toRemove.push(child);
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

    // Measure how far the ghost's mesh extends below/above its origin
    const ghostBox = new THREE.Box3().setFromObject(ghost);
    const ghostSize = ghostBox.getSize(new THREE.Vector3());
    const meshBottomBelowOrigin = ghost.position.y - ghostBox.min.y;
    const meshTopAboveOrigin = ghostBox.max.y - ghost.position.y;

    // Shrink X bounds so ghost doesn't poke out the sides
    ghostBounds.min.x += ghostSize.x * 0.5;
    ghostBounds.max.x -= ghostSize.x * 0.5;

    // Set floor/ceiling so ghost mesh stays fully inside
    const boundsCenter = ghostBounds.getCenter(new THREE.Vector3());
    ghostBaseY = ghostBounds.min.y + meshBottomBelowOrigin + mind.behaviorParams.bobAmount;
    ghostBaseZ = boundsCenter.z;
    ghost.position.set(boundsCenter.x, ghostBaseY, ghostBaseZ);
    scene.add(ghost);
    pickNewGhostTarget();
  }

  // Position monitor glow at the screen face (front of bounds, centered)
  if (boundsObj) {
    const bc = ghostBounds.getCenter(new THREE.Vector3());
    monitorGlow.position.set(bc.x, bc.y, ghostBounds.max.z + 0.15);
  }

  // Fit shadow camera to model bounds
  const fullSize = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(fullSize.x, fullSize.y, fullSize.z);
  const shadowMargin = maxDim * 3;

  const dist = shadowLight.position.length();
  shadowLight.shadow.camera.left = -shadowMargin;
  shadowLight.shadow.camera.right = shadowMargin;
  shadowLight.shadow.camera.top = shadowMargin;
  shadowLight.shadow.camera.bottom = -shadowMargin;
  shadowLight.shadow.camera.near = Math.max(0.1, dist - shadowMargin);
  shadowLight.shadow.camera.far = dist + shadowMargin;
  shadowLight.shadow.camera.updateProjectionMatrix();

  shadowLight.target.position.set(0, 0, 0);
  scene.add(shadowLight.target);
  edgeLight.target.position.set(0, 0, 0);
  scene.add(edgeLight.target);

  // Fit camera — size the ortho frustum to the model
  const padding = 1.1;
  cameraFitSize = Math.max(fullSize.x, fullSize.y) * padding * 0.5;

  // Position camera: looking slightly downward
  const cameraDistance = 10;
  camera.position.set(
    0,
    Math.sin(cameraPitch) * cameraDistance,
    Math.cos(cameraPitch) * cameraDistance,
  );
  camera.lookAt(0, 0, 0);
  fitCamera();

  // Start the ghost's brain
  const loadingEl = document.createElement('p');
  loadingEl.className = 'thought-entry';
  loadingEl.textContent = 'loading...';
  thoughtsContent.insertBefore(loadingEl, document.getElementById('thoughts-cursor'));
  mind.init(({ loaded, total }) => {
    loadingEl.textContent = `loading brain... ${Math.round((loaded / total) * 100)}%`;
  }).then(() => {
    loadingEl.remove();
    mind.start();
  });
});

// ── Resize ────────────────────────────────────────────
function fitCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  if (aspect >= 1) {
    // Landscape / square: fit height, expand width
    camera.top = cameraFitSize;
    camera.bottom = -cameraFitSize;
    camera.left = -cameraFitSize * aspect;
    camera.right = cameraFitSize * aspect;
  } else {
    // Portrait (mobile): fit width, expand height
    camera.left = -cameraFitSize;
    camera.right = cameraFitSize;
    camera.top = cameraFitSize / aspect;
    camera.bottom = -cameraFitSize / aspect;
  }
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(fitCamera, 100);
});

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
      _dir.subVectors(ghostTarget, ghost.position);
      _dir.y = 0; // only move in X (left/right along the floor)
      _dir.z = 0;
      const dist = _dir.length();

      if (dist < 0.02) {
        // Arrived — pause for 1–4 seconds
        ghostState = 'paused';
        ghostPauseTimer = mind.behaviorParams.pauseDuration * (0.5 + Math.random());
        ghostVelocity.set(0, 0, 0);
      } else {
        _dir.normalize();
        ghostVelocity.lerp(_dir.multiplyScalar(mind.behaviorParams.moveSpeed), delta * 2);
        _scaled.copy(ghostVelocity).multiplyScalar(delta);
        ghost.position.add(_scaled);

        ghost.position.x = THREE.MathUtils.clamp(ghost.position.x, ghostBounds.min.x, ghostBounds.max.x);

        // Turn to face movement direction (rotate around Y axis)
        if (ghostVelocity.length() > 0.001) {
          const targetAngle = Math.atan2(ghostVelocity.x, ghostVelocity.z);
          let currentAngle = ghost.rotation.y;
          let angleDiff = targetAngle - currentAngle;
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          ghost.rotation.y += angleDiff * delta * 4;
        }
      }
    }

    // Bob up and down (Y axis) while standing on the floor
    ghost.position.y = ghostBaseY + Math.sin(elapsed * mind.behaviorParams.bobSpeed) * mind.behaviorParams.bobAmount;
  }

  renderer.render(scene, camera);
}

animate();

export { scene, camera, renderer, loadModel };
