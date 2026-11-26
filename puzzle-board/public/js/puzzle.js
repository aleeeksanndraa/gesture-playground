// Puzzle geometry shared by the board and the phone page.
// Every piece sits in a grid cell. Pieces fill the grid in a square spiral from the centre, so
// the puzzle grows outwards as people add pieces. Each shared edge gets one tab that sticks out of
// one piece and into its neighbour, picked from the edge's position, so neighbours always fit.

// How far a tab sticks out, as a share of the cell side. The texture of a piece is a square of
// side 1 + 2*TAB cells, with the cell itself in the middle.
export const TAB = 0.28;
export const QUAD = 1 + 2 * TAB;

// Square spiral: 0 → (0,0), 1 → (1,0), 2 → (1,1), 3 → (0,1), 4 → (-1,1), ...
export function spiral(i) {
  if (i === 0) return { x: 0, y: 0 };
  const r = Math.ceil((Math.sqrt(i + 1) - 1) / 2);   // ring
  const side = 2 * r, start = (2 * r - 1) ** 2;       // first index of this ring
  const k = i - start;
  if (k < side) return { x: r, y: -r + 1 + k };              // right side, going down
  if (k < 2 * side) return { x: r - 1 - (k - side), y: r };  // bottom, going left
  if (k < 3 * side) return { x: -r, y: r - 1 - (k - 2 * side) }; // left, going up
  return { x: -r + 1 + (k - 3 * side), y: -r };             // top, going right
}

// Number of cells in all rings up to the one that holds piece n-1.
export function ringCells(n) {
  if (n <= 1) return 9;
  const r = Math.max(1, Math.ceil((Math.sqrt(n) - 1) / 2));
  return (2 * r + 1) ** 2;
}

// Deterministic ±1 per edge. 'v' = the vertical edge on the right of (x,y); 'h' = the edge below.
function edgeSign(x, y, kind) {
  let h = (x * 374761393 + y * 668265263 + (kind === 'v' ? 1442695041 : 0)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 1) ? 1 : -1;
}

// +1 = tab sticks out on that side, -1 = hole.
export function edgesAt(x, y) {
  return {
    top: -edgeSign(x, y - 1, 'h'),
    right: edgeSign(x, y, 'v'),
    bottom: edgeSign(x, y, 'h'),
    left: -edgeSign(x - 1, y, 'v'),
  };
}
export const edgesForSlot = slot => { const { x, y } = spiral(slot); return edgesAt(x, y); };

// 16 shapes in total; this is the shape's index in the mask atlas.
export const shapeIndex = e => (e.top > 0) * 8 + (e.right > 0) * 4 + (e.bottom > 0) * 2 + (e.left > 0);
export const edgesFromIndex = i => ({ top: i & 8 ? 1 : -1, right: i & 4 ? 1 : -1, bottom: i & 2 ? 1 : -1, left: i & 1 ? 1 : -1 });

// The tab outline along one edge, in (along, out) units of the cell side.
const TAB_CURVE = [
  [[0.40, 0.00], [0.43, 0.07], [0.385, 0.12]],
  [[0.33, 0.21], [0.42, 0.26], [0.50, 0.26]],
  [[0.58, 0.26], [0.67, 0.21], [0.615, 0.12]],
  [[0.57, 0.07], [0.60, 0.00], [0.65, 0.00]],
];

// Adds the outline of a piece to a 2D path. (ox, oy) = top-left corner of the cell, s = cell side.
export function tracePiece(ctx, edges, ox, oy, s) {
  const corners = [[ox, oy], [ox + s, oy], [ox + s, oy + s], [ox, oy + s]];
  const sides = ['top', 'right', 'bottom', 'left'];
  ctx.moveTo(ox, oy);
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = corners[k], [bx, by] = corners[(k + 1) % 4];
    const dx = (bx - ax) / s, dy = (by - ay) / s;          // along (unit)
    const nx = dy, ny = -dx;                                // outward normal (clockwise path)
    const sign = edges[sides[k]];
    const P = (t, h) => [ax + dx * t * s + nx * h * s * sign, ay + dy * t * s + ny * h * s * sign];
    ctx.lineTo(...P(0.35, 0));
    for (const [c1, c2, e] of TAB_CURVE) ctx.bezierCurveTo(...P(...c1), ...P(...c2), ...P(...e));
    ctx.lineTo(bx, by);
  }
  ctx.closePath();
}

// Outline inside a square canvas of `size` px that has the same framing as a piece texture.
export function tracePieceInSquare(ctx, edges, size, x0 = 0, y0 = 0) {
  const cell = size / QUAD, pad = cell * TAB;
  tracePiece(ctx, edges, x0 + pad, y0 + pad, cell);
}
