// stories: the house board. Every piece of home is a lit pane in the walls of an abstract,
// paper-lantern house. Grab to turn it, spread your hands to step inside, where the photos
// float around you, and point to pick a spot.
import * as THREE from './three.module.min.js';
import { CONFIG } from './config.js';

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ---------- renderer ----------
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.02, 400);
const handCanvas = $('#hands'), hctx = handCanvas.getContext('2d');
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  handCanvas.width = innerWidth * devicePixelRatio; handCanvas.height = innerHeight * devicePixelRatio;
}
addEventListener('resize', resize); resize();

// ---------- background: warm dark room, lit from the house ----------
function radialTexture(stops, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) g.addColorStop(p, col);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 512;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#120804'); g.addColorStop(0.55, '#2b150a'); g.addColorStop(1, '#170b05');
  x.fillStyle = g; x.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  scene.background = t;
}
const glowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);
const softTex = radialTexture([[0, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0)']]);
const additive = (map, color, opacity) => new THREE.SpriteMaterial({ map, color, opacity, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

const world = new THREE.Group(); scene.add(world);           // the house turns inside this group
const halo = new THREE.Sprite(additive(softTex, 0xff9a3d, 0.42)); scene.add(halo);
const floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: softTex, color: 0xff8a2a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
floorGlow.rotation.x = -Math.PI / 2; world.add(floorGlow);

// Light spilling out of the base, like the reference: thin warm rays on the floor.
const rays = new THREE.Group(); world.add(rays);
{
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.beginPath(); x.moveTo(26, 0); x.lineTo(38, 0); x.lineTo(64, 256); x.lineTo(0, 256); x.closePath(); x.fill();
  const tex = new THREE.CanvasTexture(c);
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, color: 0xffa040, transparent: true,
      opacity: 0.12 + hash(i) * 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.userData.a = i / 26 * Math.PI * 2 + hash(i + 9) * 0.2; m.userData.len = 1.2 + hash(i + 3) * 1.6;
    rays.add(m);
  }
}

// ---------- piece textures: a postage-stamp edge around a warm lit photo ----------
const PT = CONFIG.pieceTexture >= 256 ? 256 : 128;
const PAPERS = ['#fbf3e2', '#cff0d6', '#f9d0d8', '#fce1c4', '#fff0b8', '#e8dcff'];
function stampPath(x, s, m, n = 9, r = s * 0.028) {
  const a = m, b = s - m, step = (b - a) / n;
  x.beginPath(); x.moveTo(a, a);
  for (let i = 0; i < n; i++) { const c = a + step * (i + 0.5); x.lineTo(c - r, a); x.arc(c, a, r, Math.PI, 0, true); }
  x.lineTo(b, a);
  for (let i = 0; i < n; i++) { const c = a + step * (i + 0.5); x.lineTo(b, c - r); x.arc(b, c, r, -Math.PI / 2, Math.PI / 2, true); }
  x.lineTo(b, b);
  for (let i = 0; i < n; i++) { const c = b - step * (i + 0.5); x.lineTo(c + r, b); x.arc(c, b, r, 0, -Math.PI, true); }
  x.lineTo(a, b);
  for (let i = 0; i < n; i++) { const c = b - step * (i + 0.5); x.lineTo(a, c + r); x.arc(a, c, r, Math.PI / 2, -Math.PI / 2, true); }
  x.closePath();
}
function averageColor(img) {
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, 8, 8);
  const d = x.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const col = new THREE.Color(r / 64 / 255, g / 64 / 255, b / 64 / 255);
  const hsl = {}; col.getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, Math.max(0.55, hsl.s), 0.6);
}
function pieceCanvas(img, seed, size = PT) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), m = size * 0.04;
  stampPath(x, size, m); x.fillStyle = PAPERS[Math.floor(hash(seed) * PAPERS.length)]; x.fill();
  const i0 = size * 0.14, w = size - 2 * i0;
  x.save(); x.beginPath(); x.roundRect(i0, i0, w, w, size * 0.03); x.clip();
  const iw = img.width || img.videoWidth, ih = img.height || img.videoHeight, k = Math.max(w / iw, w / ih);
  x.drawImage(img, i0 + (w - iw * k) / 2, i0 + (w - ih * k) / 2, iw * k, ih * k);
  // warm light from behind the paper
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, w * 0.75);
  g.addColorStop(0, 'rgba(255,214,150,0.28)'); g.addColorStop(1, 'rgba(120,50,10,0.25)');
  x.fillStyle = g; x.fillRect(i0, i0, w, w);
  x.restore();
  return c;
}
const emptyTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  stampPath(x, 128, 5); x.fillStyle = 'rgba(255,205,150,0.16)'; x.fill();
  x.strokeStyle = 'rgba(255,215,170,0.22)'; x.lineWidth = 1.5; x.stroke();
  x.strokeStyle = 'rgba(255,225,185,0.45)'; x.lineWidth = 3; x.lineCap = 'round';
  x.beginPath(); x.moveTo(64, 54); x.lineTo(64, 74); x.moveTo(54, 64); x.lineTo(74, 64); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const outlineTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  stampPath(x, 256, 14, 9, 8); x.strokeStyle = '#fff'; x.lineWidth = 6; x.setLineDash([12, 8]); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();

