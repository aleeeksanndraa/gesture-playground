// stories: the house board. A house made of frosted glass cubes, each one lit from inside by a
// piece of home. The light is iridescent and shifts as you turn the house. Spread your hands to
// step in through the door: inside, every pane is a shimmering piece of light.
import * as THREE from './three.module.min.js';
import { CONFIG } from './config.js';

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ---------- renderer + post (bloom) ----------
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setClearColor(0x000000, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
const handCanvas = $('#hands'), hctx = handCanvas.getContext('2d');

const RT = (w, h, samples = 0) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthBuffer: samples > 0 });
let rtScene, mips = [];
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
const quadScene = new THREE.Scene(); quadScene.add(quad);
const fsVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const downMat = new THREE.ShaderMaterial({ vertexShader: fsVert, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 } },
  fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uFirst; varying vec2 vUv;
  vec3 s(vec2 o){ vec3 c = texture2D(tSrc, vUv + o*uTexel).rgb; if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0); c = clamp(c, 0.0, 32.0); if (uFirst > 0.5) { float l = max(c.r,max(c.g,c.b)); c *= smoothstep(0.3, 1.2, l); } return c; }
  void main(){ vec3 c = s(vec2(0))*4.0 + s(vec2(-1,-1)) + s(vec2(1,-1)) + s(vec2(-1,1)) + s(vec2(1,1)); gl_FragColor = vec4(c/8.0, 1.0); }` });
const upMat = new THREE.ShaderMaterial({ vertexShader: fsVert, blending: THREE.AdditiveBlending, depthTest: false, transparent: true,
  uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
  fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
  vec3 s(vec2 o){ return texture2D(tSrc, vUv + o*uTexel).rgb; }
  void main(){ vec3 c = s(vec2(-2,0)) + s(vec2(2,0)) + s(vec2(0,-2)) + s(vec2(0,2)) + (s(vec2(-1,-1)) + s(vec2(1,-1)) + s(vec2(-1,1)) + s(vec2(1,1)))*2.0;
    gl_FragColor = vec4(c/12.0, 1.0); }` });
const compMat = new THREE.ShaderMaterial({ vertexShader: fsVert,
  uniforms: { tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0.9 }, uTime: { value: 0 } },
  fragmentShader: `uniform sampler2D tScene, tBloom; uniform float uBloom, uTime; varying vec2 vUv;
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
  void main(){
    vec3 sc = texture2D(tScene, vUv).rgb, bl = texture2D(tBloom, vUv).rgb;
    if (any(isnan(sc)) || any(isinf(sc))) sc = vec3(0.0);
    if (any(isnan(bl)) || any(isinf(bl))) bl = vec3(0.0);
    vec3 c = clamp(sc, 0.0, 32.0) + clamp(bl, 0.0, 32.0) * uBloom;
    vec2 d = vUv - 0.5; c *= 1.0 - dot(d, d) * 0.9;                       // vignette
    c = aces(c * 1.05);
    c = pow(c, vec3(1.0/2.2));
    c += (fract(sin(dot(vUv*1000.0 + uTime, vec2(12.9898,78.233))) * 43758.5453) - 0.5) / 255.0;   // dither
    gl_FragColor = vec4(c, 1.0); }` });
function resize() {
  const pr = renderer.getPixelRatio(), w = Math.floor(innerWidth * pr), h = Math.floor(innerHeight * pr);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  handCanvas.width = innerWidth * devicePixelRatio; handCanvas.height = innerHeight * devicePixelRatio;
  rtScene?.dispose(); mips.forEach(m => m.dispose());
  rtScene = RT(w, h, 4); mips = [];
  let mw = w, mh = h;
  for (let i = 0; i < 6; i++) { mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1); mips.push(RT(mw, mh)); }
}
addEventListener('resize', resize); resize();
function pass(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); }
function renderFrame(t) {
  renderer.setRenderTarget(rtScene); renderer.clear(); renderer.render(scene, camera);
  let src = rtScene.texture, sw = rtScene.width, sh = rtScene.height;
  for (let i = 0; i < mips.length; i++) {
    downMat.uniforms.tSrc.value = src; downMat.uniforms.uTexel.value.set(1 / sw, 1 / sh); downMat.uniforms.uFirst.value = i === 0 ? 1 : 0;
    pass(downMat, mips[i]); src = mips[i].texture; sw = mips[i].width; sh = mips[i].height;
  }
  renderer.autoClear = false;
  for (let i = mips.length - 1; i > 0; i--) {
    upMat.uniforms.tSrc.value = mips[i].texture; upMat.uniforms.uTexel.value.set(1 / mips[i].width, 1 / mips[i].height);
    pass(upMat, mips[i - 1]);
  }
  renderer.autoClear = true;
  compMat.uniforms.tScene.value = rtScene.texture; compMat.uniforms.tBloom.value = mips[0].texture; compMat.uniforms.uTime.value = t % 100;
  pass(compMat, null);
}

// ---------- the room: dark floor that reflects the house, and coloured light spilling out ----------
scene.background = new THREE.Color(0.012, 0.007, 0.01);
const world = new THREE.Group(); scene.add(world);
function radialTexture(stops, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) g.addColorStop(p, col);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
const softTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);

