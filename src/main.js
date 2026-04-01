import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GhostMind } from './ghost/ghost-mind.js';
// AffectPlot now renders directly to 3D mesh texture
import { GhostBody } from './ghost/ghost-body.js';

// ── Renderer ──────────────────────────────────────────
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
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
const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
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

// ── Textures on monitor meshes ────────────────────────
let innerchatMesh = null;
let emotionhudMesh = null;
let affectCanvas = null;
let affectCtx = null;
let affectTexture = null;
let affectCanvasW = 512;
let affectCanvasH = 512;
let chatCanvas = null;
let chatCtx = null;
let chatTexture = null;
let chatCanvasW = 512;
let chatCanvasH = 512;
const thoughtsPanel = document.getElementById('thoughts-panel');

function initChatTexture(mesh) {
  mesh.updateMatrixWorld(true);

  // Diagnose the mesh geometry
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;

  // Log all vertices and UVs to understand the mapping
  console.log('=== innerchat mesh diagnostics ===');
  console.log('Vertex count:', pos.count);
  const idx = geo.index;
  if (idx) {
    const faces = [];
    for (let i = 0; i < idx.count; i += 3) {
      faces.push(`[${idx.getX(i)}, ${idx.getX(i+1)}, ${idx.getX(i+2)}]`);
    }
    console.log('Face indices:', faces.join(', '));
  }
  // Log the mesh's world matrix to see transforms
  console.log('innerchat world matrix:', mesh.matrixWorld.elements.map(e => e.toFixed(4)).join(', '));
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const uvx = uv ? uv.getX(i) : '?', uvy = uv ? uv.getY(i) : '?';
    console.log(`  v${i}: pos(${vx.toFixed(4)}, ${vy.toFixed(4)}, ${vz.toFixed(4)}) uv(${typeof uvx === 'number' ? uvx.toFixed(4) : uvx}, ${typeof uvy === 'number' ? uvy.toFixed(4) : uvy})`);
  }

  // Get world-space bounding box for aspect ratio
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  console.log('innerchat world size:', size);
  console.log('innerchat world center:', box.getCenter(new THREE.Vector3()));

  // The screen face after world transform: X = width, Y = height
  // Canvas aspect = width / height
  const screenWidth = size.x;
  const screenHeight = size.y;
  const aspect = screenWidth / screenHeight;
  console.log('Screen w/h:', screenWidth.toFixed(4), screenHeight.toFixed(4), 'aspect:', aspect.toFixed(4));

  // Higher resolution canvas for sharp text
  chatCanvasH = 2048;
  chatCanvasW = Math.round(chatCanvasH * aspect);

  chatCanvas = document.createElement('canvas');
  chatCanvas.width = chatCanvasW;
  chatCanvas.height = chatCanvasH;
  chatCtx = chatCanvas.getContext('2d');

  chatTexture = new THREE.CanvasTexture(chatCanvas);
  chatTexture.colorSpace = THREE.SRGBColorSpace;
  chatTexture.flipY = false;
  chatTexture.minFilter = THREE.LinearFilter;
  chatTexture.magFilter = THREE.LinearFilter;
  chatTexture.generateMipmaps = false;

  mesh.material = new THREE.MeshBasicMaterial({
    map: chatTexture,
    color: 0xffffff,
  });

  // Hide the HTML overlay
  thoughtsPanel.style.display = 'none';

  // Initial draw + cursor blink refresh
  drawChatCanvas();
  setInterval(drawChatCanvas, 500);
}

