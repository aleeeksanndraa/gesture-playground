// Phone page: you get a puzzle piece, fill it with a photo, drawing and stickers, and send it.
// Everything is drawn in a 1024×1024 "piece space" (the same framing as a piece texture on the
// board: the cell in the middle, room for the tabs around it). Sending exports a 512px JPEG.
import { CONFIG } from './config.js';
import { edgesForSlot, tracePieceInSquare } from './puzzle.js';
import { drawGlassPiece } from './glass2d.js';
import { dotRing } from './dots.js';

const $ = s => document.querySelector(s);
const C = 1024;
const COLORS = ['#ffffff', '#15183a', '#ff5a7a', '#ffb547', '#ffe45c', '#4fe0a6', '#4fb4ff', '#a98bff'];
const SIZES = [8, 18, 34];
const STICKERS = ['🏠', '❤️', '✨', '🌻', '🍜', '☕️', '🐈', '🐶', '🎧', '📚', '🚲', '🌧️', '🧸', '🪴', '🌙', '⭐️'];

const state = {
  slot: 0, edges: edgesForSlot(0),
  mode: 'draw', color: COLORS[2], size: SIZES[1],
  objects: [],        // { kind: 'photo' | 'sticker', img | ch, x, y, s, r }
  strokes: [],        // { color, width, pts: [[x,y], ...] }
  history: [],        // 'stroke' | 'sticker', for undo
};

// ---------- screens ----------
function show(id) {
  $('#toast').hidden = true;
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  if (id === 'editor') sizeStage();
  if (id === 'intro') startRing('introRing', '#7a5cff');
  if (id === 'sent') { const r = startRing('sentRing', '#ff4fb8'); r.burst(); }
}
let toastTimer;
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms); }

function sizeRing(c) { const r = c.getBoundingClientRect(); c.width = c.height = Math.round(r.width * Math.min(devicePixelRatio, 2.5)); }
const rings = {};
function startRing(id, color) {
  const c = $('#' + id);
  if (!rings[id]) { sizeRing(c); rings[id] = dotRing(c, { color }); }
  return rings[id];
}

async function fetchSlot() {
  try { const r = await (await fetch('/api/next', { cache: 'no-store' })).json(); state.slot = r.slot; } catch {}
  $('#already').textContent = state.slot ? `${state.slot} ${state.slot === 1 ? "piece" : "pieces"} already on the board` : 'Be the first piece on the board';
  state.edges = edgesForSlot(state.slot);
  const c = $('#introPiece'), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  drawGlassPiece(ctx, null, state.edges, c.width);
}

// ---------- photo ----------
function loadPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      // Shrink big phone photos right away: smaller memory, faster drawing.
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open that photo')); };
    img.src = url;
  });
}
async function setPhoto(file) {
  if (!file) return;
  try {
    const img = await loadPhoto(file);
    const s = Math.max(C / img.width, C / img.height);      // cover the whole piece
    const photo = { kind: 'photo', img, x: C / 2, y: C / 2, s, r: 0, w: img.width, h: img.height };
    const i = state.objects.findIndex(o => o.kind === 'photo');
    if (i >= 0) state.objects[i] = photo; else state.objects.unshift(photo);
    setMode('move');
    show('editor'); render();
  } catch (e) { toast(e.message); }
}
$('#photoIn').addEventListener('change', e => { setPhoto(e.target.files[0]); e.target.value = ''; });
$('#photoIn2').addEventListener('change', e => { setPhoto(e.target.files[0]); e.target.value = ''; });
$('#justDraw').addEventListener('click', () => { setMode('draw'); show('editor'); render(); });
$('#back').addEventListener('click', () => show('intro'));

// ---------- stage ----------
const stage = $('#stage'), sctx = stage.getContext('2d');
const ink = document.createElement('canvas'); ink.width = ink.height = C;
const ictx = ink.getContext('2d');

function sizeStage() {
  const wrap = stage.parentElement.getBoundingClientRect();
  const css = Math.floor(Math.min(wrap.width, wrap.height));
  stage.style.width = stage.style.height = css + 'px';
  const px = Math.round(css * Math.min(devicePixelRatio, 2.5));
  if (stage.width !== px) { stage.width = stage.height = px; }
  render();
}
addEventListener('resize', () => { if (!$('#editor').hidden) sizeStage(); });