// One shader for lit panes: shows the photo the right way round from outside and inside,
// with a slow candle flicker and a glow when picked.
const paneVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const paneFrag = `
uniform sampler2D map; uniform float uLit, uTime, uSeed, uHover, uOpacity, uExpo; uniform vec3 uTint;
varying vec2 vUv;
void main(){
  vec2 uv = vUv; if (!gl_FrontFacing) uv.x = 1.0 - uv.x;
  vec4 t = texture2D(map, uv);
  if (t.a < 0.5) discard;
  float f = 0.88 + 0.08*sin(uTime*6.3 + uSeed*17.0)*sin(uTime*2.7 + uSeed*5.0) + 0.04*sin(uTime*13.0 + uSeed*3.0);
  vec3 col = t.rgb * (0.35 + 0.85*uLit*f) * uExpo;
  col = mix(col, col*vec3(1.12,0.96,0.78), 0.4);
  float edge = smoothstep(0.5, 0.2, max(abs(uv.x-0.5), abs(uv.y-0.5)));
  col += uTint * uLit * f * 0.18 * edge + vec3(1.0,0.85,0.6) * uHover * 0.25;
  gl_FragColor = vec4(col, uOpacity);
  #include <colorspace_fragment>
}`;
const emptyMat = new THREE.MeshBasicMaterial({ map: emptyTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 1 });
const clock0 = performance.now();
const clock = () => (performance.now() - clock0) / 1000;
const timeU = { value: 0 }, expoU = { value: 1 };

// ---------- the house: slots on walls, gables and roof ----------
const PANE = 0.9;
let dims = null, slots = [], houseGroup = null, edges = null;
const pieces = new Map();   // slot -> piece { id, slot, tex, tint, lit, mesh, glow, float, born, demo }
function capacityOf([W, D, H]) { return buildSlots(W, D, H).length; }
function buildSlots(W, D, H) {
  const out = [], push = (wall, p, n, u, order) => out.push({ wall, pos: p, normal: n, up: u, order });
  const V = (x, y, z) => new THREE.Vector3(x, y, z), Y = V(0, 1, 0);
  const wallCells = (wall, cols, rows, at, normal, prio) => {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const u = c - cols / 2 + 0.5, v = r + 0.5;
      const d = Math.hypot(u, (v - rows * 0.45) * 1.15);
      push(wall, at(u, v), normal, Y, prio * 1000 + d);
    }
  };
  wallCells('Front wall', W, H, (u, v) => V(u, v, D / 2), V(0, 0, 1), 0);
  wallCells('Right wall', D, H, (u, v) => V(W / 2, v, -u), V(1, 0, 0), 1);
  wallCells('Left wall', D, H, (u, v) => V(-W / 2, v, u), V(-1, 0, 0), 1.5);
  wallCells('Back wall', W, H, (u, v) => V(-u, v, -D / 2), V(0, 0, -1), 2);
  for (const [side, zz] of [[1, D / 2], [-1, -D / 2]]) {          // gables: the triangle under the roof
    for (let r = 0; ; r++) {
      const n = 2 * Math.floor(W / 2 - r - 1); if (n <= 0) break;
      for (let c = 0; c < n; c++) { const u = c - n / 2 + 0.5; push(side > 0 ? 'Front gable' : 'Back gable', V(u * side, H + r + 0.5, zz), V(0, 0, side), Y, 3000 + r * 10 + Math.abs(u)); }
    }
  }
  const slope = W / 2 * Math.SQRT2, rows = Math.floor(slope);   // roof: two slopes at 45°
  for (const s of [1, -1]) {
    const nrm = V(s, 1, 0).normalize(), up = V(-s, 1, 0).normalize();
    for (let r = 0; r < rows; r++) for (let c = 0; c < D; c++) {
      const along = (r + 0.5) * (slope / rows), u = c - D / 2 + 0.5;
      const p = V(s * W / 2, H, u).addScaledVector(up, along);
      push(s > 0 ? 'Roof' : 'Roof', p, nrm, up, 4000 + r * 10 + Math.abs(u) + (s < 0 ? 0.5 : 0));
    }
  }
  out.sort((a, b) => a.order - b.order);
  return out;
}
const SIZES = [[5, 4, 3], [6, 5, 4], [7, 5, 5], [8, 6, 5], [9, 7, 6], [10, 8, 7], [12, 9, 8], [14, 11, 9]];
function pickDims(n) { return SIZES.find(s => capacityOf(s) >= n * 1.15 + 12) || SIZES[SIZES.length - 1]; }