function drawChatCanvas() {
  if (!chatCtx) return;
  const W = chatCanvasW;
  const H = chatCanvasH;

  // Match the affect panel styling exactly:
  // - #0a0a0a background
  // - 1px #3a3a3a border
  // - #1a1a1a title bar with #3a3a3a bottom border
  // - Title: 10px Courier New, #33ff33, 3px 6px padding, 0.5px letter-spacing
  // - Content: 11px Courier New, #33ff33, 6px 8px padding, line-height 1.5
  // - Scrollbar: 6px wide, #0a0a0a track, #1a3a1a/#33ff33 thumb
  //
  // Scale factor: the affect panel renders at ~200px wide on screen.
  // Our canvas is W pixels wide. So 1 CSS pixel = W/200 canvas pixels.
  const SCALE = W / 200;

  const BORDER = Math.round(1 * SCALE);
  const TITLE_PAD_X = Math.round(6 * SCALE);
  const TITLE_PAD_Y = Math.round(3 * SCALE);
  const TITLE_FONT = Math.round(10 * SCALE);
  const TITLE_H = TITLE_FONT + TITLE_PAD_Y * 2;
  const CONTENT_PAD_X = Math.round(8 * SCALE);
  const CONTENT_PAD_Y = Math.round(6 * SCALE);
  const FONT_SIZE = Math.round(11 * SCALE);
  const LINE_H = Math.round(FONT_SIZE * 1.5);
  const SCROLLBAR_W = Math.round(6 * SCALE);
  const MAX_WIDTH = W - CONTENT_PAD_X * 2 - SCROLLBAR_W - BORDER * 2;

  // Background
  chatCtx.fillStyle = '#0a0a0a';
  chatCtx.fillRect(0, 0, W, H);

  // Title bar
  chatCtx.fillStyle = '#1a1a1a';
  chatCtx.fillRect(BORDER, BORDER, W - BORDER * 2, TITLE_H);
  chatCtx.strokeStyle = '#3a3a3a';
  chatCtx.lineWidth = BORDER;
  chatCtx.beginPath();
  chatCtx.moveTo(BORDER, BORDER + TITLE_H);
  chatCtx.lineTo(W - BORDER, BORDER + TITLE_H);
  chatCtx.stroke();

  // Title text
  chatCtx.font = `${TITLE_FONT}px "Courier New", monospace`;
  chatCtx.fillStyle = '#33ff33';
  chatCtx.fillText('happy_thoughts2.exe', BORDER + TITLE_PAD_X, BORDER + TITLE_PAD_Y + TITLE_FONT * 0.85);

  // Border
  chatCtx.strokeStyle = '#3a3a3a';
  chatCtx.lineWidth = BORDER;
  chatCtx.strokeRect(BORDER / 2, BORDER / 2, W - BORDER, H - BORDER);

  // Thought text
  chatCtx.font = `${FONT_SIZE}px "Courier New", monospace`;
  chatCtx.fillStyle = '#33ff33';

  // Build line list
  const allLines = [];
  for (const thought of completedThoughts) {
    const wrapped = wrapText(chatCtx, thought, MAX_WIDTH);
    allLines.push(...wrapped);
    allLines.push('');
  }
  const partial = revealBuffer.slice(0, revealIndex);
  if (partial) {
    allLines.push(...wrapText(chatCtx, partial, MAX_WIDTH));
  }

  // Visible lines
  const textAreaTop = BORDER + TITLE_H + CONTENT_PAD_Y;
  const textAreaH = H - textAreaTop - CONTENT_PAD_Y - BORDER;
  const maxVisible = Math.floor(textAreaH / LINE_H);
  const visible = allLines.slice(-maxVisible);

  visible.forEach((line, i) => {
    chatCtx.fillText(line, BORDER + CONTENT_PAD_X, textAreaTop + FONT_SIZE + i * LINE_H);
  });

  // Blinking cursor
  if (Math.floor(Date.now() / 500) % 2 === 0) {
    const lastLine = visible[visible.length - 1] ?? '';
    const cursorX = BORDER + CONTENT_PAD_X + chatCtx.measureText(lastLine).width + 2;
    const cursorY = textAreaTop + FONT_SIZE + Math.max(0, visible.length - 1) * LINE_H;
    chatCtx.fillText('_', cursorX, cursorY);
  }

  // Scrollbar track
  const sbX = W - BORDER - SCROLLBAR_W;
  const sbTop = BORDER + TITLE_H + BORDER;
  const sbH = H - sbTop - BORDER;
  chatCtx.fillStyle = '#0a0a0a';
  chatCtx.fillRect(sbX, sbTop, SCROLLBAR_W, sbH);

  // Scrollbar thumb
  const totalLines = allLines.length || 1;
  const thumbRatio = Math.min(1, maxVisible / totalLines);
  const thumbH = Math.max(Math.round(sbH * thumbRatio), Math.round(10 * SCALE));
  const scrollRatio = totalLines <= maxVisible ? 0 : (totalLines - maxVisible) / totalLines;
  const thumbY = sbTop + Math.round(scrollRatio * (sbH - thumbH));
  chatCtx.fillStyle = '#1a3a1a';
  chatCtx.fillRect(sbX, thumbY, SCROLLBAR_W, thumbH);
  chatCtx.strokeStyle = '#33ff33';
  chatCtx.lineWidth = BORDER;
  chatCtx.strokeRect(sbX, thumbY, SCROLLBAR_W, thumbH);

  if (chatTexture) chatTexture.needsUpdate = true;
}

