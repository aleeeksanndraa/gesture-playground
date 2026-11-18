// Hand gesture classification + hand tracking on top of MediaPipe HandLandmarker.
// Landmark indices: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
// 0 wrist, 4 thumb tip, 8 index tip, 12 middle tip, 16 ring tip, 20 pinky tip, 5 index knuckle, 9 middle knuckle.

export const G = {
  NONE: 'none',       // relaxed hand: pen up
  POINT: 'point',     // index finger out: draw (the fingertip is the pen)
  OPEN: 'open',       // open hand: eraser
  FIST: 'fist',       // fist: pen up
  THUMBS: 'thumbs',   // thumbs up held: save
};

const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// A finger is extended when its tip is clearly farther from the wrist than its middle joint.
const fingerUp = (lm, tip, pip, k = 1.12) => d(lm[tip], lm[0]) > d(lm[pip], lm[0]) * k;

export function classify(lm) {
  const scale = d(lm[0], lm[9]) || 1e-6;
  const index = fingerUp(lm, 8, 6);
  const middle = fingerUp(lm, 12, 10);
  const ring = fingerUp(lm, 16, 14);
  const pinky = fingerUp(lm, 20, 18);
  const n = [index, middle, ring, pinky].filter(Boolean).length;

  if (n >= 4 || (n === 3 && !index)) return { g: G.OPEN, scale };
  // Pointing: index out and clearly longer than the middle finger. The thumb can do anything,
  // and a half-curled middle finger still counts, because that's how people really point.
  const indexReach = d(lm[8], lm[5]) / scale, middleReach = d(lm[12], lm[9]) / scale;
  if (index && !ring && !pinky && (!middle || indexReach > middleReach * 1.5)) return { g: G.POINT, scale };
  if (n === 0) {
    const thumbOut = d(lm[4], lm[5]) > d(lm[3], lm[5]) * 1.15 && d(lm[4], lm[9]) / scale > 0.75;
    const thumbUp = thumbOut && lm[4].y < lm[3].y && lm[4].y < lm[5].y - scale * 0.3;
    return { g: thumbUp ? G.THUMBS : G.FIST, scale };
  }
  return { g: G.NONE, scale };
}

// One Euro filter (Casiez et al.): smooths jitter when the hand is slow, follows closely when
// it moves fast. Much less lag than a plain moving average.
class OneEuro {
  constructor(minCutoff = 1.4, beta = 6, dCutoff = 1.2) { Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: 0 }); }
  static alpha(cutoff, dt) { const r = 2 * Math.PI * cutoff * dt; return r / (r + 1); }
  filter(x, t) {
    if (this.x == null) { this.x = x; this.t = t; return x; }
    const dt = Math.max(1e-3, (t - this.t) / 1000); this.t = t;
    const dx = (x - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (x - this.x);
    return this.x;
  }
  reset() { this.x = null; }
}

// Keeps a stable identity per hand across frames (MediaPipe's output order is not stable),
// filters the cursor, and debounces gesture changes. Tracks survive short dropouts so a line
// doesn't break when the tracker misses a frame or two.
export class HandTracker {
  constructor({ keepMs = 300, maxJump = 0.3 } = {}) {
    this.tracks = new Map();
    this.nextId = 1;
    this.keepMs = keepMs;
    this.maxJump = maxJump;
  }

  update(hands, now) {
    const unmatched = new Set(this.tracks.keys());
    // Match each detection to the nearest existing track (by wrist position).
    for (const h of hands) {
      const wrist = h.landmarks[0];
      let best = null, bestD = this.maxJump;
      for (const id of unmatched) {
        const dd = d(this.tracks.get(id).wrist, wrist);
        if (dd < bestD) { best = id; bestD = dd; }
      }
      let t;
      if (best == null) {
        t = { id: this.nextId++, raw: G.NONE, rawCount: 0, gesture: G.NONE, since: now, fx: new OneEuro(), fy: new OneEuro() };
        this.tracks.set(t.id, t);
      } else { t = this.tracks.get(best); unmatched.delete(best); }
      t.wrist = wrist; t.seen = now; t.lost = false; t.landmarks = h.landmarks;

      const { g, scale } = classify(h.landmarks);
      if (g === t.raw) t.rawCount++; else { t.raw = g; t.rawCount = 1; }
      const prev = t.gesture;
      // Pen down/up is fast (2 frames); save and erase need a little more certainty.
      const need = g === G.POINT || prev === G.POINT || g === G.NONE || g === G.FIST ? 2 : 3;
      if (t.rawCount >= need && g !== t.gesture) { t.gesture = g; t.since = now; }
      t.changed = t.gesture !== prev;
      t.scale = t.scale == null ? scale : t.scale * 0.8 + scale * 0.2;

      // Cursor: the index fingertip; palm centre for open hand / fist / thumbs.
      const lm = h.landmarks;
      const p = t.gesture === G.OPEN || t.gesture === G.FIST || t.gesture === G.THUMBS
        ? { x: (lm[0].x + lm[9].x) / 2, y: (lm[0].y + lm[9].y) / 2 } : lm[8];
      const src = p === lm[8] ? 'tip' : 'palm';
      if (src !== t.src) { t.fx.reset(); t.fy.reset(); t.src = src; }   // no streak when the cursor source jumps
      t.x = t.fx.filter(p.x, now); t.y = t.fy.filter(p.y, now);
    }
    for (const id of unmatched) {
      const t = this.tracks.get(id);
      if (now - t.seen > this.keepMs) this.tracks.delete(id);
      else t.lost = true;
    }
    return [...this.tracks.values()];
  }
}