function background(ctx) {
  const g = ctx.createLinearGradient(0, 0, C, C);
  g.addColorStop(0, '#14123a'); g.addColorStop(0.6, '#3b1d7a'); g.addColorStop(1, '#c026ff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, C, C);
}
function drawObject(ctx, o) {
  ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.r); ctx.scale(o.s, o.s);
  if (o.kind === 'photo') ctx.drawImage(o.img, -o.w / 2, -o.h / 2);
  else { ctx.font = '160px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(o.ch, 0, 8); }
  ctx.restore();
}
function compose(ctx) {
  background(ctx);
  for (const o of state.objects) drawObject(ctx, o);
  ctx.drawImage(ink, 0, 0);
}
function render() {
  const k = stage.width / C;
  sctx.setTransform(k, 0, 0, k, 0, 0);
  sctx.clearRect(0, 0, C, C);
  compose(sctx);
  // Dim everything outside your piece, then draw the glass rim.
  sctx.beginPath(); sctx.rect(0, 0, C, C); tracePieceInSquare(sctx, state.edges, C);
  sctx.fillStyle = 'rgba(0,0,0,0.82)'; sctx.fill('evenodd');
  sctx.beginPath(); tracePieceInSquare(sctx, state.edges, C);
  const rim = sctx.createLinearGradient(0, 0, C, C);
  rim.addColorStop(0, 'rgba(255,255,255,0.95)'); rim.addColorStop(0.5, 'rgba(255,255,255,0.4)'); rim.addColorStop(1, 'rgba(255,255,255,0.8)');
  sctx.lineWidth = 5; sctx.strokeStyle = rim; sctx.stroke();
}

// ---------- strokes ----------
function drawStroke(ctx, st, from = 0) {
  const p = st.pts;
  ctx.strokeStyle = st.color; ctx.fillStyle = st.color; ctx.lineWidth = st.width; ctx.lineCap = ctx.lineJoin = 'round';
  if (p.length === 1) { ctx.beginPath(); ctx.arc(p[0][0], p[0][1], st.width / 2, 0, 7); ctx.fill(); return; }
  ctx.beginPath();
  const s = Math.max(1, from);
  ctx.moveTo(...p[s - 1]);
  for (let i = s; i < p.length; i++) {           // smooth: curve through midpoints
    const [x0, y0] = p[i - 1], [x1, y1] = p[i];
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  ctx.lineTo(...p[p.length - 1]);
  ctx.stroke();
}
function redrawInk() { ictx.clearRect(0, 0, C, C); for (const st of state.strokes) drawStroke(ictx, st); }

// ---------- touch ----------
const pointers = new Map();
let gesture = null;
const toPiece = e => { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * C, (e.clientY - r.top) / r.height * C]; };

function hit(o, x, y) {
  const dx = x - o.x, dy = y - o.y, c = Math.cos(-o.r), s = Math.sin(-o.r);
  const lx = (dx * c - dy * s) / o.s, ly = (dx * s + dy * c) / o.s;
  const hw = o.kind === 'photo' ? o.w / 2 : 95, hh = o.kind === 'photo' ? o.h / 2 : 95;
  return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
}
function pick(x, y) {
  for (let i = state.objects.length - 1; i >= 0; i--) if (hit(state.objects[i], x, y)) return state.objects[i];
  return state.objects.find(o => o.kind === 'photo') || null;
}

stage.addEventListener('pointerdown', e => {
  stage.setPointerCapture(e.pointerId);
  const p = toPiece(e);
  pointers.set(e.pointerId, p);
  if (state.mode === 'draw') {
    if (pointers.size > 1) { if (gesture && gesture.stroke) { state.strokes.pop(); redrawInk(); render(); } gesture = null; return; }
    const st = { color: state.color, width: state.size * 2, pts: [p] };
    state.strokes.push(st); gesture = { stroke: st };
    drawStroke(ictx, st); render();
  } else {
    if (pointers.size === 1) gesture = { target: pick(...p) };
    if (gesture && gesture.target) gesture.start = snapshot(gesture.target);
  }
});
function snapshot(o) {
  const pts = [...pointers.values()];
  return { o: { x: o.x, y: o.y, s: o.s, r: o.r }, pts: pts.map(p => [...p]) };
}
stage.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId) || !gesture) return;
  const p = toPiece(e);
  pointers.set(e.pointerId, p);
  if (gesture.stroke) {
    const pts = gesture.stroke.pts, last = pts[pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 2) return;
    pts.push(p);
    drawStroke(ictx, gesture.stroke, pts.length - 2);
    render();
    return;
  }
  const t = gesture.target; if (!t) return;
  const now = [...pointers.values()], st = gesture.start;
  if (now.length === 1 && st.pts.length === 1) {
    t.x = st.o.x + now[0][0] - st.pts[0][0]; t.y = st.o.y + now[0][1] - st.pts[0][1];
  } else if (now.length >= 2 && st.pts.length >= 2) {
    const [a0, b0] = st.pts, [a1, b1] = now;
    const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]), d1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]);
    const ang0 = Math.atan2(b0[1] - a0[1], b0[0] - a0[0]), ang1 = Math.atan2(b1[1] - a1[1], b1[0] - a1[0]);
    const m0 = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2], m1 = [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2];
    const k = d1 / Math.max(d0, 1), dr = ang1 - ang0;
    // Scale and turn around the midpoint between the fingers.
    const vx = st.o.x - m0[0], vy = st.o.y - m0[1], c = Math.cos(dr), s = Math.sin(dr);
    t.x = m1[0] + (vx * c - vy * s) * k; t.y = m1[1] + (vx * s + vy * c) * k;
    t.s = Math.min(20, Math.max(0.05, st.o.s * k)); t.r = st.o.r + dr;
  }
  render();
});
function up(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (gesture && gesture.stroke) { state.history.push('stroke'); gesture = null; return; }
  // Restart the move with the fingers that are still down, so lifting one finger doesn't jump.
  if (gesture && gesture.target && pointers.size) gesture.start = snapshot(gesture.target);
  if (!pointers.size) gesture = null;
}
stage.addEventListener('pointerup', up);
stage.addEventListener('pointercancel', up);