function buildHouse(d) {
  dims = d; slots = buildSlots(...d);
  if (houseGroup) world.remove(houseGroup);
  houseGroup = new THREE.Group(); world.add(houseGroup);
  const [W, D, H] = d;
  // Glowing outline of the house shape: the only "drawn" part, like a lantern frame.
  const top = H + W / 2, pts = [];
  const corners = [[-W / 2, D / 2], [W / 2, D / 2], [W / 2, -D / 2], [-W / 2, -D / 2]];
  for (let i = 0; i < 4; i++) { const [x1, z1] = corners[i], [x2, z2] = corners[(i + 1) % 4]; pts.push(x1, 0, z1, x2, 0, z2, x1, H, z1, x2, H, z2, x1, 0, z1, x1, H, z1); }
  for (const z of [D / 2, -D / 2]) pts.push(-W / 2, H, z, 0, top, z, 0, top, z, W / 2, H, z);
  pts.push(0, top, D / 2, 0, top, -D / 2);
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0xffc56b, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  houseGroup.add(edges);
  // Inner light: a warm core you see through the paper.
  const core = new THREE.Sprite(additive(glowTex, 0xff9b45, 0.55)); core.position.set(0, H * 0.55, 0); core.scale.setScalar(Math.max(W, H) * 1.5);
  core.userData.core = true; houseGroup.add(core);
  // Empty panes for every slot; lit panes replace them.
  const geo = new THREE.PlaneGeometry(PANE, PANE);
  slots.forEach((s, i) => {
    const m = new THREE.Mesh(geo, emptyMat); orient(m, s); m.userData.slot = i; s.empty = m; houseGroup.add(m);
  });
  for (const p of pieces.values()) placePiece(p);
  floorGlow.scale.set(W * 3.2, D * 3.2, 1);
  rays.children.forEach(m => { const a = m.userData.a, r = Math.max(W, D) * 0.55, len = m.userData.len * Math.max(W, D) * 0.6;
    m.scale.set(len * 0.25, len, 1); m.position.set(Math.cos(a) * (r + len / 2), 0.01, Math.sin(a) * (r + len / 2)); m.rotation.z = -a + Math.PI / 2; });
}
function orient(m, s, lift = 0) {
  m.position.copy(s.pos).addScaledVector(s.normal, lift);
  const x = new THREE.Vector3().crossVectors(s.up, s.normal).normalize();
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, s.up, s.normal));
}

// ---------- pieces ----------
const paneGeo = new THREE.PlaneGeometry(PANE, PANE), floatGeo = new THREE.PlaneGeometry(1, 1);
const floating = new THREE.Group(); world.add(floating);
let maxSlot = -1;
function addPiece(info, img, born = clock()) {
  if (pieces.has(info.slot)) return;
  const tex = new THREE.CanvasTexture(pieceCanvas(img, info.slot));
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const tint = averageColor(img);
  const mat = new THREE.ShaderMaterial({ vertexShader: paneVert, fragmentShader: paneFrag, side: THREE.DoubleSide,
    uniforms: { map: { value: tex }, uLit: { value: born < 0 ? 1 : 0 }, uTime: timeU, uSeed: { value: hash(info.slot) },
      uHover: { value: 0 }, uOpacity: { value: 1 }, uTint: { value: tint }, uExpo: expoU } });
  const p = { ...info, tex, tint, mat, born, mesh: new THREE.Mesh(paneGeo, mat) };
  p.mesh.userData.slot = info.slot;
  p.glow = new THREE.Sprite(additive(glowTex, tint, 0)); p.glow.scale.setScalar(1.7);
  const fm = new THREE.ShaderMaterial({ vertexShader: paneVert, fragmentShader: paneFrag, side: THREE.DoubleSide, transparent: true,
    uniforms: { map: { value: tex }, uLit: { value: 1 }, uTime: timeU, uSeed: { value: hash(info.slot + 5) }, uHover: { value: 0 }, uOpacity: { value: 0 }, uTint: { value: tint }, uExpo: expoU } });
  p.float = new THREE.Mesh(floatGeo, fm);
  p.float.userData = { slot: info.slot, ph: hash(info.slot * 3.1) * 6.28, r: hash(info.slot * 1.7), h: hash(info.slot * 2.3), s: 0.42 + hash(info.slot * 4.1) * 0.28 };
  floating.add(p.float);
  pieces.set(info.slot, p);
  maxSlot = Math.max(maxSlot, info.slot);
  const need = pickDims(pieces.size);
  if (!dims || capacityOf(need) > capacityOf(dims)) buildHouse(need); else placePiece(p);
  $('#count').textContent = [...pieces.values()].filter(x => !x.demo).length + demoCount();
}
const demoCount = () => [...pieces.values()].filter(x => x.demo).length;
function placePiece(p) {
  const s = slots[p.slot % slots.length]; if (!s) return;
  houseGroup.add(p.mesh); houseGroup.add(p.glow);
  orient(p.mesh, s, 0.002);
  p.glow.position.copy(s.pos).addScaledVector(s.normal, 0.35);
  if (s.empty) s.empty.visible = false;
}
function loadImage(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}
async function loadAll() {
  let list = [];
  try { list = await (await fetch('/api/pieces')).json(); } catch { return; }
  const todo = list.filter(p => !pieces.has(p.slot));
  let next = 0;
  const worker = async () => { while (next < todo.length) { const p = todo[next++]; try { addPiece(p, await loadImage(p.url), -1); } catch {} } };
  await Promise.all(Array.from({ length: 6 }, worker));
}

