/**
 * total.js — Modo TOTAL, todo con gestos:
 *
 *  - Un "estante" de imágenes (componentes) flota abajo de la pantalla.
 *  - Subes la mano desde el estante (swipe de abajo hacia arriba) y la
 *    imagen más cercana a tu mano vuela al cuadro de combinación.
 *  - Repites con la segunda imagen.
 *  - Con el cuadro lleno: cierras las dos manos en puño cerca del
 *    cuadro (se carga), y al abrir ambas manos se combina — aparece
 *    la imagen de "resultado final" que subiste.
 *  - El resultado se agarra con pellizco para moverlo/posarlo.
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ---------------- Asset processing (componentes + resultado) ----------------
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
let counter = 0;
let components = [];   // hasta N imágenes a combinar
let resultAsset = null; // 1 imagen: el resultado final real, no generado

const listeners = new Set();
function notify() { listeners.forEach((cb) => cb({ components, resultAsset })); }
export function onAssetsChange(cb) { listeners.add(cb); cb({ components, resultAsset }); return () => listeners.delete(cb); }

function readImageMeta(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });
}
function detectAlpha(url, width, height) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        const w = Math.max(1, Math.min(width, 64)), h = Math.max(1, Math.min(height, 64));
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(false);
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return resolve(true);
        resolve(false);
      } catch { resolve(false); }
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}
async function toAsset(file) {
  const originalUrl = URL.createObjectURL(file);
  const { width, height } = await readImageMeta(originalUrl);
  const hasAlpha = file.type !== 'image/jpeg' ? await detectAlpha(originalUrl, width, height) : false;
  return { id: `asset_${Date.now()}_${counter++}`, name: file.name, originalUrl, width, height, hasAlpha };
}

export async function addComponentFiles(fileList) {
  const files = Array.from(fileList).filter((f) => ACCEPTED_TYPES.includes(f.type));
  for (const file of files) components.push(await toAsset(file));
  if (files.length) { rebuildShelf(); notify(); }
  return files.length;
}
export async function setResultFile(fileList) {
  const file = Array.from(fileList).find((f) => ACCEPTED_TYPES.includes(f.type));
  if (!file) return false;
  if (resultAsset) URL.revokeObjectURL(resultAsset.originalUrl);
  resultAsset = await toAsset(file);
  notify();
  return true;
}
export function removeComponent(id) {
  const a = components.find((c) => c.id === id);
  if (!a) return;
  URL.revokeObjectURL(a.originalUrl);
  components = components.filter((c) => c.id !== id);
  rebuildShelf(); notify();
}
export function clearResult() {
  if (resultAsset) URL.revokeObjectURL(resultAsset.originalUrl);
  resultAsset = null; notify();
}

// ---------------- Tarjeta 2.5D ----------------
const textureCache = new Map();
const loader = new THREE.TextureLoader();
function loadTexture(url) {
  let t = textureCache.get(url);
  if (!t) { t = loader.load(url); t.colorSpace = THREE.SRGBColorSpace; textureCache.set(url, t); }
  return t;
}
function makeCard(asset, sizeMul = 1) {
  const aspect = asset.width && asset.height ? asset.width / asset.height : 1;
  const base = 1.4 * sizeMul;
  const w = aspect >= 1 ? base : base * aspect;
  const h = aspect >= 1 ? base / aspect : base;
  const group = new THREE.Group();

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(w * 0.5, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false }));
  shadow.position.set(0, -h / 2 - 0.04, -0.05);
  group.add(shadow);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x05070c, transparent: true, opacity: 0.5, depthWrite: false }));
  back.position.z = -0.03; back.scale.set(0.97, 0.97, 1);
  group.add(back);

  const mat = new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.05, roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide });
  mat.map = loadTexture(asset.originalUrl);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 6, 6), mat);
  group.add(front);

  const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(w, h) * 0.62, Math.max(w, h) * 0.66, 32), new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0, side: THREE.DoubleSide }));
  group.add(ring);

  group.userData = { shadowMat: shadow.material, front, ring, idleSeed: Math.random() * Math.PI * 2, w, h };
  return group;
}

// ---------------- Cuadro de combinación + estante ----------------
let scene, unsubs = [];
const SLOT_X = [-0.55, 0.55];
const SLOT_Y = -0.1;
const shelfCards = new Map();   // assetId -> {group, homeX}
let slots = [null, null];       // assetId ocupando cada slot
let frameGroup = null;
let resultGroup = null;
let phase = 'idle';             // idle | ready | charging | revealing | done
let chargeStart = null;
let bothFistSince = null;

const dragTargets = new Map(); // group -> THREE.Vector3 (posición objetivo actual)

function anchorsRef() { return window.__hv_anchors || {}; }
function palmPoint(hand) {
  const a = anchorsRef();
  const p = hand === 'Left' ? a.LEFT_PALM : a.RIGHT_PALM;
  return p ? new THREE.Vector3(p.x, p.y, p.z) : null;
}

function buildFrame() {
  const g = new THREE.Group();
  const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(2.6, 1.7, 0.4));
  const mat = new THREE.LineBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.55 });
  g.add(new THREE.LineSegments(geo, mat));
  for (const sx of SLOT_X) {
    const slotMat = new THREE.LineBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.3 });
    const slotGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.1, 1.1, 0.05));
    const slotMesh = new THREE.LineSegments(slotGeo, slotMat);
    slotMesh.position.set(sx, SLOT_Y, 0.05);
    g.add(slotMesh);
  }
  g.position.set(0, 0.15, 0);
  g.userData.frameMat = mat;
  return g;
}

function rebuildShelf() {
  if (!scene) return;
  for (const [, c] of shelfCards) { scene.remove(c.group); disposeGroup(c.group); }
  shelfCards.clear();
  const n = components.length;
  components.forEach((a, i) => {
    const group = makeCard(a, 0.6);
    const homeX = (i - (n - 1) / 2) * 0.85;
    group.position.set(homeX, -1.7, 0);
    scene.add(group);
    shelfCards.set(a.id, { group, homeX });
    dragTargets.set(group, group.position.clone());
  });
}

function disposeGroup(g) {
  g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });
}

function nearestShelfAsset(worldPos) {
  let best = null, bestD = 1.4;
  for (const [id, c] of shelfCards) {
    if (slots.includes(id)) continue;
    const d = c.group.position.distanceTo(worldPos);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

function placeInSlot(assetId) {
  const emptyIndex = slots.findIndex((s) => s === null);
  if (emptyIndex === -1) return;
  const c = shelfCards.get(assetId);
  if (!c) return;
  slots[emptyIndex] = assetId;
  const target = new THREE.Vector3(SLOT_X[emptyIndex], SLOT_Y, 0.15);
  dragTargets.set(c.group, target);
  flashRing(c.group);
  if (slots.every((s) => s !== null)) { phase = 'ready'; }
}

function flashRing(group) {
  const ring = group.userData.ring;
  if (!ring) return;
  let t = 0;
  const step = () => {
    t += 1 / 30;
    ring.material.opacity = Math.max(0, 0.8 - t);
    ring.scale.setScalar(1 + t * 0.6);
    if (t < 0.8) requestAnimationFrame(step);
  };
  step();
}

function resetCraft() {
  for (const id of slots) {
    if (!id) continue;
    const c = shelfCards.get(id);
    if (c) dragTargets.set(c.group, new THREE.Vector3(c.homeX, -1.7, 0));
  }
  slots = [null, null];
  phase = 'idle';
  chargeStart = null; bothFistSince = null;
  if (frameGroup) frameGroup.userData.frameMat.color.setHex(0x8fb4ff);
}

function playCombine() {
  phase = 'revealing';
  const usedIds = slots.slice();
  usedIds.forEach((id) => {
    const c = shelfCards.get(id);
    if (!c) return;
    dragTargets.set(c.group, new THREE.Vector3(0, 0.15, 0));
    let t = 0;
    const shrink = () => {
      t += 1 / 45;
      c.group.scale.setScalar(Math.max(0.001, 1 - t));
      c.group.rotation.y += 0.3;
      if (t < 1) requestAnimationFrame(shrink);
      else { scene.remove(c.group); disposeGroup(c.group); shelfCards.delete(usedIds.find((x) => x === id)); }
    };
    requestAnimationFrame(shrink);
  });
  components = components.filter((a) => !usedIds.includes(a.id));

  setTimeout(() => {
    if (resultAsset) {
      resultGroup = makeCard(resultAsset, 1.3);
      resultGroup.position.set(0, 0.15, 0);
      resultGroup.scale.setScalar(0.001);
      scene.add(resultGroup);
      dragTargets.set(resultGroup, new THREE.Vector3(0, 0.15, 0));
      let t = 0;
      const grow = () => {
        t += 1 / 30;
        const s = Math.min(1, t);
        resultGroup.scale.setScalar(s * s * (3 - 2 * s));
        if (t < 1) requestAnimationFrame(grow); else { phase = 'done'; }
      };
      grow();
    } else {
      phase = 'idle';
    }
    slots = [null, null];
  }, 500);
}

// ---------------- Montaje ----------------
export function mount(threeScene) {
  scene = threeScene;
  phase = 'idle'; slots = [null, null]; resultGroup = null;
  frameGroup = buildFrame();
  scene.add(frameGroup);
  rebuildShelf();
  notify();

  unsubs.push(subscribeSwipeUp());
  unsubs.push(subscribeCombine());
  unsubs.push(subscribePinchResult());
}

function subscribeSwipeUp() {
  // GestureDetector emite 'swipeUp' a través del mismo detector que alimenta Bus('gesture');
  // lo escuchamos indirectamente re-emitiendo desde el detector global vía Bus custom event.
  const handler = (e) => {
    const { handedness } = e.detail || {};
    if (!handedness || phase === 'revealing') return;
    const p = palmPoint(handedness);
    if (!p) return;
    const id = nearestShelfAsset(p);
    if (id) placeInSlot(id);
  };
  window.addEventListener('hv:swipeUp', handler);
  return () => window.removeEventListener('hv:swipeUp', handler);
}

function subscribeCombine() {
  const fistState = { Left: false, Right: false };
  const onGrab = (e) => {
    const h = e.detail.handedness; fistState[h] = true;
    if (phase === 'ready' && fistState.Left && fistState.Right) chargeStart = performance.now();
  };
  const onRelease = (e) => {
    const h = e.detail.handedness; fistState[h] = false;
    if (phase === 'ready' && chargeStart && performance.now() - chargeStart > 550 && !fistState.Left && !fistState.Right) {
      chargeStart = null;
      playCombine();
    } else if (!fistState.Left && !fistState.Right) {
      chargeStart = null;
    }
  };
  window.addEventListener('hv:grab', onGrab);
  window.addEventListener('hv:release', onRelease);
  return () => { window.removeEventListener('hv:grab', onGrab); window.removeEventListener('hv:release', onRelease); };
}

let grabbedResult = false, resultDragPos = new THREE.Vector3();
function subscribePinchResult() {
  const onPinchStart = (e) => {
    if (phase !== 'done' || !resultGroup || grabbedResult) return;
    const { handedness } = e.detail;
    const a = anchorsRef();
    const thumb = handedness === 'Left' ? a.LEFT_THUMB : a.RIGHT_THUMB;
    const index = handedness === 'Left' ? a.LEFT_INDEX : a.RIGHT_INDEX;
    if (!thumb || !index) return;
    const p = new THREE.Vector3((thumb.x + index.x) / 2, (thumb.y + index.y) / 2, 0);
    if (resultGroup.position.distanceTo(p) < 1.0) { grabbedResult = true; window.__hv_resultHand = handedness; }
  };
  const onPinchEnd = (e) => {
    if (e.detail.handedness === window.__hv_resultHand) grabbedResult = false;
  };
  window.addEventListener('hv:pinchStart', onPinchStart);
  window.addEventListener('hv:pinchEnd', onPinchEnd);
  return () => { window.removeEventListener('hv:pinchStart', onPinchStart); window.removeEventListener('hv:pinchEnd', onPinchEnd); };
}

export function unmount() {
  unsubs.forEach((u) => u()); unsubs = [];
  for (const [, c] of shelfCards) { scene?.remove(c.group); disposeGroup(c.group); }
  shelfCards.clear();
  if (frameGroup) { scene?.remove(frameGroup); disposeGroup(frameGroup); frameGroup = null; }
  if (resultGroup) { scene?.remove(resultGroup); disposeGroup(resultGroup); resultGroup = null; }
  slots = [null, null]; phase = 'idle';
}

export function update(elapsed, dt) {
  // animar cada tarjeta del estante/slots hacia su objetivo
  for (const [group, target] of dragTargets) {
    group.position.lerp(target, 0.18);
    if (group.userData?.front) {
      const seed = group.userData.idleSeed;
      group.rotation.y += dt * 0.15;
      group.userData.front.rotation.x += (Math.sin(elapsed * 0.8 + seed) * 0.04 - group.userData.front.rotation.x) * 0.1;
    }
  }
  if (frameGroup) {
    const color = phase === 'ready' ? 0x38bdf8 : phase === 'revealing' ? 0xa371f7 : 0x8fb4ff;
    frameGroup.userData.frameMat.color.setHex(color);
    frameGroup.userData.frameMat.opacity = 0.4 + 0.2 * Math.sin(elapsed * (phase === 'ready' ? 3 : 1));
  }
  if (grabbedResult && resultGroup) {
    const a = anchorsRef();
    const h = window.__hv_resultHand;
    const thumb = h === 'Left' ? a.LEFT_THUMB : a.RIGHT_THUMB;
    const index = h === 'Left' ? a.LEFT_INDEX : a.RIGHT_INDEX;
    if (thumb && index) {
      resultDragPos.set((thumb.x + index.x) / 2, (thumb.y + index.y) / 2, (thumb.z + index.z) / 2);
      resultGroup.position.lerp(resultDragPos, 0.6);
    }
  } else if (resultGroup && phase === 'done') {
    resultGroup.rotation.y += dt * 0.3;
  }
}

export function currentPhase() { return phase; }
export function slotsState() { return slots.slice(); }
