// Doodle Away wall: webcam → MediaPipe hands → p5.js marker drawing on a paper page.
// Drawing needs exactly two hands in view (one person's two hands, or two people with one each).
import { FilesetResolver, HandLandmarker } from '../vendor/tasks-vision/vision_bundle.mjs';
import { G, HandTracker } from './gestures.js';
import { store, newId } from './store.js';
import { CONFIG } from './config.js';
import { drawSegment, drawStroke } from './render.js';
import { DOODLES, wobblyRect } from './doodles.js';

// Felt-tip colours taken from the paper sheet.
export const MARKERS = [
  { name: 'pink', color: '#e8607a' },
  { name: 'red', color: '#d9463b' },
  { name: 'orange', color: '#ee8a2e' },
  { name: 'yellow', color: '#f2b630' },
  { name: 'green', color: '#5aa85f' },
  { name: 'teal', color: '#2a8c95' },
  { name: 'purple', color: '#7b63c6' },
  { name: 'ink', color: '#2d2a32' },
];
const PAPER = '#fbf8f1';

const $ = s => document.querySelector(s);
const toast = (msg, ms = 2200) => {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), ms);
};

const state = {
  strokes: [],
  started: performance.now(),
  lastSeen: performance.now(),
  lastSave: 0,
  saveHold: null,
  showCam: true,
  frame: { x: 0, y: 0, w: 1, h: 1 },   // drawing page rectangle in screen px
  tray: [],                            // marker hit boxes in screen px
};
const active = new Map();
const particles = [];
let video, handLm, lastVideoTime = -1, ready = false;
const tracker = new HandTracker();
let nextMarker = 0;

// ---------- page layout (paper frame, title, doodles, marker tray) ----------
function layout() {
  const W = window.innerWidth, H = window.innerHeight;
  const mx = Math.max(56, W * 0.07), top = Math.max(96, H * 0.14), bottom = Math.max(70, H * 0.1);
  state.frame = { x: mx, y: top, w: W - mx * 2, h: H - top - bottom };
  const f = state.frame;
  const svg = $('#frame');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.querySelector('path').setAttribute('d', wobblyRect(f.x, f.y, f.w, f.h, 11, 3.5));

  // Marker tray: a row of marker caps along the bottom inside the page.
  const tray = $('#tray');
  const size = Math.min(54, f.w / 16);
  tray.style.left = `${f.x + 18}px`; tray.style.top = `${f.y + f.h - size - 16}px`;
  [...tray.children].forEach(el => { el.style.width = el.style.height = `${size}px`; });
  requestAnimationFrame(() => {
    state.tray = [...tray.children].map((el, i) => { const r = el.getBoundingClientRect(); return { i, x: r.left, y: r.top, w: r.width, h: r.height }; });
  });
}

function buildPage() {
  // Title letters in alternating marker colours, like the hand-lettered sheet.
  const colors = ['#e8607a', '#d9463b', '#2a8c95', '#e8607a', '#5aa85f', '#d9463b', '#7b63c6', '#2a8c95', '#e8607a', '#5aa85f'];
  $('#title').innerHTML = [...'Doodle Away'].map((ch, i) =>
    ch === ' ' ? '<span class="sp"> </span>' : `<span style="color:${colors[i % colors.length]};--r:${((i * 37) % 9) - 4}deg">${ch}</span>`).join('');
  const tag = 'a free playground to draw!';
  $('#tagline').innerHTML = [...tag].map((ch, i) =>
    ch === ' ' ? ' ' : `<span style="color:${colors[(i + 3) % colors.length]}">${ch}</span>`).join('');
  // Margin doodles.
  for (const el of document.querySelectorAll('[data-doodle]')) el.innerHTML = DOODLES[el.dataset.doodle] || '';
  // Marker tray.
  $('#tray').innerHTML = MARKERS.map((m, i) =>
    `<div class="marker" data-i="${i}" title="${m.name}"><svg viewBox="0 0 40 40"><path d="M8 30 L26 12 L32 18 L14 36 Z" fill="${m.color}" stroke="#2d2a32" stroke-width="2" stroke-linejoin="round"/><path d="M26 12 L30 6 L36 12 L32 18" fill="#fff" stroke="#2d2a32" stroke-width="2" stroke-linejoin="round"/><path d="M8 30 L4 38 L14 36" fill="${m.color}" stroke="#2d2a32" stroke-width="2" stroke-linejoin="round"/></svg></div>`).join('');
  layout();
  window.addEventListener('resize', layout);
}
buildPage();

