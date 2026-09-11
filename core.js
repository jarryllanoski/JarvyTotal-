/**
 * core.js — cámara, hand tracking (MediaPipe), gestos, anclas y un
 * pequeño bus de eventos + utilidad de tween. Sin frameworks: todo
 * vanilla, para que este proyecto sea "sube el archivo y ya".
 */

// ---------------- Bus de eventos ----------------
export const Bus = (() => {
  const listeners = new Map();
  return {
    on(evt, cb) {
      let s = listeners.get(evt);
      if (!s) { s = new Set(); listeners.set(evt, s); }
      s.add(cb);
      return () => s.delete(cb);
    },
    emit(evt, payload) { listeners.get(evt)?.forEach((cb) => cb(payload)); }
  };
})();

export function tween(duration, onUpdate, onComplete, ease = (t) => t) {
  const start = performance.now();
  function step(now) {
    const p = Math.min(1, (now - start) / (duration * 1000));
    onUpdate(ease(p));
    if (p < 1) requestAnimationFrame(step); else onComplete?.();
  }
  requestAnimationFrame(step);
}
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);

// ---------------- Cámara ----------------
export class CameraManager {
  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    this.stream = null;
  }
  async listDevices() {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  }
  async start({ deviceId, width = 1920, height = 1080, fps = 30 } = {}) {
    this.stop();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: fps, max: fps }
      }
    });
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play();
    return stream;
  }
  stop() { this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; }
  settings() { return this.stream?.getVideoTracks()[0]?.getSettings() ?? null; }
  label() { return this.stream?.getVideoTracks()[0]?.label ?? ''; }
}
export const cameraManager = new CameraManager();

// ---------------- Geometría de landmarks ----------------
export const LM = { WRIST: 0, THUMB_TIP: 4, INDEX_MCP: 5, INDEX_TIP: 8, MIDDLE_MCP: 9, PINKY_MCP: 17 };
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
];

const CAM_FOV = 50, CAM_ASPECT = 9 / 16, CAM_DIST = 6;
export function screenToWorld(nx, ny, depth = 0, mirror = true) {
  const viewDist = CAM_DIST - depth;
  const vFov = (CAM_FOV * Math.PI) / 180;
  const h = 2 * Math.tan(vFov / 2) * viewDist;
  const w = h * CAM_ASPECT;
  const x = mirror ? (0.5 - nx) * w : (nx - 0.5) * w;
  const y = (0.5 - ny) * h;
  return { x, y, z: depth };
}
export function handSpan(lm) { const a = lm[LM.WRIST], b = lm[LM.MIDDLE_MCP]; return Math.hypot(a.x - b.x, a.y - b.y) || 1e-4; }
export function palmCenter(lm) { const a = lm[LM.WRIST], b = lm[LM.INDEX_MCP], c = lm[LM.PINKY_MCP]; return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 }; }

// ---------------- Hand Tracker (MediaPipe Tasks Vision) ----------------
export class HandTracker {
  constructor() {
    this.landmarker = null; this.raf = 0; this.lastT = -1; this.running = false;
    this.mirror = true; this._fc = 0; this._t0 = performance.now(); this.fps = 0;
  }
  async init() {
    if (this.landmarker) return;
    const { FilesetResolver, HandLandmarker } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate },
      runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5
    });
    try { this.landmarker = await HandLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch { this.landmarker = await HandLandmarker.createFromOptions(fileset, opts('CPU')); }
  }
  start(video) {
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (video.readyState < 2 || video.currentTime === this.lastT) return;
      this.lastT = video.currentTime;
      const now = performance.now();
      let raw;
      try { raw = this.landmarker.detectForVideo(video, now); } catch { return; }
      const hands = this._toHands(raw);
      this._fc++;
      const el = now - this._t0;
      if (el > 500) { this.fps = Math.round((this._fc * 1000) / el); this._fc = 0; this._t0 = now; }
      Bus.emit('hands', { hands, fps: this.fps });
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  _toHands(raw) {
    const out = [];
    const list = raw.landmarks || [];
    const hs = raw.handedness || [];
    for (let i = 0; i < list.length; i++) {
      const lm = list[i];
      const cat = hs[i]?.[0];
      const handedness = cat?.categoryName || 'Right';
      const wrist = lm[0];
      out.push({ handedness, landmarks: lm, confidence: cat?.score ?? 0, worldPosition: screenToWorld(wrist.x, wrist.y, 0, this.mirror) });
    }
    return out;
  }
}
export const handTracker = new HandTracker();

// ---------------- Gestos (con hysteresis para evitar parpadeo) ----------------
const PINCH_ON = 0.35, PINCH_OFF = 0.5, FIST_ON = 0.35, FIST_OFF = 0.5;
const TWO_CLOSE = 0.55, TWO_APART = 0.9, SWIPE_V = 1.6, SWIPE_CD = 0.5;