// ---------- tools ----------
function setMode(m) {
  state.mode = m;
  for (const b of document.querySelectorAll('.mode')) b.classList.toggle('on', b.dataset.mode === m);
  for (const p of document.querySelectorAll('.panel')) p.classList.toggle('on', p.dataset.panel === m);
  $('#tools').className = 'card tools ' + ({ move: 'blue', draw: 'amber', stickers: 'pink' })[m];
}
for (const b of document.querySelectorAll('.mode')) b.addEventListener('click', () => setMode(b.dataset.mode));

const colorsEl = $('#colors');
for (const c of COLORS) {
  const b = document.createElement('button'); b.className = 'color'; b.style.background = c; b.ariaLabel = 'colour ' + c;
  b.addEventListener('click', () => { state.color = c; for (const x of colorsEl.children) x.classList.toggle('on', x === b); });
  if (c === state.color) b.classList.add('on');
  colorsEl.append(b);
}
const sizesEl = $('#sizes');
for (const s of SIZES) {
  const b = document.createElement('button'); b.className = 'size'; b.ariaLabel = 'brush size ' + s;
  const i = document.createElement('i'); i.style.width = i.style.height = Math.max(5, s * 0.75) + 'px'; b.append(i);
  b.addEventListener('click', () => { state.size = s; for (const x of sizesEl.children) x.classList.toggle('on', x === b); });
  if (s === state.size) b.classList.add('on');
  sizesEl.append(b);
}
$('#undo').addEventListener('click', () => {
  const last = state.history.pop();
  if (last === 'stroke') { state.strokes.pop(); redrawInk(); }
  else if (last === 'sticker') { const i = state.objects.map(o => o.kind).lastIndexOf('sticker'); if (i >= 0) state.objects.splice(i, 1); }
  render();
});
const stickersEl = $('#stickers');
for (const ch of STICKERS) {
  const b = document.createElement('button'); b.textContent = ch;
  b.addEventListener('click', () => {
    state.objects.push({ kind: 'sticker', ch, x: C / 2 + (Math.random() - 0.5) * 200, y: C / 2 + (Math.random() - 0.5) * 200, s: 1, r: (Math.random() - 0.5) * 0.5 });
    state.history.push('sticker');
    setMode('move');                    // so it can be dragged, pinched and turned right away
    render();
    toast('Drag it into place, pinch to resize', 1800);
  });
  stickersEl.append(b);
}

// ---------- send ----------
function exportPiece() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const ctx = c.getContext('2d'); ctx.scale(512 / C, 512 / C);
  compose(ctx);
  return c;
}
$('#send').addEventListener('click', async () => {
  if (!state.objects.length && !state.strokes.length) return toast('Add a photo or draw something first');
  const btn = $('#send'); btn.disabled = true; document.body.classList.add('sending');
  const img = exportPiece();
  try {
    const r = await fetch('/api/pieces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: img.toDataURL('image/jpeg', 0.86) }) });
    const piece = await r.json();
    if (!r.ok) throw new Error(piece.error || 'Could not send');
    const c = $('#sentPiece'), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    drawGlassPiece(ctx, img, edgesForSlot(piece.slot), c.width);
    show('sent');
    if (navigator.vibrate) navigator.vibrate(30);
  } catch (e) {
    toast(e.message === 'Failed to fetch' ? 'No connection to the board. Try again.' : e.message);
  } finally { btn.disabled = false; document.body.classList.remove('sending'); }
});
$('#again').addEventListener('click', () => {
  state.objects = []; state.strokes = []; state.history = []; redrawInk();
  fetchSlot(); show('intro');
});

// ---------- start ----------
$('#question').textContent = CONFIG.question;
setMode('draw');
fetchSlot();
show('intro');