// ---------- MediaPipe ----------
async function initVision() {
  const fileset = await FilesetResolver.forVisionTasks('./vendor/tasks-vision/wasm');
  const opts = delegate => ({
    baseOptions: { modelAssetPath: './models/hand_landmarker.task', delegate },
    runningMode: 'VIDEO',
    numHands: 2,                       // never more than two hands
    minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { handLm = await HandLandmarker.createFromOptions(fileset, opts('GPU')); }
  catch { handLm = await HandLandmarker.createFromOptions(fileset, opts('CPU')); }
}
async function initCamera() {
  video = $('#cam');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' }, audio: false });
  video.srcObject = stream;
  await video.play();
}

// Camera frame → drawing page (mirrored, so it feels like a mirror).
function toScreen(nx, ny) {
  const m = CONFIG.reachMargin, f = state.frame;
  const x = Math.min(1, Math.max(0, ((1 - nx) - m) / (1 - 2 * m)));
  const y = Math.min(1, Math.max(0, (ny - m * 0.6) / (1 - 1.2 * m)));
  return { x: f.x + x * f.w, y: f.y + y * f.h };
}
const brushWidth = scale => {
  const t = Math.min(1, Math.max(0, (scale - 0.07) / (0.26 - 0.07)));
  return CONFIG.minBrush + t * (CONFIG.maxBrush - CONFIG.minBrush);
};
const inTray = (x, y) => state.tray.find(b => x > b.x - 6 && x < b.x + b.w + 6 && y > b.y - 6 && y < b.y + b.h + 6);

// ---------- p5 sketch ----------
new p5(p => {
  let ink;

  const rebake = () => {
    ink.clear(); ink.strokeCap(p.ROUND);
    for (const s of state.strokes) drawStroke(ink, s, 0, 0);
  };
  const startStroke = (key, color, brush) => {
    const s = { id: newId(), color, brush, seed: Math.floor(Math.random() * 1e4), pts: [] };
    state.strokes.push(s); active.set(key, s); return s;
  };
  const addPoint = (s, x, y, w) => {
    const f = state.frame;
    x = Math.min(f.x + f.w, Math.max(f.x, x)); y = Math.min(f.y + f.h, Math.max(f.y, y));
    const pts = s.pts, last = pts[pts.length - 1];
    if (last && Math.hypot(x - last[0], y - last[1]) < 1.5) return;
    const pt = [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(w * 10) / 10, Math.round(performance.now() - state.started)];
    pts.push(pt);
    ink.strokeCap(p.ROUND);
    drawSegment(ink, s, last || pt, pt, 0, 0, pts.length - 1);
  };
  const endStroke = key => active.delete(key);

  function sparkle(x, y, color, n) {
    for (let i = 0; i < n && particles.length < 200; i++) {
      const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 2.5;
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color, kind: i % 3 });
    }
  }

  p.setup = () => {
    p.createCanvas(window.innerWidth, window.innerHeight).parent('stage');
    p.pixelDensity(1);
    ink = p.createGraphics(p.width, p.height); ink.pixelDensity(1);
    p.frameRate(60);
    p.textFont('Patrick Hand');
    window.__playground = { state, rebake, save: () => saveDrawing(), clear: () => clearPage() };
  };
  p.windowResized = () => {
    p.resizeCanvas(window.innerWidth, window.innerHeight);
    ink = p.createGraphics(p.width, p.height); ink.pixelDensity(1);
    rebake();
  };

  function clearPage() {
    state.strokes = []; active.clear(); state.started = performance.now();
    ink.clear();
  }

  async function saveDrawing({ auto = false } = {}) {
    const drawn = state.strokes.filter(s => s.brush !== 'erase' && s.pts.length > 1);
    if (!drawn.length) { if (!auto) toast('Nothing to save yet. Pinch with both hands to draw!'); return null; }
    // The saved picture is the drawing page itself, on paper.
    const f = state.frame;
    const k = Math.min(1, 1800 / Math.max(f.w, f.h));
    const W = Math.round(f.w * k), H = Math.round(f.h * k);
    const g = p.createGraphics(W, H); g.pixelDensity(1);
    const layer = p.createGraphics(W, H); layer.pixelDensity(1);
    layer.scale(k); layer.strokeCap(p.ROUND);
    const strokes = state.strokes.map(s => ({ ...s, pts: s.pts.map(([x, y, w, t]) => [Math.round((x - f.x) * 10) / 10, Math.round((y - f.y) * 10) / 10, w, t]) }));
    for (const s of strokes) drawStroke(layer, s, 0, 0);
    g.background(PAPER); g.image(layer, 0, 0);
    const png = g.elt.toDataURL('image/png');
    g.remove(); layer.remove();
    const drawing = { id: newId(), createdAt: Date.now(), png, strokes, width: Math.round(f.w), height: Math.round(f.h), people: 1 };
    try {
      await store.save(drawing);
      state.lastSave = performance.now();
      const fl = $('#flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
      toast(auto ? 'Saved! Here’s a fresh page ✿' : 'Saved to the gallery ✿');
      return drawing.id;
    } catch (e) {
      console.error(e); toast('Could not save: ' + e.message, 4000); return null;
    }
  }
  state.saveDrawing = saveDrawing;

  let hands = [];

  function handleHands(tracks, now) {
    const visible = tracks.filter(t => !t.lost);
    const together = visible.length === 2;
    document.body.classList.toggle('one-hand', visible.length === 1);
    document.body.classList.toggle('two-hands', together);

    let thumbs = 0;
    for (const t of visible) {
      if (t.marker == null) {
        const used = new Set(visible.filter(o => o.marker != null).map(o => o.marker));
        let m = nextMarker++ % MARKERS.length;
        while (used.has(m)) m = (m + 1) % MARKERS.length;
        t.marker = m;
      }
      const s = toScreen(t.x, t.y);
      t.sx = s.x; t.sy = s.y; t.w = brushWidth(t.scale);
      const key = 'h' + t.id;

      // Pick a colour by resting a hand on a marker in the tray.
      const hit = inTray(s.x, s.y);
      if (hit && (t.gesture === G.POINT || t.gesture === G.PINCH)) {
        if (t.pick?.i !== hit.i) t.pick = { i: hit.i, since: now };
        else if (now - t.pick.since > CONFIG.pickSeconds * 1000 && t.marker !== hit.i) {
          t.marker = hit.i; sparkle(s.x, s.y, MARKERS[hit.i].color, 14);
        }
        endStroke(key);
        continue;
      }
      t.pick = null;

      const drawing = together && t.gesture === G.PINCH;
      const erasing = together && t.gesture === G.OPEN;
      if (!drawing && !erasing) endStroke(key);
      if (drawing) {
        const st = active.get(key);
        const cur = st && st.brush === 'marker' ? st : (endStroke(key), startStroke(key, MARKERS[t.marker].color, 'marker'));
        addPoint(cur, s.x, s.y, t.w);
      } else if (erasing) {
        const st = active.get(key);
        const cur = st && st.brush === 'erase' ? st : (endStroke(key), startStroke(key, null, 'erase'));
        addPoint(cur, s.x, s.y, 26);
      }
      if (t.gesture === G.THUMBS) thumbs++;
    }
    const live = new Set(visible.map(t => 'h' + t.id));
    for (const k of [...active.keys()]) if (k.startsWith('h') && !live.has(k)) endStroke(k);

    // Both thumbs up, held: save the page and start a fresh one.
    if (thumbs === 2 && now - state.lastSave > 4000) {
      state.saveHold ??= { since: now };
      if (now - state.saveHold.since > CONFIG.saveHoldSeconds * 1000) {
        state.saveHold = null;
        saveDrawing({ auto: true }).then(id => { if (id) clearPage(); });
        const f = state.frame; sparkle(f.x + f.w / 2, f.y + f.h / 2, '#f2b630', 60);
      }
    } else state.saveHold = null;
  }

  p.draw = () => {
    const now = performance.now();
    if (ready && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const r = handLm.detectForVideo(video, now);
      hands = tracker.update(r.landmarks.slice(0, 2).map(landmarks => ({ landmarks })), now);
      handleHands(hands, now);
      if (hands.length) state.lastSeen = now;
    }
    if (CONFIG.idleResetSeconds && ready && state.strokes.length && now - state.lastSeen > CONFIG.idleResetSeconds * 1000) {
      state.lastSeen = now;
      saveDrawing({ auto: true }).then(id => id && clearPage());
    }

    p.clear();
    p.image(ink, 0, 0);
    drawParticles();
    for (const t of hands) if (!t.lost && t.sx != null) drawCursor(t, now);
    if (state.saveHold) drawSaveHold(now);
  };

  function drawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.x += q.vx; q.y += q.vy; q.vx *= 0.96; q.vy *= 0.96; q.life -= 0.02;
      if (q.life <= 0) { particles.splice(i, 1); continue; }
      const c = p.color(q.color); c.setAlpha(q.life * 255);
      p.push(); p.translate(q.x, q.y); p.stroke(c); p.strokeWeight(2.5); p.noFill();
      const r = 6 * q.life + 2;
      if (q.kind === 0) { p.line(-r, 0, r, 0); p.line(0, -r, 0, r); }        // little plus
      else if (q.kind === 1) p.circle(0, 0, r * 1.4);                         // tiny ring
      else { p.line(-r, -r, r, r); p.line(-r, r, r, -r); }                    // tiny x
      p.pop();
    }
  }

  // Sketchy circle: a few wobbly loops, like a pen going round twice.
  function sketchCircle(x, y, r, seed) {
    p.beginShape();
    for (let a = 0; a <= Math.PI * 2.15; a += 0.25) {
      const rr = r + Math.sin(a * 3 + seed) * 1.6 + Math.cos(a * 5 + seed * 2) * 1.2;
      p.curveVertex(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    p.endShape();
  }

  const LABEL = { [G.PINCH]: 'drawing', [G.OPEN]: 'erasing', [G.THUMBS]: 'thumbs up!' };

  function drawCursor(t, now) {
    const together = hands.filter(h => !h.lost).length === 2;
    const col = MARKERS[t.marker].color;
    const c = p.color(t.gesture === G.OPEN ? '#2d2a32' : col);
    c.setAlpha(together ? 255 : 110);
    p.noFill(); p.stroke(c); p.strokeWeight(t.gesture === G.PINCH ? 3 : 2);
    if (t.gesture === G.OPEN) {
      p.drawingContext.setLineDash([5, 7]); sketchCircle(t.sx, t.sy, 28, t.id); p.drawingContext.setLineDash([]);
    } else {
      sketchCircle(t.sx, t.sy, Math.max(10, t.w) + 6, t.id);
      p.noStroke(); p.fill(c); p.circle(t.sx, t.sy, Math.max(5, t.w * 0.6));
    }
    // marker-colour pick progress
    if (t.pick) {
      const k = Math.min(1, (now - t.pick.since) / (CONFIG.pickSeconds * 1000));
      p.noFill(); p.stroke(MARKERS[t.pick.i].color); p.strokeWeight(4);
      p.arc(t.sx, t.sy, 52, 52, -p.HALF_PI, -p.HALF_PI + k * p.TWO_PI);
    }
    const label = LABEL[t.gesture];
    if (label && together) {
      p.noStroke(); p.fill(c); p.textSize(22); p.textAlign(p.LEFT, p.CENTER);
      p.text(label, t.sx + 24, t.sy - 22);
    }
  }

  function drawSaveHold(now) {
    const f = state.frame, x = f.x + f.w / 2, y = f.y + f.h / 2;
    const k = Math.min(1, (now - state.saveHold.since) / (CONFIG.saveHoldSeconds * 1000));
    p.noFill(); p.stroke('#e8607a'); p.strokeWeight(6);
    p.arc(x, y, 120, 120, -p.HALF_PI, -p.HALF_PI + k * p.TWO_PI);
    p.noStroke(); p.fill('#e8607a'); p.textSize(30); p.textAlign(p.CENTER, p.CENTER);
    p.text('saving…', x, y + 90);
  }

  // Mouse fallback for testing without a camera.
  let mouseMarker = 0;
  p.mousePressed = e => { if (e.target?.tagName !== 'CANVAS') return; const s = startStroke('mouse', MARKERS[mouseMarker].color, 'marker'); addPoint(s, p.mouseX, p.mouseY, 10); };
  p.mouseDragged = () => { const s = active.get('mouse'); if (s) addPoint(s, p.mouseX, p.mouseY, 10); };
  p.mouseReleased = () => { if (active.has('mouse')) { endStroke('mouse'); mouseMarker = (mouseMarker + 1) % MARKERS.length; } };

  p.keyPressed = () => {
    const k = p.key.toLowerCase();
    if (k === 'c') { state.showCam = !state.showCam; document.body.classList.toggle('hide-cam', !state.showCam); }
    if (k === 's') saveDrawing();
    if (k === 'n') saveDrawing({ auto: true }).then(() => clearPage());
    if (k === 'x') clearPage();
    if (k === 'h') document.body.classList.toggle('hide-help');
    if (k === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  };
});

// ---------- boot ----------
$('#start').addEventListener('click', async () => {
  $('#intro').classList.add('loading');
  $('#start').textContent = 'getting the markers ready…';
  try {
    await Promise.all([initCamera(), initVision()]);
    ready = true;
    $('#intro').remove();
    toast('Bring in two hands and pinch to draw!', 3200);
  } catch (e) {
    console.error(e);
    $('#start').textContent = 'try again';
    $('#intro').classList.remove('loading');
    $('#err').textContent = e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in the browser and try again.' : `Could not start: ${e.message}`;
  }
});