// ---------- the house: an abstract, unfinished house of small translucent puzzle pieces ----------
// The walls, gables and roof are a loose puzzle. Low down it is almost assembled; higher up pieces
// come loose, tilt away and some drift around the house on their own, so it never quite closes.
const P = 0.6;                                // one puzzle piece
const W = 7.2, D = 5.4, HW = 3.6, R = 2.4;    // width (x), depth (z), wall height, roof rise
const HOUSE_H = HW + R;
const slots = [];
{
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const add = (pos, normal, prio) => {
    const up = Math.abs(normal.y) > 0.9 ? v3(0, 0, -1) : v3(0, 1, 0);
    const n = normal.clone().normalize(), right = up.clone().cross(n).normalize(), u = n.clone().cross(right);
    slots.push({ home: pos, n, q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, u, n)), prio });
  };
  const cols = Math.round(W / P), deep = Math.round(D / P), rows = Math.round(HW / P);
  for (const side of [1, -1]) {                                   // front (door) and back, with gables
    for (let c = 0; c < cols; c++) for (let r = 0; ; r++) {
      const x = -W / 2 + P / 2 + c * P, y = P / 2 + r * P;
      if (y > HOUSE_H) break;
      if (y > HW && Math.abs(x) + P * 0.3 > (W / 2) * (1 - (y - HW) / R)) continue;
      if (side === 1 && Math.abs(x) < P && y < 2.3) continue;     // the door
      add(v3(x * side, y, side * D / 2), v3(0, 0, side), (y > HW ? 3000 : 0) + Math.abs(y - 1.7) * 13 + Math.abs(x) * 2 + (side === 1 ? 0 : 3));
    }
  }
  for (const side of [1, -1]) for (let c = 0; c < deep; c++) for (let r = 0; r < rows; r++) {   // side walls
    const z = -D / 2 + P / 2 + c * P, y = P / 2 + r * P;
    add(v3(side * W / 2, y, z), v3(side, 0, 0), Math.abs(y - 1.7) * 13 + Math.abs(z) * 2 + (side === 1 ? 1 : 2));
  }
  const L = Math.hypot(W / 2, R), along = Math.round(L / P);
  for (const side of [1, -1]) {                                   // roof slopes
    const s = v3(-side * W / 2, R, 0).normalize(), n = v3(side * R, W / 2, 0).normalize();
    for (let c = 0; c < deep; c++) for (let r = 0; r < along; r++) {
      const u = P / 2 + r * P, z = -D / 2 + P / 2 + c * P;
      add(v3(side * W / 2, HW, z).addScaledVector(s, u).addScaledVector(n, 0.03), n, 4000 + r * 40 + Math.abs(z) * 10);
    }
  }
  // how loose each piece is: mostly by height, with noise, so the edge of the puzzle is ragged
  slots.forEach((s, i) => {
    const h = s.home.y / HOUSE_H, k = hash(i * 3.1 + 7);
    s.loose = clamp((h - 0.5) * 1.5 + (k - 0.5) * 0.7 + (hash(i * 1.7) < 0.05 ? 0.6 : 0), 0, 1);
    s.seed = hash(i * 1.37);
  });
  // the loosest pieces leave the house completely (a few vanish, leaving gaps)
  for (let i = slots.length - 1; i >= 0; i--) if (slots[i].loose > 0.93 && hash(i * 9.1) < 0.45) slots.splice(i, 1);
  for (const [i, s] of slots.entries()) {
    const j = new THREE.Euler((hash(i * 2.2) - 0.5) * 0.12, (hash(i * 4.4) - 0.5) * 0.12, (hash(i * 6.6) - 0.5) * 0.16);
    let pos = s.home.clone().addScaledVector(s.n, (hash(i * 8.8) - 0.5) * 0.06), q = s.q.clone().multiply(new THREE.Quaternion().setFromEuler(j));
    if (s.loose > 0.78) {                                         // floating free around the house
      const out = 0.5 + hash(i * 5.5) * 2.0;
      pos.addScaledVector(s.n, out).add(new THREE.Vector3((hash(i * 7.3) - 0.5) * 1.6, -0.4 + hash(i * 3.9) * 1.2, (hash(i * 2.9) - 0.5) * 1.6));
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((hash(i * 1.1) - 0.5) * 2.2, (hash(i * 1.9) - 0.5) * 2.2, (hash(i * 2.3) - 0.5) * 2.2)));
    } else if (s.loose > 0.32) {                                  // coming loose: pulled out a little and tilted
      const k = (s.loose - 0.32) / 0.4;
      pos.addScaledVector(s.n, k * k * 0.6).y += k * 0.15;
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((hash(i * 1.1) - 0.5) * k * 0.9, (hash(i * 1.9) - 0.5) * k * 0.9, (hash(i * 2.3) - 0.5) * k * 0.6)));
    }
    s.pos = pos; s.rot = q; s.prio += s.loose * 900;
  }
  slots.sort((a, b) => a.prio - b.prio);
}
const N = slots.length;

// One puzzle-piece shape: tabs out on the right and top, holes on the left and bottom, so
// neighbours fit together.
function puzzleGeometry(size, depth) {
  const sh = new THREE.Shape(), h = size / 2, t = size * 0.17;
  const pts = [];
  const edge = (ax, ay, bx, by, dir) => {
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), nx = (dy / len) * dir, ny = (-dx / len) * dir;
    const at = (f, o) => new THREE.Vector2(ax + dx * f + nx * o, ay + dy * f + ny * o);
    pts.push(at(0, 0), at(0.36, 0));
    const b1 = new THREE.CubicBezierCurve(at(0.36, 0), at(0.44, t * 0.25), at(0.28, t), at(0.5, t));
    const b2 = new THREE.CubicBezierCurve(at(0.5, t), at(0.72, t), at(0.56, t * 0.25), at(0.64, 0));
    pts.push(...b1.getPoints(8).slice(1), ...b2.getPoints(8).slice(1), at(1, 0));
  };
  // with a counter-clockwise outline, dir -1 pushes the bump outwards and +1 pulls it in
  edge(-h, -h, h, -h, 1);     // bottom: hole
  edge(h, -h, h, h, -1);      // right: tab
  edge(h, h, -h, h, -1);      // top: tab
  edge(-h, h, -h, -h, 1);     // left: hole
  const clean = pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 1e-5);
  clean.pop();
  sh.setFromPoints(clean);
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: depth * 0.5, bevelSize: size * 0.025, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  g.userData.outline = clean;
  return g;
}
const pieceGeo = puzzleGeometry(P * 0.9, 0.035);
function makeInstanced(base, n) {
  const g = new THREE.InstancedBufferGeometry().copy(base);
  const at = (name, size) => { const a = new Float32Array(n * size); g.setAttribute(name, new THREE.InstancedBufferAttribute(a, size)); return a; };
  return { g, off: at('aOff', 3), quat: at('aQuat', 4), cell: at('aCell', 1).fill(-1), birth: at('aBirth', 1).fill(-100), seed: at('aSeed', 1), loose: at('aLoose', 1), fade: at('aFade', 1).fill(1) };
}
const H = makeInstanced(pieceGeo, N);
H.g.instanceCount = N;
slots.forEach((s, i) => {
  s.pos.toArray(H.off, i * 3); H.quat.set([s.rot.x, s.rot.y, s.rot.z, s.rot.w], i * 4);
  H.seed[i] = s.seed; H.loose[i] = s.loose;
});