// A new piece arrives as a spark from below and lights its pane.
const sparks = [];
async function onNewPiece(info) {
  try {
    const img = await loadImage(info.url);
    addPiece(info, img, clock() + 1.4);
    const p = pieces.get(info.slot), s = slots[info.slot % slots.length];
    const spark = new THREE.Sprite(additive(glowTex, 0xffd08a, 1)); spark.scale.setScalar(0.9);
    const from = new THREE.Vector3((hash(info.slot) - 0.5) * 6, -2, 6), to = s.pos.clone().addScaledVector(s.normal, 0.3);
    houseGroup.add(spark); sparks.push({ spark, from, to, t0: clock(), p });
    burstEmbers(to, 40);
    setCaption(`A new piece of home · ${s.wall}`, 6000);
  } catch {}
}

// ---------- embers: the fire part. Sparks drift up out of the house and fade. ----------
const EMBERS = 420;
const emberGeo = new THREE.BufferGeometry();
const ePos = new Float32Array(EMBERS * 3), eVel = new Float32Array(EMBERS * 3), eLife = new Float32Array(EMBERS), eSize = new Float32Array(EMBERS);
emberGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
emberGeo.setAttribute('aLife', new THREE.BufferAttribute(eLife, 1));
emberGeo.setAttribute('aSize', new THREE.BufferAttribute(eSize, 1));
const emberMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uScale: { value: 1 } },
  vertexShader: `attribute float aLife, aSize; varying float vLife; uniform float uScale;
    void main(){ vLife = aLife; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;
      gl_PointSize = aSize * uScale * (0.4 + 0.6*sin(3.1416*clamp(aLife,0.0,1.0))) / -mv.z; }`,
  fragmentShader: `varying float vLife; void main(){ vec2 d = gl_PointCoord-0.5; float r = length(d); if (r > 0.5) discard;
    float a = smoothstep(0.5, 0.0, r) * sin(3.1416*clamp(vLife,0.0,1.0));
    vec3 c = mix(vec3(1.0,0.35,0.08), vec3(1.0,0.85,0.45), clamp(vLife*1.3,0.0,1.0));
    gl_FragColor = vec4(c*a, a); }` });
