import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GhostMind } from './ghost/ghost-mind.js';
import { AffectPlot } from './ghost/affect-plot.js';
import { GhostBody } from './ghost/ghost-body.js';

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

// ── Camera ────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(39.6, window.innerWidth / window.innerHeight, 0.1, 1000);
let cameraDistance = 10; // will be set after model loads

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
let ghostBody = null;
let mouthOpen = null;
let mouthClosed = null;
let isTalking = false;
let talkTimer = 0;
let talkPhase = 0;
const TALK_INTERVAL = 0.15;

// ── Emotion colors ───────────────────────────────────
const EMOTION_COLORS = {
  anger:    new THREE.Color('#FF3039'),
  disgust:  new THREE.Color('#92FF77'),
  fear:     new THREE.Color('#999997'),
  joy:      new THREE.Color('#FFCAF8'),
  neutral:  new THREE.Color('#FFFFFC'),
  sadness:  new THREE.Color('#2928FF'),
  surprise: new THREE.Color('#FFCC8B'),
};

const EMOTION_VA = {
  anger:    { v: -0.67, a:  0.49 },
  disgust:  { v: -0.65, a:  0.03 },
  fear:     { v: -0.59, a:  0.49 },
  joy:      { v:  0.80, a:  0.25 },
  neutral:  { v:  0.00, a: -0.54 },
  sadness:  { v: -0.85, a: -0.22 },
  surprise: { v:  0.10, a:  0.62 },
};

function nearestEmotion(valence, arousal) {
  let best = 'neutral';
  let bestDist = Infinity;
  for (const [name, coord] of Object.entries(EMOTION_VA)) {
    const d = (coord.v - valence) ** 2 + (coord.a - arousal) ** 2;
    if (d < bestDist) { bestDist = d; best = name; }
  }
  return best;
}

// ── Ghost animation ───────────────────────────────────
let mixer = null;
let walkAction = null;
let idleAction = null;
let ghostWasResting = null;
let bodyMesh = null;
// Ghost mind — cognitive architecture
const mind = new GhostMind();
const affectPlot = new AffectPlot('affect-plot');
const thoughtsContent = document.getElementById('thoughts-content');

let currentThoughtEl = null;
let isUserScrolledUp = false;
const scrollBtn = document.getElementById('scroll-to-bottom');

function isNearBottom() {
  return thoughtsContent.scrollHeight - thoughtsContent.scrollTop - thoughtsContent.clientHeight < 30;
}

thoughtsContent.addEventListener('scroll', () => {
  isUserScrolledUp = !isNearBottom();
  scrollBtn.classList.toggle('visible', isUserScrolledUp);
});

scrollBtn.addEventListener('click', () => {
  thoughtsContent.scrollTop = thoughtsContent.scrollHeight;
  isUserScrolledUp = false;
  scrollBtn.classList.remove('visible');
});

// Typewriter reveal system
let revealBuffer = '';
let revealIndex = 0;
let revealTimeout = null;
let generationDone = false;

// Base reveal speed — modulated by arousal
let revealBaseMs = 55; // ms per character at neutral arousal

// Cursor element
const cursorEl = document.createElement('span');
cursorEl.id = 'thoughts-cursor';
thoughtsContent.appendChild(cursorEl);

let revealVisible = null;
let revealHidden = null;

function ensureThoughtEl() {
  if (!currentThoughtEl) {
    currentThoughtEl = document.createElement('span');
    currentThoughtEl.className = 'thought-entry';
    revealVisible = document.createElement('span');
    revealHidden = document.createElement('span');
    revealHidden.className = 'thought-unrevealed';
    currentThoughtEl.appendChild(revealVisible);
    // Cursor goes between visible and hidden text
    currentThoughtEl.appendChild(cursorEl);
    currentThoughtEl.appendChild(revealHidden);
    thoughtsContent.appendChild(currentThoughtEl);
  }
}

function nextRevealDelay() {
  const noise = 1.0 + (Math.random() - 0.5) * 0.6;
  return revealBaseMs * noise;
}

function revealNextChar() {
  if (revealIndex < revealBuffer.length) {
    revealIndex++;
    revealVisible.textContent = revealBuffer.slice(0, revealIndex);
    revealHidden.textContent = revealBuffer.slice(revealIndex);
    if (!isUserScrolledUp) {
      thoughtsContent.scrollTop = thoughtsContent.scrollHeight;
    }
    revealTimeout = setTimeout(revealNextChar, nextRevealDelay());
  } else if (generationDone) {
    revealTimeout = null;
    // Show full text, clean up hidden span, move cursor out
    if (revealVisible && revealHidden) {
      revealVisible.textContent = revealBuffer;
      revealHidden.remove();
      cursorEl.remove();
    }
    currentThoughtEl = null;
    revealVisible = null;
    revealHidden = null;
    revealBuffer = '';
    revealIndex = 0;
    generationDone = false;
    // Cursor on a new line, waiting
    thoughtsContent.appendChild(document.createElement('br'));
    thoughtsContent.appendChild(document.createElement('br'));
    thoughtsContent.appendChild(cursorEl);
    if (!isUserScrolledUp) {
      thoughtsContent.scrollTop = thoughtsContent.scrollHeight;
    }
  } else {
    revealTimeout = setTimeout(revealNextChar, nextRevealDelay());
  }
}

function startReveal() {
  if (revealTimeout) return;
  revealTimeout = setTimeout(revealNextChar, nextRevealDelay());
}

