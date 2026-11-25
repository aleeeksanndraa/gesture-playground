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
  vec3 s(vec2 o){ vec3 c = texture2D(tSrc, vUv + o*uTexel).rgb; if (uFirst > 0.5) { float l = max(c.r,max(c.g,c.b)); c *= smoothstep(0.3, 1.2, l); } return c; }
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
    vec3 c = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloom;
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

// ---------- the house: a hollow shell of glass cubes with a stepped gable roof and a door ----------
const S = 0.5;                       // size of one cube
const WX = 18, DZ = 14, HY = 8;      // footprint and wall height in cubes
const voxels = [];
{
  const has = new Set(), add = (x, y, z, prio) => { const k = `${x},${y},${z}`; if (has.has(k)) return; has.add(k); voxels.push({ x, y, z, prio }); };
  const door = (x, y, z) => z === DZ - 1 && (x === 8 || x === 9) && y < 5;
  for (let y = 0; y < HY; y++) for (let x = 0; x < WX; x++) for (let z = 0; z < DZ; z++) {
    if (!(x === 0 || x === WX - 1 || z === 0 || z === DZ - 1)) continue;
    if (door(x, y, z)) continue;
    const front = z === DZ - 1, back = z === 0;
    const face = front ? 0 : (x === WX - 1 ? 1 : x === 0 ? 2 : 3);
    const cx = front || back ? x - (WX - 1) / 2 : z - (DZ - 1) / 2;
    add(x, y, z, face * 1000 + Math.hypot(cx, (y - HY * 0.45) * 1.2));
  }
  // roof: each layer steps in by one cube on the long sides; gable ends stay closed
  for (let l = 0; ; l++) {
    const x0 = l * 2, x1 = WX - 1 - l * 2, y = HY + l; if (x1 - x0 < 1) break;
    for (let x = x0; x <= x1; x++) for (let z = 0; z < DZ; z++) {
      const edge = x <= x0 + 1 || x >= x1 - 1, gable = z === 0 || z === DZ - 1;
      if (!edge && !gable && x1 - x0 > 3) continue;
      add(x, y, z, 4000 + l * 30 + Math.abs(z - (DZ - 1) / 2));
    }
  }
  voxels.sort((a, b) => a.prio - b.prio);
}
const N = voxels.length;
const HOUSE_H = (HY + WX / 4) * S;
const boxGeo = new THREE.BoxGeometry(S * 0.97, S * 0.97, S * 0.97);
const inst = new THREE.InstancedBufferGeometry().copy(boxGeo);
inst.instanceCount = N;
const aCell = new Float32Array(N).fill(-1), aBirth = new Float32Array(N).fill(-100), aSeed = new Float32Array(N);
const aOff = new Float32Array(N * 3);
voxels.forEach((v, i) => {
  aOff[i * 3] = (v.x - (WX - 1) / 2) * S; aOff[i * 3 + 1] = (v.y + 0.5) * S; aOff[i * 3 + 2] = (v.z - (DZ - 1) / 2) * S;
  aSeed[i] = hash(i * 1.37); v.pos = new THREE.Vector3(aOff[i * 3], aOff[i * 3 + 1], aOff[i * 3 + 2]);
});
inst.setAttribute('aOff', new THREE.InstancedBufferAttribute(aOff, 3));
inst.setAttribute('aCell', new THREE.InstancedBufferAttribute(aCell, 1));
inst.setAttribute('aBirth', new THREE.InstancedBufferAttribute(aBirth, 1));
inst.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));