export class GestureDetector {
  constructor() { this.listeners = new Map(); this.tracks = new Map(); this.twoHand = null; }
  on(evt, cb) { let s = this.listeners.get(evt); if (!s) { s = new Set(); this.listeners.set(evt, s); } s.add(cb); return () => s.delete(cb); }
  emit(evt, p) { this.listeners.get(evt)?.forEach((cb) => cb(p)); }
  _track(h) { let t = this.tracks.get(h); if (!t) { t = { pinching: false, fist: false, lastX: null, cd: 0 }; this.tracks.set(h, t); } return t; }
  update(hands, dt) {
    const states = hands.map((h) => this._updateHand(h, dt));
    let twoHanded = null, palmDist = null;
    if (hands.length === 2) {
      const [a, b] = hands;
      const pa = palmCenter(a.landmarks), pb = palmCenter(b.landmarks);
      const scale = (handSpan(a.landmarks) + handSpan(b.landmarks)) / 2;
      palmDist = Math.hypot(pa.x - pb.x, pa.y - pb.y) / Math.max(scale, 1e-4);
      if (this.twoHand !== 'close' && palmDist < TWO_CLOSE) { this.twoHand = 'close'; this.emit('handsTogether', {}); }
      else if (this.twoHand !== 'apart' && palmDist > TWO_APART) { this.twoHand = 'apart'; this.emit('handsApart', {}); }
      twoHanded = this.twoHand;
    } else this.twoHand = null;
    return { hands: states, twoHanded, palmDist };
  }
  _updateHand(h, dt) {
    const t = this._track(h.handedness);
    const lm = h.landmarks;
    const span = handSpan(lm);
    const thumb = lm[LM.THUMB_TIP], index = lm[LM.INDEX_TIP];
    const pd = Math.hypot(thumb.x - index.x, thumb.y - index.y) / span;
    if (!t.pinching && pd < PINCH_ON) { t.pinching = true; this.emit('pinchStart', { handedness: h.handedness }); }
    else if (t.pinching && pd > PINCH_OFF) { t.pinching = false; this.emit('pinchEnd', { handedness: h.handedness }); }
    let curl = 0;
    for (const tip of [8, 12, 16, 20]) { const p = lm[tip]; curl += Math.hypot(p.x - lm[0].x, p.y - lm[0].y) / span; }
    curl /= 4;
    const openness = Math.max(0, Math.min(1, (curl - 1.0) / 1.1));
    if (!t.fist && openness < FIST_ON) { t.fist = true; this.emit('grab', { handedness: h.handedness }); }
    else if (t.fist && openness > FIST_OFF) { t.fist = false; this.emit('release', { handedness: h.handedness }); }
    const palm = palmCenter(lm);
    if (t.lastX !== null) {
      const vx = (palm.x - t.lastX) / Math.max(dt, 1 / 120);
      t.cd = Math.max(0, t.cd - dt);
      if (t.cd === 0 && Math.abs(vx) > SWIPE_V) { t.cd = SWIPE_CD; this.emit(vx > 0 ? 'swipeRight' : 'swipeLeft', { handedness: h.handedness }); }
    }
    t.lastX = palm.x;
    let gesture = 'NONE';
    if (t.fist) gesture = 'CLOSED_FIST'; else if (t.pinching) gesture = 'PINCH'; else if (openness > 0.75) gesture = 'OPEN_PALM';
    return { handedness: h.handedness, gesture, pinchDistance: pd, openness };
  }
}
export const gestureDetector = new GestureDetector();

let lastTime = performance.now();
Bus.on('hands', ({ hands, fps }) => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  const gesture = gestureDetector.update(hands, dt);
  Bus.emit('gesture', { hands, fps, gesture });
});

// ---------------- Anclas en mundo Three.js ----------------
export function computeAnchors(hands, mirror = true) {
  const anchors = {};
  const left = hands.find((h) => h.handedness === 'Left');
  const right = hands.find((h) => h.handedness === 'Right');
  const w = (p) => screenToWorld(p.x, p.y, 0, mirror);
  if (left) {
    anchors.LEFT_PALM = w(left.landmarks[9]);
    anchors.LEFT_INDEX = w(left.landmarks[8]);
    anchors.LEFT_THUMB = w(left.landmarks[4]);
    anchors.ABOVE_LEFT_PALM = { ...anchors.LEFT_PALM, y: anchors.LEFT_PALM.y + 1.1 };
  }
  if (right) {
    anchors.RIGHT_PALM = w(right.landmarks[9]);
    anchors.RIGHT_INDEX = w(right.landmarks[8]);
    anchors.RIGHT_THUMB = w(right.landmarks[4]);
    anchors.ABOVE_RIGHT_PALM = { ...anchors.RIGHT_PALM, y: anchors.RIGHT_PALM.y + 1.1 };
  }
  if (left && right) {
    anchors.BETWEEN_HANDS = { x: (anchors.LEFT_PALM.x + anchors.RIGHT_PALM.x) / 2, y: (anchors.LEFT_PALM.y + anchors.RIGHT_PALM.y) / 2, z: 0 };
  }
  return anchors;
}
