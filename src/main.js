import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── Loading screen ────────────────────────────────────
// Opaque cover, up from the moment the page loads, removed only once the
// tower model, star catalog, and music-player art have all finished loading
// (see readyPromises below) — so nothing ever pops in after the reveal, and
// the music player is already decoded/responsive on the very first click.
// The title jitters/stretches the whole time so the wait reads as intentional.
const loadingScreenEl = document.getElementById('loading-screen');
const loadingTextEl = document.getElementById('loading-text');
let loadingAnimId = 0;

if (loadingTextEl) {
  // Split into one span per character so each can ride its own point on a
  // traveling sine wave — phase-offset by position, so the wave visibly
  // moves down the word like a worm/snake undulating rather than the whole
  // title jittering as one rigid block.
  const rawText = loadingTextEl.textContent;
  loadingTextEl.textContent = '';
  const loadingChars = [...rawText].map((ch) => {
    const span = document.createElement('span');
    span.textContent = ch === ' ' ? ' ' : ch;
    span.style.display = 'inline-block';
    span.style.willChange = 'transform';
    loadingTextEl.appendChild(span);
    return span;
  });

  const loadingStart = performance.now();
  const jitterLoadingText = (now) => {
    const t = (now - loadingStart) / 1000;
    loadingChars.forEach((span, i) => {
      const phase = t * 3.2 + i * 0.6; // per-letter offset = the wave travels along the word
      const y = Math.sin(phase) * 22;                     // bob up/down, like a hump moving through
      const rot = Math.sin(phase) * 16;                   // bend with the wave, like a snake's body
      const sy = 1 + Math.sin(phase + Math.PI / 2) * 0.4;  // stretch/shrink 90° out of phase with the bob
      const sx = 1 / sy;                                   // squash-and-stretch: keep apparent volume
      span.style.transform =
        `translateY(${y.toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${sx.toFixed(2)}, ${sy.toFixed(2)})`;
    });
    loadingAnimId = requestAnimationFrame(jitterLoadingText);
  };
  loadingAnimId = requestAnimationFrame(jitterLoadingText);
}

function hideLoadingScreen() {
  if (!loadingScreenEl) return;
  cancelAnimationFrame(loadingAnimId);
  loadingScreenEl.classList.add('loading-screen--hidden');
  loadingScreenEl.addEventListener('transitionend', () => loadingScreenEl.remove(), { once: true });
}

// Every subsystem below that loads something over the network pushes its
// completion promise here; once they've all settled (or LOADING_TIMEOUT_MS
// elapses, whichever first — a slow/broken asset shouldn't strand visitors
// on a black screen forever) the loading screen is removed.
const readyPromises = [];
const LOADING_TIMEOUT_MS = 20000;

// ── Renderer ──────────────────────────────────────────
// Transparent clear so the CSS sky gradient (on <body>) shows through behind
// the tower. Keeps the sky crisp and resolution-independent.
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  alpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ── Scene ─────────────────────────────────────────────
const scene = new THREE.Scene();

// ── Camera ────────────────────────────────────────────
// Worm's-eye view: low to the ground, off to one side, tilted up the tower.
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 5000);

// Framing knobs — tuned against the model bounds once it loads.
const VIEW = {
  fov: 50,
  azimuthDeg: 145,  // camera orbit angle — sin>0 keeps front wires coming forward, cos<0 puts them on the left; back recedes right
  distanceK: 1.0,  // camera distance from the tower axis, × tower height
  camHeightK: 0.2, // camera height above the base, × tower height
  targetK: 0.6,     // look-at height up the tower, × tower height
};

// Baked-in default camera — a view dialed in with the camera controls and saved.
// Applied on every origin so the framing never depends on localStorage (which
// doesn't carry from the dev server to the live domain).
const DEFAULT_CAMERA = {
  position: [47.7349, -9.4418, -26.5162],
  target: [11.7491, 36.997, 8.7392],
  fov: 50,
};

// Tower yaw about its vertical axis (degrees). Note: because the front/back
// anchors are mirror-symmetric, yawing the tower alone doesn't change the
// picture — which side the wires exit is set by the camera azimuth instead.
const TOWER_YAW_DEG = 0;

// Power-line knobs.
const WIRE = {
  spanK: 4.0,      // distance from the tower to the far anchors, × tower height
  sagK: 0.04,      // catenary droop depth, × span length
  radiusK: 0.0012, // wire tube radius, × tower height
  segments: 48,    // samples along each span
};

// Center-top red light knobs (see addCenterTopLight). Overridden at runtime by
// a saved debug tweak (localStorage), if one exists. Only used as the
// fallback for a fresh light added via the debug panel's "+ Add light"
// button — the actual on-load setup comes from DEFAULT_TOP_LIGHTS below.
const TOP_LIGHT = {
  color: 0xff0000,
  intensity: 4,
  distanceK: 0.6, // point-light falloff distance, × tower height
  decay: 2,
};

// Baked-in light setup — dialed in with the debug sliders and saved. Applied
// on every origin (like DEFAULT_CAMERA) so it doesn't depend on localStorage,
// which doesn't carry between dev-server restarts/ports or into other
// previews. Index 0 is the base center-top light; any further entries are
// extras added via the debug panel's "+ Add light" button.
const DEFAULT_TOP_LIGHTS = [
  { color: 0xff0000, intensity: 20, distance: 101.457, decay: 1.3, position: [1.268, 55.801, 0.028] },
  { color: 0xf2e8d9, intensity: 4.8, distance: 102.725, decay: 0.6, position: [15.853, 39.949, -5.707] },
];

// The center-top light only shows dusk-to-dawn, like a real obstruction
// light — on by the clock, not a dimmer. Hours are in local 24h time; the
// off hour is earlier than the on hour because the "on" span wraps midnight.
const TOP_LIGHT_ON_HOUR = 17;          // 17:00
const TOP_LIGHT_OFF_HOUR = 6 + 46 / 60; // 06:46

// Interactive camera + Save/Reset UI. Turn on to reposition the camera by hand;
// off freezes the view at the VIEW framing (or a saved camera) with no controls.
const CAMERA_CONTROLS = false;

// Debug sliders for the center-top light (intensity/distance/decay/color) plus
// a Save button that persists to localStorage and logs a paste-able snippet
// for TOP_LIGHT. Turn off once the light is dialed in.
const TOP_LIGHT_DEBUG = false;