// Photo atlas: each piece shows its photo as soft light (the glass is frosted).
const ATLAS = 4096, CELL = 128, PER = ATLAS / CELL;   // 1024 pieces, sharp enough to read from inside
const atlasCanvas = document.createElement('canvas'); atlasCanvas.width = atlasCanvas.height = ATLAS;
const actx = atlasCanvas.getContext('2d'); actx.fillStyle = '#000'; actx.fillRect(0, 0, ATLAS, ATLAS);
const atlasTex = new THREE.CanvasTexture(atlasCanvas);
atlasTex.colorSpace = THREE.SRGBColorSpace; atlasTex.generateMipmaps = true; atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
// a sharper atlas for the floating cards inside (the latest pieces only)
const CELL2 = 128, PER2 = 2048 / CELL2;
const cardCanvas = document.createElement('canvas'); cardCanvas.width = cardCanvas.height = 2048;
const cctx = cardCanvas.getContext('2d');
const cardTex = new THREE.CanvasTexture(cardCanvas);
cardTex.colorSpace = THREE.SRGBColorSpace; cardTex.minFilter = THREE.LinearMipmapLinearFilter; cardTex.anisotropy = 4;

const uniforms = {
  uTime: { value: 0 }, uTurn: { value: 0 }, uAtlas: { value: atlasTex }, uPer: { value: PER }, uSize: { value: P * 0.9 },
  uLight: { value: new THREE.Vector3(0, 1.6, 0) }, uMirror: { value: 0 }, uInside: { value: 0 }, uHover: { value: -1 },
  uBlur: { value: 1.6 }, uPhoto: { value: 0.55 }, uSolid: { value: 0 }, uFade: { value: 1 }, uLift: { value: 0.6 }, uScatter: { value: 1 }, uFlick: { value: 1 },
};
const glassVert = `
attribute vec3 aOff; attribute vec4 aQuat; attribute float aCell, aBirth, aSeed, aLoose, aFade;
uniform float uMirror, uTime, uSize, uLift, uScatter;
varying vec3 vW, vN; varying vec2 vUv; varying float vCell, vBirth, vSeed, vId, vEdge, vLoose, vFade;
vec3 rot(vec4 q, vec3 v){ return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main(){
  // loose pieces breathe and drift a little
  float k = aLoose * aLoose;
  vec3 bob = vec3(sin(uTime * 0.5 + aSeed * 40.0), sin(uTime * 0.7 + aSeed * 23.0), cos(uTime * 0.45 + aSeed * 31.0)) * (0.015 + k * 0.16);
  // the house keeps coming apart and gathering again, in slow waves that roll up through it
  float wave = 0.5 + 0.5 * sin(uTime * 0.42 - aOff.y * 0.45 + aSeed * 1.2);
  float wave2 = 0.5 + 0.5 * sin(uTime * 0.17 + aOff.x * 0.25 + aSeed * 0.6);
  float br = (pow(clamp(wave, 0.0, 1.0), 4.0) * (0.3 + aLoose) + pow(clamp(wave2, 0.0, 1.0), 8.0) * 0.6) * uScatter;
  float sp = (uTime * 0.25 + aSeed * 6.0) * k * step(0.78, aLoose) + br * (aSeed - 0.5) * 3.0;
  vec3 lp = position;
  lp.xz = mat2(cos(sp), -sin(sp), sin(sp), cos(sp)) * lp.xz;
  lp.yz = mat2(cos(br * aSeed), -sin(br * aSeed), sin(br * aSeed), cos(br * aSeed)) * lp.yz;
  vec3 outDir = normalize(aOff - vec3(0.0, 2.2, 0.0) + 1e-3);
  vec3 p = rot(aQuat, lp) + aOff + bob + (outDir * 1.3 + vec3(0.0, 0.6 + aSeed, 0.0)) * br;
  p.y += uLift;
  if (uMirror > 0.5) p.y = -p.y;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vec3 n = rot(aQuat, normal);
  if (uMirror > 0.5) n.y = -n.y;
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * n);
  vEdge = 1.0 - abs(normal.z);
  vUv = position.xy / uSize + 0.5; vCell = aCell; vBirth = aBirth; vSeed = aSeed; vId = float(gl_InstanceID); vLoose = aLoose; vFade = aFade;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const glassFrag = `
