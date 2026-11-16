// Wall / projection app: webcam → MediaPipe → gestures → p5.js infinite canvas.
import { FilesetResolver, HandLandmarker, PoseLandmarker } from '../vendor/tasks-vision/vision_bundle.mjs';
import { G, HandTracker } from './gestures.js';
import { store, newId } from './store.js';
import { CONFIG } from './config.js';
import { drawSegment, drawStroke } from './render.js';

const PALETTE = ['#ff4d8d', '#ffd23f', '#3ddc97', '#4cc9f0', '#b388ff', '#ff8c42', '#ffffff'];
const BRUSHES = ['ink', 'neon', 'spray'];
const BG = '#0d0c14';

const $ = s => document.querySelector(s);
const toast = (msg, ms = 2200) => {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), ms);
};

// ---------- state ----------
const state = {
  mode: 'hands',             // 'hands' | 'body'
  view: { x: 0, y: 0 },      // pan offset (screen = world + view)
  baked: { x: 0, y: 0 },     // view offset the ink layer was last rendered at
  strokes: [],
  started: performance.now(),
  lastSeen: performance.now(),
  lastSave: 0,
  saveHold: null,           // { since, x, y }
  resetHold: null,
  showCam: true,
  debug: false,
  people: 0,
  nextColor: 0,
};
const active = new Map();   // track id → stroke currently being drawn
const grabs = new Map();    // track id → last screen point while fist-dragging
const particles = [];

let video, handLm, poseLm, lastVideoTime = -1, ready = false, inferMs = 0;
const tracker = new HandTracker();
const bodyTracks = [];      // [{ id, nose, colorIdx }]

