// Draws one glass puzzle piece on a 2D canvas: the picture inside the puzzle outline, with a
// soft shine and bright rim like iOS liquid glass. Used on the phone and for the "new piece"
// moment on the board. The 3D board uses the same look in a shader (board.js).
import { tracePieceInSquare } from './puzzle.js';

export function drawGlassPiece(ctx, source, edges, size, { x = 0, y = 0, shadow = true } = {}) {
  const path = () => { ctx.beginPath(); tracePieceInSquare(ctx, edges, size, x, y); };
  ctx.save();

  if (shadow) {
    ctx.save();
    path();
    ctx.shadowColor = 'rgba(0,0,20,0.45)';
    ctx.shadowBlur = size * 0.06;
    ctx.shadowOffsetY = size * 0.025;
    ctx.fillStyle = 'rgba(30,34,60,0.9)';
    ctx.fill();
    ctx.restore();
  }

  // Picture (or frosted glass if there is none yet).
  ctx.save();
  path(); ctx.clip();
  if (source) ctx.drawImage(source, x, y, size, size);
  else {
    const g = ctx.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, 'rgba(255,255,255,0.28)'); g.addColorStop(1, 'rgba(255,255,255,0.08)');
    ctx.fillStyle = g; ctx.fillRect(x, y, size, size);
  }
  // Shine: a soft diagonal sheen from the top-left, and a light band near the top.
  const sheen = ctx.createLinearGradient(x, y, x + size * 0.7, y + size * 0.7);
  sheen.addColorStop(0, 'rgba(255,255,255,0.38)');
  sheen.addColorStop(0.35, 'rgba(255,255,255,0.08)');
  sheen.addColorStop(0.6, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen; ctx.fillRect(x, y, size, size);
  const low = ctx.createLinearGradient(x, y + size, x, y + size * 0.6);
  low.addColorStop(0, 'rgba(10,10,40,0.25)'); low.addColorStop(1, 'rgba(10,10,40,0)');
  ctx.fillStyle = low; ctx.fillRect(x, y, size, size);
  // Thick-glass edge: a frosted band just inside the outline.
  path();
  ctx.lineWidth = size * 0.05; ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.stroke();
  ctx.lineWidth = size * 0.022; ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.stroke();
  ctx.restore();

  // Crisp rim: bright on top-left, darker on bottom-right, like light catching the edge.
  path();
  const rim = ctx.createLinearGradient(x, y, x + size, y + size);
  rim.addColorStop(0, 'rgba(255,255,255,0.95)');
  rim.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  rim.addColorStop(1, 'rgba(255,255,255,0.7)');
  ctx.lineWidth = Math.max(1.5, size * 0.007);
  ctx.strokeStyle = rim; ctx.stroke();
  ctx.restore();
}
