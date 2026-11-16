// Hand gesture classification + multi-hand tracking on top of MediaPipe HandLandmarker.
// Landmark indices: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
// 0 wrist, 4 thumb tip, 8 index tip, 12 middle tip, 16 ring tip, 20 pinky tip, 9 middle MCP.

export const G = {
  NONE: 'none',
  POINT: 'point',     // index finger only: hover cursor, no ink
  PINCH: 'pinch',     // thumb + index together: draw
  OPEN: 'open',       // open palm: eraser
  FIST: 'fist',       // closed fist: grab and move the canvas
  PEACE: 'peace',     // index + middle: next colour
  ROCK: 'rock',       // index + pinky: next brush
  THUMBS: 'thumbs',   // thumbs up held: save to gallery
};

const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function fingerUp(lm, tip, pip) {
  // A finger is extended when its tip is clearly farther from the wrist than its middle joint.
  return d(lm[tip], lm[0]) > d(lm[pip], lm[0]) * 1.12;
}

export function classify(lm, wasPinching) {
  const scale = d(lm[0], lm[9]) || 1e-6;
  const pinchRatio = d(lm[4], lm[8]) / scale;
  const index = fingerUp(lm, 8, 6);
  const middle = fingerUp(lm, 12, 10);
  const ring = fingerUp(lm, 16, 14);
  const pinky = fingerUp(lm, 20, 18);
  // Thumb: tip away from the index MCP compared to the thumb IP joint.
  const thumbOut = d(lm[4], lm[5]) > d(lm[3], lm[5]) * 1.15 && d(lm[4], lm[9]) / scale > 0.75;

  // Hysteresis so a stroke does not break when fingers wobble.
  // A fist also brings thumb and index tips together, so a pinch additionally needs the index
  // finger to be at least half-extended (tip away from its knuckle). Tuned on MediaPipe sample photos.
  const indexReach = d(lm[8], lm[5]) / scale;
  const pinching = indexReach > 0.36 && (wasPinching ? pinchRatio < 0.5 : pinchRatio < 0.3);
  if (pinching && !ring && !pinky) return { g: G.PINCH, scale };

  const n = [index, middle, ring, pinky].filter(Boolean).length;
  if (n === 4) return { g: G.OPEN, scale };
  if (n === 0) {
    const thumbUp = thumbOut && lm[4].y < lm[3].y && lm[4].y < lm[5].y - scale * 0.3;
    return { g: thumbUp ? G.THUMBS : G.FIST, scale };
  }
  if (index && middle && !ring && !pinky) return { g: G.PEACE, scale };
  if (index && pinky && !middle && !ring) return { g: G.ROCK, scale };
  if (index && !middle && !ring && !pinky) return { g: G.POINT, scale };
  return { g: G.NONE, scale };
}

// Keeps a stable identity per hand across frames (MediaPipe's output order is not stable),
// smooths the cursor, and debounces gesture changes.
export class HandTracker {
  constructor({ stableFrames = 3, smoothing = 0.45, maxJump = 0.25 } = {}) {
    this.tracks = new Map();
    this.nextId = 1;
    this.stableFrames = stableFrames;
    this.smoothing = smoothing;
    this.maxJump = maxJump;
  }

  update(hands, now) {
    // hands: [{ landmarks, handedness }]
    const unmatched = new Set(this.tracks.keys());
    const results = [];
    for (const h of hands) {
      const wrist = h.landmarks[0];
      let best = null, bestD = this.maxJump;
      for (const id of unmatched) {
        const t = this.tracks.get(id);
        const dd = d(t.wrist, wrist);
        if (dd < bestD) { best = id; bestD = dd; }
      }
      let t;
      if (best == null) {
        t = { id: this.nextId++, raw: G.NONE, rawCount: 0, gesture: G.NONE, since: now, x: null, y: null, wrist };
        this.tracks.set(t.id, t);
      } else {
        t = this.tracks.get(best);
        unmatched.delete(best);
      }
      t.wrist = wrist;
      t.seen = now;
      t.landmarks = h.landmarks;
      t.handedness = h.handedness;

      const { g, scale } = classify(h.landmarks, t.gesture === G.PINCH);
      if (g === t.raw) t.rawCount++; else { t.raw = g; t.rawCount = 1; }
      const prevGesture = t.gesture;
      // Pinch starts/stops fast, everything else needs a few stable frames.
      const need = g === G.PINCH || prevGesture === G.PINCH ? 2 : this.stableFrames;
      if (t.rawCount >= need && g !== t.gesture) { t.gesture = g; t.since = now; }
      t.changed = t.gesture !== prevGesture;
      t.scale = t.scale == null ? scale : t.scale * 0.8 + scale * 0.2;

      // Cursor: midpoint of thumb & index while pinching, otherwise index tip (palm centre for open/fist).
      const lm = h.landmarks;
      let p;
      if (t.gesture === G.PINCH) p = { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 };
      else if (t.gesture === G.OPEN || t.gesture === G.FIST || t.gesture === G.THUMBS) p = { x: (lm[0].x + lm[9].x) / 2, y: (lm[0].y + lm[9].y) / 2 };
      else p = { x: lm[8].x, y: lm[8].y };
      if (t.x == null || t.changed) { t.x = p.x; t.y = p.y; }
      else { const a = this.smoothing; t.x = t.x * a + p.x * (1 - a); t.y = t.y * a + p.y * (1 - a); }
      results.push(t);
    }
    // Forget hands not seen for 400 ms.
    for (const id of unmatched) {
      const t = this.tracks.get(id);
      if (now - t.seen > 400) this.tracks.delete(id);
      else t.lost = true;
    }
    for (const t of results) t.lost = false;
    return results;
  }
}