// Day/night cycle.
const ENABLE_DAY_NIGHT = true;
const DAY_NIGHT = {
  useSystemTime: true, // drive the time of day from the user's local clock
  durationSec: 60,     // full day→night loop length, used only when useSystemTime is false
  startT: 0.25,        // loop start (0.25 = noon, 0.5 = sunset, 0.75 = midnight, 0.0 = sunrise)
  paused: false,
  fixedT: null,        // set 0..1 to freeze at a time of day (debugging); null = normal
};

// A slider that scrubs DAY_NIGHT.fixedT, so lights (or anything else that
// only shows up at night) can be checked without waiting for the real clock.
const TIME_DEBUG = false;

// ── Sky environment ───────────────────────────────────
// A vertical sky gradient baked into an equirectangular map, run through PMREM
// so metal surfaces on the tower reflect the sky instead of rendering black.
function makeSkyEnvironment() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0.0, '#2472c4'); // zenith
  g.addColorStop(0.45, '#4a95dc');
  g.addColorStop(0.8, '#a6cdec');
  g.addColorStop(1.0, '#d8ebf6'); // horizon
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromEquirectangular(tex);
  tex.dispose();
  pmrem.dispose();
  return envRT.texture;
}
scene.environment = makeSkyEnvironment();

// ── Lighting ──────────────────────────────────────────
// Sky/ground hemisphere for soft ambient daylight (colors/intensity animated).
const hemiLight = new THREE.HemisphereLight(0xbfe0ff, 0x8a94a0, 1.1);
scene.add(hemiLight);

// Sun — the key light and shadow caster. Position/color/intensity are driven by
// the day/night cycle; the shadow camera rides along and frames the tower.
const sun = new THREE.DirectionalLight(0xfff6e8, 2.0);
sun.position.set(-4, 6, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.6; // thin lattice members need a nudge to avoid acne
scene.add(sun);
scene.add(sun.target);

// The sun orbits this point (the tower's mid-height) so the shadow camera stays
// centered on the structure. Both are finalized once the model's size is known.
let sunDist = 190;
let sunTargetY = 30;

// Moon — a dim, cool fill that only shows at night.
const moon = new THREE.DirectionalLight(0xaec4ff, 0.0);
scene.add(moon);
scene.add(moon.target);

// ── Sky dome ──────────────────────────────────────────
// A big inward-facing sphere with a vertical gradient (top → horizon). The two
// colors are uniforms so the day/night cycle can repaint the sky each frame.
const skyUniforms = {
  topColor: { value: new THREE.Color('#2472c4') },
  bottomColor: { value: new THREE.Color('#d8ebf6') },
  offset: { value: 120.0 },
  exponent: { value: 0.7 },
};
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  side: THREE.BackSide,
  depthWrite: false,
  toneMapped: false,
  vertexShader: /* glsl */`
    varying vec3 vWorldPosition;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPosition = wp.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform vec3 topColor;
    uniform vec3 bottomColor;
    uniform float offset;
    uniform float exponent;
    varying vec3 vWorldPosition;
    void main() {
      float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
      float f = pow(max(h, 0.0), exponent);
      gl_FragColor = vec4(mix(bottomColor, topColor, f), 1.0);
    }
  `,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMat);
sky.renderOrder = -2; // draw first, behind the stars
scene.add(sky);

// ── Night sky: real stars (HYG catalog) ───────────────
// ~120k real stars loaded from public/data/stars.bin (packed as
// [dirX,dirY,dirZ, mag, ci] Float32 per star, dirZ = north celestial pole).
// They form one celestial sphere that turns slowly around a pole placed behind
// the tower. Each star twinkles with its own phase.
const starVertexShader = /* glsl */`
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSpeed;
  uniform float uTwinkle;
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vColor = aColor;
    // A whisper of brightness shimmer only; size is NOT modulated — size twinkle
    // is what read as jarring.
    vTw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * uSpeed + aPhase));
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio;
  }
`;
const starFragmentShader = /* glsl */`
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0; // 0 at center .. 1 at edge
    float e = max(1.0 - d, 0.0);
    float core = pow(e, 2.0);        // soft bright core (smooth footprint, no flicker)
    float glow = pow(e, 0.9) * 0.30; // soft wide halo — the visible "light"
    gl_FragColor = vec4(vColor, (core + glow) * uOpacity * vTw);
  }
`;

// The visible sky is one celestial sphere at this radius (real stars are all
// effectively at infinity). Size + brightness come from apparent magnitude;
// hue from the B-V color index.
const STAR_RADIUS = 2800;

// B-V color index → RGB: hot blue (negative) → white → warm red (high).
const CI_STOPS = [
  [-0.40, 0.51, 0.63, 1.00], // hot blue
  [ 0.00, 0.72, 0.82, 1.00], // blue-white
  [ 0.40, 1.00, 0.99, 0.95], // white
  [ 0.80, 1.00, 0.88, 0.68], // yellow
  [ 1.20, 1.00, 0.77, 0.50], // orange
  [ 1.60, 1.00, 0.64, 0.40], // deep orange
  [ 2.00, 1.00, 0.55, 0.35], // red
];
function ciToColor(ci, out) {
  const lo = CI_STOPS[0][0];
  const hi = CI_STOPS[CI_STOPS.length - 1][0];
  const c = Math.max(lo, Math.min(hi, ci));
  let k = 0;
  while (k < CI_STOPS.length - 2 && c > CI_STOPS[k + 1][0]) k++;
  const a = CI_STOPS[k], b = CI_STOPS[k + 1];
  const t = (c - a[0]) / (b[0] - a[0]);
  out[0] = a[1] + (b[1] - a[1]) * t;
  out[1] = a[2] + (b[2] - a[2]) * t;
  out[2] = a[3] + (b[3] - a[3]) * t;
  return out;
}

const starSky = new THREE.Group();
scene.add(starSky);
let starMaterial = null; // set once the catalog loads

