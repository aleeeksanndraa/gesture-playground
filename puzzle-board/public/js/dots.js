// Animated ring of small dots (several rows), with a few dots glowing in colour that slowly
// travel around. Same motif as the halo on the board.
export function dotRing(canvas, { rows = 6, inner = 0.66, outer = 0.98, color = '#7a5cff', speed = 0.35 } = {}) {
  const ctx = canvas.getContext('2d');
  const dots = [];
  for (let r = 0; r < rows; r++) {
    const rad = inner + (outer - inner) * r / (rows - 1);
    const n = Math.round(46 + rad * 30);
    for (let i = 0; i < n; i++) {
      dots.push({ a: (i + (r % 2) * 0.5) / n * Math.PI * 2, rad, seed: Math.random() });
    }
  }
  const state = { color, angle: -Math.PI / 2, burst: 0 };
  let raf, last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    state.angle += dt * speed * (1 + state.burst * 6);
    state.burst = Math.max(0, state.burst - dt * 0.5);
    const W = canvas.width, H = canvas.height, R = Math.min(W, H) / 2, cx = W / 2, cy = H / 2, t = now / 1000;
    ctx.clearRect(0, 0, W, H);
    for (const d of dots) {
      let diff = Math.abs(((d.a - state.angle) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      const hi = Math.max(0, 1 - diff / (0.22 + state.burst * 2.2));
      const x = cx + Math.cos(d.a) * d.rad * R, y = cy + Math.sin(d.a) * d.rad * R;
      const tw = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * (0.6 + d.seed * 1.5) + d.seed * 40));
      const size = R * (0.008 + d.seed * 0.006 + hi * 0.016);
      if (hi > 0.05) {
        ctx.globalAlpha = hi * 0.6;
        const g = ctx.createRadialGradient(x, y, 0, x, y, size * 4);
        g.addColorStop(0, state.color); g.addColorStop(1, 'transparent');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, size * 4, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = Math.min(1, tw + hi);
      ctx.fillStyle = hi > 0.05 ? mixWhite(state.color, 1 - hi) : '#fff';
      ctx.beginPath(); ctx.arc(x, y, size, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return {
    setColor(c) { state.color = c; },
    burst() { state.burst = 1; },
    stop() { cancelAnimationFrame(raf); },
  };
}

function mixWhite(hex, k) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const m = v => Math.round(v + (255 - v) * k);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