const embers = new THREE.Points(emberGeo, emberMat); embers.frustumCulled = false; world.add(embers);
function spawnEmber(i, at) {
  const [W, D, H] = dims || [6, 5, 4];
  if (at) { ePos[i * 3] = at.x; ePos[i * 3 + 1] = at.y; ePos[i * 3 + 2] = at.z; }
  else { ePos[i * 3] = (Math.random() - 0.5) * W * 1.1; ePos[i * 3 + 1] = Math.random() * (H + W / 2) * 0.9; ePos[i * 3 + 2] = (Math.random() - 0.5) * D * 1.1; }
  eVel[i * 3] = (Math.random() - 0.5) * 0.25; eVel[i * 3 + 1] = 0.25 + Math.random() * 0.55; eVel[i * 3 + 2] = (Math.random() - 0.5) * 0.25;
  eLife[i] = 0; eSize[i] = 14 + Math.random() * 46;
}
for (let i = 0; i < EMBERS; i++) { spawnEmber(i); eLife[i] = Math.random(); }
let emberCursor = 0;
function burstEmbers(at, n) { for (let k = 0; k < n; k++) { const i = emberCursor++ % EMBERS; spawnEmber(i, at); eVel[i * 3] *= 4; eVel[i * 3 + 2] *= 4; eSize[i] *= 1.4; } }
function stepEmbers(dt, t) {
  for (let i = 0; i < EMBERS; i++) {
    eLife[i] += dt / (3.5 + (i % 7) * 0.6);
    if (eLife[i] >= 1) { spawnEmber(i); continue; }
    const k = i * 3;
    eVel[k] += Math.sin(t * 1.3 + i) * dt * 0.08; eVel[k + 2] += Math.cos(t * 1.1 + i * 0.7) * dt * 0.08;
    ePos[k] += eVel[k] * dt; ePos[k + 1] += eVel[k + 1] * dt; ePos[k + 2] += eVel[k + 2] * dt;
  }
  emberGeo.attributes.position.needsUpdate = true; emberGeo.attributes.aLife.needsUpdate = true; emberGeo.attributes.aSize.needsUpdate = true;
}