// Photo atlas: each piece is blurred light inside its cube (the glass is frosted).
const ATLAS = 2048, CELL = 64, PER = ATLAS / CELL;
const atlasCanvas = document.createElement('canvas'); atlasCanvas.width = atlasCanvas.height = ATLAS;
const actx = atlasCanvas.getContext('2d'); actx.fillStyle = '#000'; actx.fillRect(0, 0, ATLAS, ATLAS);
const atlasTex = new THREE.CanvasTexture(atlasCanvas);
atlasTex.colorSpace = THREE.SRGBColorSpace; atlasTex.generateMipmaps = true; atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
// a sharper atlas for the floating cards inside (the latest pieces only)
const CELL2 = 128, PER2 = ATLAS / CELL2;
const cardCanvas = document.createElement('canvas'); cardCanvas.width = cardCanvas.height = ATLAS;
const cctx = cardCanvas.getContext('2d');
const cardTex = new THREE.CanvasTexture(cardCanvas);
cardTex.colorSpace = THREE.SRGBColorSpace; cardTex.minFilter = THREE.LinearMipmapLinearFilter; cardTex.anisotropy = 4;

const uniforms = {
  uTime: { value: 0 }, uTurn: { value: 0 }, uAtlas: { value: atlasTex }, uPer: { value: PER },
  uLight: { value: new THREE.Vector3(0, HOUSE_H * 0.45, 0) }, uMirror: { value: 0 }, uInside: { value: 0 }, uHover: { value: -1 },
};
const glassVert = `
attribute vec3 aOff; attribute float aCell, aBirth, aSeed;
uniform float uMirror;
varying vec3 vW, vN, vL; varying vec2 vUv; varying float vCell, vBirth, vSeed, vId;
void main(){
  vec3 p = position + aOff;
  if (uMirror > 0.5) p.y = -p.y;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz; vN = normalize(mat3(modelMatrix) * (normal * vec3(1.0, uMirror > 0.5 ? -1.0 : 1.0, 1.0)));
  vL = position / ${(S * 0.97).toFixed(3)}; vUv = uv; vCell = aCell; vBirth = aBirth; vSeed = aSeed; vId = float(gl_InstanceID);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const glassFrag = `
