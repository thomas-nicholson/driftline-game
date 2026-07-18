import '@fontsource/bricolage-grotesque/latin-700.css';
import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-700.css';
import * as THREE from 'three';

import './style.css';
import {
  TRACK_HALF_WIDTH,
  clamp,
  collisionHit,
  difficultyForScore,
  scoreAfterStep,
  spawnDelayForScore,
  steeringTargetFromClientX,
} from './game-model.js';

const ui = {
  shell: document.querySelector('#game-shell'),
  canvas: document.querySelector('#game-canvas'),
  score: document.querySelector('#score'),
  energy: document.querySelector('#energy'),
  soundButton: document.querySelector('#sound-button'),
  soundState: document.querySelector('#sound-state'),
  startScreen: document.querySelector('#start-screen'),
  endScreen: document.querySelector('#end-screen'),
  pauseScreen: document.querySelector('#pause-screen'),
  startButton: document.querySelector('#start-button'),
  restartButton: document.querySelector('#restart-button'),
  resumeButton: document.querySelector('#resume-button'),
  finalScore: document.querySelector('#final-score'),
  bestScore: document.querySelector('#best-score'),
  liveStatus: document.querySelector('#live-status'),
  lede: document.querySelector('.screen__lede'),
};

function readCssColour(tokenName) {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  context.canvas.width = 1;
  context.canvas.height = 1;
  context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim();
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return (red << 16) | (green << 8) | blue;
}

const colours = {
  sky: readCssColour('--color-paper'),
  fog: readCssColour('--color-paper-raised'),
  ground: readCssColour('--color-paper-soft'),
  groundEdge: readCssColour('--color-ground-edge'),
  marker: readCssColour('--color-marker'),
  accent: readCssColour('--color-accent'),
  energy: readCssColour('--color-energy'),
  ink: readCssColour('--color-ink'),
  hazard: readCssColour('--color-error'),
  shadow: readCssColour('--color-shadow'),
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const lowPowerDevice = (
  (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
  || (navigator.deviceMemory && navigator.deviceMemory <= 4)
);

let renderer;
let scene;
let camera;
let ship;
let shipShadow;
let worldClock = 0;
let runStatus = 'ready';
let score = 0;
let energy = 0;
let bestScore = readBestScore();
let targetX = 0;
let spawnTimer = 0.6;
let hudTimer = 0;
let pointerActive = false;
let soundEnabled = true;
let audioContext;
let adaptiveQualityChecked = false;
let performanceElapsed = 0;
let performanceFrames = 0;
let qualityCap = lowPowerDevice ? 1.15 : 1.5;

const keys = { left: false, right: false };
const trackMarkers = [];
const roadsidePosts = [];
const entities = [];
const pools = { hazard: [], energy: [] };

const shared = {};

function readBestScore() {
  try {
    return Number.parseInt(localStorage.getItem('driftline-best') || '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBestScore(value) {
  try {
    localStorage.setItem('driftline-best', String(value));
  } catch {
    // Private browsing can deny storage. The current session still works.
  }
}

function setStatus(nextStatus) {
  runStatus = nextStatus;
  ui.shell.dataset.status = nextStatus;
}

function setLiveStatus(message) {
  ui.liveStatus.textContent = message;
}

function formatScore(value) {
  return Math.floor(value).toString().padStart(4, '0');
}

function updateHud(force = false) {
  hudTimer = force ? 0 : hudTimer;
  ui.score.textContent = formatScore(score);
  ui.energy.textContent = String(energy);
}

function createRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas: ui.canvas,
    antialias: !lowPowerDevice,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, qualityCap));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
}

function createWorld() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(colours.sky);
  scene.fog = new THREE.Fog(colours.fog, 24, 92);

  camera = new THREE.PerspectiveCamera(58, 1, 0.1, 140);
  camera.position.set(0, 6.5, 11.5);
  camera.lookAt(0, 0.4, -13);

  scene.add(new THREE.HemisphereLight(colours.ink, colours.ground, 1.8));
  const sun = new THREE.DirectionalLight(colours.accent, 2.2);
  sun.position.set(-5, 9, 7);
  scene.add(sun);

  createTrack();
  createStars();
  createShip();
  createSharedEntityAssets();
}