// ---------- view: outside orbit ⇄ inside the house ----------
const view = { yaw: -0.55, pitch: 0.18, inside: 0, insideT: 0, zoom: 1, vyaw: 0 };
const center = new THREE.Vector3();
function frameCamera(dt) {
  const [W, D, H] = dims || [6, 5, 4];
  view.inside += (view.insideT - view.inside) * (1 - Math.exp(-dt * 2.4));
  const e = view.inside, ease = e * e * (3 - 2 * e);
  center.set(0, (H + W / 2) * 0.45, 0);
  const fitH = (H + W / 2) * 0.5 + 1.2, fitW = Math.hypot(W, D) * 0.5 + 1.2;
  const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max(fitH / half, fitW / (half * camera.aspect)) * 1.22 * view.zoom;
  const pitch = lerp(view.pitch, view.pitch * 0.6, ease);
  const dir = new THREE.Vector3(Math.sin(view.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(view.yaw) * Math.cos(pitch));
  const eye = new THREE.Vector3(0, H * 0.42, 0);
  camera.position.copy(center).addScaledVector(dir, dist).lerp(eye.clone().addScaledVector(dir, 0.6), ease);
  const look = center.clone().lerp(eye.clone().addScaledVector(dir, -4), ease);
  camera.lookAt(look);
  camera.fov = lerp(42, 70, ease); camera.updateProjectionMatrix();
  emberMat.uniforms.uScale.value = innerHeight * renderer.getPixelRatio() / 900 * 6;
  halo.position.copy(center); halo.scale.setScalar(Math.max(W, H + W / 2) * 4.2);
  halo.material.opacity = 0.42 * (1 - ease * 0.6);
  const v = $('#view'); const ins = e > 0.5;
  if (v.classList.contains('inside') !== ins) { v.classList.toggle('inside', ins); v.textContent = ins ? 'Inside the house' : 'Outside view'; }
  return ease;
}

// ---------- frame loop ----------
const ray = new THREE.Raycaster();
let hover = null, lastFrame = performance.now();
const outline = new THREE.Mesh(new THREE.PlaneGeometry(PANE * 1.18, PANE * 1.18),
  new THREE.MeshBasicMaterial({ map: outlineTex, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
outline.renderOrder = 10; outline.visible = false; world.add(outline);
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
  const t = clock(); timeU.value = t;
  if (!dragging) { view.yaw += view.vyaw * dt; view.vyaw *= Math.exp(-dt * 2.5); }
  const ease = frameCamera(dt);
  // panes: light up after birth, flicker glow
  for (const p of pieces.values()) {
    const lit = clamp((t - p.born) / 1.2, 0, 1); p.mat.uniforms.uLit.value = lit;
    p.mat.uniforms.uHover.value += ((hover && hover.slot === p.slot ? 1 : 0) - p.mat.uniforms.uHover.value) * 0.2;
    p.glow.material.opacity = lit * (0.22 + 0.07 * Math.sin(t * 5 + p.slot)) * (1 - ease * 0.9);
    const f = p.float, u = f.userData, [W, D, H] = dims;
    const a = u.ph + t * (0.05 + u.r * 0.05);
    const ring = 0.55 + u.r * 0.35;   // keep the floating photos away from the camera in the middle
    f.position.set(Math.cos(a) * ring * (W / 2 - 0.4), 0.5 + u.h * (H - 0.8) + Math.sin(t * 0.6 + u.ph) * 0.15, Math.sin(a) * ring * (D / 2 - 0.4));
    f.scale.setScalar(u.s); f.lookAt(world.worldToLocal(camera.position.clone()));
    f.material.uniforms.uOpacity.value = clamp((ease - 0.35) / 0.5, 0, 1) * 0.95;
    f.material.uniforms.uHover.value = hover && hover.float === f ? 0.8 : 0;
    f.visible = f.material.uniforms.uOpacity.value > 0.01;
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i], k = clamp((t - s.t0) / 1.4, 0, 1), e = 1 - Math.pow(1 - k, 3);
    s.spark.position.lerpVectors(s.from, s.to, e); s.spark.position.y += Math.sin(k * Math.PI) * 2;
    s.spark.scale.setScalar(0.5 + Math.sin(k * Math.PI) * 0.8 + (k > 0.95 ? 2 : 0));
    if (k >= 1) { houseGroup.remove(s.spark); sparks.splice(i, 1); burstEmbers(s.to, 60); }
  }
  stepEmbers(dt, t);
  expoU.value = 1 - ease * 0.3; emptyMat.opacity = 1 - ease * 0.65;
  houseGroup && houseGroup.children.forEach(c => { if (c.userData.core) c.material.opacity = (0.5 + 0.06 * Math.sin(t * 2.3) + 0.04 * Math.sin(t * 7.1)) * (1 - ease * 0.92); });
  if (edges) edges.material.opacity = 0.45 + 0.1 * Math.sin(t * 1.7);
  world.rotation.y = 0;
  updateHover();
  renderer.render(scene, camera);
  drawHands(now);
  if (!$('#debug').hidden) $('#debug').textContent = `${pieces.size} pieces · house ${dims.join('×')} · ${slots.length} spots · ${renderer.info.render.calls} draws`;
  requestAnimationFrame(frame);
}

// ---------- picking a spot ----------
let pointerNdc = null, pointerSource = 'mouse', dwell = { key: null, t: 0 };
function updateHover() {
  if (!pointerNdc || !houseGroup) { setHover(null); return; }
  ray.setFromCamera(pointerNdc, camera);
  const targets = [];
  for (const p of pieces.values()) { targets.push(p.mesh); if (p.float.visible) targets.push(p.float); }
  for (const s of slots) if (s.empty && s.empty.visible) targets.push(s.empty);
  const hit = ray.intersectObjects(targets, false)[0];
  if (!hit) { setHover(null); return; }
  const slot = hit.object.userData.slot;
  setHover({ slot, float: hit.object === pieces.get(slot)?.float ? hit.object : null, piece: pieces.get(slot) || null });
}
function setHover(h) {
  const key = h ? (h.float ? 'f' : 's') + h.slot : null;
  if (key !== (hover && hover.key)) { hover = h ? { ...h, key } : null; dwell = { key, t: performance.now() }; }
  if (!hover) { outline.visible = false; $('#qrbox').classList.remove('call'); if (!captionHold) setCaption(''); return; }
  const s = slots[hover.slot % slots.length];
  outline.visible = !hover.float;
  if (s) orient(outline, s, 0.02);
  if (hover.piece) setCaption(`Piece ${hover.slot + 1} · ${s ? s.wall : 'floating'} · ${hover.piece.demo ? 'test piece' : timeAgo(hover.piece.t)}`);
  else setCaption(`Empty spot · ${s.wall} · scan the code to add yours`);
  $('#qrbox').classList.toggle('call', !hover.piece);
  // pointing at a piece for a moment opens it big
  if (pointerSource === 'hand' && hover.piece && performance.now() - dwell.t > 900 && $('#focus').hidden) openFocus(hover.piece);
}
function timeAgo(t) {
  if (!t) return 'added by a visitor';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'added just now' : m < 60 ? `added ${m} min ago` : m < 1440 ? `added ${Math.round(m / 60)} h ago` : `added ${Math.round(m / 1440)} days ago`;
}
let captionHold = 0, captionTimer = 0;
function setCaption(s, holdMs = 0) {
  if (holdMs) { captionHold = 1; clearTimeout(captionTimer); captionTimer = setTimeout(() => { captionHold = 0; setCaption(''); }, holdMs); }
  else if (captionHold) return;
  const el = $('#caption'); if (el.textContent !== s) el.textContent = s;
}
function openFocus(p) {
  const c = $('#focus canvas'), x = c.getContext('2d');
  x.clearRect(0, 0, 512, 512); x.drawImage(p.tex.image, 0, 0, 512, 512);
  $('#focusText').textContent = `Piece ${p.slot + 1} · ${slots[p.slot % slots.length]?.wall || ''}`;
  $('#focus').hidden = false;
  clearTimeout(openFocus.t); openFocus.t = setTimeout(closeFocus, 6000);
}
function closeFocus() { $('#focus').hidden = true; }
$('#focus').addEventListener('click', closeFocus);

// ---------- mouse ----------
let dragging = false, drag = null;
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; dragging = true; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  pointerSource = 'mouse';
  pointerNdc = new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
  turn(dx / innerWidth * 4, dy / innerHeight * 2.4);
  view.vyaw = dx / innerWidth * 4 * 30;
});
canvas.addEventListener('pointerup', () => { if (drag && drag.moved < 6 && hover && hover.piece) openFocus(hover.piece); drag = null; dragging = false; });
canvas.addEventListener('pointerleave', () => { pointerNdc = null; });
canvas.addEventListener('wheel', e => { e.preventDefault();
  if (view.insideT > 0.5) { if (e.deltaY > 0) view.insideT = 0; }
  else { view.zoom = clamp(view.zoom * Math.exp(e.deltaY * 0.0012), 0.45, 1.8); if (view.zoom < 0.5 && e.deltaY < 0) { view.insideT = 1; view.zoom = 1; } }
}, { passive: false });
canvas.addEventListener('dblclick', () => { view.insideT = view.insideT > 0.5 ? 0 : 1; });
function turn(dyaw, dpitch) {
  view.yaw -= dyaw;
  view.pitch = clamp(view.pitch + dpitch * (view.inside > 0.5 ? -1 : 1), -0.35, 1.0);
}
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  else if (k === 'i' || k === ' ') { e.preventDefault(); view.insideT = view.insideT > 0.5 ? 0 : 1; }
  else if (k === 'r') { view.yaw = -0.55; view.pitch = 0.18; view.zoom = 1; view.insideT = 0; }
  else if (k === 'd') $('#debug').hidden = !$('#debug').hidden;
  else if (k === 'c') $('#cambubble').hidden = !$('#cambubble').hidden;
  else if (k === 'h') $('#guide').hidden = !$('#guide').hidden;
  else if (k === 'x') addDemoPieces(e.shiftKey ? 200 : 40);
  else if (k === 'escape') closeFocus();
});