mind.thoughtGenerator.addListener({
  onToken(text) {
    ensureThoughtEl();
    revealBuffer = text;
    // Update both spans — visible shows what's revealed, hidden holds the rest for layout
    revealVisible.textContent = revealBuffer.slice(0, revealIndex);
    revealHidden.textContent = revealBuffer.slice(revealIndex);
    generationDone = false;
    isTalking = true;
    startReveal();
  },
  onComplete() {
    generationDone = true;
    isTalking = false;
  },
});

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

  // Set up remaining ghost meshes, find mouth and body meshes
  ghost.traverse((child) => {
    if (child.name === 'mouthopen') mouthOpen = child;
    if (child.name === 'mouthclosed') mouthClosed = child;
    if (child.name === 'body') {
      bodyMesh = child;
      bodyMesh.material = bodyMesh.material.clone();
      bodyMesh.material.color.copy(EMOTION_COLORS.neutral);
    }
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  // Default rest face
  if (mouthOpen) mouthOpen.visible = true;
  if (mouthClosed) mouthClosed.visible = false;

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

    // Create physics body
    console.log('bounds Y:', ghostBounds.min.y, 'to', ghostBounds.max.y);
    console.log('mesh offsets: bottom', meshBottomBelowOrigin, 'top', meshTopAboveOrigin);
    ghostBody = new GhostBody(ghost, ghostBounds, meshBottomBelowOrigin, meshTopAboveOrigin);
    console.log('ghostBody Y range:', ghostBody._minY, 'to', ghostBody._maxY, 'starting at', ghostBody._posY);
    scene.add(ghost);

    // Set up animation mixer
    const clip = ghostGltf.animations[0];
    if (clip) {
      mixer = new THREE.AnimationMixer(ghost);
      const walkClip = THREE.AnimationUtils.subclip(clip, 'walk', 0, 90, 60);
      const idleClip = THREE.AnimationUtils.subclip(clip, 'idle', 90, 270, 60);
      walkAction = mixer.clipAction(walkClip);
      idleAction = mixer.clipAction(idleClip);
      walkAction.loop = THREE.LoopRepeat;
      idleAction.loop = THREE.LoopRepeat;
      idleAction.play(); // start on idle
    }
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

  // Fit camera — compute distance so model fills viewport at FOV 39.6°
  const padding = 1.1;
  const halfFitSize = Math.max(fullSize.x, fullSize.y) * padding * 0.5;
  const vFovRad = THREE.MathUtils.degToRad(39.6);
  cameraDistance = halfFitSize / Math.tan(vFovRad / 2);

  // Position camera: straight on
  camera.position.set(0, 0, cameraDistance);
  camera.lookAt(0, 0, 0);
  fitCamera();

  // Start the ghost's brain
  const loadingEl = document.createElement('span');
  loadingEl.className = 'thought-entry';
  loadingEl.textContent = 'loading...';
  thoughtsContent.insertBefore(loadingEl, cursorEl);
  mind.init(({ phase, loaded, total }) => {
    if (loaded != null && total) {
      const pct = Math.round((loaded / total) * 100);
      if (phase === 'brain') {
        loadingEl.textContent = `loading brain... ${pct}%`;
      } else if (phase === 'affect') {
        loadingEl.textContent = `loading affect... ${pct}%`;
      }
    } else if (phase === 'affect') {
      loadingEl.textContent = 'loading affect...';
    }
  }).then(() => {
    loadingEl.remove();
    mind.start();
  });
});

// ── Resize ────────────────────────────────────────────
function fitCamera() {
  camera.aspect = window.innerWidth / window.innerHeight;
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
  const delta = Math.min(clock.getDelta(), 0.1); // cap at 100ms to prevent explosion after tab switch

  // Integrate affect dynamics continuously
  mind.update(delta);
  affectPlot.draw(mind.affect);

  // Arousal modulates typing speed: high arousal = faster reveal
  const arousalT = (mind.affect.arousal + 1) / 2; // 0..1
  revealBaseMs = 35 + (1 - arousalT) * 50; // 35ms (aroused) to 85ms (calm)

  if (mixer) mixer.update(delta);

  if (bodyMesh) {
    const { valence, arousal } = mind.affect.snapshot();
    const emotion = nearestEmotion(valence, arousal);
    bodyMesh.material.color.lerp(EMOTION_COLORS[emotion], delta * 1.5);
  }

  if (ghostBody) {
    ghostBody.syncParams(mind.behaviorParams);
    ghostBody.update(delta);

    // Crossfade between walk and idle when movement state changes
    if (walkAction && idleAction) {
      const resting = ghostBody._isResting;
      if (resting !== ghostWasResting) {
        ghostWasResting = resting;
        if (resting) {
          walkAction.fadeOut(0.3);
          idleAction.reset().fadeIn(0.3).play();
        } else {
          idleAction.fadeOut(0.3);
          walkAction.reset().fadeIn(0.3).play();
        }
      }
    }
  }

  if (mouthOpen && mouthClosed) {
    if (isTalking) {
      talkTimer += delta;
      if (talkTimer >= TALK_INTERVAL) {
        talkTimer = 0;
        talkPhase = 1 - talkPhase;
        mouthOpen.visible = talkPhase === 0;
        mouthClosed.visible = talkPhase === 1;
      }
    } else {
      mouthOpen.visible = true;
      mouthClosed.visible = false;
    }
  }

  renderer.render(scene, camera);
}

animate();

export { scene, camera, renderer, loadModel };