function createTrack() {
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: colours.ground,
    roughness: 0.94,
    metalness: 0.05,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 180), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -70);
  scene.add(floor);

  const edgeGeometry = new THREE.BoxGeometry(0.12, 0.08, 180);
  const edgeMaterial = new THREE.MeshBasicMaterial({ color: colours.groundEdge });
  for (const x of [-4.42, 4.42]) {
    const edge = new THREE.Mesh(edgeGeometry, edgeMaterial);
    edge.position.set(x, 0.05, -70);
    scene.add(edge);
  }

  const markerGeometry = new THREE.BoxGeometry(0.1, 0.035, 3.2);
  const markerMaterial = new THREE.MeshBasicMaterial({ color: colours.marker });
  for (let row = 0; row < 2; row += 1) {
    const x = row === 0 ? -1.48 : 1.48;
    for (let index = 0; index < 14; index += 1) {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.set(x, 0.035, 8 - index * 8);
      trackMarkers.push(marker);
      scene.add(marker);
    }
  }

  const postGeometry = new THREE.BoxGeometry(0.22, 1.4, 0.22);
  const postMaterial = new THREE.MeshBasicMaterial({ color: colours.groundEdge });
  const capMaterial = new THREE.MeshBasicMaterial({ color: colours.energy });
  for (let index = 0; index < 18; index += 1) {
    for (const side of [-1, 1]) {
      const group = new THREE.Group();
      const post = new THREE.Mesh(postGeometry, postMaterial);
      post.position.y = 0.7;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.3), capMaterial);
      cap.position.y = 1.42;
      group.add(post, cap);
      group.position.set(side * (6.2 + (index % 3) * 0.55), 0, 4 - index * 7.3);
      roadsidePosts.push(group);
      scene.add(group);
    }
  }
}

function createStars() {
  const count = lowPowerDevice ? 48 : 90;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (Math.random() - 0.5) * 42;
    positions[index * 3 + 1] = 3 + Math.random() * 14;
    positions[index * 3 + 2] = 6 - Math.random() * 110;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  scene.add(new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: colours.ink, size: 0.065, sizeAttenuation: true }),
  ));
}