// ---------- hands ----------
// ✊ grab and move: turn the house (inside: look around).
// 🙌 two hands: move them apart to step in, together to step out.
// ☝️ point: a spot lights up under your finger. Hold on a piece to open it.
let tracks = [], prev = new Map(), active = null, hint = '', handStats = null, stepStart = null;
const M = 0.1;
const toScreen = t => ({ x: clamp(((1 - t.x) - M) / (1 - 2 * M), 0, 1), y: clamp((t.y - M) / (1 - 2 * M), 0, 1) });
async function initHands() {
  if (!CONFIG.gestures) { $('#guide').classList.add('nohands'); return; }
  try {
    const { startHands, G } = await import('./hands.js');
    handStats = await startHands($('#cam'), (tr, now) => onHands(tr, now, G));
    $('#cambubble').hidden = false;
  } catch (err) { console.warn('Hand tracking off:', err); }
}
function onHands(tr, now, G) {
  onHands.G = G;
  tracks = tr.filter(t => !t.lost);
  const next = new Map(tracks.map(t => [t.id, { ...toScreen(t), t: now }]));
  const isFist = t => t.gesture === G.FIST || t.gesture === G.PINCH || t.gesture === G.THUMBS;
  const isPoint = t => t.gesture === G.POINT;
  let mode = null; hint = '';
  const two = tracks.slice(0, 2);
  if (two.length === 2 && !two.some(isPoint)) {
    mode = 'step';
    const [a, b] = two.map(t => next.get(t.id)), d = Math.hypot(a.x - b.x, a.y - b.y);
    if (!stepStart) stepStart = { d, inside: view.insideT };
    const ch = (d - stepStart.d) / 0.25;
    if (ch > 1 && view.insideT < 0.5) { view.insideT = 1; stepStart = { d, inside: 1 }; }
    else if (ch < -1 && view.insideT > 0.5) { view.insideT = 0; stepStart = { d, inside: 0 }; }
    hint = view.insideT > 0.5 ? 'bring hands together to step out' : 'move hands apart to step in';
  } else {
    stepStart = null;
    const t = tracks.find(isFist) || tracks.find(isPoint) || tracks[0];
    if (t && isFist(t)) {
      mode = 'grab'; hint = 'holding · move to turn · open to let go';
      const c = next.get(t.id), p = prev.get(t.id);
      if (p) turn((c.x - p.x) * 5, (c.y - p.y) * 2.6);
      view.vyaw = 0;
    } else if (t && isPoint(t)) {
      mode = 'point'; hint = 'hold on a piece to open it';
      const c = next.get(t.id); pointerSource = 'hand';
      pointerNdc = new THREE.Vector2(c.x * 2 - 1, -(c.y * 2 - 1));
    } else if (t) { hint = '✊ grab to turn · ☝️ point to pick'; }
  }
  if (mode !== 'point' && pointerSource === 'hand') pointerNdc = null;
  prev = next;
  if (mode !== active) { active = mode; for (const el of document.querySelectorAll('#guide [data-g]')) el.classList.toggle('on', el.dataset.g === mode); }
}
function drawHands(now) {
  const W = handCanvas.width, H = handCanvas.height, dpr = devicePixelRatio;
  hctx.clearRect(0, 0, W, H);
  const G = onHands.G; if (!G || !tracks.length) return;
  const spin = now / 1000;
  const pts = tracks.map(t => { const p = toScreen(t); return { t, x: p.x * W, y: p.y * H }; });
  for (const { t, x, y } of pts) {
    const fist = t.gesture === G.FIST || t.gesture === G.PINCH || t.gesture === G.THUMBS, point = t.gesture === G.POINT;
    const n = fist ? 8 : point ? 6 : 14, r = (fist ? 14 : point ? 10 : 30) * dpr;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + spin * (fist ? 2.4 : 0.7);
      hctx.beginPath(); hctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, (fist ? 3.2 : 2.6) * dpr, 0, 7);
      hctx.fillStyle = fist ? 'rgba(255,170,90,0.95)' : 'rgba(255,230,190,0.9)'; hctx.fill();
    }
    if (fist || point) {
      const g = hctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
      g.addColorStop(0, 'rgba(255,150,60,0.55)'); g.addColorStop(1, 'rgba(255,150,60,0)');
      hctx.fillStyle = g; hctx.beginPath(); hctx.arc(x, y, r * 2.2, 0, 7); hctx.fill();
    }
  }
  if (active === 'step' && pts.length >= 2) {
    const [a, b] = pts, n = Math.max(6, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / (14 * dpr)));
    hctx.fillStyle = 'rgba(255,220,170,0.6)';
    for (let i = 1; i < n; i++) { hctx.beginPath(); hctx.arc(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n, 2 * dpr, 0, 7); hctx.fill(); }
  }
  if (hint) {
    const top = pts.reduce((m, q) => (q.y > m.y ? q : m), pts[0]), fs = 17 * dpr;
    hctx.font = `500 ${fs}px Inter, system-ui, sans-serif`;
    const w = hctx.measureText(hint).width + fs * 1.4, h = fs * 2;
    const bx = clamp(top.x - w / 2, 8 * dpr, W - w - 8 * dpr), by = Math.min(H - h - 8 * dpr, top.y + 48 * dpr);
    hctx.fillStyle = 'rgba(40,18,6,0.75)'; hctx.beginPath(); hctx.roundRect(bx, by, w, h, h / 2); hctx.fill();
    hctx.strokeStyle = 'rgba(255,200,140,0.3)'; hctx.lineWidth = dpr; hctx.stroke();
    hctx.fillStyle = '#f8e6cc'; hctx.textBaseline = 'middle'; hctx.textAlign = 'center'; hctx.fillText(hint, bx + w / 2, by + h / 2);
  }
}