uniform float uTime, uTurn, uPer, uMirror, uInside, uHover; uniform vec3 uLight; uniform sampler2D uAtlas;
varying vec3 vW, vN, vL; varying vec2 vUv; varying float vCell, vBirth, vSeed, vId;
// the reference palette: coral, rose, hot pink, violet, periwinkle blue, back to amber
vec3 pal(float h){
  h = fract(h) * 6.0;
  vec3 c0 = vec3(1.00, 0.42, 0.22), c1 = vec3(1.00, 0.22, 0.30), c2 = vec3(1.00, 0.30, 0.62),
       c3 = vec3(0.68, 0.32, 1.00), c4 = vec3(0.42, 0.50, 1.00), c5 = vec3(1.00, 0.62, 0.30);
  float f = fract(h); f = f * f * (3.0 - 2.0 * f);
  if (h < 1.0) return mix(c0, c1, f); if (h < 2.0) return mix(c1, c2, f); if (h < 3.0) return mix(c2, c3, f);
  if (h < 4.0) return mix(c3, c4, f); if (h < 5.0) return mix(c4, c5, f); return mix(c5, c0, f);
}
void main(){
  vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
  float ndv = abs(dot(N, V)), fres = pow(1.0 - ndv, 3.0);
  // big soft patches of colour over the whole house; they slide as the house turns
  vec3 q = vW * 0.32;
  float field = sin(q.x * 1.3 + uTurn * 2.2 + uTime * 0.05) + sin(q.y * 1.7 - q.z * 0.9 + uTurn * 1.4)
              + sin((q.x + q.z) * 0.9 - uTime * 0.04) * 0.8;
  float h = field * 0.22 + ndv * 0.22 + vSeed * 0.05 + uTurn * 0.25;
  vec3 col = pal(h);
  // glow from a lamp low in the middle of the house
  float d = length(vW - uLight);
  float lamp = 0.45 + 0.75 * exp(-d * 0.22);
  float has = step(0.0, vCell);
  if (has > 0.5) {
    vec2 cell = vec2(mod(vCell, uPer), uPer - 1.0 - floor(vCell / uPer));
    vec3 photo = texture2D(uAtlas, (cell + clamp(vUv, 0.08, 0.92)) / uPer, 2.2).rgb;
    float lum = dot(photo, vec3(0.3, 0.55, 0.15));
    vec3 tint = photo / max(lum, 0.08);
    col = mix(col, col * (0.5 + lum) * mix(vec3(1.0), clamp(tint, 0.0, 2.0), 0.45), 0.85);   // the photo glows through frosted glass
  } else col *= 0.62;
  // frosted cube: brighter in the middle of each face, a fine light seam on the edges
  vec3 a = abs(vL) * 2.0;
  float e1 = max(a.x, max(a.y, a.z)), e2 = a.x + a.y + a.z - e1 - min(a.x, min(a.y, a.z));
  float seam = smoothstep(0.9, 0.99, e2);
  float inner = 1.0 - 0.18 * smoothstep(0.3, 0.95, e2);
  float shimmer = 0.9 + 0.1 * sin(uTime * 1.1 + vSeed * 20.0 + dot(vW, vec3(1.3, 0.7, 1.1)));
  col *= lamp * inner * shimmer * (0.72 + vSeed * 0.4) * 0.78;
  col += pal(h + 0.33) * fres * 0.45;                 // the iridescent rim: another colour at grazing angles
  col = mix(col, col * 0.55 + pal(h + 0.15) * 0.25 * lamp, seam);
  float age = uTime - vBirth;
  col += vec3(1.0, 0.75, 0.65) * has * step(0.0, age) * exp(-max(age, 0.0) * 1.4) * 2.0;
  if (abs(vId - uHover) < 0.5) col = col * 1.6 + 0.12;
  float alpha = 0.86;
  if (uMirror > 0.5) { col *= 0.55 * exp(vW.y * 0.6); alpha = 1.0; }
  gl_FragColor = vec4(col, alpha);
}`;
const glassMat = new THREE.ShaderMaterial({ vertexShader: glassVert, fragmentShader: glassFrag, uniforms,
  transparent: true, depthWrite: true, side: THREE.FrontSide });
const house = new THREE.Mesh(inst, glassMat); house.frustumCulled = false; house.renderOrder = 3; world.add(house);
const mirrorMat = glassMat.clone(); mirrorMat.uniforms = { ...uniforms, uMirror: { value: 1 } }; mirrorMat.side = THREE.BackSide;
const mirror = new THREE.Mesh(inst, mirrorMat); mirror.frustumCulled = false; mirror.renderOrder = 1; world.add(mirror);

// Floor: dark, slightly glossy, lit by the house. Coloured rays spill out across it.
const floorMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime: uniforms.uTime, uTurn: uniforms.uTurn, uInside: uniforms.uInside },
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `uniform float uTime, uTurn, uInside; varying vec3 vW;
  void main(){
    float r = length(vW.xz), a = atan(vW.z, vW.x);
    float rays = pow(0.5 + 0.5*sin(a*13.0 + sin(a*5.0)*1.5 + uTurn*0.6), 6.0) * 0.8 + pow(0.5 + 0.5*sin(a*7.0 - 1.3), 10.0);
    float fall = exp(-max(r - 3.0, 0.0) * 0.32);
    vec3 c1 = vec3(1.0, 0.3, 0.35), c2 = vec3(0.55, 0.4, 1.0), c3 = vec3(1.0, 0.55, 0.3);
    vec3 tint = mix(mix(c1, c2, 0.5 + 0.5*sin(a*2.0 + uTurn)), c3, 0.5 + 0.5*sin(a*3.0 - 0.7));
    vec3 col = tint * (rays * fall * 0.55 + exp(-r * 0.35) * 0.35) * (1.0 - uInside * 0.75);
    float dim = smoothstep(26.0, 6.0, r);
    gl_FragColor = vec4(col * dim + vec3(0.025, 0.014, 0.02), 0.62);
  }` });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), floorMat);
floor.rotation.x = -Math.PI / 2; floor.renderOrder = 2; world.add(floor);
// the back wall of the room catches a soft glow
const wallGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: softTex, color: new THREE.Color(0.22, 0.08, 0.12),
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
wallGlow.scale.set(40, 22, 1); wallGlow.position.set(0, 4, -14); world.add(wallGlow);

// Floating dust of light, slow and few.
const DUST = 260, dPos = new Float32Array(DUST * 3), dSeed = new Float32Array(DUST);
for (let i = 0; i < DUST; i++) { dPos[i * 3] = (Math.random() - 0.5) * 18; dPos[i * 3 + 1] = Math.random() * 10; dPos[i * 3 + 2] = (Math.random() - 0.5) * 16; dSeed[i] = Math.random(); }
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3)); dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dSeed, 1));
const dustMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: uniforms.uTime, uScale: { value: 1 } },
  vertexShader: `attribute float aSeed; uniform float uTime, uScale; varying float vA, vS;
    void main(){ vec3 p = position; p.y = mod(p.y + uTime * (0.08 + aSeed * 0.12), 10.0); p.x += sin(uTime*0.3 + aSeed*30.0)*0.4;
      vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv; vS = aSeed;
      vA = (0.3 + 0.7*sin(uTime*1.5 + aSeed*40.0)*0.5+0.35) * smoothstep(0.0, 1.5, p.y) * smoothstep(10.0, 7.0, p.y);
      gl_PointSize = (4.0 + aSeed * 10.0) * uScale / -mv.z; }`,
  fragmentShader: `varying float vA, vS; void main(){ float r = length(gl_PointCoord-0.5); if (r > 0.5) discard;
    vec3 c = mix(vec3(1.0,0.55,0.6), vec3(0.7,0.6,1.0), vS); gl_FragColor = vec4(c * smoothstep(0.5,0.0,r) * vA * 0.6, 1.0); }` });
const dust = new THREE.Points(dustGeo, dustMat); dust.frustumCulled = false; dust.renderOrder = 4; world.add(dust);

// Floating panes inside: thin glass cards, one per piece, visible when you step in.
const MAXF = 32, CARD = 1.15;
const cardGeo = new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(CARD, CARD, 0.05));
const fOff = new Float32Array(MAXF * 3), fCell = new Float32Array(MAXF).fill(-1), fBirth = new Float32Array(MAXF).fill(-100), fSeed = new Float32Array(MAXF);
for (let i = 0; i < MAXF; i++) fSeed[i] = hash(i * 7.7);
cardGeo.setAttribute('aOff', new THREE.InstancedBufferAttribute(fOff, 3));
cardGeo.setAttribute('aCell', new THREE.InstancedBufferAttribute(fCell, 1));
cardGeo.setAttribute('aBirth', new THREE.InstancedBufferAttribute(fBirth, 1));
cardGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(fSeed, 1));
cardGeo.instanceCount = 0;
// cards face the camera: rotate the box per instance in the vertex shader
const cardMat = glassMat.clone();
cardMat.uniforms = { ...uniforms, uAtlas: { value: cardTex }, uPer: { value: PER2 }, uMirror: { value: 0 }, uHover: { value: -1 }, uCam: { value: new THREE.Vector3() }, uFade: { value: 0 } };
cardMat.vertexShader = glassVert.replace('vec3 p = position + aOff;', `
  vec3 f = normalize(vec3(uCam.x - aOff.x, 0.0, uCam.z - aOff.z) + 1e-4);
  vec3 r = normalize(cross(vec3(0.0,1.0,0.0), f));
  vec3 p = aOff + r * position.x + vec3(0.0,1.0,0.0) * position.y + f * position.z;`)
  .replace('uniform float uMirror;', 'uniform float uMirror; uniform vec3 uCam;')
  .replace(`vL = position / ${(S * 0.97).toFixed(3)};`, `vL = position / vec3(${CARD.toFixed(3)}, ${CARD.toFixed(3)}, 0.05);`)
  .replace('vN = normalize(mat3(modelMatrix) * (normal * vec3(1.0, uMirror > 0.5 ? -1.0 : 1.0, 1.0)));',
    'vN = normalize(mat3(modelMatrix) * (r * normal.x + vec3(0.0,1.0,0.0) * normal.y + f * normal.z));');
cardMat.fragmentShader = glassFrag.replace('uniform float uTime,', 'uniform float uFade; uniform float uTime,')
  .replace('col = mix(col, col * (0.5 + lum)', 'col = mix(col * 0.5, photo * 1.1, 0.8); col = mix(col, col * (0.5 + lum)').replace('0.45), 0.85);', '0.45), 0.0);')
  .replace(', 2.2).rgb', ', 0.4).rgb')
  .replace('col += pal(h + 0.33) * fres * 0.45;', 'col += pal(h + 0.33) * (fres * 1.2 + seam * 0.6);')
  .replace('gl_FragColor = vec4(col, alpha);', 'gl_FragColor = vec4(col * 0.95, (0.8 + seam * 0.2) * uFade);');
cardMat.depthWrite = false;
const cards = new THREE.Mesh(cardGeo, cardMat); cards.frustumCulled = false; cards.renderOrder = 5; world.add(cards);

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
  aCell[v] = cell; aBirth[v] = born;
  inst.attributes.aCell.needsUpdate = true; inst.attributes.aBirth.needsUpdate = true;
  // the newest pieces float inside; the oldest card makes room
  const k = cardNext++ % MAXF;
  if (cardOwner[k] != null) delete pieces.get(cardOwner[k]).card;
  cardOwner[k] = info.slot;
  drawCell(cctx, k, PER2, CELL2, img); cardTex.needsUpdate = true;
  fCell[k] = k; fBirth[k] = born; cardGeo.instanceCount = Math.max(cardGeo.instanceCount, k + 1);
  cardGeo.attributes.aCell.needsUpdate = true; cardGeo.attributes.aBirth.needsUpdate = true;
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
const center = new THREE.Vector3(0, HOUSE_H * 0.42, 0);
function frameCamera(dt) {
  view.inside += (view.insideT - view.inside) * (1 - Math.exp(-dt * 1.8));
  const e = view.inside, ease = e * e * (3 - 2 * e);
  const half = Math.tan(THREE.MathUtils.degToRad(40 / 2));
  const dist = Math.max((HOUSE_H * 0.5 + 1.5) / half, (Math.hypot(WX, DZ) * S * 0.5 + 1) / (half * camera.aspect)) * 1.45 * view.zoom;
  const dir = new THREE.Vector3(Math.sin(view.yaw) * Math.cos(view.pitch), Math.sin(view.pitch), Math.cos(view.yaw) * Math.cos(view.pitch));
  const eye = new THREE.Vector3(0, 1.5, 0);
  const outPos = center.clone().addScaledVector(dir, dist);
  const inPos = eye.clone().addScaledVector(dir, 0.15);
  camera.position.lerpVectors(outPos, inPos, ease);
  camera.position.y = Math.max(0.25, camera.position.y);
  const look = center.clone().lerp(eye.clone().addScaledVector(dir, -5).setY(eye.y + view.pitch * -2), ease);
  camera.lookAt(look);
  camera.fov = lerp(40, 72, ease); camera.updateProjectionMatrix();
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
  const n = cardGeo.instanceCount;
  for (let i = 0; i < n; i++) {
    const s = fSeed[i], a = i * 2.39996 + t * 0.03, ring = 2.3 + (i % 3) * 0.3;
    fOff[i * 3] = Math.cos(a) * ring * 1.1; fOff[i * 3 + 1] = 0.9 + ((i * 3) % 5) * 0.62 + Math.sin(t * 0.5 + s * 9) * 0.1; fOff[i * 3 + 2] = Math.sin(a) * ring * 0.8;
  }
  cardGeo.attributes.aOff.needsUpdate = true;
  cardMat.uniforms.uCam.value.copy(camera.position);
  cardMat.uniforms.uFade.value = clamp((ease - 0.45) / 0.45, 0, 1);
  cards.visible = cardMat.uniforms.uFade.value > 0.01;
  compMat.uniforms.uBloom.value = lerp(1.15, 0.8, ease);
  updateHover();
  renderFrame(t);
  drawHands(now);
  if (!$('#debug').hidden) $('#debug').textContent = `${pieces.size} pieces · ${N} glass cubes · ${renderer.info.render.calls} draws`;
  requestAnimationFrame(frame);
}

// ---------- picking ----------
let pointerNdc = null, pointerSource = 'mouse', dwell = { key: null, t: 0 };
const pickBoxes = new THREE.InstancedMesh(boxGeo, new THREE.MeshBasicMaterial(), N);
{ const m = new THREE.Matrix4(); voxels.forEach((v, i) => { m.makeTranslation(v.pos.x, v.pos.y, v.pos.z); pickBoxes.setMatrixAt(i, m); }); }
const pickCards = new THREE.InstancedMesh(new THREE.BoxGeometry(CARD, CARD, 0.05), new THREE.MeshBasicMaterial(), MAXF);
const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(S * 1.04, S * 1.04, S * 1.04)),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
outline.visible = false; outline.renderOrder = 9; world.add(outline);
function updateHover() {
  if (!pointerNdc) { setHover(null); return; }
  ray.setFromCamera(pointerNdc, camera);
  if (cards.visible) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < cardGeo.instanceCount; i++) {
      const p = new THREE.Vector3(fOff[i * 3], fOff[i * 3 + 1], fOff[i * 3 + 2]);
      q.setFromRotationMatrix(new THREE.Matrix4().lookAt(camera.position.clone().setY(p.y), p, new THREE.Vector3(0, 1, 0)));
      pickCards.setMatrixAt(i, m.compose(p, q, new THREE.Vector3(1, 1, 1)));
    }
    pickCards.count = cardGeo.instanceCount; pickCards.instanceMatrix.needsUpdate = true; pickCards.computeBoundingSphere();
    const hc = ray.intersectObject(pickCards)[0];
    if (hc) { const slot = [...pieces.values()].find(p => p.card === hc.instanceId)?.slot; if (slot != null) { setHover({ slot, card: hc.instanceId }); return; } }
  }
  pickBoxes.computeBoundingSphere();
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
  if (hover.voxel != null) { outline.visible = true; outline.position.copy(voxels[hover.voxel].pos); } else outline.visible = false;
  const p = hover.slot != null ? pieces.get(hover.slot) : null;
  if (p) setCaption(`Piece ${p.slot + 1} · ${p.demo ? 'test piece' : timeAgo(p.t)}`);
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
  pointerNdc = new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
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
      pointerNdc = new THREE.Vector2(c.x * 2 - 1, -(c.y * 2 - 1));
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
    const top = pts.reduce((m, q) => (q.y > m.y ? q : m), pts[0]), fs = 17 * dpr;
    hctx.font = `500 ${fs}px Inter, system-ui, sans-serif`;
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
const DEMO = ['🏠', '🍜', '🌻', '🐈', '🎧', '🚲', '☕️', '📚', '🌧️', '🧸', '🪴', '🍕', '🎸', '🌙', '🧦', '🫖', '🕯️', '🍞'];
function addDemoPieces(n) {
  const t = clock();
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), hue = [350, 15, 30, 280, 220, 330][(Math.random() * 6) | 0] + Math.random() * 20;
    const g = x.createLinearGradient(0, 0, 128, 128);
    g.addColorStop(0, `hsl(${hue},80%,65%)`); g.addColorStop(1, `hsl(${(hue + 40) % 360},70%,40%)`);
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    x.font = '64px serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(DEMO[(Math.random() * DEMO.length) | 0], 64, 68);
    let slot = 0; while (pieces.has(slot)) slot++;
    addPiece({ id: 'demo' + slot, slot, demo: true }, c, t + i * 0.015);
  }
}

// ---------- start ----------
fetch('/api/info').then(r => r.json()).then(i => setPhoneUrl(i.phoneUrl)).catch(() => {});
await loadAll();
connect();
requestAnimationFrame(frame);
initHands();
window.house = { view, pieces, addDemoPieces, onHands: (...a) => onHands(...a), openFocus, count: N };