function createShip() {
  ship = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: colours.accent,
    roughness: 0.36,
    metalness: 0.5,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: colours.groundEdge,
    roughness: 0.25,
    metalness: 0.7,
  });
  const energyMaterial = new THREE.MeshBasicMaterial({ color: colours.energy });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.34, 1.75), bodyMaterial);
  body.position.y = 0.72;
  ship.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.58, 1.35, 4), bodyMaterial);
  nose.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
  nose.position.set(0, 0.72, -1.45);
  ship.add(nose);

  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.46, 12, 8), darkMaterial);
  cockpit.scale.set(0.8, 0.55, 1.25);
  cockpit.position.set(0, 1.02, -0.18);
  ship.add(cockpit);

  const wingGeometry = new THREE.BoxGeometry(1.08, 0.12, 0.72);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeometry, bodyMaterial);
    wing.position.set(side * 0.78, 0.62, 0.28);
    wing.rotation.y = side * 0.12;
    ship.add(wing);

    const thruster = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.45), energyMaterial);
    thruster.position.set(side * 0.5, 0.7, 1.02);
    ship.add(thruster);
  }

  ship.position.set(0, 0, 4);
  scene.add(ship);

  shipShadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.2, 20),
    new THREE.MeshBasicMaterial({ color: colours.shadow, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  shipShadow.rotation.x = -Math.PI / 2;
  shipShadow.scale.set(1, 1.55, 1);
  shipShadow.position.set(0, 0.03, 4.2);
  scene.add(shipShadow);
}

function createSharedEntityAssets() {
  shared.hazardGeometry = new THREE.BoxGeometry(1.55, 1.65, 1.15);
  shared.hazardMaterial = new THREE.MeshStandardMaterial({
    color: colours.hazard,
    emissive: colours.hazard,
    emissiveIntensity: 0.22,
    roughness: 0.45,
    metalness: 0.28,
  });
  shared.hazardBandGeometry = new THREE.BoxGeometry(1.61, 0.18, 1.2);
  shared.hazardBandMaterial = new THREE.MeshBasicMaterial({ color: colours.ink });
  shared.energyGeometry = new THREE.TorusGeometry(0.48, 0.14, 8, 18);
  shared.energyMaterial = new THREE.MeshBasicMaterial({ color: colours.energy });
}

function buildEntity(kind) {
  const group = new THREE.Group();
  if (kind === 'hazard') {
    const block = new THREE.Mesh(shared.hazardGeometry, shared.hazardMaterial);
    block.position.y = 0.83;
    const band = new THREE.Mesh(shared.hazardBandGeometry, shared.hazardBandMaterial);
    band.position.y = 0.9;
    group.add(block, band);
  } else {
    const ring = new THREE.Mesh(shared.energyGeometry, shared.energyMaterial);
    ring.position.y = 1.05;
    group.add(ring);
  }
  group.userData.kind = kind;
  return group;
}

function acquireEntity(kind) {
  const mesh = pools[kind].pop() || buildEntity(kind);
  mesh.visible = true;
  scene.add(mesh);
  return { kind, mesh };
}

function releaseEntity(entity) {
  scene.remove(entity.mesh);
  entity.mesh.visible = false;
  pools[entity.kind].push(entity.mesh);
}

function spawnEntity() {
  const kind = Math.random() < 0.29 ? 'energy' : 'hazard';
  const entity = acquireEntity(kind);
  entity.mesh.position.set((Math.random() * 2 - 1) * 2.05, 0, -74);
  entity.mesh.rotation.set(0, kind === 'hazard' ? (Math.random() - 0.5) * 0.18 : 0, 0);
  entities.push(entity);
}

function clearEntities() {
  while (entities.length) releaseEntity(entities.pop());
}

function moveWorld(speed, deltaSeconds) {
  const amount = speed * deltaSeconds;
  for (const marker of trackMarkers) {
    marker.position.z += amount;
    if (marker.position.z > 12) marker.position.z -= 112;
  }
  for (const post of roadsidePosts) {
    post.position.z += amount;
    if (post.position.z > 14) post.position.z -= 132;
  }
}

function updateEntities(speed, deltaSeconds) {
  for (let index = entities.length - 1; index >= 0; index -= 1) {
    const entity = entities[index];
    entity.mesh.position.z += speed * deltaSeconds;

    if (entity.kind === 'energy' && !reducedMotion) {
      entity.mesh.rotation.z += deltaSeconds * 2.6;
      entity.mesh.rotation.y += deltaSeconds * 1.3;
    }

    const hit = collisionHit(
      ship.position,
      entity.mesh.position,
      entity.kind === 'hazard' ? 1.0 : 0.82,
      entity.kind === 'hazard' ? 1.25 : 1.05,
    );

    if (hit && entity.kind === 'hazard') {
      endRun();
      return;
    }

    if (hit && entity.kind === 'energy') {
      score += 120;
      energy += 1;
      playTone(620, 0.09, 'sine');
      vibrate(14);
      releaseEntity(entity);
      entities.splice(index, 1);
      updateHud(true);
      continue;
    }

    if (entity.mesh.position.z > 13) {
      releaseEntity(entity);
      entities.splice(index, 1);
    }
  }
}

function updateSteering(deltaSeconds) {
  const direction = Number(keys.right) - Number(keys.left);
  if (direction) targetX = clamp(targetX + direction * deltaSeconds * 7.2, -TRACK_HALF_WIDTH, TRACK_HALF_WIDTH);

  const smoothing = 1 - Math.exp(-deltaSeconds * 11);
  const previousX = ship.position.x;
  ship.position.x = THREE.MathUtils.lerp(ship.position.x, targetX, smoothing);
  shipShadow.position.x = ship.position.x;

  if (!reducedMotion) {
    const lateralVelocity = (ship.position.x - previousX) / Math.max(deltaSeconds, 0.001);
    ship.rotation.z = THREE.MathUtils.lerp(ship.rotation.z, -lateralVelocity * 0.022, smoothing);
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, ship.position.x * 0.16, smoothing * 0.55);
    camera.lookAt(ship.position.x * 0.08, 0.4, -13);
  }
}