// Build the point cloud from the packed [dirX,dirY,dirZ, mag, ci] Float32 data.
function buildStars(data) {
  const n = Math.floor(data.length / 5);
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const phases = new Float32Array(n);
  const rgb = [0, 0, 0];

  // Real catalog stars: magnitude → size + brightness, B-V → hue.
  for (let i = 0; i < n; i++) {
    const o = i * 5;
    positions[i * 3] = data[o] * STAR_RADIUS;
    positions[i * 3 + 1] = data[o + 1] * STAR_RADIUS;
    positions[i * 3 + 2] = data[o + 2] * STAR_RADIUS;
    const mag = data[o + 3];
    // Brightness on a near-true logarithmic magnitude scale (each mag ≈ 2.5×):
    // a few bright stars dominate, the faint majority recede — that IS the depth.
    // Size also grows with brightness; the small floor keeps faint stars from
    // sub-pixel flicker while staying dim enough to read as background.
    const size = Math.min(10.0, Math.max(1.1, 0.8 + (5.5 - mag) * 0.95));
    const intensity = Math.min(3.0, Math.max(0.02, Math.pow(2.512, (4.5 - mag) * 0.6)));
    ciToColor(data[o + 4], rgb);
    colors[i * 3] = rgb[0] * intensity;
    colors[i * 3 + 1] = rgb[1] * intensity;
    colors[i * 3 + 2] = rgb[2] * intensity;
    sizes[i] = size;
    phases[i] = Math.random() * Math.PI * 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  starMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uSpeed: { value: 0.7 },
      uTwinkle: { value: 0.035 },
    },
    vertexShader: starVertexShader,
    fragmentShader: starFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const points = new THREE.Points(geo, starMaterial);
  points.renderOrder = -1;
  points.frustumCulled = false;
  starSky.add(points);
  console.log(`stars loaded: ${n}`);
}

readyPromises.push(
  fetch('/data/stars.bin')
    .then((r) => r.arrayBuffer())
    .then((buf) => buildStars(new Float32Array(buf)))
    .catch((e) => console.error('failed to load star catalog:', e))
);

// ── Moon ──────────────────────────────────────────────
// A soft glowing disc that sits along the moonlight direction and fades in at night.
function makeMoonSprite() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,255,250,1)');
  g.addColorStop(0.35, 'rgba(245,247,255,0.95)');
  g.addColorStop(0.5, 'rgba(210,225,255,0.35)');
  g.addColorStop(1.0, 'rgba(180,200,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = -1;
  return sprite;
}
const moonSprite = makeMoonSprite();
moonSprite.scale.set(220, 220, 1);
scene.add(moonSprite);

// The whole star field turns slowly around a fixed pole, like the real night
// sky, so stars sweep in arcs as the night progresses. The pole sits behind the
// tower, up in the frame; its axis is computed from the camera once loaded.
const STAR_POLE = {
  screenY: 0.45, // NDC height of the pivot (positive = upper part of the frame)
  speed: 0.01,   // radians per second — a slow drift over the night
  phase: 4.1,    // initial roll about the pole — orients the denser galactic-plane region into frame
};
const starPoleAxis = new THREE.Vector3(0, 1, 0);
const starAlignQuat = new THREE.Quaternion(); // aligns the celestial pole (+Z) to starPoleAxis
let starAngle = STAR_POLE.phase;

function updateStars(dt, elapsed) {
  starAngle += dt * STAR_POLE.speed;
  // Spin around the pole, then orient the sphere so its pole sits at starPoleAxis.
  starSky.quaternion.setFromAxisAngle(starPoleAxis, starAngle).multiply(starAlignQuat);
  if (starMaterial) starMaterial.uniforms.uTime.value = elapsed;
}

// ── Day/night cycle ───────────────────────────────────
// Palette keyframes (all in sRGB; THREE.Color converts to linear internally).
const PAL = {
  skyTopDay: new THREE.Color('#2472c4'),
  skyTopNight: new THREE.Color('#05060d'),
  skyTopSunset: new THREE.Color('#2b3a63'),
  skyHorizonDay: new THREE.Color('#d8ebf6'),
  skyHorizonNight: new THREE.Color('#0b1526'),
  skyHorizonSunset: new THREE.Color('#ff9a52'),
  sunNoon: new THREE.Color('#fff6e8'),
  sunHorizon: new THREE.Color('#ff7a2f'),
  hemiSkyDay: new THREE.Color('#bfe0ff'),
  hemiSkyNight: new THREE.Color('#0a1428'),
  hemiGroundDay: new THREE.Color('#8a94a0'),
  hemiGroundNight: new THREE.Color('#05070d'),
};
// Scratch colors reused each frame to avoid per-frame allocation.
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _sunDir = new THREE.Vector3();

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// t in [0,1): 0=sunrise, 0.25=noon, 0.5=sunset, 0.75=midnight.
function updateDayNight(t) {
  const phase = t * Math.PI * 2;
  const elev = Math.sin(phase); // sun height: +1 noon, -1 midnight

  const dayFactor = smoothstep(-0.08, 0.22, elev);       // 0 night → 1 day
  const nightFactor = 1 - smoothstep(-0.16, 0.02, elev); // 1 deep night → 0 day
  const twilight = smoothstep(0.28, 0.0, Math.abs(elev)); // peaks at the horizon

  // Sun: arc across the sky, warmer and dimmer near the horizon. It orbits the
  // tower's mid-height so its shadow camera stays framed on the structure.
  _sunDir.set(Math.cos(phase) * 0.6, Math.sin(phase), 0.35).normalize();
  sun.target.position.set(0, sunTargetY, 0);
  sun.position.set(
    _sunDir.x * sunDist,
    _sunDir.y * sunDist + sunTargetY,
    _sunDir.z * sunDist
  );
  sun.color.copy(PAL.sunNoon).lerp(PAL.sunHorizon, twilight);
  sun.intensity = 2.4 * Math.max(elev, 0.0);
  sun.castShadow = elev > -0.05; // stop casting once the sun is below the horizon

  // Moon: opposite the sun, faint and cool, only at night.
  moon.target.position.set(0, sunTargetY, 0);
  moon.position.set(
    -_sunDir.x * sunDist,
    -_sunDir.y * sunDist + sunTargetY,
    -_sunDir.z * sunDist
  );
  moon.intensity = 0.85 * nightFactor;

  // Moon disc in the sky along the moonlight direction; up only when above horizon.
  moonSprite.position.set(-_sunDir.x, -_sunDir.y, -_sunDir.z).multiplyScalar(2200);
  moonSprite.material.opacity = nightFactor * smoothstep(-0.05, 0.15, -_sunDir.y);

  // Hemisphere ambient.
  hemiLight.color.copy(PAL.hemiSkyDay).lerp(PAL.hemiSkyNight, nightFactor);
  hemiLight.groundColor.copy(PAL.hemiGroundDay).lerp(PAL.hemiGroundNight, nightFactor);
  hemiLight.intensity = 0.28 + 0.85 * dayFactor;

  // Sky gradient: night→day base, tinted toward sunset near the horizon crossing.
  _c1.copy(PAL.skyTopNight).lerp(PAL.skyTopDay, dayFactor).lerp(PAL.skyTopSunset, twilight * 0.7);
  skyUniforms.topColor.value.copy(_c1);
  _c2.copy(PAL.skyHorizonNight).lerp(PAL.skyHorizonDay, dayFactor).lerp(PAL.skyHorizonSunset, twilight);
  skyUniforms.bottomColor.value.copy(_c2);

  // Reflections + overall exposure track daylight; stars fade in at night.
  scene.environmentIntensity = 0.05 + 0.95 * dayFactor;
  renderer.toneMappingExposure = 0.85 + 0.25 * dayFactor;
  if (starMaterial) starMaterial.uniforms.uOpacity.value = nightFactor;
}

