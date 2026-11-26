// Stroke rendering shared by the wall app and the gallery replay. Deterministic, so a saved
// drawing replays exactly as it was drawn.
// Smooth pen: each new point draws a quadratic curve through the midpoints of the polyline,
// plus a short straight tail to the newest point (covered by the next curve), so lines look
// like one continuous hand-drawn stroke instead of a chain of straight pieces.
function curveSeg(g, p0, a, b, ox = 0, oy = 0) {
  const c = g.drawingContext;
  const mx = (a[0] + b[0]) / 2 + ox, my = (a[1] + b[1]) / 2 + oy;
  c.beginPath();
  if (p0) c.moveTo((p0[0] + a[0]) / 2 + ox, (p0[1] + a[1]) / 2 + oy); else c.moveTo(a[0] + ox, a[1] + oy);
  c.quadraticCurveTo(a[0] + ox, a[1] + oy, mx, my);
  c.lineTo(b[0] + ox, b[1] + oy);
  c.stroke();
}
const prevPt = (s, i) => (i >= 2 ? s.pts[i - 2] : null);

function hash(n) { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); }

export function drawSegment(g, s, a, b, ox, oy, i) {
  const ax = a[0] + ox, ay = a[1] + oy, bx = b[0] + ox, by = b[1] + oy, w = b[2];
  if (s.brush === 'erase') {
    g.stroke(255); g.erase(); g.strokeWeight(w * 2.2);
    if (!ox && !oy && s.pts && s.pts[i] === b) curveSeg(g, prevPt(s, i), a, b); else g.line(ax, ay, bx, by);
    g.noErase(); return;
  }
  const c = g.color(s.color);
  if (s.brush === 'marker') {
    // Felt-tip marker: width breathes a little like a real pen.
    g.stroke(c);
    g.strokeWeight(w * (0.9 + 0.2 * hash(i * 0.37 + s.seed)));
    if (!ox && !oy && s.pts && s.pts[i] === b) curveSeg(g, prevPt(s, i), a, b); else g.line(ax, ay, bx, by);
  } else if (s.brush === 'ink') {
    g.stroke(c); g.strokeWeight(w); g.line(ax, ay, bx, by);
  } else if (s.brush === 'neon') {
    c.setAlpha(45); g.stroke(c); g.strokeWeight(w * 2.4); g.line(ax, ay, bx, by);
    c.setAlpha(110); g.stroke(c); g.strokeWeight(w * 1.2); g.line(ax, ay, bx, by);
    g.stroke(255, 255, 255, 220); g.strokeWeight(Math.max(2, w * 0.3)); g.line(ax, ay, bx, by);
  } else if (s.brush === 'spray') {
    g.noStroke(); c.setAlpha(170); g.fill(c);
    const n = 6 + Math.floor(w / 3);
    for (let k = 0; k < n; k++) {
      const r = hash(i * 31 + k * 7 + s.seed) * w * 1.3, th = hash(i * 17 + k * 13 + s.seed) * Math.PI * 2;
      const tt = hash(i * 5 + k);
      const px = ax + (bx - ax) * tt + Math.cos(th) * r, py = ay + (by - ay) * tt + Math.sin(th) * r;
      g.circle(px, py, 1.5 + hash(k + i) * w * 0.18);
    }
  }
}
export function drawStroke(g, s, ox, oy) {
  const p = s.pts;
  if (p.length === 1) drawSegment(g, s, p[0], p[0], ox, oy, 0);
  for (let i = 1; i < p.length; i++) drawSegment(g, s, p[i - 1], p[i], ox, oy, i);
}


// "Real world" rendering for the window: each marker line becomes a glossy 3D tube with a soft
// shadow. Each pass goes to its own layer so the joints between segments stay seamless:
// L = { shadow, rim, body, gloss, shine }.
function shade(g, hex, k) {
  const c = g.color(hex);
  return g.color(g.red(c) * k, g.green(c) * k, g.blue(c) * k);
}
export function drawRealSegment(L, s, a, b, i) {
  const ax = a[0], ay = a[1], bx = b[0], by = b[1];
  const w = b[2] * 1.6;
  if (s.brush === 'erase') {
    for (const g of Object.values(L)) { g.stroke(255); g.erase(); g.strokeWeight(b[2] * 2.2); g.line(ax, ay, bx, by); g.noErase(); }
    // the shadow sits offset, so erase it there too
    L.shadow.erase(); L.shadow.strokeWeight(b[2] * 2.6); L.shadow.line(ax + w * 0.5, ay + w * 0.8, bx + w * 0.5, by + w * 0.8); L.shadow.noErase();
    return;
  }
  if (s.brush !== 'marker' && s.brush !== 'ink' && s.brush !== 'neon' && s.brush !== 'spray') return;
  const ox = w * 0.5, oy = w * 0.8, p0 = s.pts && s.pts[i] === b ? prevPt(s, i) : null;
  L.shadow.stroke(0); L.shadow.strokeWeight(w * 1.1); curveSeg(L.shadow, p0, a, b, ox, oy);
  L.rim.stroke(shade(L.rim, s.color, 0.55)); L.rim.strokeWeight(w + 3); curveSeg(L.rim, p0, a, b);
  L.body.stroke(s.color); L.body.strokeWeight(w * 0.82); curveSeg(L.body, p0, a, b);
  const hx = -w * 0.17, hy = -w * 0.2;
  // Opaque strokes here; transparency is applied when the layers are composited, so the
  // overlapping round caps between segments don't show up as beads.
  L.gloss.stroke(255); L.gloss.strokeWeight(w * 0.5); curveSeg(L.gloss, p0, a, b, hx * 0.6, hy * 0.6);
  L.shine.stroke(255); L.shine.strokeWeight(Math.max(1.5, w * 0.16)); curveSeg(L.shine, p0, a, b, hx, hy);
}