function initAffectTexture(mesh) {
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const aspect = size.x / size.y;
  console.log('emotionhud size:', size, 'aspect:', aspect);

  affectCanvasH = 2048;
  affectCanvasW = Math.round(affectCanvasH * aspect);

  affectCanvas = document.createElement('canvas');
  affectCanvas.width = affectCanvasW;
  affectCanvas.height = affectCanvasH;
  affectCtx = affectCanvas.getContext('2d');

  affectTexture = new THREE.CanvasTexture(affectCanvas);
  affectTexture.colorSpace = THREE.SRGBColorSpace;
  affectTexture.flipY = false;
  affectTexture.minFilter = THREE.LinearFilter;
  affectTexture.magFilter = THREE.LinearFilter;
  affectTexture.generateMipmaps = false;

  mesh.material = new THREE.MeshBasicMaterial({
    map: affectTexture,
    color: 0xffffff,
  });

  // Hide the HTML affect panel
  document.getElementById('affect-panel').style.display = 'none';
}

function drawAffectCanvas(affect) {
  if (!affectCtx) return;
  const W = affectCanvasW;
  const H = affectCanvasH;
  const SCALE = W / 200;

  const BORDER = Math.round(1 * SCALE);
  const TITLE_PAD_X = Math.round(6 * SCALE);
  const TITLE_PAD_Y = Math.round(3 * SCALE);
  const TITLE_FONT = Math.round(10 * SCALE);
  const TITLE_H = TITLE_FONT + TITLE_PAD_Y * 2;
  const PLOT_PAD = Math.round(10 * SCALE);

  // Background
  affectCtx.fillStyle = '#0a0a0a';
  affectCtx.fillRect(0, 0, W, H);

  // Title bar
  affectCtx.fillStyle = '#1a1a1a';
  affectCtx.fillRect(BORDER, BORDER, W - BORDER * 2, TITLE_H);
  affectCtx.strokeStyle = '#3a3a3a';
  affectCtx.lineWidth = BORDER;
  affectCtx.beginPath();
  affectCtx.moveTo(BORDER, BORDER + TITLE_H);
  affectCtx.lineTo(W - BORDER, BORDER + TITLE_H);
  affectCtx.stroke();

  // Title text
  affectCtx.font = `${TITLE_FONT}px "Courier New", monospace`;
  affectCtx.fillStyle = '#33ff33';
  affectCtx.fillText('affect_monitor.exe', BORDER + TITLE_PAD_X, BORDER + TITLE_PAD_Y + TITLE_FONT * 0.85);

  // Border
  affectCtx.strokeStyle = '#3a3a3a';
  affectCtx.lineWidth = BORDER;
  affectCtx.strokeRect(BORDER / 2, BORDER / 2, W - BORDER, H - BORDER);

  // Plot area
  const plotTop = BORDER + TITLE_H + PLOT_PAD;
  const plotLeft = PLOT_PAD;
  const plotW = W - PLOT_PAD * 2;
  const plotH = H - plotTop - PLOT_PAD;
  const plotCX = plotLeft + plotW / 2;
  const plotCY = plotTop + plotH / 2;

  // Grid lines
  affectCtx.strokeStyle = '#1a3a1a';
  affectCtx.lineWidth = Math.round(0.5 * SCALE);
  for (let i = 0; i <= 4; i++) {
    const x = plotLeft + (i / 4) * plotW;
    const y = plotTop + (i / 4) * plotH;
    affectCtx.beginPath();
    affectCtx.moveTo(x, plotTop);
    affectCtx.lineTo(x, plotTop + plotH);
    affectCtx.stroke();
    affectCtx.beginPath();
    affectCtx.moveTo(plotLeft, y);
    affectCtx.lineTo(plotLeft + plotW, y);
    affectCtx.stroke();
  }

  // Crosshair at origin
  affectCtx.strokeStyle = '#33ff33';
  affectCtx.lineWidth = Math.round(0.5 * SCALE);
  affectCtx.globalAlpha = 0.3;
  affectCtx.beginPath();
  affectCtx.moveTo(plotCX, plotTop);
  affectCtx.lineTo(plotCX, plotTop + plotH);
  affectCtx.stroke();
  affectCtx.beginPath();
  affectCtx.moveTo(plotLeft, plotCY);
  affectCtx.lineTo(plotLeft + plotW, plotCY);
  affectCtx.stroke();
  affectCtx.globalAlpha = 1;

  // Trail
  const trail = affect.trail;
  if (trail.length > 1) {
    const now = performance.now();
    const trailDuration = 30000;
    affectCtx.lineWidth = Math.round(1.5 * SCALE);
    affectCtx.lineCap = 'round';

    for (let i = 1; i < trail.length; i++) {
      const prev = trail[i - 1];
      const curr = trail[i];
      const age = now - curr.t;
      const alpha = Math.max(0, 1 - age / trailDuration);
      if (alpha <= 0) continue;

      const x0 = plotCX + prev.v * (plotW / 2);
      const y0 = plotCY - prev.a * (plotH / 2);
      const x1 = plotCX + curr.v * (plotW / 2);
      const y1 = plotCY - curr.a * (plotH / 2);

      affectCtx.strokeStyle = '#33ff33';
      affectCtx.globalAlpha = alpha * 0.6;
      affectCtx.beginPath();
      affectCtx.moveTo(x0, y0);
      affectCtx.lineTo(x1, y1);
      affectCtx.stroke();
    }
    affectCtx.globalAlpha = 1;
  }

  // Current point
  const { valence, arousal } = affect.snapshot();
  const px = plotCX + valence * (plotW / 2);
  const py = plotCY - arousal * (plotH / 2);

  affectCtx.shadowColor = '#33ff33';
  affectCtx.shadowBlur = Math.round(8 * SCALE);
  affectCtx.fillStyle = '#33ff33';
  affectCtx.beginPath();
  affectCtx.arc(px, py, Math.round(3 * SCALE), 0, Math.PI * 2);
  affectCtx.fill();
  affectCtx.shadowBlur = 0;

  // Axis labels
  const labelFont = Math.round(8 * SCALE);
  affectCtx.font = `${labelFont}px "Courier New", monospace`;
  affectCtx.fillStyle = '#33ff33';
  affectCtx.globalAlpha = 0.4;

  // Arousal — vertical axis
  affectCtx.save();
  affectCtx.translate(plotLeft - Math.round(4 * SCALE), plotCY);
  affectCtx.rotate(-Math.PI / 2);
  affectCtx.textAlign = 'center';
  affectCtx.fillText('arousal', 0, 0);
  affectCtx.restore();

  // Valence — horizontal axis
  affectCtx.textAlign = 'center';
  affectCtx.fillText('valence', plotCX, plotTop + plotH + labelFont + Math.round(2 * SCALE));

  affectCtx.globalAlpha = 1;

  if (affectTexture) affectTexture.needsUpdate = true;
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Track completed thoughts for the canvas renderer
let completedThoughts = [];

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
    drawChatCanvas();
    revealTimeout = setTimeout(revealNextChar, nextRevealDelay());
  } else if (generationDone) {
    revealTimeout = null;
    // Show full text, clean up hidden span, move cursor out
    if (revealVisible && revealHidden) {
      revealVisible.textContent = revealBuffer;
      revealHidden.remove();
      cursorEl.remove();
    }
    completedThoughts.push(revealBuffer);
    drawChatCanvas();
    currentThoughtEl = null;
    revealVisible = null;
    revealHidden = null;
    revealBuffer = '';
    revealIndex = 0;
    generationDone = false;
    // Done thinking — ghost can move again
    if (ghostBody) ghostBody.isThinking = false;
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
    revealVisible.textContent = revealBuffer.slice(0, revealIndex);
    revealHidden.textContent = revealBuffer.slice(revealIndex);
    generationDone = false;
    // Ghost pauses and looks at camera while thinking
    if (ghostBody) ghostBody.isThinking = true;
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


  // Find MonitorBounds and innerchat mesh
  let boundsObj = null;
  model.traverse((child) => {
    if (child.name === 'MonitorBounds') boundsObj = child;
    if (child.name === 'innerchat') innerchatMesh = child;
    if (child.name === 'emotionhud') emotionhudMesh = child;
  });
  if (innerchatMesh) {
    try { initChatTexture(innerchatMesh); }
    catch (e) { console.error('initChatTexture failed:', e); }
  }
  if (emotionhudMesh) {
    try { initAffectTexture(emotionhudMesh); }
    catch (e) { console.error('initAffectTexture failed:', e); }
  }

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
  if (mouthOpen) mouthOpen.visible = false;
  if (mouthClosed) mouthClosed.visible = true;

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
  const padding = 0.85;
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

// ── Mouse tilt ────────────────────────────────────────
const MAX_TILT = 0.12; // radians (~7°)
let mouseDown = false;
const tiltTarget  = new THREE.Vector2(0, 0); // x=rotY, y=rotX
const tiltCurrent = new THREE.Vector2(0, 0);

canvas.addEventListener('mousedown', (e) => {
  mouseDown = true;
  const nx = (e.clientX / window.innerWidth  - 0.5) * 2;
  const ny = (e.clientY / window.innerHeight - 0.5) * 2;
  tiltTarget.set(nx * MAX_TILT, ny * MAX_TILT);
});

window.addEventListener('mouseup', () => {
  mouseDown = false;
  tiltTarget.set(0, 0);
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
  drawAffectCanvas(mind.affect);

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
      mouthOpen.visible = false;
      mouthClosed.visible = true;
    }
  }

  // Smoothly lerp scene tilt toward target
  tiltCurrent.lerp(tiltTarget, 1 - Math.exp(-8 * delta));
  scene.rotation.y = tiltCurrent.x;
  scene.rotation.x = tiltCurrent.y;

  renderer.render(scene, camera);
}

animate();

export { scene, camera, renderer, loadModel };