// ── Model Loader ──────────────────────────────────────
const loader = new GLTFLoader();

function loadModel(filename) {
  return new Promise((resolve, reject) => {
    loader.load(
      `/models/${filename}`,
      (gltf) => resolve(gltf),
      undefined,
      (error) => {
        console.error(`Failed to load ${filename}:`, error);
        reject(error);
      }
    );
  });
}

// ── Camera framing ────────────────────────────────────
function frameTower(height) {
  const az = THREE.MathUtils.degToRad(VIEW.azimuthDeg);
  const dist = height * VIEW.distanceK;
  const camY = height * VIEW.camHeightK;
  const targetY = height * VIEW.targetK;

  camera.fov = VIEW.fov;
  camera.position.set(Math.sin(az) * dist, camY, Math.cos(az) * dist);
  camera.lookAt(0, targetY, 0);
  camera.updateProjectionMatrix();
}

// ── Interactive camera + saved position ───────────────
// Drag to orbit, scroll to zoom, right-drag to pan. "Save" persists the current
// camera to localStorage so it's restored on reload; "Reset" clears it and
// returns to the computed framing above.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.6;
controls.zoomSpeed = 0.9;
controls.panSpeed = 0.6;
controls.enabled = CAMERA_CONTROLS;

const CAM_KEY = 'hgii.camera';
let towerHeight = 0; // set once the model loads; used by resetCamera()

const LIGHT_KEY = 'hgii.topLights';
let centerTopLight = null;  // the base light at the "centertoplight" vert
const sceneLights = [];     // every tunable point light (base + any added via the debug UI)

// Adds another red point light to the scene, tunable the same way as the base
// one. With no `data` it starts at TOP_LIGHT's defaults, next to the first
// light; `data` (from a saved snapshot) restores a specific position/settings.
function createExtraLight(data) {
  const light = new THREE.PointLight(
    data && data.color != null ? data.color : TOP_LIGHT.color,
    data && data.intensity != null ? data.intensity : TOP_LIGHT.intensity,
    data && data.distance != null ? data.distance : towerHeight * TOP_LIGHT.distanceK,
    data && data.decay != null ? data.decay : TOP_LIGHT.decay
  );
  const base = sceneLights[0];
  light.position.fromArray(
    data && data.position ? data.position : (base ? base.position.toArray() : [0, towerHeight, 0])
  );
  light.name = `topLight${sceneLights.length}`;
  scene.add(light);
  sceneLights.push(light);
  return light;
}