uniform float uTime, uTurn, uPer, uMirror, uInside, uHover, uBlur, uPhoto, uFade, uSolid, uFlick; uniform vec3 uLight; uniform sampler2D uAtlas;
varying vec3 vW, vN; varying vec2 vUv; varying float vCell, vBirth, vSeed, vId, vEdge, vLoose, vFade;
// warm iridescence: amber, peach, rose, lilac, a breath of sky blue
vec3 pal(float h){
  h = fract(h) * 5.0;
  vec3 c0 = vec3(1.00, 0.48, 0.12), c1 = vec3(1.00, 0.18, 0.22), c2 = vec3(1.00, 0.20, 0.58),
       c3 = vec3(0.62, 0.25, 1.00), c4 = vec3(0.30, 0.45, 1.00);
  float f = fract(h); f = f * f * (3.0 - 2.0 * f);
  if (h < 1.0) return mix(c0, c1, f); if (h < 2.0) return mix(c1, c2, f); if (h < 3.0) return mix(c2, c3, f);
  if (h < 4.0) return mix(c3, c4, f); return mix(c4, c0, f);
}
void main(){
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
  float ndv = abs(dot(N, V)), fres = pow(clamp(1.0 - ndv, 0.0, 1.0), 2.5);
  vec3 q = vW * 0.3;
  float field = sin(q.x * 1.3 + uTurn * 2.2 + uTime * 0.06) + sin(q.y * 1.6 - q.z * 0.9 + uTurn * 1.4) + sin((q.x + q.z) * 0.9 - uTime * 0.05) * 0.8;
  float h = field * 0.2 + ndv * 0.35 + vSeed * 0.08 + uTurn * 0.25;
  vec3 iri = pal(h);
  float lamp = 0.6 + 0.45 * exp(-length(vW - uLight) * 0.3);        // the warm lamp inside the house
  float has = step(0.0, vCell);
  vec3 col = iri * 0.75;
  float alpha = 0.11;
  if (has > 0.5) {
    vec2 cell = vec2(mod(vCell, uPer), uPer - 1.0 - floor(vCell / uPer));
    vec2 fuv = gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y);   // read the right way round from inside too
    vec3 photo = texture2D(uAtlas, (cell + clamp(fuv, 0.04, 0.96)) / uPer, uBlur).rgb;
    col = mix(iri * 0.7, photo * 1.1 * mix(vec3(1.0), iri, 0.35), uPhoto) + iri * 0.1 * uSolid;
    alpha = mix(0.34, 0.88, uSolid);
  }
  // firelight: the lamp flickers, and small flames run up through the pieces
  float flame = 0.92 + 0.08 * sin(uTime * 1.9 - vW.y * 1.6 + vSeed * 9.0) * sin(uTime * 1.2 - vW.y * 1.1 + vW.x * 0.6 + vSeed * 3.0);
  float shimmer = (0.9 + 0.1 * sin(uTime * 1.3 + vSeed * 20.0 + dot(vW, vec3(1.3, 0.7, 1.1)))) * flame * uFlick;
  col = mix(col, col * vec3(1.15, 0.92, 0.75), clamp((flame * uFlick - 0.95) * 3.0, 0.0, 1.0));
  col *= lamp * shimmer;
  // bright glassy rims where the light catches the edges and the bevel
  vec3 rim = pal(h + 0.3) * (fres * 0.25 + vEdge * 0.35) * lamp;
  col += rim; alpha = max(alpha, vEdge * 0.3 + fres * 0.15);
  float age = uTime - vBirth;
  col += vec3(1.0, 0.85, 0.7) * has * step(0.0, age) * exp(-max(age, 0.0) * 1.4) * 2.5;
  if (abs(vId - uHover) < 0.5) { col = col * 1.5 + vec3(0.25, 0.2, 0.18); alpha = max(alpha, 0.75); }
  if (uMirror > 0.5) { col *= 0.38 * exp(vW.y * 0.7); }
  alpha *= uFade * vFade;
  gl_FragColor = vec4(col * alpha, alpha);    // premultiplied, with a little extra glow
}`;
const glassMat = new THREE.ShaderMaterial({ vertexShader: glassVert, fragmentShader: glassFrag, uniforms,
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
const house = new THREE.Mesh(H.g, glassMat); house.frustumCulled = false; house.renderOrder = 3; world.add(house);
const mirrorMat = glassMat.clone(); mirrorMat.uniforms = { ...uniforms, uMirror: { value: 1 } };
const mirror = new THREE.Mesh(H.g, mirrorMat); mirror.frustumCulled = false; mirror.renderOrder = 1; world.add(mirror);

// The room: warm haze, not black. A soft glow behind the house, a glossy floor that fades into it.
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#2a1620'); g.addColorStop(0.45, '#5a2f38'); g.addColorStop(0.62, '#7a4544'); g.addColorStop(1, '#2a161c');
  x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
}
const floorMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime: uniforms.uTime, uTurn: uniforms.uTurn, uInside: uniforms.uInside, uFlick: { value: 1 } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `uniform float uTime, uTurn, uInside, uFlick; varying vec3 vW;
  void main(){
    float r = length(vW.xz), a = atan(vW.z, vW.x + 1e-4);
    float rays = pow(clamp(0.5 + 0.5*sin(a*11.0 + sin(a*5.0)*1.5 + uTurn*0.6 + uTime*0.05), 0.0, 1.0), 5.0) * 0.7 + pow(clamp(0.5 + 0.5*sin(a*6.0 - 1.3 - uTime*0.04), 0.0, 1.0), 9.0) * 0.8;
    float fall = exp(-max(r - 2.5, 0.0) * 0.28);
    vec3 c1 = vec3(1.0, 0.6, 0.35), c2 = vec3(1.0, 0.45, 0.6), c3 = vec3(0.7, 0.6, 1.0);
    vec3 tint = mix(mix(c1, c2, 0.5 + 0.5*sin(a*2.0 + uTurn)), c3, 0.35 + 0.35*sin(a*3.0 - 0.7));
    vec3 col = tint * tint * (rays * fall * 0.38 + exp(-r * 0.3) * 0.45) * (1.0 - uInside * 0.6) * uFlick;
    float fade = smoothstep(22.0, 7.0, r);
    vec3 base = vec3(0.16, 0.09, 0.1);
    gl_FragColor = vec4(base * fade + col * fade, 0.78 * fade);
  }` });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), floorMat);
floor.rotation.x = -Math.PI / 2; floor.renderOrder = 2; world.add(floor);
const glow = (color, sx, sy, pos, order) => {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
  m.scale.set(sx, sy, 1); m.position.copy(pos); m.renderOrder = order; world.add(m); return m;
};
const haloBack = glow(new THREE.Color(0.22, 0.11, 0.09), 22, 16, new THREE.Vector3(0, 3, 0), 0);   // light around the house
const lampGlow = glow(new THREE.Color(0.32, 0.14, 0.06), 6, 6, new THREE.Vector3(0, 1.6, 0), 4);   // the cozy lamp inside
const roofGlow = glow(new THREE.Color(0.14, 0.05, 0.12), 9, 6, new THREE.Vector3(0, 5, 0), 4);

// Floating dust of light, slow and few.
const DUST = 320, dPos = new Float32Array(DUST * 3), dSeed = new Float32Array(DUST);
for (let i = 0; i < DUST; i++) { dPos[i * 3] = (Math.random() - 0.5) * 18; dPos[i * 3 + 1] = Math.random() * 10; dPos[i * 3 + 2] = (Math.random() - 0.5) * 16; dSeed[i] = Math.random(); }
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3)); dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dSeed, 1));
const dustMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: uniforms.uTime, uScale: { value: 1 } },
  vertexShader: `attribute float aSeed; uniform float uTime, uScale; varying float vA, vS;
    void main(){ vec3 p = position; p.y = mod(p.y + uTime * (0.08 + aSeed * 0.12), 10.0); p.x += sin(uTime*0.3 + aSeed*30.0)*0.4;
      vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv; vS = aSeed;
      vA = (0.55 + 0.2*sin(uTime*0.6 + aSeed*40.0)) * smoothstep(0.0, 1.5, p.y) * smoothstep(10.0, 7.0, p.y);
      gl_PointSize = min((4.0 + aSeed * 8.0) * uScale / -mv.z, 7.0); vA *= smoothstep(2.0, 5.0, -mv.z); }`,
  fragmentShader: `varying float vA, vS; void main(){ float r = length(gl_PointCoord-0.5); if (r > 0.5) discard;
    vec3 c = mix(vec3(1.0,0.75,0.5), vec3(1.0,0.6,0.8), vS); gl_FragColor = vec4(c * smoothstep(0.5,0.0,r) * vA * 0.55, 1.0); }` });
const dust = new THREE.Points(dustGeo, dustMat); dust.frustumCulled = false; dust.renderOrder = 6; world.add(dust);

// Inside: the newest pieces float around you as bigger glowing puzzle pieces with clear photos.
const MAXF = 40, CARD = 0.72;
const F = makeInstanced(puzzleGeometry(CARD, 0.03), MAXF);
F.g.instanceCount = 0;
for (let i = 0; i < MAXF; i++) F.seed[i] = hash(i * 7.7);
const cardMat = glassMat.clone();
cardMat.uniforms = { ...uniforms, uAtlas: { value: cardTex }, uPer: { value: PER2 }, uSize: { value: CARD }, uBlur: { value: 0.3 },
  uPhoto: { value: 0.9 }, uSolid: { value: 1 }, uScatter: { value: 0 }, uHover: { value: -1 }, uFade: { value: 0 } };
const cards = new THREE.Mesh(F.g, cardMat); cards.frustumCulled = false; cards.renderOrder = 5; world.add(cards);

// ---------- pieces ----------
const pieces = new Map();   // slot -> { id, slot, t, demo, img }
const voxelOf = slot => slot % N;
function drawCell(ctx, c, per, size, img) {
  const x = (c % per) * size, y = Math.floor(c / per) * size;
  const iw = img.width || img.videoWidth, ih = img.height || img.videoHeight, k = Math.max(size / iw, size / ih);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip();
  ctx.drawImage(img, x + (size - iw * k) / 2, y + (size - ih * k) / 2, iw * k, ih * k);
  ctx.restore();
}
function drawToAtlas(slot, img) {
  const c = slot % (PER * PER);
  drawCell(actx, c, PER, CELL, img); atlasTex.needsUpdate = true;
  return c;
}
let cardNext = 0;
const cardOwner = new Array(MAXF).fill(null);
function addPiece(info, img, born) {
  if (pieces.has(info.slot)) return;
  const cell = drawToAtlas(info.slot, img);
  pieces.set(info.slot, { ...info, img, cell });
  const v = voxelOf(info.slot);
  H.cell[v] = cell; H.birth[v] = born;
  H.g.attributes.aCell.needsUpdate = true; H.g.attributes.aBirth.needsUpdate = true;
  // the newest pieces float inside; the oldest card makes room
  const k = cardNext++ % MAXF;
  if (cardOwner[k] != null) delete pieces.get(cardOwner[k]).card;
  cardOwner[k] = info.slot;
  drawCell(cctx, k, PER2, CELL2, img); cardTex.needsUpdate = true;
  F.cell[k] = k; F.birth[k] = born; F.g.instanceCount = Math.max(F.g.instanceCount, k + 1);
  F.g.attributes.aCell.needsUpdate = true; F.g.attributes.aBirth.needsUpdate = true;
  pieces.get(info.slot).card = k;
  $('#count').textContent = pieces.size;
}
function loadImage(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }
async function loadAll() {
  let list = [];
  try { list = await (await fetch('/api/pieces')).json(); } catch { return; }
  const todo = list.filter(p => !pieces.has(p.slot));
  let next = 0;
  const worker = async () => { while (next < todo.length) { const p = todo[next++]; try { addPiece(p, await loadImage(p.url), -100); } catch {} } };
  await Promise.all(Array.from({ length: 6 }, worker));
}
async function onNewPiece(info) {
  try {
    const img = await loadImage(info.url);
    addPiece(info, img, clock() + 0.3);
    setCaption('A new piece of home just lit up', 6000);
  } catch {}
}

// ---------- view: outside orbit ⇄ inside through the door ----------
const view = { yaw: -0.5, pitch: 0.12, inside: 0, insideT: 0, zoom: 1, vyaw: 0, turnHue: 0 };
const clock0 = performance.now(), clock = () => (performance.now() - clock0) / 1000;
const center = new THREE.Vector3(0, HOUSE_H * 0.5, 0);
function frameCamera(dt) {
  view.inside += (view.insideT - view.inside) * (1 - Math.exp(-dt * 1.8));
  const e = view.inside, ease = e * e * (3 - 2 * e);
  const half = Math.tan(THREE.MathUtils.degToRad(40 / 2));
  const dist = Math.max((HOUSE_H * 0.5 + 1.5) / half, (Math.hypot(W, D) * 0.5 + 2.5) / (half * camera.aspect)) * 1.5 * view.zoom;
  const dir = new THREE.Vector3(Math.sin(view.yaw) * Math.cos(view.pitch), Math.sin(view.pitch), Math.cos(view.yaw) * Math.cos(view.pitch));
  const eye = new THREE.Vector3(0, 1.5, 0);
  const outPos = center.clone().addScaledVector(dir, dist);
  const inPos = eye.clone().addScaledVector(dir, 0.15);
  camera.position.lerpVectors(outPos, inPos, ease);
  camera.position.y = Math.max(0.25, camera.position.y);
  const look = center.clone().lerp(eye.clone().addScaledVector(dir, -5).setY(eye.y + view.pitch * -2), ease);
  camera.lookAt(look);
  camera.fov = lerp(40, 62, ease); camera.updateProjectionMatrix();
  uniforms.uInside.value = ease;
  const v = $('#view'), ins = e > 0.5;
  if (v.classList.contains('inside') !== ins) { v.classList.toggle('inside', ins); v.textContent = ins ? 'Inside the house' : 'Outside view'; }
  return ease;
}

// ---------- frame ----------
const ray = new THREE.Raycaster();
let hover = null, lastFrame = performance.now(), lastYaw = view.yaw;
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
  const t = clock(); uniforms.uTime.value = t;
  if (!dragging) { view.yaw += view.vyaw * dt; view.vyaw *= Math.exp(-dt * 2.5); }
  // turning the house moves the light: the hue follows how far it has turned
  view.turnHue += (view.yaw - lastYaw) * 0.35 + (view.pitch - (frame.lp ?? view.pitch)) * 0.25; lastYaw = view.yaw; frame.lp = view.pitch;
  uniforms.uTurn.value = view.turnHue;
  const ease = frameCamera(dt);
  dustMat.uniforms.uScale.value = innerHeight * renderer.getPixelRatio() / 900 * 18;
  // floating cards drift slowly around you inside
  uniforms.uLift.value = (0.55 + Math.sin(t * 0.6) * 0.12) * (1 - ease);   // the house hovers above the floor
  lampGlow.position.y = 1.6 + uniforms.uLift.value; roofGlow.position.y = 5 + uniforms.uLift.value;
  // firelight flicker, shared by the pieces, the lamp and the floor
  const flick = 1 + 0.035 * Math.sin(t * 2.3) + 0.025 * Math.sin(t * 3.7 + 1) + 0.015 * Math.sin(t * 5.1 + 2);
  uniforms.uFlick.value = flick; floorMat.uniforms.uFlick.value = flick;
  lampGlow.scale.setScalar(6);
  // inside, the walls hold still and their photos come into focus
  cards.visible = false;
  uniforms.uScatter.value = 1 - ease;
  uniforms.uBlur.value = lerp(1.6, 0.0, ease); uniforms.uPhoto.value = lerp(0.55, 0.92, ease); uniforms.uSolid.value = ease * 0.85;
  lampGlow.material.opacity = roofGlow.material.opacity = 1 - ease;
  dustMat.uniforms.uScale.value *= 1 - ease * 0.6;
  compMat.uniforms.uBloom.value = lerp(1.1, 0.8, ease);
  updateHover();
  renderFrame(t);
  drawHands(now);
  if (!$('#debug').hidden) $('#debug').textContent = `${pieces.size} pieces · ${N} puzzle spots · ${renderer.info.render.calls} draws`;
  requestAnimationFrame(frame);
}

// ---------- picking ----------
let pointerNdc = null, pointerSource = 'mouse', dwell = { key: null, t: 0 };
const pickBoxes = new THREE.InstancedMesh(new THREE.BoxGeometry(P * 0.9, P * 0.9, 0.08), new THREE.MeshBasicMaterial(), N);
let pickLift = null;
function placePickBoxes() {
  const m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), lift = uniforms.uLift.value;
  slots.forEach((s, i) => pickBoxes.setMatrixAt(i, m.compose(s.pos.clone().setY(s.pos.y + lift), s.rot, one)));
  pickBoxes.instanceMatrix.needsUpdate = true; pickBoxes.computeBoundingSphere(); pickLift = lift;
}
const pickCards = new THREE.InstancedMesh(new THREE.BoxGeometry(CARD, CARD, 0.05), new THREE.MeshBasicMaterial(), MAXF);
const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pieceGeo.userData.outline.map(p => new THREE.Vector3(p.x * 1.12, p.y * 1.12, 0.04))),
  new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, dashSize: 0.035, gapSize: 0.025 }));
outline.computeLineDistances();
outline.visible = false; outline.renderOrder = 9; world.add(outline);
let pointerMoved = true;
function updateHover() {
  if (!pointerNdc) { setHover(null); return; }
  // a resting pointer keeps its piece, so the highlight doesn't jump while the house moves
  if (!pointerMoved && view.inside < 0.5) { if (hover) setHover(hover); return; }
  pointerMoved = false;
  ray.setFromCamera(pointerNdc, camera);
  if (cards.visible) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), lift = uniforms.uLift.value;
    for (let i = 0; i < F.g.instanceCount; i++) {
      const p = new THREE.Vector3(F.off[i * 3], F.off[i * 3 + 1] + lift, F.off[i * 3 + 2]);
      q.fromArray(F.quat, i * 4);
      pickCards.setMatrixAt(i, m.compose(p, q, new THREE.Vector3(1, 1, 1)));
    }
    pickCards.count = F.g.instanceCount; pickCards.instanceMatrix.needsUpdate = true; pickCards.computeBoundingSphere();
    const hc = ray.intersectObject(pickCards)[0];
    if (hc) { const slot = [...pieces.values()].find(p => p.card === hc.instanceId)?.slot; if (slot != null) { setHover({ slot, card: hc.instanceId }); return; } }
  }
  if (pickLift === null || Math.abs(pickLift - uniforms.uLift.value) > 0.03) placePickBoxes();
  const hits = ray.intersectObject(pickBoxes);
  // from inside, skip the cube you are standing next to; take the first one in front
  const h = hits[0];
  if (!h) { setHover(null); return; }
  const v = h.instanceId, slot = [...pieces.keys()].find(s => voxelOf(s) === v);
  setHover({ voxel: v, slot: slot ?? null });
}
function setHover(h) {
  const key = h ? (h.card != null ? 'c' + h.card : 'v' + h.voxel) : null;
  if (key !== (hover && hover.key)) { hover = h ? { ...h, key } : null; dwell = { key, t: performance.now() }; }
  uniforms.uHover.value = hover && hover.voxel != null ? hover.voxel : -1;
  cardMat.uniforms.uHover.value = hover && hover.card != null ? hover.card : -1;
  if (!hover) { outline.visible = false; $('#qrbox').classList.remove('call'); setCaption(''); return; }
  if (hover.voxel != null && view.inside > 0.5) { outline.visible = true; const sl = slots[hover.voxel]; outline.position.copy(sl.pos).y += uniforms.uLift.value; outline.quaternion.copy(sl.rot); } else outline.visible = false;
  const p = hover.slot != null ? pieces.get(hover.slot) : null;
  if (p) setCaption(`Piece ${p.slot + 1} · ${p.demo ? 'test photo' : timeAgo(p.t)}`);
  else setCaption('An empty spot · scan the code to light it up');
  $('#qrbox').classList.toggle('call', !p);
  if (pointerSource === 'hand' && p && performance.now() - dwell.t > 900 && $('#focus').hidden) openFocus(p);
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
  const c = $('#focus canvas'), x = c.getContext('2d'), img = p.img;
  const iw = img.width || img.videoWidth, ih = img.height || img.videoHeight, k = Math.max(512 / iw, 512 / ih);
  x.clearRect(0, 0, 512, 512); x.drawImage(img, (512 - iw * k) / 2, (512 - ih * k) / 2, iw * k, ih * k);
  $('#focusText').textContent = `Piece ${p.slot + 1}`;
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
  pointerNdc = new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); pointerMoved = true;
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
  turn(dx / innerWidth * 4, dy / innerHeight * 2.2);
  view.vyaw = -dx / innerWidth * 4 * 30;
});
canvas.addEventListener('pointerup', () => { if (drag && drag.moved < 6 && hover && hover.slot != null) openFocus(pieces.get(hover.slot)); drag = null; dragging = false; });
canvas.addEventListener('pointerleave', () => { pointerNdc = null; });
canvas.addEventListener('wheel', e => { e.preventDefault();
  if (view.insideT > 0.5) { if (e.deltaY > 0) view.insideT = 0; }
  else { view.zoom = clamp(view.zoom * Math.exp(e.deltaY * 0.0012), 0.5, 1.8); if (view.zoom < 0.55 && e.deltaY < 0) { view.insideT = 1; view.zoom = 1; } }
}, { passive: false });
canvas.addEventListener('dblclick', () => { view.insideT = view.insideT > 0.5 ? 0 : 1; });
function turn(dyaw, dpitch) {
  view.yaw -= dyaw;
  view.pitch = clamp(view.pitch + dpitch * (view.inside > 0.5 ? -0.6 : 1), -0.05, 0.9);
}
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  else if (k === 'i' || k === ' ') { e.preventDefault(); view.insideT = view.insideT > 0.5 ? 0 : 1; }
  else if (k === 'r') { view.yaw = -0.5; view.pitch = 0.12; view.zoom = 1; view.insideT = 0; }
  else if (k === 'd') $('#debug').hidden = !$('#debug').hidden;
  else if (k === 'c') $('#cambubble').hidden = !$('#cambubble').hidden;
  else if (k === 'h') $('#guide').hidden = !$('#guide').hidden;
  else if (k === 'x') addDemoPieces(e.shiftKey ? 300 : 60);
  else if (k === 'escape') closeFocus();
});

// ---------- hands ----------
// ✊ grab and move: turn the house (inside: look around); the light shifts as it turns.
// 🙌 two hands: apart to step in through the door, together to step out.
// ☝️ point: the cube under your finger lights up; hold on a piece to open it.
let tracks = [], prev = new Map(), active = null, hint = '', stepStart = null;
const M = 0.1;
const toScreen = t => ({ x: clamp(((1 - t.x) - M) / (1 - 2 * M), 0, 1), y: clamp((t.y - M) / (1 - 2 * M), 0, 1) });
async function initHands() {
  if (!CONFIG.gestures) { $('#guide').classList.add('nohands'); return; }
  try {
    const { startHands, G } = await import('./hands.js');
    await startHands($('#cam'), (tr, now) => onHands(tr, now, G));
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
    if (!stepStart) stepStart = { d };
    const ch = (d - stepStart.d) / 0.25;
    if (ch > 1 && view.insideT < 0.5) { view.insideT = 1; stepStart = { d }; }
    else if (ch < -1 && view.insideT > 0.5) { view.insideT = 0; stepStart = { d }; }
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
      pointerNdc = new THREE.Vector2(c.x * 2 - 1, -(c.y * 2 - 1)); pointerMoved = true;
    } else if (t) hint = '✊ grab to turn · ☝️ point to pick';
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
      hctx.fillStyle = `hsla(${(spin * 40 + i * 25) % 360}, 90%, 80%, 0.95)`; hctx.fill();
    }
  }
  if (active === 'step' && pts.length >= 2) {
    const [a, b] = pts, n = Math.max(6, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / (14 * dpr)));
    hctx.fillStyle = 'rgba(255,220,235,0.6)';
    for (let i = 1; i < n; i++) { hctx.beginPath(); hctx.arc(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n, 2 * dpr, 0, 7); hctx.fill(); }
  }
  if (hint) {
    const top = pts.reduce((m, q) => (q.y > m.y ? q : m), pts[0]), fs = 12 * dpr;
    hctx.font = `500 ${fs}px Montserrat, system-ui, sans-serif`;
    const w = hctx.measureText(hint).width + fs * 1.4, h = fs * 2;
    const bx = clamp(top.x - w / 2, 8 * dpr, W - w - 8 * dpr), by = Math.min(H - h - 8 * dpr, top.y + 48 * dpr);
    hctx.fillStyle = 'rgba(30,14,22,0.72)'; hctx.beginPath(); hctx.roundRect(bx, by, w, h, h / 2); hctx.fill();
    hctx.strokeStyle = 'rgba(255,190,220,0.3)'; hctx.lineWidth = dpr; hctx.stroke();
    hctx.fillStyle = '#fbe9f0'; hctx.textBaseline = 'middle'; hctx.textAlign = 'center'; hctx.fillText(hint, bx + w / 2, by + h / 2);
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

// ---------- test pieces (X / Shift+X) ----------
// Soft, photo-like little scenes of home (window light, a lamp, a sunset over roofs, a candle, a plant
// on the sill, fairy lights...), so the board looks the way it will with real photos.
const rnd = (a, b) => a + Math.random() * (b - a);
function homeScene(size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), S = size, kind = (Math.random() * 7) | 0;
  const warm = rnd(15, 45), cool = rnd(200, 260);
  const grad = (stops, x0 = 0, y0 = 0, x1 = 0, y1 = S) => { const g = x.createLinearGradient(x0, y0, x1, y1); stops.forEach(([p, col]) => g.addColorStop(p, col)); return g; };
  const glowAt = (cx, cy, r, col, a = 1) => { const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, col.replace('A', a)); g.addColorStop(1, col.replace('A', 0)); x.fillStyle = g; x.fillRect(0, 0, S, S); };
  const bokeh = (n, hue, sat = 90) => { for (let i = 0; i < n; i++) { x.globalAlpha = rnd(0.15, 0.55); x.fillStyle = `hsl(${hue + rnd(-15, 15)},${sat}%,${rnd(60, 80)}%)`; x.beginPath(); x.arc(rnd(0, S), rnd(0, S), rnd(S * 0.03, S * 0.09), 0, 7); x.fill(); } x.globalAlpha = 1; };
  if (kind === 0) {            // a lit window at dusk
    x.fillStyle = grad([[0, `hsl(${cool},35%,22%)`], [1, `hsl(${cool + 20},30%,12%)`]]); x.fillRect(0, 0, S, S);
    const wx = rnd(0.2, 0.35) * S, wy = rnd(0.15, 0.3) * S, ww = rnd(0.35, 0.5) * S, wh = rnd(0.4, 0.55) * S;
    glowAt(wx + ww / 2, wy + wh / 2, S * 0.6, `hsla(${warm},90%,60%,A)`, 0.5);
    x.fillStyle = grad([[0, `hsl(${warm + 10},95%,72%)`], [1, `hsl(${warm},90%,52%)`]], 0, wy, 0, wy + wh); x.fillRect(wx, wy, ww, wh);
    x.fillStyle = `hsl(${cool},25%,14%)`; x.fillRect(wx + ww / 2 - 3, wy, 6, wh); x.fillRect(wx, wy + wh / 2 - 3, ww, 6);
  } else if (kind === 1) {     // sunset over rooftops
    x.fillStyle = grad([[0, `hsl(${rnd(260, 290)},45%,35%)`], [0.55, `hsl(${rnd(330, 360)},75%,62%)`], [0.8, `hsl(${warm + 10},95%,65%)`]]); x.fillRect(0, 0, S, S);
    glowAt(rnd(0.3, 0.7) * S, S * 0.72, S * 0.25, 'hsla(45,100%,80%,A)', 0.9);
    x.fillStyle = `hsl(${cool + 40},30%,14%)`; x.beginPath(); x.moveTo(0, S);
    let px = 0; while (px < S) { const w = rnd(0.12, 0.25) * S, h = rnd(0.62, 0.8) * S; x.lineTo(px, h); x.lineTo(px + w / 2, h - rnd(0.05, 0.12) * S); x.lineTo(px + w, h); px += w; }
    x.lineTo(S, S); x.fill();
  } else if (kind === 2) {     // table lamp in a dim room
    x.fillStyle = grad([[0, `hsl(${warm},30%,14%)`], [1, `hsl(${warm - 10},35%,8%)`]]); x.fillRect(0, 0, S, S);
    const lx = rnd(0.35, 0.65) * S; glowAt(lx, S * 0.38, S * 0.7, `hsla(${warm + 8},95%,62%,A)`, 0.75);
    x.fillStyle = `hsl(${warm + 12},90%,78%)`; x.beginPath(); x.moveTo(lx - S * 0.14, S * 0.46); x.lineTo(lx - S * 0.07, S * 0.26); x.lineTo(lx + S * 0.07, S * 0.26); x.lineTo(lx + S * 0.14, S * 0.46); x.fill();
    x.fillStyle = `hsl(${warm},25%,10%)`; x.fillRect(lx - 3, S * 0.46, 6, S * 0.2); x.fillRect(0, S * 0.68, S, S * 0.32);
  } else if (kind === 3) {     // fairy lights bokeh
    x.fillStyle = grad([[0, `hsl(${rnd(280, 340)},35%,16%)`], [1, `hsl(${cool},30%,10%)`]]); x.fillRect(0, 0, S, S);
    bokeh(22, warm + 15); bokeh(8, rnd(320, 350), 80);
  } else if (kind === 4) {     // a plant on a sunny sill
    x.fillStyle = grad([[0, `hsl(${rnd(190, 210)},60%,78%)`], [1, `hsl(${warm + 20},70%,80%)`]]); x.fillRect(0, 0, S, S);
    glowAt(S * 0.7, S * 0.2, S * 0.5, 'hsla(50,100%,92%,A)', 0.9);
    x.fillStyle = `hsl(${warm},45%,45%)`; x.fillRect(S * 0.36, S * 0.66, S * 0.28, S * 0.2); x.fillStyle = `hsl(30,25%,60%)`; x.fillRect(0, S * 0.84, S, S * 0.16);
    x.strokeStyle = `hsl(${rnd(110, 140)},45%,32%)`; x.lineWidth = S * 0.035; x.lineCap = 'round';
    for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + rnd(-0.9, 0.9); x.beginPath(); x.moveTo(S / 2, S * 0.66); x.quadraticCurveTo(S / 2 + Math.cos(a) * S * 0.15, S * 0.5, S / 2 + Math.cos(a) * S * 0.32, S * 0.66 + Math.sin(a) * S * 0.45); x.stroke(); }
  } else if (kind === 5) {     // candle and warm dark
    x.fillStyle = `hsl(${warm - 5},40%,7%)`; x.fillRect(0, 0, S, S);
    const cx = rnd(0.4, 0.6) * S; glowAt(cx, S * 0.42, S * 0.55, `hsla(${warm + 10},100%,58%,A)`, 0.8);
    x.fillStyle = `hsl(40,40%,85%)`; x.fillRect(cx - S * 0.07, S * 0.5, S * 0.14, S * 0.35);
    glowAt(cx, S * 0.44, S * 0.06, 'hsla(48,100%,90%,A)', 1);
  } else {                     // sea / sky through a window
    x.fillStyle = grad([[0, `hsl(${cool - 10},55%,70%)`], [0.55, `hsl(${cool - 20},50%,85%)`], [0.56, `hsl(${cool},45%,45%)`], [1, `hsl(${cool + 10},40%,30%)`]]); x.fillRect(0, 0, S, S);
    glowAt(rnd(0.2, 0.8) * S, S * 0.4, S * 0.3, 'hsla(45,100%,95%,A)', 0.8);
    x.fillStyle = `hsl(${warm},25%,92%)`; x.fillRect(0, 0, S * 0.08, S); x.fillRect(S * 0.92, 0, S * 0.08, S);
  }
  // camera softness and grain
  const o = document.createElement('canvas'); o.width = o.height = S; const ox = o.getContext('2d');
  ox.filter = `blur(${S * 0.008}px) saturate(1.1) brightness(1.12)`; ox.drawImage(c, 0, 0);
  const img = ox.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  ox.putImageData(img, 0, 0);
  return o;
}
function addDemoPieces(n) {
  const t = clock();
  for (let i = 0; i < n; i++) {
    let slot = 0; while (pieces.has(slot)) slot++;
    addPiece({ id: 'demo' + slot, slot, demo: true }, homeScene(), t + i * 0.015);
  }
}

// ---------- start ----------
// Without the server (the shareable preview) the board fills itself with test photos and the
// hints describe the mouse instead of hands.
let preview = false;
try { setPhoneUrl((await (await fetch('/api/info')).json()).phoneUrl); } catch { preview = true; }
if (preview || new URLSearchParams(location.search).has('preview')) {
  preview = true;
  document.body.classList.add('preview');
  $('#qrbox').hidden = true;
  const chips = { grab: 'Drag to turn', step: 'Double-click to step in', point: 'Click a piece to open it' };
  for (const [k, v] of Object.entries(chips)) $(`#guide [data-g="${k}"] span`).textContent = v;
  addDemoPieces(110);
} else {
  await loadAll();
  connect();
  initHands();
}
requestAnimationFrame(frame);
window.house = { view, pieces, addDemoPieces, camera, F, onHands: (...a) => onHands(...a), openFocus, count: N };
