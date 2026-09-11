/**
 * total.js — Modo TOTAL: sube tus propias imágenes (galería/archivos/
 * drag&drop), se procesan como Asset, aparecen flotando como tarjetas
 * 2.5D, y se agarran con pellizco (pulgar+índice), se mueven, se
 * sueltan.
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { Bus } from './core.js';

// ---------------- Asset processing ----------------
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
let counter = 0;
const assets = new Map();
const assetListeners = new Set();

function notifyAssets() { const list = listAssets(); assetListeners.forEach((cb) => cb(list)); }
export function onAssetsChange(cb) { assetListeners.add(cb); cb(listAssets()); return () => assetListeners.delete(cb); }
export function listAssets() { return Array.from(assets.values()).sort((a, b) => a.createdAt - b.createdAt); }
export function removeAsset(id) {
  const a = assets.get(id); if (!a) return;
  URL.revokeObjectURL(a.originalUrl);
  assets.delete(id);
  notifyAssets();
}

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
        const canvas = document.createElement('canvas');
        const w = Math.max(1, Math.min(width, 64)), h = Math.max(1, Math.min(height, 64));
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
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

export async function addFiles(fileList) {
  const files = Array.from(fileList).filter((f) => ACCEPTED_TYPES.includes(f.type));
  for (const file of files) {
    const originalUrl = URL.createObjectURL(file);
    const { width, height } = await readImageMeta(originalUrl);
    const hasAlpha = file.type !== 'image/jpeg' ? await detectAlpha(originalUrl, width, height) : false;
    const id = `asset_${Date.now()}_${counter++}`;
    assets.set(id, { id, name: file.name, originalUrl, width, height, hasAlpha, createdAt: Date.now() });
  }
  if (files.length) notifyAssets();
  return files.length;
}

// ---------------- Tarjeta 2.5D (ProcessedAsset3D) ----------------
const textureCache = new Map();
const loader = new THREE.TextureLoader();
function loadTexture(url) {
  let t = textureCache.get(url);
  if (!t) { t = loader.load(url); t.colorSpace = THREE.SRGBColorSpace; textureCache.set(url, t); }
  return t;
}

function makeCard(asset) {
  const aspect = asset.width && asset.height ? asset.width / asset.height : 1;
  const w = aspect >= 1 ? 1.6 : 1.6 * aspect;
  const h = aspect >= 1 ? 1.6 / aspect : 1.6;
  const group = new THREE.Group();

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(w * 0.5, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }));
  shadow.position.set(0, -h / 2 - 0.05, -0.05);
  group.add(shadow);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x05070c, transparent: true, opacity: 0.5, depthWrite: false }));
  back.position.z = -0.035; back.scale.set(0.97, 0.97, 1);
  group.add(back);

  const mat = new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.05, roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide });
  mat.map = loadTexture(asset.originalUrl);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 8, 8), mat);
  group.add(front);

  group.userData = { shadowMat: shadow.material, front, idleSeed: Math.random() * Math.PI * 2 };
  return group;
}

// ---------------- Capa de interacción (grab/move/release) ----------------
let scene, clock, unsubs = [];
const cards = new Map(); // assetId -> {group, restPos}
let grabbedId = null, grabbedBy = null;
const dragPos = new THREE.Vector3();

function anchorsRef() { return window.__hv_anchors || {}; }

function pinchPoint(hand) {
  const a = anchorsRef();
  const thumb = hand === 'Left' ? a.LEFT_THUMB : a.RIGHT_THUMB;
  const index = hand === 'Left' ? a.LEFT_INDEX : a.RIGHT_INDEX;
  if (thumb && index) return new THREE.Vector3((thumb.x + index.x) / 2, (thumb.y + index.y) / 2, (thumb.z + index.z) / 2);
  const palm = hand === 'Left' ? a.LEFT_PALM : a.RIGHT_PALM;
  return palm ? new THREE.Vector3(palm.x, palm.y, palm.z) : null;
}

function syncCards() {
  const list = listAssets();
  const seen = new Set();
  list.forEach((asset, i) => {
    seen.add(asset.id);
    if (!cards.has(asset.id)) {
      const group = makeCard(asset);
      const angle = (i / Math.max(1, list.length)) * Math.PI * 2;
      const restPos = new THREE.Vector3(Math.cos(angle) * 1.1, Math.sin(angle) * 0.4, 0);
      group.position.copy(restPos);
      scene.add(group);
      cards.set(asset.id, { group, restPos });
    }
  });
  for (const [id, c] of cards) {
    if (!seen.has(id)) {
      scene.remove(c.group);
      c.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });
      cards.delete(id);
      if (grabbedId === id) { grabbedId = null; grabbedBy = null; }
    }
  }
}

export function mount(threeScene) {
  scene = threeScene;
  clock = { t: 0 };
  syncCards();
  unsubs.push(onAssetsChange(syncCards));

  unsubs.push(Bus.on('gesture', ({ gesture }) => {
    gesture.hands.forEach((h) => {
      if (h.gesture === 'PINCH' && !grabbedId) {
        const p = pinchPoint(h.handedness);
        if (!p) return;
        let bestId = null, bestDist = 0.9;
        for (const [id, c] of cards) {
          const d = c.restPos.distanceTo(p);
          if (d < bestDist) { bestDist = d; bestId = id; }
        }
        if (bestId) { grabbedId = bestId; grabbedBy = h.handedness; }
      }
    });
  }));

  unsubs.push(Bus.on('gesture', ({ gesture }) => {
    const stillPinching = gesture.hands.some((h) => h.handedness === grabbedBy && h.gesture === 'PINCH');
    if (grabbedId && !stillPinching) {
      const c = cards.get(grabbedId);
      if (c) c.restPos.copy(dragPos);
      grabbedId = null; grabbedBy = null;
    }
  }));
}

export function unmount() {
  unsubs.forEach((u) => u()); unsubs = [];
  for (const [, c] of cards) {
    scene?.remove(c.group);
    c.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });
  }
  cards.clear();
  grabbedId = null; grabbedBy = null;
}

export function update(elapsed, dt) {
  if (grabbedId && grabbedBy) {
    const p = pinchPoint(grabbedBy);
    if (p) dragPos.copy(p);
  }
  for (const [id, c] of cards) {
    const isGrabbed = id === grabbedId;
    const target = isGrabbed ? dragPos : c.restPos;
    c.group.position.lerp(target, isGrabbed ? 0.6 : 0.15);
    if (!isGrabbed) c.group.rotation.y += dt * 0.35;
    const front = c.group.userData.front;
    const seed = c.group.userData.idleSeed;
    const tiltX = isGrabbed ? THREE.MathUtils.clamp(-target.y * 0.06, -0.3, 0.3) : Math.sin(elapsed * 0.8 + seed) * 0.05;
    front.rotation.x += (tiltX - front.rotation.x) * 0.12;
    const s = isGrabbed ? 1.08 : 1;
    c.group.scale.lerp(new THREE.Vector3(s, s, s), 0.2);
    c.group.userData.shadowMat.opacity = isGrabbed ? 0.28 : 0.18;
  }
}