// ---------- MediaPipe ----------
async function initVision() {
  const fileset = await FilesetResolver.forVisionTasks('./vendor/tasks-vision/wasm');
  const opts = delegate => ({ baseOptions: { delegate }, runningMode: 'VIDEO' });
  const make = async (Cls, path, extra) => {
    try { return await Cls.createFromOptions(fileset, { ...opts('GPU'), baseOptions: { modelAssetPath: path, delegate: 'GPU' }, ...extra }); }
    catch { return await Cls.createFromOptions(fileset, { ...opts('CPU'), baseOptions: { modelAssetPath: path, delegate: 'CPU' }, ...extra }); }
  };
  handLm = await make(HandLandmarker, './models/hand_landmarker.task', {
    numHands: 6, minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  poseLm = await make(PoseLandmarker, './models/pose_landmarker_lite.task', { numPoses: 4 });
}

async function initCamera() {
  video = $('#cam');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' }, audio: false });
  video.srcObject = stream;
  await video.play();
}

// ---------- coordinate mapping ----------
function toScreen(nx, ny, W, H) {
  const m = CONFIG.reachMargin;
  const x = ((1 - nx) - m) / (1 - 2 * m);       // mirror so it feels like a mirror
  const y = (ny - m * 0.6) / (1 - 1.2 * m);
  return { x: Math.min(1, Math.max(0, x)) * W, y: Math.min(1, Math.max(0, y)) * H };
}
const brushWidth = scale => {
  const t = Math.min(1, Math.max(0, (scale - 0.07) / (0.26 - 0.07)));
  return CONFIG.minBrush + t * t * (CONFIG.maxBrush - CONFIG.minBrush);
};

// ---------- p5 sketch ----------
new p5(p => {
  let ink;

  const rebake = () => {
    ink.clear();
    ink.strokeCap(p.ROUND);
    for (const s of state.strokes) drawStroke(ink, s, state.view.x, state.view.y);
    state.baked = { ...state.view };
  };

  const startStroke = (key, color, brush) => {
    const s = { id: newId(), color, brush, seed: Math.floor(Math.random() * 1e4), pts: [] };
    state.strokes.push(s); active.set(key, s); return s;
  };
  const addPoint = (s, sx, sy, w) => {
    const wx = sx - state.view.x, wy = sy - state.view.y;
    const pts = s.pts, last = pts[pts.length - 1];
    if (last && Math.hypot(wx - last[0], wy - last[1]) < 1.5) return;
    const pt = [Math.round(wx * 10) / 10, Math.round(wy * 10) / 10, Math.round(w * 10) / 10, Math.round(performance.now() - state.started)];
    pts.push(pt);
    const ox = state.baked.x, oy = state.baked.y;
    ink.strokeCap(p.ROUND);
    drawSegment(ink, s, last || pt, pt, ox, oy, pts.length - 1);
    if (s.brush !== 'erase' && Math.random() < 0.6) spawn(sx, sy, s.color, 1);
  };
  const endStroke = key => active.delete(key);

  function spawn(x, y, color, n) {
    for (let i = 0; i < n && particles.length < 700; i++) {
      particles.push({ x, y, vx: p.random(-1.2, 1.2), vy: p.random(-1.8, 0.4), life: 1, color, r: p.random(2, 5) });
    }
  }

  p.setup = () => {
    const c = p.createCanvas(window.innerWidth, window.innerHeight);
    c.parent('stage');
    ink = p.createGraphics(p.width, p.height);
    p.pixelDensity(1); ink.pixelDensity(1);
    p.frameRate(60);
    window.__playground = { state, rebake, save: () => saveDrawing(p), clear: () => clearCanvas() };
  };

  p.windowResized = () => {
    p.resizeCanvas(window.innerWidth, window.innerHeight);
    ink = p.createGraphics(p.width, p.height); ink.pixelDensity(1);
    rebake();
  };

  function clearCanvas() {
    state.strokes = []; active.clear(); state.view = { x: 0, y: 0 }; state.started = performance.now();
    rebake();
  }
  state.clear = clearCanvas;

  async function saveDrawing(pp, { auto = false } = {}) {
    const drawn = state.strokes.filter(s => s.brush !== 'erase' && s.pts.length > 1);
    if (!drawn.length) { if (!auto) toast('Nothing to save yet — pinch to draw'); return null; }
    // Bounding box of everything drawn (world coordinates).
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of drawn) for (const [x, y, w] of s.pts) { x0 = Math.min(x0, x - w); y0 = Math.min(y0, y - w); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + w); }
    const pad = 60; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const W = Math.ceil(x1 - x0), H = Math.ceil(y1 - y0);
    const k = Math.min(1, 2000 / Math.max(W, H));
    const g = pp.createGraphics(Math.ceil(W * k), Math.ceil(H * k)); g.pixelDensity(1);
    const layer = pp.createGraphics(Math.ceil(W * k), Math.ceil(H * k)); layer.pixelDensity(1);
    layer.scale(k); layer.strokeCap(pp.ROUND);
    const strokes = state.strokes.map(s => ({ ...s, pts: s.pts.map(([x, y, w, t]) => [Math.round((x - x0) * 10) / 10, Math.round((y - y0) * 10) / 10, w, t]) }));
    for (const s of strokes) drawStroke(layer, s, 0, 0);
    g.background(BG); g.image(layer, 0, 0);
    const png = g.elt.toDataURL('image/png');
    g.remove(); layer.remove();
    const drawing = { id: newId(), createdAt: Date.now(), png, strokes, width: W, height: H, people: state.people };
    try {
      await store.save(drawing);
      state.lastSave = performance.now();
      flash();
      toast(auto ? 'Saved to the gallery ✦ fresh canvas' : 'Saved to the gallery ✦');
      return drawing.id;
    } catch (e) {
      console.error(e); toast('Could not save: ' + e.message, 4000); return null;
    }
  }
  state.saveDrawing = opts => saveDrawing(p, opts);

  function flash() { const f = $('#flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }

  // ---------- per-frame ----------
  function runDetection(now) {
    if (!ready || !video || video.readyState < 2 || video.currentTime === lastVideoTime) return null;
    lastVideoTime = video.currentTime;
    const t0 = performance.now();
    let out;
    if (state.mode === 'hands') {
      const r = handLm.detectForVideo(video, now);
      out = { hands: r.landmarks.map((landmarks, i) => ({ landmarks, handedness: r.handednesses?.[i]?.[0]?.categoryName })) };
    } else {
      const r = poseLm.detectForVideo(video, now);
      out = { poses: r.landmarks };
    }
    inferMs = inferMs * 0.9 + (performance.now() - t0) * 0.1;
    return out;
  }

  let lastHands = [], lastPoses = [];

  function handleHands(tracks, now) {
    const W = p.width, H = p.height;
    let openCount = 0, thumbs = null;
    for (const t of tracks) {
      if (t.colorIdx == null) {
        // New hand: give it a colour nobody else on the wall is using right now.
        const used = new Set(tracks.filter(o => o.colorIdx != null).map(o => o.colorIdx));
        let c = state.nextColor++ % PALETTE.length;
        for (let k = 0; k < PALETTE.length && used.has(c); k++) c = (c + 1) % PALETTE.length;
        t.colorIdx = c; t.brushIdx = 0;
      }
      const s = toScreen(t.x, t.y, W, H);
      t.sx = s.x; t.sy = s.y; t.w = brushWidth(t.scale);
      const key = 'h' + t.id;

      if (t.gesture !== G.PINCH && t.gesture !== G.OPEN && active.has(key)) endStroke(key);
      if (t.gesture !== G.FIST) grabs.delete(key);

      switch (t.gesture) {
        case G.PINCH: {
          const st = active.get(key) || startStroke(key, PALETTE[t.colorIdx], BRUSHES[t.brushIdx]);
          addPoint(st, s.x, s.y, t.w);
          break;
        }
        case G.OPEN: {
          openCount++;
          const st = active.get(key) || startStroke(key, null, 'erase');
          addPoint(st, s.x, s.y, Math.max(30, t.w * 1.6));
          break;
        }
        case G.FIST: {
          const g = grabs.get(key);
          if (g) { state.view.x += s.x - g.x; state.view.y += s.y - g.y; }
          grabs.set(key, { x: s.x, y: s.y });
          break;
        }
        case G.PEACE:
          if (t.changed) { t.colorIdx = (t.colorIdx + 1) % PALETTE.length; spawn(s.x, s.y, PALETTE[t.colorIdx], 25); }
          break;
        case G.ROCK:
          if (t.changed) { t.brushIdx = (t.brushIdx + 1) % BRUSHES.length; spawn(s.x, s.y, PALETTE[t.colorIdx], 25); toast(`Brush: ${BRUSHES[t.brushIdx]}`, 1200); }
          break;
        case G.THUMBS:
          thumbs = t;
          break;
      }
    }
    // Hands that vanished end their strokes.
    const live = new Set(tracks.map(t => 'h' + t.id));
    for (const k of [...active.keys()]) if (k.startsWith('h') && !live.has(k)) endStroke(k);
    for (const k of [...grabs.keys()]) if (!live.has(k)) grabs.delete(k);
    // Rebake after a pan ends.
    if (!grabs.size && (state.baked.x !== state.view.x || state.baked.y !== state.view.y)) rebake();

    // Hold gestures.
    const since = now - state.lastSave;
    if (thumbs && since > 4000) {
      state.saveHold ??= { since: now };
      state.saveHold.x = thumbs.sx; state.saveHold.y = thumbs.sy;
      if (now - state.saveHold.since > CONFIG.saveHoldSeconds * 1000) { state.saveHold = null; saveDrawing(p); }
    } else state.saveHold = null;

    if (openCount >= 2 && since > 4000) {
      state.resetHold ??= { since: now };
      if (now - state.resetHold.since > CONFIG.resetHoldSeconds * 1000) {
        state.resetHold = null;
        saveDrawing(p, { auto: true }).then(() => clearCanvas());
      }
    } else state.resetHold = null;
  }

  function handlePoses(poses, now) {
    // Body brush: each wrist paints while it is raised above the hip. Raise both hands over your
    // head for a burst.
    const W = p.width, H = p.height;
    const seen = new Set();
    poses.forEach(lm => {
      const nose = lm[0];
      let bt = bodyTracks.find(b => !seen.has(b) && Math.hypot(b.nose.x - nose.x, b.nose.y - nose.y) < 0.2);
      if (!bt) { bt = { id: newId(), nose, colorIdx: state.nextColor++ % PALETTE.length }; bodyTracks.push(bt); }
      bt.nose = nose; bt.seen = now; seen.add(bt);
      const hipY = (lm[23].y + lm[24].y) / 2;
      const shoulderW = Math.hypot(lm[11].x - lm[12].x, lm[11].y - lm[12].y);
      for (const [wi, name] of [[15, 'L'], [16, 'R']]) {
        const key = 'b' + bt.id + name, wr = lm[wi];
        if ((wr.visibility ?? 1) > 0.5 && wr.y < hipY - 0.03) {
          const s = toScreen(wr.x, wr.y, W, H);
          const st = active.get(key) || startStroke(key, PALETTE[(bt.colorIdx + (name === 'R' ? 2 : 0)) % PALETTE.length], 'neon');
          addPoint(st, s.x, s.y, 6 + Math.min(1, shoulderW / 0.35) * 22);
        } else endStroke(key);
      }
      if (lm[15].y < nose.y && lm[16].y < nose.y) {
        const s = toScreen(nose.x, nose.y - 0.15, W, H);
        spawn(s.x, s.y, PALETTE[(now / 150 | 0) % PALETTE.length], 6);
      }
    });
    for (let i = bodyTracks.length - 1; i >= 0; i--) {
      if (!seen.has(bodyTracks[i])) {
        const id = bodyTracks[i].id;
        endStroke('b' + id + 'L'); endStroke('b' + id + 'R');
        if (now - bodyTracks[i].seen > 1000) bodyTracks.splice(i, 1);
      }
    }
  }

  p.draw = () => {
    const now = performance.now();
    const det = runDetection(now);
    if (det?.hands) {
      lastHands = tracker.update(det.hands, now);
      handleHands(lastHands, now);
      state.people = Math.ceil(lastHands.length / 2);
    } else if (det?.poses) {
      lastPoses = det.poses;
      handlePoses(lastPoses, now);
      state.people = lastPoses.length;
    }
    if (det && (state.mode === 'hands' ? lastHands.length : lastPoses.length)) state.lastSeen = now;

    // Idle: save and start fresh when nobody has been around for a while.
    if (CONFIG.idleResetSeconds && ready && state.strokes.length && now - state.lastSeen > CONFIG.idleResetSeconds * 1000) {
      state.lastSeen = now;
      saveDrawing(p, { auto: true }).then(id => id && clearCanvas());
    }

    // --- render ---
    p.background(BG);
    drawGrid();
    p.image(ink, state.view.x - state.baked.x, state.view.y - state.baked.y);

    // particles
    p.noStroke();
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.x += q.vx; q.y += q.vy; q.vy += 0.02; q.life -= 0.018;
      if (q.life <= 0) { particles.splice(i, 1); continue; }
      const c = p.color(q.color); c.setAlpha(q.life * 255); p.fill(c); p.circle(q.x, q.y, q.r * q.life);
    }

    if (state.mode === 'hands') for (const t of lastHands) if (!t.lost && t.sx != null) drawCursor(t, now);
    if (state.mode === 'body' && state.debug) drawPoseDebug();
    drawHolds(now);
    drawCamPreview();
    updateHud();
  };

  function drawGrid() {
    // FigJam-style dot grid that moves with the canvas.
    const step = 48;
    p.stroke(255, 255, 255, 34); p.strokeWeight(2);
    const ox = ((state.view.x % step) + step) % step, oy = ((state.view.y % step) + step) % step;
    for (let x = ox; x < p.width; x += step) for (let y = oy; y < p.height; y += step) p.point(x, y);
  }

  const LABEL = { [G.PINCH]: 'drawing', [G.POINT]: 'pinch to draw', [G.OPEN]: 'erasing', [G.FIST]: 'moving canvas', [G.PEACE]: 'new colour', [G.ROCK]: 'new brush', [G.THUMBS]: 'hold to save', [G.NONE]: '' };

  function drawCursor(t, now) {
    const col = t.gesture === G.OPEN ? '#ffffff' : PALETTE[t.colorIdx];
    const c = p.color(col);
    p.noFill();
    const pulse = 1 + Math.sin(now / 180) * 0.08;
    if (t.gesture === G.OPEN) {
      c.setAlpha(140); p.stroke(c); p.strokeWeight(2);
      p.drawingContext.setLineDash([6, 6]); p.circle(t.sx, t.sy, Math.max(30, t.w * 1.6) * 2.2); p.drawingContext.setLineDash([]);
    } else if (t.gesture === G.FIST) {
      c.setAlpha(200); p.stroke(c); p.strokeWeight(3); p.rectMode(p.CENTER); p.square(t.sx, t.sy, 34, 8);
    } else {
      c.setAlpha(t.gesture === G.PINCH ? 255 : 170); p.stroke(c); p.strokeWeight(t.gesture === G.PINCH ? 3 : 2);
      p.circle(t.sx, t.sy, Math.max(14, t.w) * pulse + 10);
      p.noStroke(); p.fill(c); p.circle(t.sx, t.sy, 6);
    }
    // label chip: brush + gesture
    const label = `${BRUSHES[t.brushIdx]} · ${LABEL[t.gesture] || ''}`;
    p.textFont('sans-serif'); p.textSize(14); p.textStyle(p.BOLD);
    const tw = p.textWidth(label) + 18;
    p.noStroke(); p.fill(0, 0, 0, 150); p.rectMode(p.CORNER); p.rect(t.sx + 22, t.sy - 30, tw, 24, 12);
    p.fill(col); p.circle(t.sx + 22 + 10, t.sy - 18, 8);
    p.fill(255); p.text(label, t.sx + 22 + 18, t.sy - 13);
  }

  function arc(x, y, frac, col, label) {
    p.noFill(); p.strokeWeight(8); p.stroke(255, 255, 255, 40); p.circle(x, y, 90);
    p.stroke(col); p.arc(x, y, 90, 90, -p.HALF_PI, -p.HALF_PI + frac * p.TWO_PI);
    p.noStroke(); p.fill(255); p.textAlign(p.CENTER); p.textSize(16); p.textStyle(p.BOLD); p.text(label, x, y + 72); p.textAlign(p.LEFT);
  }
  function drawHolds(now) {
    if (state.saveHold) arc(state.saveHold.x, state.saveHold.y, (now - state.saveHold.since) / (CONFIG.saveHoldSeconds * 1000), '#3ddc97', 'saving…');
    if (state.resetHold) arc(p.width / 2, p.height / 2, (now - state.resetHold.since) / (CONFIG.resetHoldSeconds * 1000), '#ffd23f', 'save & start fresh…');
  }

  function drawCamPreview() {
    if (!state.showCam || !video || video.readyState < 2) return;
    const w = Math.min(300, p.width * 0.2), h = w * (video.videoHeight / video.videoWidth || 0.5625);
    const x = p.width - w - 20, y = p.height - h - 20;
    const ctx = p.drawingContext;
    ctx.save(); ctx.globalAlpha = 0.85; ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0, w, h); ctx.restore();
    p.noFill(); p.stroke(255, 255, 255, 60); p.strokeWeight(1); p.rect(x, y, w, h, 10);
    // reach area
    const m = CONFIG.reachMargin;
    p.stroke(255, 255, 255, 90); p.drawingContext.setLineDash([4, 4]);
    p.rect(x + w * m, y + h * m * 0.6, w * (1 - 2 * m), h * (1 - 1.2 * m)); p.drawingContext.setLineDash([]);
    p.noStroke(); p.fill(255);
    const pts = state.mode === 'hands' ? lastHands.filter(t => !t.lost).flatMap(t => t.landmarks) : lastPoses.flat();
    for (const l of pts) p.circle(x + (1 - l.x) * w, y + l.y * h, 3);
  }

  function drawPoseDebug() {
    p.noStroke(); p.fill(255, 255, 255, 120);
    for (const lm of lastPoses) for (const l of lm) { const s = toScreen(l.x, l.y, p.width, p.height); p.circle(s.x, s.y, 6); }
  }

  let hudT = 0;
  function updateHud() {
    if (performance.now() - hudT < 250) return; hudT = performance.now();
    const n = state.mode === 'hands' ? lastHands.filter(t => !t.lost).length : lastPoses.length;
    $('#status').textContent = !ready ? 'starting camera…' :
      `${state.mode === 'hands' ? 'hand mode' : 'body mode'} · ${n} ${state.mode === 'hands' ? 'hand' : 'person'}${n === 1 ? '' : 's'} · ${Math.round(p.frameRate())} fps · ${inferMs.toFixed(0)} ms`;
    document.body.dataset.mode = state.mode;
  }

  // ---------- mouse fallback (testing without a camera) ----------
  let mouseColor = 0;
  p.mousePressed = e => { if (e.target?.tagName !== 'CANVAS') return; startStroke('mouse', PALETTE[mouseColor], BRUSHES[0]); addPoint(active.get('mouse'), p.mouseX, p.mouseY, 10); };
  p.mouseDragged = () => { const s = active.get('mouse'); if (s) addPoint(s, p.mouseX, p.mouseY, 10); };
  p.mouseReleased = () => { endStroke('mouse'); mouseColor = (mouseColor + 1) % PALETTE.length; };

  p.keyPressed = () => {
    const k = p.key.toLowerCase();
    if (k === 'c') state.showCam = !state.showCam;
    if (k === 'b') setMode(state.mode === 'hands' ? 'body' : 'hands');
    if (k === 's') saveDrawing(p);
    if (k === 'n') { saveDrawing(p, { auto: true }).then(() => clearCanvas()); }
    if (k === 'x') clearCanvas();
    if (k === 'h') document.body.classList.toggle('hide-help');
    if (k === 'd') state.debug = !state.debug;
    if (k === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  };
});

function setMode(m) {
  state.mode = m;
  for (const k of [...active.keys()]) active.delete(k);
  toast(m === 'hands' ? 'Hand mode: pinch to draw' : 'Body mode: raise your hands to paint', 1800);
}
window.setMode = setMode;

// ---------- boot ----------
$('#start').addEventListener('click', start);
async function start() {
  $('#intro').classList.add('loading');
  $('#start').textContent = 'Loading models…';
  try {
    await Promise.all([initCamera(), initVision()]);
    ready = true;
    $('#intro').remove();
    toast('Pinch thumb + index to draw', 3000);
  } catch (e) {
    console.error(e);
    $('#start').textContent = 'Try again';
    $('#intro').classList.remove('loading');
    $('#err').textContent = e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in the browser and try again.' : `Could not start: ${e.message}`;
  }
}
document.querySelectorAll('[data-mode-btn]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.modeBtn)));