function saveTopLights() {
  if (!sceneLights.length) return;
  const data = sceneLights.map((light) => ({
    color: light.color.getHex(),
    intensity: +light.intensity.toFixed(3),
    distance: +light.distance.toFixed(3),
    decay: +light.decay.toFixed(3),
    position: light.position.toArray().map((n) => +n.toFixed(3)),
  }));
  try {
    localStorage.setItem(LIGHT_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('[top light] could not save to localStorage:', e);
  }
  console.log('[top light] saved — paste into TOP_LIGHTS to bake in:\n' + JSON.stringify(data, null, 2));
}

function loadSavedTopLights() {
  try {
    const raw = localStorage.getItem(LIGHT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function applyTopLight(light, data) {
  light.color.setHex(data.color);
  light.intensity = data.intensity;
  light.distance = data.distance;
  light.decay = data.decay;
  if (data.position) light.position.fromArray(data.position);
}

function saveCamera() {
  const data = {
    position: camera.position.toArray().map((n) => +n.toFixed(4)),
    target: controls.target.toArray().map((n) => +n.toFixed(4)),
    fov: camera.fov,
  };
  try {
    localStorage.setItem(CAM_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('[camera] could not save to localStorage:', e);
  }
  console.log(
    '[camera] saved — paste into frameTower() to bake in:\n' +
    `  camera.position.set(${data.position.join(', ')});\n` +
    `  controls.target.set(${data.target.join(', ')});\n` +
    `  camera.fov = ${data.fov};`
  );
  flashStatus('Camera saved');
}

function loadSavedCamera() {
  try {
    const raw = localStorage.getItem(CAM_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function applyCamera(data) {
  camera.position.fromArray(data.position);
  controls.target.fromArray(data.target);
  if (data.fov) camera.fov = data.fov;
  camera.updateProjectionMatrix();
  controls.update();
}

function resetCamera() {
  try { localStorage.removeItem(CAM_KEY); } catch (e) { /* ignore */ }
  if (towerHeight) {
    frameTower(towerHeight);
    controls.target.set(0, towerHeight * VIEW.targetK, 0);
    controls.update();
  }
  flashStatus('View reset');
}

// Small on-screen controls + transient status text.
let statusTimer;
function flashStatus(msg) {
  const el = document.getElementById('cam-status');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.style.opacity = '0'; }, 1500);
}

function initCameraUI() {
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;left:12px;bottom:12px;z-index:10;display:flex;gap:6px;' +
    'align-items:center;font-family:monospace;font-size:12px;';
  const mkBtn = (label) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'padding:6px 10px;background:rgba(0,0,0,0.55);color:#fff;' +
      'border:1px solid rgba(255,255,255,0.4);border-radius:4px;cursor:pointer;font:inherit;';
    return b;
  };
  const saveBtn = mkBtn('Save camera (S)');
  const resetBtn = mkBtn('Reset (R)');
  const status = document.createElement('span');
  status.id = 'cam-status';
  status.style.cssText = 'color:#fff;text-shadow:0 1px 2px #000;opacity:0;transition:opacity .2s;';
  saveBtn.addEventListener('click', saveCamera);
  resetBtn.addEventListener('click', resetCamera);
  panel.append(saveBtn, resetBtn, status);
  document.body.appendChild(panel);
}

if (CAMERA_CONTROLS) {
  window.addEventListener('keydown', (e) => {
    if (e.key === 's' || e.key === 'S') saveCamera();
    if (e.key === 'r' || e.key === 'R') resetCamera();
  });
  initCameraUI();
}

// Debug sliders for every tunable point light (position + intensity/distance/
// decay/color): one section per light, an "+ Add light" button that creates
// another one and appends its section live, and a Save button that persists
// all of them + logs a snippet to paste into TOP_LIGHTS.
function initTopLightUI() {
  if (!sceneLights.length) return;

  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;right:12px;top:12px;z-index:10;display:flex;flex-direction:column;gap:10px;' +
    'padding:10px 12px;background:rgba(0,0,0,0.55);color:#fff;border:1px solid rgba(255,255,255,0.4);' +
    'border-radius:4px;font-family:monospace;font-size:12px;min-width:220px;max-height:80vh;overflow-y:auto;';

  const title = document.createElement('div');
  title.textContent = 'Lights';
  title.style.cssText = 'font-weight:bold;';
  panel.appendChild(title);

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
  panel.appendChild(list);

  function addSlider(container, label, min, max, step, value, onInput) {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;';
    const name = document.createElement('span');
    name.textContent = label;
    const val = document.createElement('span');
    val.textContent = value.toFixed(2);
    head.append(name, val);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      val.textContent = v.toFixed(2);
      onInput(v);
    });
    row.append(head, input);
    container.appendChild(row);
  }

  function addLightSection(light, index) {
    const section = document.createElement('div');
    section.style.cssText =
      'display:flex;flex-direction:column;gap:4px;padding-top:8px;' +
      (index > 0 ? 'border-top:1px solid rgba(255,255,255,0.2);' : '');
    const heading = document.createElement('div');
    heading.textContent = index === 0 ? 'Center-top light' : `Light ${index + 1}`;
    heading.style.cssText = 'font-weight:bold;opacity:0.85;';
    section.appendChild(heading);

    const posRange = Math.max(towerHeight * 2, 10);
    const posStep = posRange / 200;
    addSlider(section, 'X', -posRange, posRange, posStep, light.position.x, (v) => { light.position.x = v; });
    addSlider(section, 'Y', -posRange, posRange, posStep, light.position.y, (v) => { light.position.y = v; });
    addSlider(section, 'Z', -posRange, posRange, posStep, light.position.z, (v) => { light.position.z = v; });
    addSlider(section, 'Intensity', 0, 20, 0.1, light.intensity, (v) => { light.intensity = v; });
    addSlider(section, 'Distance', 0, towerHeight * 3, towerHeight * 0.01, light.distance, (v) => { light.distance = v; });
    addSlider(section, 'Decay', 0, 4, 0.1, light.decay, (v) => { light.decay = v; });

    const colorRow = document.createElement('label');
    colorRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
    const colorName = document.createElement('span');
    colorName.textContent = 'Color';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = `#${light.color.getHexString()}`;
    colorInput.addEventListener('input', () => { light.color.set(colorInput.value); });
    colorRow.append(colorName, colorInput);
    section.appendChild(colorRow);

    list.appendChild(section);
  }

  sceneLights.forEach((light, i) => addLightSection(light, i));

  const btnStyle =
    'padding:6px 10px;background:rgba(255,255,255,0.15);color:#fff;' +
    'border:1px solid rgba(255,255,255,0.4);border-radius:4px;cursor:pointer;font:inherit;';

  const addBtn = document.createElement('button');
  addBtn.textContent = '+ Add light';
  addBtn.style.cssText = btnStyle;
  addBtn.addEventListener('click', () => {
    const light = createExtraLight();
    addLightSection(light, sceneLights.length - 1);
  });

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save lights';
  saveBtn.style.cssText = btnStyle;
  const status = document.createElement('span');
  status.style.cssText = 'color:#fff;text-shadow:0 1px 2px #000;opacity:0;transition:opacity .2s;';
  let saveStatusTimer;
  saveBtn.addEventListener('click', () => {
    saveTopLights();
    status.textContent = 'Saved';
    status.style.opacity = '1';
    clearTimeout(saveStatusTimer);
    saveStatusTimer = setTimeout(() => { status.style.opacity = '0'; }, 1500);
  });

  panel.append(addBtn, saveBtn, status);
  document.body.appendChild(panel);
}

// ── Power lines ───────────────────────────────────────
// A gently drooping conductor between two points, sampled as a curve.
function catenaryCurve(a, b, sag, segments) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = a.clone().lerp(b, t);
    p.y -= sag * 4 * t * (1 - t); // parabolic sag: 0 at the ends, max at midspan
    pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts);
}

// For each `line[FB][TMB][IO]` anchor, copy it out along the corridor to a far
// endpoint (front anchors run forward, back anchors run backward) and string a
// drooping wire between the pair.
function addPowerLines(tower, towerHeight) {
  const LINE_RE = /^line([FB])([TMB])([IO])$/;
  const anchors = [];
  tower.traverse((c) => {
    const m = c.name.match(LINE_RE);
    if (m) {
      const pos = new THREE.Vector3();
      c.getWorldPosition(pos);
      anchors.push({ name: c.name, side: m[1], pos });
    }
  });
  if (!anchors.length) { console.warn('no power-line anchors found'); return; }

  // Corridor axis = horizontal direction from the back anchors to the front ones.
  const frontC = new THREE.Vector3();
  const backC = new THREE.Vector3();
  let nf = 0, nb = 0;
  for (const a of anchors) {
    if (a.side === 'F') { frontC.add(a.pos); nf++; }
    else { backC.add(a.pos); nb++; }
  }
  frontC.divideScalar(nf || 1);
  backC.divideScalar(nb || 1);
  const dirFront = frontC.sub(backC).setY(0).normalize();

  const span = towerHeight * WIRE.spanK;
  const sag = span * WIRE.sagK;
  const radius = towerHeight * WIRE.radiusK;

  const wireMat = new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.55, metalness: 0.85 });
  const group = new THREE.Group();
  group.name = 'powerlines';

  for (const a of anchors) {
    const dir = a.side === 'F' ? dirFront : dirFront.clone().negate();
    const far = a.pos.clone().addScaledVector(dir, span);
    const curve = catenaryCurve(a.pos, far, sag, WIRE.segments);
    const geo = new THREE.TubeGeometry(curve, WIRE.segments, radius, 6, false);
    group.add(new THREE.Mesh(geo, wireMat));
  }
  scene.add(group);
  console.log(`power lines: ${anchors.length} spans, span=${span.toFixed(1)}`);
}

