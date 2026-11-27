// stories · the phone page. Pick a photo, say what it is about, send it: it flies into the house.
// With ?slot=N (the QR inside the house) the photo goes into that empty place.
import { CONFIG } from './config.js';
import { api } from './api.js';
import { TOPICS } from './topics.js';

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
let wantSlot = params.has('slot') && /^\d+$/.test(params.get('slot')) ? +params.get('slot') : null;
const state = { img: null, topic: null, panX: 0, panY: 0 };

let toastTimer = 0;
function toast(msg, ms = 2800) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms); }
function show(id) { for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id; }

// ---------- the puzzle piece (the same shape as in the house: tabs right and top, holes left and bottom) ----------
function piecePath(ctx, cx, cy, size) {
  const h = size / 2, t = size * 0.17;
  const edge = (ax, ay, bx, by, dir, first) => {
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), nx = (dy / len) * dir, ny = (-dx / len) * dir;
    const at = (f, o) => [cx + ax + dx * f + nx * o, cy - (ay + dy * f + ny * o)];
    if (first) ctx.moveTo(...at(0, 0));
    ctx.lineTo(...at(0.36, 0));
    ctx.bezierCurveTo(...at(0.44, t * 0.25), ...at(0.28, t), ...at(0.5, t));
    ctx.bezierCurveTo(...at(0.72, t), ...at(0.56, t * 0.25), ...at(0.64, 0));
    ctx.lineTo(...at(1, 0));
  };
  ctx.beginPath();
  edge(-h, -h, h, -h, 1, true); edge(h, -h, h, h, -1); edge(h, h, -h, h, -1); edge(-h, h, -h, -h, 1);
  ctx.closePath();
}
// the photo, cropped square (it is what the house shows)
function square(size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), img = state.img;
  if (!img) return c;
  const k = Math.max(size / img.width, size / img.height), w = img.width * k, h = img.height * k;
  const mx = (w - size) / 2, my = (h - size) / 2;
  x.drawImage(img, -mx + clampPan(state.panX * size, mx), -my + clampPan(state.panY * size, my), w, h);
  return c;
}
const clampPan = (v, m) => Math.max(-m, Math.min(m, v));
function drawPiece(canvas, t = performance.now() / 1000) {
  const ctx = canvas.getContext('2d'), S = canvas.width, size = S * 0.62, cx = S / 2, cy = S / 2;
  ctx.clearRect(0, 0, S, S);
  const g = ctx.createLinearGradient(0, 0, S, S), sh = (Math.sin(t * 0.5) + 1) * 0.1;
  g.addColorStop(0, '#ff9a62'); g.addColorStop(0.35 + sh, '#ff5c9a'); g.addColorStop(0.7 + sh * 0.5, '#a77bff'); g.addColorStop(1, '#6f9bff');
  ctx.save(); ctx.shadowColor = 'rgba(255, 120, 170, 0.55)'; ctx.shadowBlur = S * 0.08;
  piecePath(ctx, cx, cy, size);
  if (state.img) {
    ctx.fillStyle = '#000'; ctx.fill(); ctx.shadowBlur = 0; ctx.clip();
    const big = size * 1.4, sq = square(Math.round(big));   // a little wider, so it fills the tabs too
    ctx.drawImage(sq, cx - big / 2, cy - big / 2, big, big);
    const film = ctx.createLinearGradient(cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2);   // a breath of glass on top
    film.addColorStop(0, 'rgba(255,170,120,0.12)'); film.addColorStop(0.5, 'rgba(255,255,255,0)'); film.addColorStop(1, 'rgba(167,123,255,0.14)');
    ctx.fillStyle = film; ctx.fillRect(0, 0, S, S);
  } else {
    ctx.fillStyle = 'rgba(255, 190, 215, 0.07)'; ctx.fill();
  }
  ctx.restore();
  piecePath(ctx, cx, cy, size);
  ctx.lineWidth = S * (state.img ? 0.008 : 0.006); ctx.strokeStyle = g; ctx.globalAlpha = state.img ? 0.9 : 0.75; ctx.stroke(); ctx.globalAlpha = 1;
}
const piece = $('#piece');
(function loop() { drawPiece(piece); if (!$('#sent').hidden) drawPiece($('#sentPiece')); requestAnimationFrame(loop); })();

