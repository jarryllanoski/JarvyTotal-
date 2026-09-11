/**
 * ui.js — orquesta todo: selección de modo, cámara, panel de
 * diagnóstico, overlay de landmarks, subida de assets, grabación,
 * y el bucle de render que alimenta a historia.js / total.js.
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { cameraManager, handTracker, Bus, computeAnchors, HAND_CONNECTIONS } from './core.js';
import * as Historia from './historia.js';
import * as Total from './total.js';

const $ = (sel) => document.querySelector(sel);
const state = {
  mode: 'menu', mirror: true, targetFps: 30, resKey: '1080p',
  panel: null, debugOverlay: true,
  hands: [], trackingFps: 0, cameraStatus: 'idle',
  diag: { w: 0, h: 0, fps: 0, label: '' },
  isRecording: false
};
const RES = { '1080p': [1920, 1080], '720p': [1280, 720] };

function aviso(txt, ms = 5000) {
  const el = $('#aviso');
  el.textContent = txt; el.hidden = false;
  clearTimeout(aviso._t);
  aviso._t = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------------- Cámara ----------------
async function refreshDevices() {
  const list = await cameraManager.listDevices();
  const sel = $('#devSelect');
  sel.innerHTML = '';
  list.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId; opt.textContent = d.label || `Cámara ${i + 1}`;
    sel.appendChild(opt);
  });
}
async function startCamera(deviceId) {
  state.cameraStatus = 'requesting';
  try {
    const [w, h] = RES[state.resKey];
    await cameraManager.start({ deviceId, width: w, height: h, fps: state.targetFps });
    state.cameraStatus = 'live';
    await refreshDevices();
    const s = cameraManager.settings();
    state.diag.w = s?.width || 0; state.diag.h = s?.height || 0; state.diag.label = cameraManager.label();
    $('#camStatus').textContent = 'live';
  } catch (err) {
    state.cameraStatus = 'error';
    $('#camStatus').textContent = 'error';
    aviso('No pude encender la cámara: ' + err.message);
  }
}
function applyMirror() { cameraManager.video.classList.toggle('mirrored', state.mirror); }

// ---------------- Three.js ----------------
let renderer, scene, camera;
function initThree() {
  const canvas = $('#three');
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 6);
  scene.add(new THREE.HemisphereLight(0xcbe8ff, 0x0a1018, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(3, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x5fbcff, 0.5); rim.position.set(-3, -1, 2); scene.add(rim);
  resizeThree();
  window.addEventListener('resize', resizeThree);
}
function resizeThree() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const debug = $('#debug'); debug.width = w; debug.height = h;
}

// ---------------- Modo ----------------
function enterMode(mode) {
  if (state.mode === mode) return;
  if (state.mode === 'historia') Historia.unmount();
  if (state.mode === 'total') Total.unmount();
  state.mode = mode;
  $('#modeSelect').hidden = mode !== 'menu';
  $('#hud').hidden = mode === 'menu';
  $('#toolbar').hidden = mode === 'menu';
  if (mode === 'historia') { Historia.mount(scene); $('#hudTitle').textContent = 'HISTORIA'; }
  if (mode === 'total') { Total.mount(scene); $('#hudTitle').textContent = 'TOTAL'; $('#hudSubtitle').textContent = 'Sube una imagen en ASSETS y pellizca para agarrarla'; }
  ensureTracking();
}

let trackingStarted = false;
async function ensureTracking() {
  if (state.mode === 'menu' || trackingStarted) return;
  trackingStarted = true;
  try {
    await handTracker.init();
    handTracker.start(cameraManager.video);
  } catch (err) {
    aviso('No cargó el modelo de manos: ' + err.message);
  }
}

// ---------------- Overlay de debug + diagnóstico ----------------
function drawDebug() {
  const canvas = $('#debug');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.debugOverlay) return;
  const toPx = (nx, ny) => [state.mirror ? (1 - nx) * canvas.width : nx * canvas.width, ny * canvas.height];
  for (const h of state.hands) {
    ctx.strokeStyle = h.handedness === 'Left' ? '#38bdf8' : '#a78bfa';
    ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      const [ax, ay] = toPx(h.landmarks[a].x, h.landmarks[a].y);
      const [bx, by] = toPx(h.landmarks[b].x, h.landmarks[b].y);
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    }
    ctx.stroke();
    h.landmarks.forEach((p) => { const [x, y] = toPx(p.x, p.y); ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); });
    const [lx, ly] = toPx(h.landmarks[0].x, h.landmarks[0].y);
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText(h.handedness, lx + 10, ly - 10);
  }
  ctx.fillStyle = '#e8eefc'; ctx.font = '12px ui-monospace, monospace';
  ctx.fillText(`tracking: ${state.trackingFps} fps`, 12, canvas.height - 12);
}
function updateDiagnostics() {
  $('#diagRes').textContent = `${state.diag.w}×${state.diag.h}`;
  $('#diagFpsTrack').textContent = state.trackingFps;
  $('#diagLabel').textContent = state.diag.label || '—';
  const left = state.hands.find((h) => h.handedness === 'Left');
  const right = state.hands.find((h) => h.handedness === 'Right');
  const handTxt = (h) => h ? `${h.landmarks.length}/21 pts · pos ${h.worldPosition.x.toFixed(2)}, ${h.worldPosition.y.toFixed(2)}` : 'no detectada';
  $('#diagLeft').textContent = handTxt(left);
  $('#diagRight').textContent = handTxt(right);
}

// ---------------- Assets panel ----------------
function renderAssetGrid(list) {
  const grid = $('#assetGrid');
  grid.innerHTML = '';
  list.forEach((a) => {
    const div = document.createElement('div');
    div.className = 'hv-asset-thumb';
    div.innerHTML = `<img src="${a.originalUrl}" alt="${a.name}"><button title="Quitar">×</button>`;
    div.querySelector('button').onclick = () => Total.removeAsset(a.id);
    grid.appendChild(div);
  });
}
Total.onAssetsChange(renderAssetGrid);

async function handleFiles(files) {
  if (!files || !files.length) return;
  $('#dropzoneLabel').textContent = 'Procesando…';
  await Total.addFiles(files);
  $('#dropzoneLabel').textContent = '+ Añadir imagen';
}

// ---------------- Grabación ----------------
let recCanvas, recCtx, recRaf, mediaRecorder, chunks = [];
function pickMime() {
  const c = ['video/mp4;codecs=h264', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return c.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
}
function startRecording() {
  recCanvas = document.createElement('canvas'); recCanvas.width = 1080; recCanvas.height = 1920;
  recCtx = recCanvas.getContext('2d');
  const drawLoop = () => {
    recRaf = requestAnimationFrame(drawLoop);
    const w = 1080, h = 1920;
    recCtx.fillStyle = '#000'; recCtx.fillRect(0, 0, w, h);
    const video = cameraManager.video;
    if (video.videoWidth) {
      const va = video.videoWidth / video.videoHeight, ca = w / h;
      let dw = w, dh = h;
      if (va > ca) dw = h * va; else dh = w / va;
      recCtx.save();
      if (state.mirror) { recCtx.translate(w, 0); recCtx.scale(-1, 1); }
      recCtx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
      recCtx.restore();
    }
    recCtx.drawImage(renderer.domElement, 0, 0, w, h);
  };
  drawLoop();
  const stream = recCanvas.captureStream(30);
  const mimeType = pickMime();
  chunks = [];
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 10_000_000 } : undefined);
  mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  mediaRecorder.start();
  state.isRecording = true;
  $('#btnRecord').textContent = '■ Detener';
  recTimerStart = performance.now();
  recTimerId = setInterval(() => { $('#recTimer').textContent = ((performance.now() - recTimerStart) / 1000).toFixed(1) + 's'; }, 200);
}
let recTimerStart = 0, recTimerId = null;
function stopRecording() {
  if (!mediaRecorder) return;
  mediaRecorder.onstop = () => {
    cancelAnimationFrame(recRaf);
    clearInterval(recTimerId);
    const mimeType = mediaRecorder.mimeType || 'video/webm';
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    $('#recPreview').src = url; $('#recPreview').hidden = false;
    $('#btnDownload').hidden = false;
    $('#btnDownload').onclick = () => {
      const a = document.createElement('a');
      a.href = url; a.download = `handverse-${Date.now()}.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
    };
    state.isRecording = false;
    $('#btnRecord').textContent = '● Grabar';
  };
  mediaRecorder.stop();
}

// ---------------- Wiring de UI ----------------
function wire() {
  $('#btnHistoria').onclick = () => enterMode('historia');
  $('#btnTotal').onclick = () => enterMode('total');

  document.querySelectorAll('#toolbar [data-panel]').forEach((btn) => {
    btn.onclick = () => {
      const name = btn.dataset.panel;
      state.panel = state.panel === name ? null : name;
      document.querySelectorAll('#toolbar [data-panel]').forEach((b) => b.classList.toggle('active', b.dataset.panel === state.panel));
      ['camera', 'assets', 'record', 'settings'].forEach((p) => { $('#panel' + p[0].toUpperCase() + p.slice(1)).hidden = state.panel !== p; });
    };
  });

  $('#devSelect').onchange = (e) => startCamera(e.target.value);
  $('#resSelect').onchange = (e) => { state.resKey = e.target.value; startCamera($('#devSelect').value); };
  $('#fpsSelect').onchange = (e) => { state.targetFps = Number(e.target.value); startCamera($('#devSelect').value); };
  $('#mirrorCheck').onchange = (e) => { state.mirror = e.target.checked; applyMirror(); };
  $('#btnFullscreen').onclick = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {}); else document.exitFullscreen().catch(() => {}); };
  $('#btnCamToggle').onclick = () => { if (state.cameraStatus === 'live') { cameraManager.stop(); state.cameraStatus = 'idle'; $('#camStatus').textContent = 'idle'; } else startCamera($('#devSelect').value); };

  const dropzone = $('#dropzone');
  dropzone.onclick = () => $('#fileInput').click();
  dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('over'); };
  dropzone.ondragleave = () => dropzone.classList.remove('over');
  dropzone.ondrop = (e) => { e.preventDefault(); dropzone.classList.remove('over'); handleFiles(e.dataTransfer.files); };
  $('#fileInput').onchange = (e) => { handleFiles(e.target.files); e.target.value = ''; };

  $('#btnRecord').onclick = () => { if (state.isRecording) stopRecording(); else startRecording(); };
  $('#debugCheck').onchange = (e) => { state.debugOverlay = e.target.checked; };
  $('#btnMenu').onclick = () => enterMode('menu');
}

// ---------------- Bus: manos -> estado, anclas globales para total.js ----------------
Bus.on('gesture', ({ hands, fps, gesture }) => {
  state.hands = hands; state.trackingFps = fps;
  window.__hv_anchors = computeAnchors(hands, state.mirror);
  drawDebug();
  updateDiagnostics();
});

// ---------------- Bucle principal ----------------
let clockStart = null;
function loop(now) {
  requestAnimationFrame(loop);
  if (clockStart === null) clockStart = now;
  const elapsed = (now - clockStart) / 1000;
  if (state.mode === 'historia') Historia.update(elapsed);
  if (state.mode === 'total') Total.update(elapsed, 1 / 60);
  renderer.render(scene, camera);
}

// ---------------- Arranque ----------------
async function boot() {
  const wrap = $('#videoWrap');
  cameraManager.video.className = 'camera-video';
  wrap.appendChild(cameraManager.video);
  applyMirror();
  initThree();
  wire();
  await refreshDevices();
  await startCamera();
  requestAnimationFrame(loop);
}
boot();