// ── Center-top light ──────────────────────────────────
// A red obstruction-style point light at the "centertoplight" vert exported
// from the model — no visible fixture, just the glow it casts once it's dark.
// Tunable live via the TOP_LIGHT_DEBUG sliders (see initTopLightUI).
function addCenterTopLight(tower, towerHeight) {
  const marker = tower.getObjectByName('centertoplight');
  if (!marker) { console.warn('centertoplight vert not found'); return; }
  const pos = new THREE.Vector3();
  marker.getWorldPosition(pos);

  const light = new THREE.PointLight(TOP_LIGHT.color, TOP_LIGHT.intensity, towerHeight * TOP_LIGHT.distanceK, TOP_LIGHT.decay);
  light.position.copy(pos);
  light.name = 'centerTopLight';
  scene.add(light);
  centerTopLight = light;
  sceneLights.push(light);
}

// ── Load the tower ────────────────────────────────────
readyPromises.push(loadModel('electricaltower.glb').then((gltf) => {
  const tower = gltf.scene;

  tower.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) child.material.side = THREE.DoubleSide;
    }
  });

  // Yaw the tower before measuring, so the corridor runs the desired way.
  tower.rotation.y = THREE.MathUtils.degToRad(TOWER_YAW_DEG);
  tower.updateMatrixWorld(true);

  // Recenter horizontally over the origin, base sitting at y = 0.
  const box = new THREE.Box3().setFromObject(tower);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  tower.position.x -= center.x;
  tower.position.z -= center.z;
  tower.position.y -= box.min.y;
  tower.updateMatrixWorld(true);

  console.log('tower size (w,h,d):', size.x.toFixed(2), size.y.toFixed(2), size.z.toFixed(2));

  scene.add(tower);
  towerHeight = size.y;

  // Aim the sun's orbit at the tower's mid-height and size its shadow camera to
  // enclose the whole structure, so shadows stay crisp at every sun angle.
  sunTargetY = size.y * 0.5;
  sunDist = size.y * 3;
  const R = size.y * 0.7;
  const shadowCam = sun.shadow.camera;
  shadowCam.left = -R;
  shadowCam.right = R;
  shadowCam.top = R;
  shadowCam.bottom = -R;
  shadowCam.near = Math.max(1, sunDist - size.y);
  shadowCam.far = sunDist + size.y;
  shadowCam.updateProjectionMatrix();

  frameTower(size.y); // VIEW-based fallback
  applyCamera(DEFAULT_CAMERA); // the baked saved view — authoritative on every origin

  // A camera saved locally via the controls still overrides the default.
  const saved = loadSavedCamera();
  if (saved) applyCamera(saved);
  controls.update();

  // Star-rotation pole: horizontally centered on the tower, up in the frame.
  camera.updateMatrixWorld(true);
  const towerNdc = new THREE.Vector3(0, size.y * 0.75, 0).project(camera);
  starPoleAxis
    .set(towerNdc.x, STAR_POLE.screenY, 0.5)
    .unproject(camera)
    .sub(camera.position)
    .normalize();
  // Orient the celestial sphere so its north pole (+Z) sits at that screen pole.
  starAlignQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), starPoleAxis);

  addPowerLines(tower, size.y);
  addCenterTopLight(tower, size.y);

  // DEFAULT_TOP_LIGHTS is authoritative on every origin; a locally saved
  // debug tweak (this browser only, mid-tuning) overrides it if present. The
  // first entry applies onto the base center-top light, any further entries
  // are extras (added via the debug panel's "+ Add light" button) recreated
  // the same way.
  const savedLights = loadSavedTopLights();
  const lightsConfig = (savedLights && savedLights.length) ? savedLights : DEFAULT_TOP_LIGHTS;
  if (centerTopLight && lightsConfig[0]) applyTopLight(centerTopLight, lightsConfig[0]);
  for (let i = 1; i < lightsConfig.length; i++) createExtraLight(lightsConfig[i]);

  if (TOP_LIGHT_DEBUG) initTopLightUI();
}).catch((e) => console.error('tower failed to load:', e)));