// drag the photo inside the piece to choose what shows
let drag = null;
piece.addEventListener('pointerdown', e => { if (!state.img) return; drag = { x: e.clientX, y: e.clientY }; piece.setPointerCapture(e.pointerId); });
piece.addEventListener('pointermove', e => {
  if (!drag) return;
  const px = piece.getBoundingClientRect().width * 0.62;   // the piece on screen, in CSS pixels
  state.panX += (e.clientX - drag.x) / px; state.panY += (e.clientY - drag.y) / px; drag = { x: e.clientX, y: e.clientY };
  const img = state.img, s = Math.max(1 / img.width, 1 / img.height);
  state.panX = clampPan(state.panX, (img.width * s - 1) / 2); state.panY = clampPan(state.panY, (img.height * s - 1) / 2);
});
addEventListener('pointerup', () => { drag = null; });

// ---------- photo ----------
function loadPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));   // shrink big phone photos right away
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
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
    state.img = await loadPhoto(file); state.panX = state.panY = 0;
    $('#chooseBtn').hidden = true; $('#send').hidden = false; $('#changeBtn').hidden = false; $('#topics').hidden = false;
    $('#hint').textContent = 'Drag the photo to choose what shows';
  } catch (e) { toast(e.message); }
}
for (const id of ['#photoIn', '#photoIn2']) $(id).addEventListener('change', e => { setPhoto(e.target.files[0]); e.target.value = ''; });

// ---------- topic ----------
for (const t of TOPICS) {
  const b = document.createElement('button'); b.className = 'chip'; b.style.setProperty('--c', t.color);
  b.innerHTML = `<i></i>${t.label}`;
  b.addEventListener('click', () => { state.topic = state.topic === t.id ? null : t.id; for (const c of document.querySelectorAll('.chip')) c.classList.toggle('on', c === b && state.topic === t.id); });
  $('#chips').append(b);
}

// ---------- send ----------
$('#send').addEventListener('click', async () => {
  if (!state.img) return;
  if (!state.topic) return toast('Pick what it is about first');
  const btn = $('#send'); btn.disabled = true; document.body.classList.add('sending');
  try {
    await api.upload(square(512).toDataURL('image/jpeg', 0.86), { topic: state.topic, slot: wantSlot });
    show('sent'); if (navigator.vibrate) navigator.vibrate(30);
    const sp = $('#sentPiece'); sp.classList.remove('fly'); void sp.offsetWidth; sp.classList.add('fly');
  } catch (e) {
    toast(e.message === 'Failed to fetch' ? 'No connection to the house. Try again.' : e.message);
  } finally { btn.disabled = false; document.body.classList.remove('sending'); }
});
$('#again').addEventListener('click', () => {
  state.img = null; state.topic = null;
  for (const c of document.querySelectorAll('.chip')) c.classList.remove('on');
  $('#chooseBtn').hidden = false; $('#send').hidden = true; $('#changeBtn').hidden = true; $('#topics').hidden = true;
  $('#hint').textContent = 'A photo of something that feels like home';
  if (wantSlot != null) { wantSlot = null; history.replaceState(null, '', location.pathname); $('#kicker').textContent = 'Piece of Home'; }
  show('pick'); count();
});

// ---------- start ----------
$('#question').textContent = CONFIG.question;
if (wantSlot != null) { $('#kicker').textContent = `You are filling place ${wantSlot + 1}`; }
async function count() {
  try { const n = await api.next(); const c = typeof n === 'number' ? n : 0; $('#count').textContent = c ? `${c} pieces in the house` : ''; } catch {}
}
count();
show('pick');