function updateRun(deltaSeconds) {
  const difficulty = difficultyForScore(score);
  score = scoreAfterStep(score, difficulty.speed, deltaSeconds);
  updateSteering(deltaSeconds);
  moveWorld(difficulty.speed, deltaSeconds);

  spawnTimer -= deltaSeconds;
  if (spawnTimer <= 0) {
    spawnEntity();
    spawnTimer = spawnDelayForScore(score);
  }

  updateEntities(difficulty.speed, deltaSeconds);

  hudTimer += deltaSeconds;
  if (hudTimer >= 0.08) {
    updateHud();
    hudTimer = 0;
  }
}

function resetRun() {
  clearEntities();
  score = 0;
  energy = 0;
  targetX = 0;
  spawnTimer = 0.62;
  hudTimer = 0;
  ship.position.x = 0;
  ship.rotation.z = 0;
  shipShadow.position.x = 0;
  camera.position.x = 0;
  ui.shell.classList.remove('has-steered');
  updateHud(true);
}

function startRun() {
  resetRun();
  setStatus('running');
  ui.startScreen.hidden = true;
  ui.endScreen.hidden = true;
  ui.pauseScreen.hidden = true;
  ui.canvas.focus({ preventScroll: true });
  ensureAudio();
  playTone(360, 0.07, 'triangle');
  setLiveStatus('Run started. Drag left and right to steer.');
}

function endRun() {
  if (runStatus !== 'running') return;
  setStatus('crashed');
  const finalValue = Math.floor(score);
  bestScore = Math.max(bestScore, finalValue);
  saveBestScore(bestScore);
  ui.finalScore.textContent = new Intl.NumberFormat('en-AU').format(finalValue);
  ui.bestScore.textContent = new Intl.NumberFormat('en-AU').format(bestScore);
  ui.endScreen.hidden = false;
  ui.restartButton.focus({ preventScroll: true });
  playTone(110, 0.22, 'sawtooth');
  vibrate([45, 35, 65]);
  setLiveStatus(`Run over. Score ${finalValue}. Best ${bestScore}.`);
}

function pauseRun() {
  if (runStatus !== 'running') return;
  setStatus('paused');
  ui.pauseScreen.hidden = false;
  setLiveStatus('Run paused.');
}

function resumeRun() {
  if (runStatus !== 'paused') return;
  setStatus('running');
  ui.pauseScreen.hidden = true;
  ui.canvas.focus({ preventScroll: true });
  setLiveStatus('Run resumed.');
}

function ensureAudio() {
  if (!soundEnabled) return;
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioContext = new AudioContextClass();
  }
  if (audioContext?.state === 'suspended') audioContext.resume();
}