// ── Music player ──────────────────────────────────────
// A centered canvas toggle: "stop" art by default; tap/click to start the track
// and show the "play" art, tap/click again to stop and revert.
//
// The two source GIFs are the SAME animation (same frame count, same phase) and
// differ only by a small play/stop indicator baked into the moving artwork. Two
// live <img> GIFs can't be kept frame-synced by the browser — they drift, so
// swapping between them jumps the artwork to a different point in the loop. To
// avoid that we decode each GIF's bytes ONCE into an array of frame bitmaps (the
// cached data) and render onto a single canvas from ONE shared frame index. The
// toggle only changes which frameset we draw at that index, so the artwork stays
// on the exact same frame and only the indicator changes — seamless, no drift.
// Returns a promise that resolves once the play/stop/black-hole GIFs have all
// finished decoding, so the caller can hold the loading screen up until the
// music player's first click/minimize is instant rather than stalling on
// GIF decode.
function initMusicPlayer() {
  const toggle = document.getElementById('music-toggle');
  const audio = document.getElementById('music-audio');
  const canvas = document.getElementById('music-canvas');
  const minmaxBtn = document.getElementById('music-minmax');
  const minmaxIcon = document.getElementById('music-minmax-icon');
  const blackholeCanvas = document.getElementById('music-blackhole-canvas');
  if (!toggle || !audio || !canvas) return Promise.resolve();

  // ── Minimize / maximize ──
  // Minimized hides the art (visibility, not display, so layout/frame timing is
  // undisturbed) and stops the container from intercepting clicks, so the scene
  // behind it stays interactive. Only the corner icon remains live.
  const MINMAX_ICONS = {
    expanded: '/images/musicplayer_icon_minus.png', // shown while maximized — click to minimize
    minimized: '/images/musicplayer_icon_maxus.png', // shown while minimized — click to maximize
  };
  let minimized = false;

  function setMinimized(on) {
    minimized = on;
    toggle.classList.toggle('minimized', on);
    if (minmaxBtn) minmaxBtn.setAttribute('aria-pressed', String(on));
    if (minmaxBtn) minmaxBtn.setAttribute('aria-label', on ? 'Maximize music player' : 'Minimize music player');
    if (minmaxIcon) minmaxIcon.src = on ? MINMAX_ICONS.minimized : MINMAX_ICONS.expanded;
  }

  // Plays the decoded black-hole frames once, in the given direction, onto the
  // overlay canvas — direction 1 (forward) starts at frame 0 for minimizing,
  // direction -1 (reverse) starts at the last frame for maximizing — then
  // calls `onDone`. Falls back to an instant no-op transition if the GIF
  // hasn't finished decoding yet (or WebCodecs isn't available at all).
  function playBlackholeTransition(direction, onDone) {
    if (!blackholeCache || !blackholeCanvas || !blackholeCtx) { onDone(); return; }
    const { frames, delays } = blackholeCache;
    let idx = direction === 1 ? 0 : frames.length - 1;
    let last = 0;

    function drawFrame() {
      blackholeCtx.clearRect(0, 0, blackholeCanvas.width, blackholeCanvas.height);
      blackholeCtx.drawImage(frames[idx], 0, 0, blackholeCanvas.width, blackholeCanvas.height);
    }

    function step(ts) {
      if (!last) {
        last = ts;
        drawFrame();
        requestAnimationFrame(step);
        return;
      }
      const delay = delays[idx] || DEFAULT_FRAME_MS;
      if (ts - last < delay) { requestAnimationFrame(step); return; }
      last = ts;
      idx += direction;
      if (direction === 1 ? idx >= frames.length : idx < 0) {
        blackholeCanvas.classList.remove('active');
        onDone();
        return;
      }
      drawFrame();
      requestAnimationFrame(step);
    }

    blackholeCanvas.classList.add('active');
    requestAnimationFrame(step);
  }

  // Routes every minimize/maximize request through the transition so the art
  // only disappears after playing forward, and only reappears after playing
  // back in reverse. Guarded against overlapping clicks mid-animation.
  let transitioningMinmax = false;
  function requestMinimizeToggle() {
    if (transitioningMinmax) return;
    transitioningMinmax = true;
    if (minmaxBtn) minmaxBtn.disabled = true;
    const goingToMinimize = !minimized;
    if (goingToMinimize) {
      // Hide the player art right away so only the black-hole animation shows
      // while it plays — the GIF has transparent areas, so otherwise the art
      // stays visible underneath it instead of looking "sucked in".
      canvas.style.visibility = 'hidden';
    }
    playBlackholeTransition(goingToMinimize ? 1 : -1, () => {
      setMinimized(goingToMinimize);
      if (!goingToMinimize) canvas.style.visibility = '';
      transitioningMinmax = false;
      if (minmaxBtn) minmaxBtn.disabled = false;
    });
  }

  if (minmaxBtn) {
    minmaxBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      requestMinimizeToggle();
    });
    minmaxBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        requestMinimizeToggle();
      }
    });
  }

  const SOURCES = {
    stop: '/images/musicplayerstop.gif',
    play: '/images/musicplayerplay.gif',
    blackhole: '/images/blackholemin.gif',
  };
  const DEFAULT_FRAME_MS = 40; // ~25fps fallback if a GIF omits frame delays

  const ctx = canvas.getContext('2d');
  let playing = false;

  // Decoded frame data, keyed by state: { frames: ImageBitmap[], delays: ms[] }.
  const cache = { stop: null, play: null };
  let frameIndex = 0;
  let acc = 0;          // ms accumulated toward the current frame's delay
  let lastTs = 0;       // performance.now() of the previous rAF tick
  let rafId = 0;

  // Black-hole minimize/maximize transition: decoded once, then a one-shot
  // playthrough draws it onto its own overlay canvas — forwards (sucked in)
  // when minimizing, backwards (emerging) when maximizing — on top of the
  // player art, which only flips visibility once the animation completes.
  let blackholeCache = null;
  const blackholeCtx = blackholeCanvas ? blackholeCanvas.getContext('2d') : null;

  // The visible frameset follows `playing`, but only once its data is cached;
  // until then we keep drawing whatever is already decoded so the canvas is
  // never blank.
  function activeState() {
    if (playing && cache.play) return 'play';
    if (!playing && cache.stop) return 'stop';
    return cache.stop ? 'stop' : (cache.play ? 'play' : null);
  }

  function draw() {
    const state = activeState();
    if (!state) return;
    const { frames } = cache[state];
    const idx = frameIndex % frames.length;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(frames[idx], 0, 0, canvas.width, canvas.height);
  }

  // One clock drives the shared frame index. Both framesets are the same length
  // and cadence, so a single index/timeline keeps them perfectly in step.
  function tick(ts) {
    rafId = requestAnimationFrame(tick);
    const state = activeState();
    if (!state) { lastTs = ts; return; }
    const { frames, delays } = cache[state];
    if (!lastTs) lastTs = ts;
    acc += Math.min(ts - lastTs, 250); // cap after tab-switch stalls
    lastTs = ts;
    let advanced = false;
    // Advance as many frames as elapsed time calls for (usually 0 or 1).
    let guard = frames.length;
    while (acc >= (delays[frameIndex % frames.length] || DEFAULT_FRAME_MS) && guard-- > 0) {
      acc -= (delays[frameIndex % frames.length] || DEFAULT_FRAME_MS);
      frameIndex = (frameIndex + 1) % frames.length;
      advanced = true;
    }
    if (advanced) draw();
  }

  function startLoop() {
    if (rafId) return;
    lastTs = 0;
    rafId = requestAnimationFrame(tick);
  }

  // Decode one GIF into frame bitmaps + per-frame delays using WebCodecs.
  async function decodeGif(url) {
    const buf = await (await fetch(url)).arrayBuffer();
    const decoder = new ImageDecoder({ data: buf, type: 'image/gif' });
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    const count = track.frameCount;
    const frames = [];
    const delays = [];
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      // `image` is a VideoFrame; bake it into an ImageBitmap so we can close the
      // frame and free decoder memory while keeping a cheap, drawable copy.
      frames.push(await createImageBitmap(image));
      delays.push(image.duration ? image.duration / 1000 : DEFAULT_FRAME_MS);
      image.close();
    }
    decoder.close();
    return { frames, delays };
  }

  function setPlaying(on) {
    playing = on;
    // No DOM/opacity swap: the render loop simply starts drawing the other
    // frameset at the same shared index on the next tick.
    toggle.setAttribute('aria-pressed', String(on));
  }

  function toggleMusic() {
    if (playing) {
      // Pause without resetting, so the next tap resumes from here.
      audio.pause();
      setPlaying(false);
    } else {
      // Play returns a promise in modern browsers; guard against it rejecting
      // (e.g. if the file is missing) so the UI doesn't get stuck.
      const p = audio.play();
      if (p && p.catch) p.catch((e) => { console.warn('[music] play failed:', e); setPlaying(false); });
      setPlaying(true);
    }
  }

  toggle.addEventListener('click', toggleMusic);
  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMusic(); }
  });

  // Keep the art in sync if the track ever ends on its own (it loops, but be safe).
  audio.addEventListener('ended', () => setPlaying(false));

  // ── Decode + start ──────────────────────────────────
  // Fall back to plain <img> GIFs if WebCodecs' ImageDecoder isn't available
  // (older Safari/Firefox); the player still works, just without the sync fix.
  if (typeof ImageDecoder === 'undefined') {
    console.warn('[music] ImageDecoder unavailable — falling back to <img> GIFs');
    canvas.remove();
    const stopImg = new Image();
    stopImg.src = SOURCES.stop;
    stopImg.alt = 'Music player';
    stopImg.className = 'music-art';
    stopImg.style.cssText = 'display:block;width:100%;height:auto';
    toggle.prepend(stopImg);
    const update = () => { stopImg.src = playing ? SOURCES.play : SOURCES.stop; };
    toggle.addEventListener('click', update);
    toggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') update();
    });
    audio.addEventListener('ended', update);
    return new Promise((resolve) => {
      if (stopImg.complete) resolve();
      else stopImg.addEventListener('load', () => resolve(), { once: true });
    });
  }

  // Decode the default (stop) frameset first so the canvas paints ASAP, then the
  // play frameset in the background so the first toggle is instant.
  const stopReady = decodeGif(SOURCES.stop)
    .then((data) => { cache.stop = data; canvas.width = data.frames[0].width; canvas.height = data.frames[0].height; draw(); startLoop(); })
    .catch((e) => console.warn('[music] stop decode failed:', e));
  const playReady = decodeGif(SOURCES.play)
    .then((data) => { cache.play = data; })
    .catch((e) => console.warn('[music] play decode failed:', e));
  const blackholeReady = blackholeCanvas
    ? decodeGif(SOURCES.blackhole)
        .then((data) => {
          blackholeCache = data;
          blackholeCanvas.width = data.frames[0].width;
          blackholeCanvas.height = data.frames[0].height;
        })
        .catch((e) => console.warn('[music] blackhole decode failed:', e))
    : Promise.resolve();

  return Promise.all([stopReady, playReady, blackholeReady]);
}
readyPromises.push(initMusicPlayer());

