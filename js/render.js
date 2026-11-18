// Stroke rendering shared by the wall app and the gallery replay. Deterministic, so a saved
// drawing replays exactly as it was drawn.
function hash(n) { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); }

export function drawSegment(g, s, a, b, ox, oy, i) {
  const ax = a[0] + ox, ay = a[1] + oy, bx = b[0] + ox, by = b[1] + oy, w = b[2];
  if (s.brush === 'erase') {
    g.stroke(255); g.erase(); g.strokeWeight(w * 2.2); g.line(ax, ay, bx, by); g.noErase(); return;
  }
  const c = g.color(s.color);
  if (s.brush === 'marker') {
    // Felt-tip marker: width breathes a little like a real pen.
    g.stroke(c);
    g.strokeWeight(w * (0.85 + 0.3 * hash(i * 0.37 + s.seed)));
    g.line(ax, ay, bx, by);
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