function playTone(frequency, duration, type) {
  if (!soundEnabled) return;
  ensureAudio();
  if (!audioContext) return;

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.type = type;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

function vibrate(pattern) {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

function setSteeringFromPointer(event) {
  if (runStatus !== 'running' || event.target.closest('button')) return;
  event.preventDefault();
  targetX = steeringTargetFromClientX(event.clientX, ui.shell.clientWidth);
  pointerActive = true;
  ui.shell.classList.add('has-steered');
  try {
    ui.canvas.setPointerCapture?.(event.pointerId);
  } catch {
    // Synthetic pointer events may not have a browser-owned active pointer.
  }
}

function resize() {
  if (!renderer || !camera) return;
  const width = Math.max(1, ui.shell.clientWidth);
  const height = Math.max(1, ui.shell.clientHeight);
  const aspect = width / height;
  const isShortLandscape = aspect > 1.4;
  camera.aspect = aspect;
  camera.fov = aspect < 0.72 ? 62 : isShortLandscape ? 55 : 57;
  camera.position.y = isShortLandscape ? 6.9 : 6.5;
  camera.position.z = aspect < 0.72 ? 12.4 : isShortLandscape ? 14.3 : 11.5;
  camera.lookAt(ship?.position.x * 0.08 || 0, 0.4, -13);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function assessPerformance(deltaSeconds) {
  if (adaptiveQualityChecked || document.hidden) return;
  performanceElapsed += deltaSeconds;
  performanceFrames += 1;
  if (performanceElapsed < 4) return;

  adaptiveQualityChecked = true;
  const framesPerSecond = performanceFrames / performanceElapsed;
  if (framesPerSecond < 45 && renderer.getPixelRatio() > 1) {
    qualityCap = 1;
    renderer.setPixelRatio(1);
    resize();
  }
}

function animate() {
  const deltaSeconds = Math.min(clock.getDelta(), 0.05);
  worldClock += deltaSeconds;

  if (runStatus === 'running') {
    updateRun(deltaSeconds);
  } else if (runStatus === 'ready' && !reducedMotion) {
    moveWorld(2.4, deltaSeconds);
    ship.position.y = Math.sin(worldClock * 1.8) * 0.035;
  }

  assessPerformance(deltaSeconds);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function showWebGlError() {
  setStatus('error');
  ui.startButton.disabled = true;
  ui.startButton.dataset.state = 'error';
  ui.startButton.textContent = 'WebGL unavailable';
  ui.lede.textContent = 'This browser could not start 3D graphics. Update the browser or turn off battery-saving restrictions, then reload.';
  setLiveStatus('WebGL is unavailable. The game cannot start.');
}

ui.startButton.addEventListener('click', startRun);
ui.restartButton.addEventListener('click', startRun);
ui.resumeButton.addEventListener('click', resumeRun);
ui.soundButton.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  ui.soundButton.setAttribute('aria-pressed', String(soundEnabled));
  ui.soundButton.setAttribute('aria-label', soundEnabled ? 'Turn sound off' : 'Turn sound on');
  ui.soundState.textContent = soundEnabled ? 'ON' : 'OFF';
  if (soundEnabled) {
    ensureAudio();
    playTone(480, 0.06, 'sine');
  }
});

ui.shell.addEventListener('pointerdown', setSteeringFromPointer, { passive: false });
ui.shell.addEventListener('pointermove', (event) => {
  if (!pointerActive) return;
  setSteeringFromPointer(event);
}, { passive: false });
ui.shell.addEventListener('pointerup', () => { pointerActive = false; });
ui.shell.addEventListener('pointercancel', () => { pointerActive = false; });

window.addEventListener('keydown', (event) => {
  if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(event.code) && runStatus === 'running') {
    event.preventDefault();
    ui.shell.classList.add('has-steered');
  }
  if (event.code === 'ArrowLeft' || event.code === 'KeyA') keys.left = true;
  if (event.code === 'ArrowRight' || event.code === 'KeyD') keys.right = true;
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'ArrowLeft' || event.code === 'KeyA') keys.left = false;
  if (event.code === 'ArrowRight' || event.code === 'KeyD') keys.right = false;
});
window.addEventListener('resize', resize, { passive: true });
window.visualViewport?.addEventListener('resize', resize, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseRun();
});
ui.canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  pauseRun();
  setLiveStatus('3D graphics paused. Reload the page to continue.');
});

const clock = new THREE.Clock();

window.__DRIFTLINE__ = {
  version: '1.0.0',
  get state() {
    return {
      status: runStatus,
      score: Math.floor(score),
      energy,
      bestScore,
      playerX: Number(ship?.position.x.toFixed(3) || 0),
      targetX: Number(targetX.toFixed(3)),
      activeEntities: entities.length,
      pixelRatio: renderer?.getPixelRatio() || 0,
    };
  },
  start: startRun,
  crash: endRun,
  steerTo(clientX) {
    targetX = steeringTargetFromClientX(clientX, ui.shell.clientWidth);
  },
};

try {
  createRenderer();
  createWorld();
  resize();
  setStatus('ready');
  updateHud(true);
  animate();
} catch (error) {
  console.error('Driftline failed to initialise WebGL.', error);
  showWebGlError();
}