// ── Resize ────────────────────────────────────────────
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(onResize, 100);
});

// ── Render Loop ───────────────────────────────────────
const clock = new THREE.Clock();
let dayT = DAY_NIGHT.startT;

// Map the user's local clock to cycle time: sunrise ≈ 06:00 (t=0), noon (0.25),
// sunset ≈ 18:00 (0.5), midnight (0.75).
function systemTimeOfDay() {
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  return (((h - 6) / 24) % 1 + 1) % 1;
}

// t (0..1, 0 = 06:00) → 24h clock hour (0..24), for anything keyed to time of day.
function dayTToHour(t) {
  return (((t * 24) + 6) % 24 + 24) % 24;
}

// t (0..1, 0 = 06:00) → an "HH:MM" clock label for the slider readout.
function formatDayT(t) {
  const h = dayTToHour(t);
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function initTimeUI() {
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;left:12px;top:12px;z-index:10;display:flex;flex-direction:column;gap:6px;' +
    'padding:10px 12px;background:rgba(0,0,0,0.55);color:#fff;border:1px solid rgba(255,255,255,0.4);' +
    'border-radius:4px;font-family:monospace;font-size:12px;min-width:200px;';

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;';
  const title = document.createElement('span');
  title.textContent = 'Time of day';
  title.style.cssText = 'font-weight:bold;';
  const clockLabel = document.createElement('span');
  head.append(title, clockLabel);
  panel.appendChild(head);

  const startT = DAY_NIGHT.fixedT != null ? DAY_NIGHT.fixedT : dayT;
  clockLabel.textContent = formatDayT(startT);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.001';
  slider.value = String(startT);
  slider.addEventListener('input', () => {
    const t = parseFloat(slider.value);
    DAY_NIGHT.fixedT = t;
    clockLabel.textContent = formatDayT(t);
  });
  panel.appendChild(slider);

  const liveBtn = document.createElement('button');
  liveBtn.textContent = 'Live (system time)';
  liveBtn.style.cssText =
    'padding:6px 10px;background:rgba(255,255,255,0.15);color:#fff;' +
    'border:1px solid rgba(255,255,255,0.4);border-radius:4px;cursor:pointer;font:inherit;';
  liveBtn.addEventListener('click', () => {
    DAY_NIGHT.fixedT = null;
    const t = DAY_NIGHT.useSystemTime ? systemTimeOfDay() : dayT;
    slider.value = String(t);
    clockLabel.textContent = formatDayT(t);
  });
  panel.appendChild(liveBtn);

  document.body.appendChild(panel);
}
if (TIME_DEBUG) initTimeUI();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1); // cap after tab-switch stalls

  if (ENABLE_DAY_NIGHT) {
    let t;
    if (DAY_NIGHT.fixedT != null) {
      t = DAY_NIGHT.fixedT;
    } else if (DAY_NIGHT.useSystemTime) {
      t = systemTimeOfDay();
      dayT = t;
    } else if (!DAY_NIGHT.paused) {
      dayT = (dayT + dt / DAY_NIGHT.durationSec) % 1;
      t = dayT;
    } else {
      t = dayT;
    }
    updateDayNight(t);

    if (centerTopLight) {
      const hour = dayTToHour(t);
      centerTopLight.visible = hour >= TOP_LIGHT_ON_HOUR || hour < TOP_LIGHT_OFF_HOUR;
    }
  }

  updateStars(dt, clock.elapsedTime);

  if (CAMERA_CONTROLS) controls.update();
  renderer.render(scene, camera);
}
animate();

// Reveal once everything's ready — or after LOADING_TIMEOUT_MS regardless, so
// a slow or broken asset doesn't strand visitors on the loading screen.
Promise.race([
  Promise.all(readyPromises),
  new Promise((resolve) => setTimeout(resolve, LOADING_TIMEOUT_MS)),
]).then(hideLoadingScreen);

export { scene, camera, renderer, loadModel };