// ---------- server ----------
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

// ---------- test pieces (X / Shift+X): warm little scenes, not saved ----------
const DEMO = ['🏠', '🍜', '🌻', '🐈', '🎧', '🚲', '☕️', '📚', '🌧️', '🧸', '🪴', '🍕', '🎸', '🌙', '🧦', '🫖', '🕯️', '🍞'];
function addDemoPieces(n) {
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d'), hue = 10 + Math.random() * 50 + (Math.random() < 0.3 ? 140 : 0);
    const g = x.createLinearGradient(0, 0, 256, 256);
    g.addColorStop(0, `hsl(${hue},70%,62%)`); g.addColorStop(1, `hsl(${(hue + 40) % 360},60%,35%)`);
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    x.font = '110px serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(DEMO[(Math.random() * DEMO.length) | 0], 128, 136);
    let slot = 0; while (pieces.has(slot)) slot++;
    addPiece({ id: 'demo' + slot, slot, demo: true }, c, clock() + i * 0.02);
  }
}

// ---------- start ----------
buildHouse(pickDims(0));
fetch('/api/info').then(r => r.json()).then(i => setPhoneUrl(i.phoneUrl)).catch(() => {});
await loadAll();
connect();
requestAnimationFrame(frame);
initHands();
window.house = { view, pieces, addDemoPieces, onHands: (...a) => onHands(...a), openFocus, slots: () => slots };
