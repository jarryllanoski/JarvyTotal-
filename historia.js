/**
 * historia.js — Modo HISTORIA: El Caballo de Troya, 4 beats,
 * geometría 100% procedural en Three.js. Puño cierra desarma la
 * escena, abrir la mano arma la siguiente.
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { Bus, tween, easeOutCubic, easeOutBack } from './core.js';

const MAT = {
  madera: () => new THREE.MeshStandardMaterial({ color: '#8b5a2b', roughness: 0.75 }),
  maderaC: () => new THREE.MeshStandardMaterial({ color: '#a9743c', roughness: 0.75 }),
  maderaO: () => new THREE.MeshStandardMaterial({ color: '#5d3a19', roughness: 0.75 }),
  piedra: () => new THREE.MeshStandardMaterial({ color: '#a89a80', roughness: 0.95 }),
  piedraOsc: () => new THREE.MeshStandardMaterial({ color: '#6f6553', roughness: 0.95 }),
  arena: () => new THREE.MeshStandardMaterial({ color: '#c7b48c', roughness: 1 }),
  bronce: () => new THREE.MeshStandardMaterial({ color: '#c99a3e', metalness: 0.6, roughness: 0.35 }),
  tela: () => new THREE.MeshStandardMaterial({ color: '#b8332a', roughness: 0.9 }),
  piel: () => new THREE.MeshStandardMaterial({ color: '#cf9c72', roughness: 0.8 }),
  noche: () => new THREE.MeshStandardMaterial({ color: '#1c2331' }),
  nocheOsc: () => new THREE.MeshStandardMaterial({ color: '#121722' }),
  fuego: () => new THREE.MeshBasicMaterial({ color: '#ff6a12' }),
  fuego2: () => new THREE.MeshBasicMaterial({ color: '#ffc63a' }),
  luna: () => new THREE.MeshBasicMaterial({ color: '#bcd0ff' })
};

function box(g, w, h, d, mat, p, r) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(...p); if (r) m.rotation.set(...r);
  g.add(m); return m;
}
function cyl(g, rt, rb, h, mat, p, r, seg) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 14), mat);
  m.position.set(...p); if (r) m.rotation.set(...r);
  g.add(m); return m;
}
function cone(g, r, h, mat, p, rt) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 10), mat);
  m.position.set(...p); if (rt) m.rotation.set(...rt);
  g.add(m); return m;
}
function sphere(g, r, mat, p) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
  m.position.set(...p); g.add(m); return m;
}

function buildHorse(dark) {
  const g = new THREE.Group();
  const M1 = dark ? MAT.noche() : MAT.madera();
  const M2 = dark ? MAT.noche() : MAT.maderaC();
  const M3 = dark ? MAT.nocheOsc() : MAT.maderaO();
  for (let i = 0; i < 5; i++) box(g, 1.9, 0.2, 0.95, i % 2 ? M1 : M2, [0, 1.05 + i * 0.21, 0]);
  box(g, 0.28, 0.95, 0.86, M3, [0.92, 1.45, 0]);
  box(g, 0.28, 0.95, 0.86, M3, [-0.92, 1.45, 0]);
  box(g, 0.46, 0.95, 0.5, M1, [0.88, 2.2, 0], [0, 0, -0.34]);
  box(g, 0.72, 0.38, 0.42, M2, [1.3, 2.66, 0], [0, 0, -0.14]);
  box(g, 0.3, 0.26, 0.32, M3, [1.63, 2.55, 0]);
  cone(g, 0.08, 0.24, M1, [1.14, 2.92, 0.14]);
  cone(g, 0.08, 0.24, M1, [1.14, 2.92, -0.14]);
  for (let i = 0; i < 5; i++) box(g, 0.1, 0.28, 0.12, M3, [1.02 - i * 0.14, 2.52 + i * 0.05, 0], [0, 0, -0.34]);
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) box(g, 0.22, 1.05, 0.22, M1, [sx * 0.68, 0.52, sz * 0.3]);
  cyl(g, 0.16, 0.16, 0.62, M3, [-1.12, 1.6, 0], [0, 0, 0.52], 8);
  box(g, 2.7, 0.18, 1.45, M3, [0, -0.08, 0]);
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) cyl(g, 0.3, 0.3, 0.16, M2, [sx * 0.95, -0.28, sz * 0.58], [0, 0, Math.PI / 2], 14);
  return g;
}
function buildWall(broken) {
  const g = new THREE.Group();
  const pi = broken ? MAT.piedraOsc() : MAT.piedra(), po = MAT.piedraOsc();
  for (const sx of [-1, 1]) {
    const sub = new THREE.Group(); sub.rotation.z = broken ? sx * 0.12 : 0;
    box(sub, 0.95, 3.0, 1.0, pi, [sx * 1.75, 1.4, 0]);
    for (const k of [-1, 0, 1]) box(sub, 0.24, 0.34, 1.0, po, [sx * 1.75 + k * 0.32, 3.0, 0]);
    g.add(sub);
  }
  if (!broken) { box(g, 2.7, 0.55, 0.9, pi, [0, 2.75, 0]); box(g, 2.6, 0.24, 0.95, po, [0, 3.12, 0]); }
  box(g, 1.8, 2.2, 0.9, pi, [3.2, 1.0, 0]);
  box(g, 1.8, 2.2, 0.9, pi, [-3.2, 1.0, 0]);
  return g;
}
function buildWarrior(dark, scale = 1) {
  const g = new THREE.Group();
  const piel = dark ? MAT.nocheOsc() : MAT.piel(), tela = dark ? MAT.noche() : MAT.tela();
  box(g, 0.26, 0.44, 0.22, tela, [0, 0.52, 0]);
  sphere(g, 0.13, piel, [0, 0.86, 0]);
  cyl(g, 0.15, 0.17, 0.15, MAT.bronce(), [0, 0.95, 0], null, 10);
  box(g, 0.09, 0.46, 0.1, piel, [-0.07, 0.14, 0.04]);
  box(g, 0.09, 0.46, 0.1, piel, [0.07, 0.14, -0.04]);
  cyl(g, 0.03, 0.03, 0.85, MAT.maderaO(), [0.22, 0.62, 0], [0, 0, 0.22], 8);
  g.scale.setScalar(scale);
  return g;
}
function buildFlame(scale) {
  const g = new THREE.Group();
  cone(g, 0.3, 0.95, MAT.fuego(), [0, 0, 0]);
  cone(g, 0.17, 0.6, MAT.fuego2(), [0, -0.03, 0]);
  g.scale.setScalar(scale);
  g.userData.seed = Math.random() * 10;
  return g;
}
function buildSmoke() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), new THREE.MeshStandardMaterial({ color: '#2b3036', transparent: true, opacity: 0.3 }));
  m.userData.seed = Math.random();
  return m;
}
function buildEmber() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), new THREE.MeshBasicMaterial({ color: '#ff9a3a', transparent: true, opacity: 1 }));
  m.userData.seed = Math.random();
  return m;
}

const BEATS = [
  { name: 'El caballo aparece', build: (g) => {
      box(g, 9, 0.16, 5, MAT.arena(), [0, -0.7, -0.4], [-Math.PI / 2, 0, 0]);
      const horse = buildHorse(false); g.add(horse);
      g.userData.horse = horse;
    }, tick: (g, t) => { if (g.userData.horse) g.userData.horse.position.y = Math.sin(t * 1.1) * 0.05; }
  },
  { name: 'Lo meten a Troya', build: (g) => {
      box(g, 9, 0.16, 5, MAT.arena(), [0, -0.7, -0.4], [-Math.PI / 2, 0, 0]);
      g.add(buildWall(false));
      const rig = new THREE.Group();
      rig.add(buildHorse(false));
      const w1 = buildWarrior(false, 0.9); w1.position.set(3.15, -0.62, 0.35); rig.add(w1);
      const w2 = buildWarrior(false, 0.9); w2.position.set(3.5, -0.62, -0.35); rig.add(w2);
      const w3 = buildWarrior(false, 0.9); w3.position.set(4.05, -0.62, 0.1); rig.add(w3);
      g.add(rig); g.userData.rig = rig; g.userData.t0 = null;
    }, tick: (g, t) => {
      const rig = g.userData.rig; if (!rig) return;
      if (g.userData.t0 === null) g.userData.t0 = t;
      const lt = t - g.userData.t0;
      const p = Math.min(1, Math.max(0, (lt - 0.6) / 6));
      const s = p * p * (3 - 2 * p);
      rig.position.x = -2.3 + s * 2.3;
      rig.position.z = 1.5 - s * 2.4;
    }
  },
  { name: 'Salen los guerreros', build: (g) => {
      const groundMat = new THREE.MeshStandardMaterial({ color: '#12161d' });
      box(g, 9, 0.16, 5, groundMat, [0, -0.7, -0.4], [-Math.PI / 2, 0, 0]);
      g.add(buildWall(false));
      g.add(buildHorse(true));
      const hatch = box(g, 0.85, 0.12, 0.8, MAT.maderaO(), [-0.1, 0.82, 0.52], [0.9, 0, 0]);
      cyl(g, 0.028, 0.028, 1.5, MAT.maderaC(), [-0.1, 0.2, 0.3], null, 6);
      sphere(g, 0.28, MAT.luna(), [-2.7, 3.1, -2.2]);
      const warriors = [];
      for (let i = 0; i < 4; i++) {
        const w = buildWarrior(true, 0.8);
        w.position.set(-0.1, 0.35, 0.3);
        w.visible = false;
        g.add(w); warriors.push(w);
      }
      g.userData = { hatch, warriors, t0: null };
    }, tick: (g, t) => {
      const { hatch, warriors, t0 } = g.userData;
      if (g.userData.t0 === null) g.userData.t0 = t;
      const lt = t - g.userData.t0;
      if (hatch) hatch.rotation.x = 0.9 + Math.sin(lt * 1.6) * 0.06;
      warriors.forEach((w, i) => {
        const t0i = 0.6 + i * 1.15;
        const baja = Math.min(1, Math.max(0, (lt - t0i) / 1.15));
        const anda = Math.min(1, Math.max(0, (lt - t0i - 1.15) / 2.2));
        w.visible = baja > 0;
        w.position.set(-1.6 * anda - i * 0.4 * anda, 0.35 - baja * 1.3, 0.3 + anda * (0.5 + i * 0.22));
        w.rotation.y = anda * 0.6;
      });
    }
  },
  { name: 'Troya arde', build: (g) => {
      const groundMat = new THREE.MeshStandardMaterial({ color: '#2e2a28' });
      box(g, 9, 0.16, 5, groundMat, [0, -0.7, -0.2], [-Math.PI / 2, 0, 0]);
      g.add(buildWall(true));
      g.add(buildHorse(true));
      box(g, 0.9, 0.7, 0.8, MAT.piedraOsc(), [-1.1, -0.25, 0.3], [0, 0.4, 0.22]);
      box(g, 0.7, 0.5, 0.6, MAT.piedraOsc(), [1.3, -0.35, 0.5], [0, -0.3, -0.3]);
      cyl(g, 0.22, 0.24, 1.5, MAT.piedra(), [2.2, 0.1, 0.2], [0, 0, 0.38], 12);
      const flames = [], smokes = [], embers = [];
      for (let i = 0; i < 7; i++) { const f = buildFlame(0.8 + (i % 3) * 0.3); f.position.set(-3.1 + i * 1.05, -0.35, -0.9 + (i % 3) * 0.35); g.add(f); flames.push(f); }
      const f1 = buildFlame(1.2); f1.position.set(1.0, 0.5, -0.5); g.add(f1); flames.push(f1);
      const f2 = buildFlame(1.0); f2.position.set(-1.8, 0.75, -0.9); g.add(f2); flames.push(f2);
      for (let i = 0; i < 6; i++) { const s = buildSmoke(); s.position.set(-2.6 + i * 1.05, 1.1, -1.1); g.add(s); smokes.push(s); }
      for (let i = 0; i < 10; i++) { const e = buildEmber(); e.position.set(-3 + i * 0.68, -0.1, -0.4); g.add(e); embers.push(e); }
      g.userData = { flames, smokes, embers, bases: new Map() };
      [...flames, ...smokes, ...embers].forEach((o) => g.userData.bases.set(o, o.position.clone()));
    }, tick: (g, t) => {
      const { flames, smokes, embers, bases } = g.userData;
      flames.forEach((f, i) => {
        const s = f.scale.x / (f.scale.x || 1);
        const base = 0.8 + (i % 3) * 0.3;
        const k = 1 + 0.25 * Math.sin(t * 9 + i) + 0.12 * Math.sin(t * 23 + i);
        f.scale.setScalar(Math.max(0.1, k));
        f.rotation.y = t * 1.6 + i;
      });
      smokes.forEach((sObj, i) => {
        const b = bases.get(sObj);
        const q = ((t * 0.22 + i * 0.16) % 1);
        sObj.position.set(b.x + Math.sin(t * 0.6 + i) * 0.4, b.y + q * 2.6, b.z);
        sObj.scale.setScalar(0.3 + q * 1.3);
        sObj.material.opacity = 0.35 * (1 - q);
      });
      embers.forEach((e, i) => {
        const b = bases.get(e);
        const q = ((t * 0.5 + i * 0.1) % 1);
        e.position.set(b.x + Math.sin(t * 1.4 + i) * 0.6, b.y + q * 3.2, b.z + Math.cos(t + i) * 0.3);
        e.material.opacity = 1 - q;
      });
    }
  }
];

let scene, beatGroup, beatIndex = 0, phase = 'assembling', t0 = null, unsubs = [];

function disposeGroup(g) {
  g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });
}

function buildBeat(i) {
  if (beatGroup) { scene.remove(beatGroup); disposeGroup(beatGroup); }
  beatGroup = new THREE.Group();
  BEATS[i].build(beatGroup);
  scene.add(beatGroup);
  assemble();
}

function forEachTopChild(fn) { beatGroup.children.forEach(fn); }

function assemble() {
  phase = 'assembling';
  const bases = new Map();
  forEachTopChild((c) => bases.set(c, { p: c.position.clone(), s: c.scale.clone() }));
  let pending = beatGroup.children.length;
  if (!pending) { phase = 'idle'; return; }
  forEachTopChild((c) => {
    const b = bases.get(c);
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const startPos = b.p.clone().addScaledVector(dir, 2.2);
    const startScale = 0.001;
    tween(1.1, (p) => {
      c.position.lerpVectors(startPos, b.p, p);
      const s = startScale + (1 - startScale) * p;
      c.scale.set(b.s.x * s, b.s.y * s, b.s.z * s);
    }, () => { pending--; if (pending <= 0) phase = 'idle'; }, easeOutBack);
  });
}

function collapse() {
  phase = 'collapsing';
  let pending = beatGroup.children.length;
  if (!pending) { phase = 'collapsed-wait'; return; }
  forEachTopChild((c) => {
    const startPos = c.position.clone();
    const startScale = c.scale.clone();
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const target = startPos.clone().addScaledVector(dir, 2.4);
    tween(0.8, (p) => {
      c.position.lerpVectors(startPos, target, p);
      const s = 1 - p;
      c.scale.set(startScale.x * s, startScale.y * s, startScale.z * s);
    }, () => { pending--; if (pending <= 0) phase = 'collapsed-wait'; }, easeOutCubic);
  });
}

export function mount(threeScene) {
  scene = threeScene;
  beatIndex = 0; phase = 'assembling'; t0 = null;
  buildBeat(beatIndex);
  unsubs.push(Bus.on('gesture', ({ gesture }) => {
    if (!gesture.hands.length) return;
    const anyFist = gesture.hands.every((h) => h.gesture === 'CLOSED_FIST');
    const anyOpen = gesture.hands.some((h) => h.gesture === 'OPEN_PALM');
    if (anyFist && phase === 'idle') collapse();
    else if (anyOpen && phase === 'collapsed-wait') {
      beatIndex = (beatIndex + 1) % BEATS.length;
      buildBeat(beatIndex);
    }
  }));
}

export function unmount() {
  unsubs.forEach((u) => u()); unsubs = [];
  if (beatGroup) { scene?.remove(beatGroup); disposeGroup(beatGroup); beatGroup = null; }
}

export function update(elapsed) {
  if (!beatGroup) return;
  if (t0 === null) t0 = elapsed;
  BEATS[beatIndex].tick(beatGroup, elapsed - t0);
}

export function currentBeatName() { return BEATS[beatIndex]?.name ?? ''; }
export function currentPhase() { return phase; }
