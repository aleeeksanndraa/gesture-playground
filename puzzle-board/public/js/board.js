// The big board: every piece is a glass puzzle piece in one shared 3D scene (three.js).
// Two layouts: 'wall' (the pieces fit together into one growing puzzle) and 'sphere' (a floating
// 3D gallery). Turn it with the mouse or with hand gestures.
//
// Speed: all pieces share a few big textures (atlases), and every atlas is drawn in one call,
// so thousands of pieces stay smooth. The glass look (bevel, refraction, shine, rim) is computed
// in the shader from one small set of 16 puzzle shapes.
import * as THREE from './three.module.min.js';
import { CONFIG } from './config.js';
import { spiral, edgesForSlot, shapeIndex, edgesFromIndex, tracePieceInSquare, QUAD, ringCells } from './puzzle.js';
import { drawGlassPiece } from './glass2d.js';

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- three.js setup ----------
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 2000);
const world = new THREE.Group();
scene.add(world);
const handCanvas = $('#hands'), hctx = handCanvas.getContext('2d');

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  handCanvas.width = w * devicePixelRatio; handCanvas.height = h * devicePixelRatio;
}
addEventListener('resize', resize); resize();

// ---------- the 16 puzzle shapes ----------
// R = sharp outline (alpha), G = blurred outline (used as the height of the glass bevel).
const MS = 256;
function blurCells(src, W, cell, r, passes) {
  const a = Float32Array.from(src), b = new Float32Array(W * W);
  const n = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < W; y++) {                    // horizontal, clamped inside each cell
      for (let x = 0; x < W; x++) {
        const x0 = x - (x % cell), x1 = x0 + cell - 1;
        let s = 0;
        for (let k = -r; k <= r; k++) s += a[y * W + clamp(x + k, x0, x1)];
        b[y * W + x] = s / n;
      }
    }
    for (let y = 0; y < W; y++) {                    // vertical
      const y0 = y - (y % cell), y1 = y0 + cell - 1;
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += b[clamp(y + k, y0, y1) * W + x];
        a[y * W + x] = s / n;
      }
    }
  }
  return a;
}
function buildMasks() {
  const W = MS * 4;
  const c = document.createElement('canvas'); c.width = c.height = W;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, W);
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 16; i++) {
    ctx.beginPath(); tracePieceInSquare(ctx, edgesFromIndex(i), MS, (i % 4) * MS, Math.floor(i / 4) * MS); ctx.fill();
  }
  const img = ctx.getImageData(0, 0, W, W), d = img.data;
  const sharp = new Float32Array(W * W);
  for (let i = 0; i < W * W; i++) sharp[i] = d[i * 4] / 255;
  const soft = blurCells(sharp, W, MS, 6, 3);
  for (let i = 0; i < W * W; i++) { d[i * 4 + 1] = soft[i] * 255; d[i * 4 + 2] = 0; d[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = false; t.anisotropy = 4;
  return t;
}
const maskTex = buildMasks();

// ---------- glass shader ----------
const VERT = /* glsl */`
attribute vec3 aWall; attribute vec3 aSphA; attribute vec3 aSphB;
attribute float aCell; attribute float aShape; attribute float aBirth;
uniform float uMix, uSphT, uTime, uGap;
varying vec2 vUv; varying float vCell, vShape, vGlow, vFade;
varying vec3 vT, vB, vN, vWorld;
void main() {
  vUv = vec2(uv.x, 1.0 - uv.y);
  vCell = aCell; vShape = aShape;
  float age = uTime - aBirth;
  float k = clamp(age / 1.1, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - k, 3.0);
  float pop = mix(2.2, 1.0, e);          // a new piece arrives big and settles into place
  float lift = (1.0 - e) * 2.5;          // ...coming from in front of the board
  vGlow = age >= 0.0 ? exp(-age * 0.35) : 0.0;
  vFade = smoothstep(0.0, 0.3, k);

  vec3 local = position * uGap * pop;
  vec3 sph = mix(aSphA, aSphB, uSphT);
  vec3 n = normalize(sph);
  vec3 up = abs(n.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 t = normalize(cross(up, n));
  vec3 b = cross(n, t);
  vec3 pW = aWall + vec3(local.xy, lift);
  vec3 pS = sph + t * local.x + b * local.y + n * lift;
  vec3 p = mix(pW, pS, uMix);
  vec3 T = normalize(mix(vec3(1.0, 0.0, 0.0), t, uMix));
  vec3 B = normalize(mix(vec3(0.0, 1.0, 0.0), b, uMix));
  vec3 N = normalize(mix(vec3(0.0, 0.0, 1.0), n, uMix));
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  mat3 m = mat3(modelMatrix);
  vT = m * T; vB = m * B; vN = m * N;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */`
uniform sampler2D uAtlas; uniform sampler2D uMasks;
uniform float uCells, uEmpty, uMix;
uniform vec3 uLight;
varying vec2 vUv; varying float vCell, vShape, vGlow, vFade;
varying vec3 vT, vB, vN, vWorld;
vec2 cellUv(float idx, vec2 uv, float n) {
  idx = floor(idx + 0.5);                // varyings arrive as 2.9999 sometimes; snap to the cell
  float row = floor((idx + 0.5) / n);
  return (vec2(idx - row * n, row) + uv) / n;
}
float H(vec2 uv) { return smoothstep(0.5, 1.0, texture2D(uMasks, uv).g); }
void main() {
  vec2 muv = cellUv(vShape, vUv, 4.0);
  float a = texture2D(uMasks, muv).r;
  if (a < 0.03 || vFade < 0.01) discard;

  // Bevel normal from the height of the blurred outline.
  float e = 1.6 / 1024.0;
  float h = H(muv);
  float hx = H(muv + vec2(e, 0.0)) - H(muv - vec2(e, 0.0));
  float hy = H(muv + vec2(0.0, e)) - H(muv - vec2(0.0, e));
  vec3 nT = normalize(vec3(-hx * 5.0, hy * 5.0, 1.0));
  vec3 Nw = normalize(vT * nT.x + vB * nT.y + vN * nT.z);
  if (!gl_FrontFacing) Nw = -Nw;
  vec3 V = normalize(cameraPosition - vWorld);
  float rim = 1.0 - h;                   // 1 at the edge, 0 in the flat middle

  vec3 col;
  if (uEmpty > 0.5) {
    col = vec3(0.80, 0.86, 1.0) * 0.45;
  } else {
    // Refraction: the picture bends a little under the curved glass edge.
    vec2 off = vec2(nT.x, -nT.y) * 0.07 * rim;
    vec2 iuv = clamp(vUv - off, 0.004, 0.996);
    col = texture2D(uAtlas, cellUv(vCell, iuv, uCells)).rgb;
    col = mix(col, vec3(1.0), rim * 0.3);    // frosted thick edge
  }
  vec3 L = normalize(uLight);
  float spec = pow(max(dot(reflect(-L, Nw), V), 0.0), 60.0);
  vec3 L2 = normalize(vec3(0.7, -0.5, 0.6));
  float spec2 = pow(max(dot(reflect(-L2, Nw), V), 0.0), 20.0) * 0.22;
  float fres = pow(clamp(1.0 - abs(dot(Nw, V)), 0.0, 1.0), 3.0);
  float sheen = (1.0 - smoothstep(0.0, 0.6, (vUv.x + vUv.y) * 0.5)) * 0.16;
  float line = (1.0 - smoothstep(0.0, 0.25, h)) * smoothstep(0.03, 0.5, a);
  col = col * (0.9 + 0.1 * dot(Nw, L));
  col += vec3(1.0) * (spec * 1.2 + spec2 + fres * 0.3 + sheen + line * 0.3);
  col += vec3(1.0, 0.9, 0.7) * vGlow * (0.18 + rim * 0.8);
  if (!gl_FrontFacing) col *= 0.42;

  float alpha = a * vFade;
  if (uEmpty > 0.5) alpha *= (0.10 + rim * 0.45 + spec * 0.6) * (1.0 - uMix);
  else alpha *= mix(0.97, 0.82, rim);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}`;

const sharedUniforms = {
  uMix: { value: CONFIG.startLayout === 'sphere' ? 1 : 0 },
  uSphT: { value: 1 },
  uTime: { value: 0 },
  uGap: { value: 0.985 },
  uMasks: { value: maskTex },
  uLight: { value: new THREE.Vector3(-0.45, 0.65, 0.75) },
};
function makeMaterial(atlas, cells, empty) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { ...sharedUniforms, uAtlas: { value: atlas }, uCells: { value: cells }, uEmpty: { value: empty ? 1 : 0 } },
    transparent: true, depthWrite: !empty, side: THREE.DoubleSide,
  });
}

// ---------- instanced layers ----------
const ATTRS = { aWall: 3, aSphA: 3, aSphB: 3, aCell: 1, aShape: 1, aBirth: 1 };
class Layer {
  constructor(material, capacity, renderOrder = 0) {
    const plane = new THREE.PlaneGeometry(QUAD, QUAD);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute('position', plane.attributes.position);
    g.setAttribute('uv', plane.attributes.uv);
    this.a = {};
    for (const [k, n] of Object.entries(ATTRS)) {
      const arr = new Float32Array(capacity * n);
      if (k === 'aBirth') arr.fill(1e9);                 // not there yet = invisible
      const at = new THREE.InstancedBufferAttribute(arr, n);
      at.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(k, at); this.a[k] = at;
    }
    g.instanceCount = 0;
    this.capacity = capacity; this.geometry = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    world.add(this.mesh);
  }
  set(i, key, ...v) { const at = this.a[key]; for (let k = 0; k < v.length; k++) at.array[i * at.itemSize + k] = v[k]; at.needsUpdate = true; }
  get(i, key) { const at = this.a[key]; return Array.from(at.array.subarray(i * at.itemSize, (i + 1) * at.itemSize)); }
  dispose() { world.remove(this.mesh); this.geometry.dispose(); }
}

// Picture atlases: one 2048px texture holds many pieces.
const ATLAS = 2048;
const PT = CONFIG.pieceTexture;
const PER_ROW = ATLAS / PT, PER_PAGE = PER_ROW * PER_ROW;
const pages = [];
function page(k) {
  while (pages.length <= k) {
    const c = document.createElement('canvas'); c.width = c.height = ATLAS;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1b1f3a'; ctx.fillRect(0, 0, ATLAS, ATLAS);
    const tex = new THREE.CanvasTexture(c);
    tex.flipY = false; tex.anisotropy = 4;
    const layer = new Layer(makeMaterial(tex, PER_ROW, false), PER_PAGE, 1);
    pages.push({ c, ctx, tex, layer });
  }
  return pages[k];
}

// Empty slots around the puzzle, so you can see where the next pieces will go.
let empties = new Layer(makeMaterial(null, 1, true), 512, 2);

// ---------- pieces ----------
const bySlot = new Map();   // slot → piece
let maxSlot = -1;
const dirty = { sphere: true, empties: true };

function addPiece(p, img, birth) {
  let slot = p.slot;
  if (bySlot.has(slot)) slot = maxSlot + 1;          // only happens next to local demo pieces
  const pg = page(Math.floor(slot / PER_PAGE)), cell = slot % PER_PAGE;
  pg.ctx.drawImage(img, (cell % PER_ROW) * PT, Math.floor(cell / PER_ROW) * PT, PT, PT);
  pg.tex.needsUpdate = true;
  const { x, y } = spiral(slot);
  const L = pg.layer;
  L.set(cell, 'aWall', x, -y, 0);
  L.set(cell, 'aCell', cell);
  L.set(cell, 'aShape', shapeIndex(edgesForSlot(slot)));
  L.set(cell, 'aBirth', birth);
  L.geometry.instanceCount = Math.max(L.geometry.instanceCount, cell + 1);
  bySlot.set(slot, { ...p, slot, cell, page: pg, fresh: true });
  maxSlot = Math.max(maxSlot, slot);
  dirty.sphere = dirty.empties = true;
  $('#count').textContent = bySlot.size;
}

function sphereRadius(n) { return Math.max(2.4, 0.5 * Math.sqrt(n)); }
let sphT = { from: 0, start: 0 };
function updateSphere(now) {
  const N = maxSlot + 1, R = sphereRadius(N), t = sharedUniforms.uSphT.value;
  for (const pc of bySlot.values()) {
    const L = pc.page.layer, i = pc.cell;
    const j = N - 1 - pc.slot;                        // newest piece faces the front
    const z = 1 - 2 * (j + 0.5) / N, r = Math.sqrt(Math.max(0, 1 - z * z)), th = j * 2.399963;
    const B = [R * r * Math.cos(th), R * r * Math.sin(th), R * z];
    if (pc.fresh) { L.set(i, 'aSphA', ...B); pc.fresh = false; }
    else {                                            // start the move from where it is now
      const a = L.get(i, 'aSphA'), b = L.get(i, 'aSphB');
      L.set(i, 'aSphA', a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
    }
    L.set(i, 'aSphB', ...B);
  }
  sharedUniforms.uSphT.value = 0; sphT.start = now;
}
function updateEmpties() {
  const N = maxSlot + 1;
  let total = ringCells(N + 1);
  if (total - N < 6) total = ringCells(total + 1);
  const need = total - N;
  if (need > empties.capacity) { const m = empties.mesh.material; empties.dispose(); empties = new Layer(m, need * 2, 2); }
  for (let i = 0; i < need; i++) {
    const slot = N + i, { x, y } = spiral(slot);
    empties.set(i, 'aWall', x, -y, 0);
    empties.set(i, 'aShape', shapeIndex(edgesForSlot(slot)));
    empties.set(i, 'aBirth', -1000);
    empties.set(i, 'aSphA', 0, 0, 1); empties.set(i, 'aSphB', 0, 0, 1);
  }
  empties.geometry.instanceCount = need;
}

const loadImage = url => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });

// ---------- new piece moment ----------
const queue = [];
let revealing = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function onNewPiece(p) {
  if ([...bySlot.values()].some(x => x.id === p.id && !x.demo)) return;
  try { queue.push({ p, img: await loadImage(p.url) }); } catch { return; }
  if (revealing) return;
  revealing = true;
  while (queue.length) {
    const { p, img } = queue.shift();
    if (queue.length >= 3 || CONFIG.showNewSeconds <= 0) { addPiece(p, img, clock()); continue; }
    const el = $('#newpiece'), cv = el.querySelector('canvas');
    const size = Math.round(Math.min(innerWidth, innerHeight) * 0.6 * devicePixelRatio);
    cv.width = cv.height = size;
    const cx = cv.getContext('2d'); cx.clearRect(0, 0, size, size);
    drawGlassPiece(cx, img, edgesForSlot(p.slot), size);
    el.className = 'newpiece show';
    lastInteract = performance.now();
    await sleep(CONFIG.showNewSeconds * 1000);
    el.className = 'newpiece show fly';
    addPiece(p, img, clock());
    await sleep(800);
    el.className = 'newpiece';
  }
  revealing = false;
}

async function loadAll() {
  let list = [];
  try { list = await (await fetch('/api/pieces')).json(); } catch { return; }
  const todo = list.filter(p => ![...bySlot.values()].some(x => x.id === p.id && !x.demo));
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const p = todo[next++];
      try { addPiece(p, await loadImage(p.url), -1000); } catch {}
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

// ---------- live connection ----------
let opened = false;
function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('piece', e => onNewPiece(JSON.parse(e.data)));
  es.addEventListener('info', e => setPhoneUrl(JSON.parse(e.data).phoneUrl));
  es.onopen = () => { if (opened) loadAll(); opened = true; $('#offline').hidden = true; };
  es.onerror = () => { $('#offline').hidden = false; };
}
function setPhoneUrl(url) {
  $('#url').textContent = url.replace(/^https?:\/\//, '');
  $('#qr').src = '/api/qr.svg?u=' + encodeURIComponent(url);
}

// ---------- view: rotation, zoom, layout ----------
const view = {
  layout: CONFIG.startLayout === 'sphere' ? 'sphere' : 'wall',
  yaw: 0, pitch: 0, vyaw: 0, vpitch: 0, zoom: 1, pan: { x: 0, y: 0 }, dist: 10,
  lastSwitch: performance.now(),
};
let lastInteract = -1e9;
const t0 = performance.now();
const clock = () => (performance.now() - t0) / 1000;
function toggleLayout() {
  view.layout = view.layout === 'wall' ? 'sphere' : 'wall';
  view.lastSwitch = performance.now();
  view.pan = { x: 0, y: 0 }; view.zoom = 1;
  if (view.layout === 'wall') { view.yaw = wrapAngle(view.yaw); }
  $('#layout').textContent = view.layout === 'wall' ? 'puzzle wall' : 'sphere';
}
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const touch = () => { lastInteract = performance.now(); };

function frame(nowMs) {
  const dt = Math.min(0.05, (nowMs - (frame.last || nowMs)) / 1000); frame.last = nowMs;
  const time = clock();
  if (dirty.sphere) { updateSphere(nowMs); dirty.sphere = false; }
  if (dirty.empties) { updateEmpties(); dirty.empties = false; }
  sharedUniforms.uSphT.value = clamp((nowMs - sphT.start) / 1200, 0, 1);
  sharedUniforms.uTime.value = time;

  const mixT = view.layout === 'sphere' ? 1 : 0;
  const mix = sharedUniforms.uMix.value += (mixT - sharedUniforms.uMix.value) * (1 - Math.exp(-dt * 2.2));

  const idle = nowMs - lastInteract > CONFIG.idleSeconds * 1000;
  if (idle) {
    if (view.layout === 'sphere') { view.yaw += dt * 0.12; view.pitch += (Math.sin(time * 0.13) * 0.25 - view.pitch) * dt * 0.5; }
    else {
      view.yaw = wrapAngle(view.yaw);
      view.yaw += (Math.sin(time * 0.11) * 0.35 - view.yaw) * dt * 0.6;
      view.pitch += (Math.sin(time * 0.083) * 0.16 - view.pitch) * dt * 0.6;
      view.zoom += (1 - view.zoom) * dt * 0.3;
      view.pan.x += (0 - view.pan.x) * dt * 0.3; view.pan.y += (0 - view.pan.y) * dt * 0.3;
    }
    if (CONFIG.autoSwitchSeconds > 0 && nowMs - view.lastSwitch > CONFIG.autoSwitchSeconds * 1000) toggleLayout();
  } else {
    view.yaw += view.vyaw * dt; view.pitch += view.vpitch * dt;
    const damp = Math.exp(-dt * 2.2); view.vyaw *= damp; view.vpitch *= damp;
  }
  view.pitch = clamp(view.pitch, -1.25, 1.25);
  world.rotation.set(view.pitch, view.yaw, 0);

  // Fit the camera to the puzzle (wall) or the sphere, then apply zoom and pan.
  const N = maxSlot + 1, half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const side = Math.sqrt(ringCells(Math.max(1, N)));
  const fitH = (side / 2 + 0.9) / half, fitW = (side / 2 + 0.9) / (half * camera.aspect);
  const dWall = Math.max(fitH, fitW), dSph = sphereRadius(N) * 2.9 + 1.5;
  const target = (dWall + (dSph - dWall) * mix) * view.zoom;
  view.dist += (target - view.dist) * (1 - Math.exp(-dt * 3));
  const px = view.pan.x * (1 - mix), py = view.pan.y * (1 - mix);
  camera.position.set(px, py, view.dist);
  camera.lookAt(px, py, 0);

  renderer.render(scene, camera);
  drawHands(nowMs);
  if (debug) showDebug(dt);
  requestAnimationFrame(frame);
}

// ---------- mouse, touch and keyboard ----------
let drag = null;
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, t: performance.now(), pan: e.shiftKey || e.button === 2 }; canvas.setPointerCapture(e.pointerId); touch(); });
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y, now = performance.now(), dts = Math.max(0.008, (now - drag.t) / 1000);
  if (drag.pan) { const k = view.dist * 0.0013; view.pan.x -= dx * k; view.pan.y += dy * k; }
  else {
    view.yaw += dx * 0.005; view.pitch += dy * 0.005;
    view.vyaw = dx * 0.005 / dts; view.vpitch = dy * 0.005 / dts;
  }
  drag.x = e.clientX; drag.y = e.clientY; drag.t = now; touch();
});
const endDrag = () => { if (drag && performance.now() - drag.t > 80) { view.vyaw = 0; view.vpitch = 0; } drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => { e.preventDefault(); view.zoom = clamp(view.zoom * Math.exp(e.deltaY * 0.0012), 0.12, 3); touch(); }, { passive: false });

let debug = false;
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  else if (k === 'l' || k === ' ') { toggleLayout(); touch(); }
  else if (k === 'd') { debug = !debug; $('#debug').hidden = !debug; }
  else if (k === 'c') $('#cambubble').hidden = !$('#cambubble').hidden;
  else if (k === 'h') $('#help').hidden = !$('#help').hidden;
  else if (k === 'r') { view.yaw = view.pitch = view.vyaw = view.vpitch = 0; view.zoom = 1; view.pan = { x: 0, y: 0 }; }
  else if (k === 'x') addDemoPieces(e.shiftKey ? 500 : 60);
});

// ---------- hand gestures ----------
let tracks = [], handStats = null, prevPinch = new Map(), palm = null, palmCooldown = 0;
const M = 0.1;   // ignore the outer 10% of the camera frame so people can reach the edges
const toScreen = t => ({ x: clamp(((1 - t.x) - M) / (1 - 2 * M), 0, 1), y: clamp((t.y - M) / (1 - 2 * M), 0, 1) });

async function initHands() {
  if (!CONFIG.gestures) return;
  try {
    const { startHands, G } = await import('./hands.js');
    handStats = await startHands($('#cam'), (tr, now) => onHands(tr, now, G));
    $('#cambubble').hidden = false;
  } catch (err) {
    console.warn('Hand tracking off:', err);
    $('#help').classList.add('nohands');
  }
}

function onHands(tr, now, G) {
  tracks = tr.filter(t => !t.lost);
  if (tracks.length) touch();
  const pinching = tracks.filter(t => t.gesture === G.PINCH);
  const next = new Map(pinching.map(t => [t.id, { ...toScreen(t), t: now }]));

  if (pinching.length === 1) {
    const cur = next.get(pinching[0].id), prev = prevPinch.get(pinching[0].id);
    if (prev) {
      const dx = cur.x - prev.x, dy = cur.y - prev.y, dts = Math.max(0.01, (now - prev.t) / 1000);
      view.yaw += dx * 4; view.pitch += dy * 3;
      view.vyaw = view.vyaw * 0.5 + (dx * 4 / dts) * 0.5;
      view.vpitch = view.vpitch * 0.5 + (dy * 3 / dts) * 0.5;
    } else { view.vyaw = view.vpitch = 0; }
  } else if (pinching.length === 2) {
    const [a, b] = pinching.map(t => next.get(t.id));
    const [pa, pb] = pinching.map(t => prevPinch.get(t.id));
    if (pa && pb) {
      const d = Math.hypot(a.x - b.x, a.y - b.y), pd = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      if (d > 0.02 && pd > 0.02) view.zoom = clamp(view.zoom * (pd / d), 0.12, 3);
      const mx = (a.x + b.x - pa.x - pb.x) / 2, my = (a.y + b.y - pa.y - pb.y) / 2;
      const w = view.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 2;
      view.pan.x -= mx * w * camera.aspect; view.pan.y += my * w;
    }
    view.vyaw = view.vpitch = 0;
  }
  prevPinch = next;

  // Open hand held still → switch puzzle wall ↔ sphere.
  const open = pinching.length === 0 && tracks.find(t => t.gesture === G.OPEN);
  if (open && now > palmCooldown) {
    const p = toScreen(open);
    if (!palm || palm.id !== open.id || Math.hypot(p.x - palm.x, p.y - palm.y) > 0.08) palm = { id: open.id, x: p.x, y: p.y, start: now };
    palm.progress = (now - palm.start) / (CONFIG.palmHoldSeconds * 1000);
    if (palm.progress >= 1) { toggleLayout(); palm = null; palmCooldown = now + 2500; }
  } else palm = null;
  onHands.G = G;
}

function drawHands() {
  const W = handCanvas.width, H = handCanvas.height, dpr = devicePixelRatio;
  hctx.clearRect(0, 0, W, H);
  const G = onHands.G;
  if (!G) return;
  for (const t of tracks) {
    const p = toScreen(t), x = p.x * W, y = p.y * H;
    const pinch = t.gesture === G.PINCH;
    const r = (pinch ? 16 : 24) * dpr;
    hctx.beginPath(); hctx.arc(x, y, r, 0, Math.PI * 2);
    hctx.fillStyle = pinch ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.16)'; hctx.fill();
    hctx.lineWidth = 2 * dpr; hctx.strokeStyle = 'rgba(255,255,255,0.85)'; hctx.stroke();
    if (palm && palm.id === t.id) {
      hctx.beginPath(); hctx.arc(x, y, r + 10 * dpr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(palm.progress, 0, 1));
      hctx.lineWidth = 5 * dpr; hctx.strokeStyle = 'rgba(255,240,200,0.95)'; hctx.lineCap = 'round'; hctx.stroke();
    }
  }
}

// ---------- debug + demo ----------
let fps = 60;
function showDebug(dt) {
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  $('#debug').textContent = `${fps.toFixed(0)} fps · ${bySlot.size} pieces · ${pages.length} atlas · ${renderer.info.render.calls} draw calls`
    + (handStats ? ` · hands ${handStats.delegate} ${handStats.fps.toFixed(0)} fps` : ' · hands off');
}

// Local test pieces (not saved, gone on reload): X adds 60, Shift+X adds 500.
const DEMO_EMOJI = ['🏠', '🍜', '🌻', '🐈', '🎧', '🚲', '☕️', '📚', '🌧️', '🧸', '🪴', '🍕', '🎸', '🌙', '🧦', '🫖'];
function addDemoPieces(n) {
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas'); c.width = c.height = PT;
    const x = c.getContext('2d'), hue = Math.random() * 360;
    const g = x.createLinearGradient(0, 0, PT, PT);
    g.addColorStop(0, `hsl(${hue},70%,62%)`); g.addColorStop(1, `hsl(${(hue + 60) % 360},65%,40%)`);
    x.fillStyle = g; x.fillRect(0, 0, PT, PT);
    for (let k = 0; k < 5; k++) {
      x.beginPath(); x.arc(Math.random() * PT, Math.random() * PT, PT * (0.05 + Math.random() * 0.15), 0, 7);
      x.fillStyle = `hsla(${(hue + 180) % 360},80%,80%,0.35)`; x.fill();
    }
    x.font = `${PT * 0.42}px serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(DEMO_EMOJI[(Math.random() * DEMO_EMOJI.length) | 0], PT / 2, PT / 2);
    addPiece({ id: `demo${maxSlot + 1}`, slot: maxSlot + 1, demo: true }, c, clock() + i * 0.01);
  }
  touch();
}

// ---------- start ----------
$('#question').textContent = CONFIG.question;
$('#hint').textContent = CONFIG.hint;
$('#layout').textContent = view.layout === 'wall' ? 'puzzle wall' : 'sphere';
fetch('/api/info').then(r => r.json()).then(i => setPhoneUrl(i.phoneUrl)).catch(() => {});
await loadAll();
connect();
requestAnimationFrame(frame);
initHands();

// For poking around in the browser console.
window.board = { view, pages, sharedUniforms, get empties() { return empties; }, addDemoPieces, toggleLayout };
