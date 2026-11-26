// Little marker doodles for the page margins, in the spirit of the paper "Doodle Away" sheet.
// Plain SVG strokes; a turbulence filter in the page makes them wobble like real pen lines.

const S = (body, vb = '0 0 48 48') =>
  `<svg viewBox="${vb}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4">${body}</svg>`;

export const DOODLES = {
  star: S(`<path d="M24 5l5.6 12.2 13.2 1.4-9.9 8.9 2.8 13-11.7-6.8-11.6 6.8 2.8-13-9.9-8.9 13.2-1.4z" fill="#f4bf3a" stroke="#d99a16"/>`),
  sun: S(`<circle cx="24" cy="24" r="8" fill="#f9d65c" stroke="#e0a722"/><path d="M24 6v6M24 36v6M6 24h6M36 24h6M11 11l4 4M33 33l4 4M37 11l-4 4M15 33l-4 4" stroke="#e0a722"/>`),
  cloud: S(`<path d="M12 34h24a7 7 0 0 0 0-14 10 10 0 0 0-19-3 8 8 0 0 0-5 17z" fill="#fff" stroke="#e8a33a"/><path d="M18 28c3 2 8 2 11 0" stroke="#e8a33a"/>`),
  boat: S(`<path d="M8 30h32l-5 9H13z" fill="#fff" stroke="#e08a3c"/><path d="M24 30V9l11 15H24" stroke="#e08a3c"/><path d="M4 43c4-2 8 2 12 0s8 2 12 0 8 2 12 0" stroke="#7fb2d6"/>`),
  flower: S(`<g stroke="#c98a12"><circle cx="24" cy="16" r="4" fill="#7a4a12"/><path d="M24 12c-3-7 3-9 3-3M28 15c6-3 8 3 2 3M27 20c5 5-1 8-2 2M21 20c-4 6-9 1-2-1M20 15c-6-3-3-8 2-3" fill="#f6c443"/></g><path d="M24 20v22M24 32c-5-4-9-2-10 0 4 1 7 1 10 0M24 36c4-4 8-3 9-1-3 1-6 2-9 1" stroke="#3f8a55"/>`),
  tree: S(`<path d="M24 44V26M24 32l-6-5M24 29l6-6" stroke="#8a5a2b" stroke-width="3"/><circle cx="24" cy="17" r="11" fill="#2f7a8a" stroke="#235e6a"/><circle cx="19" cy="15" r="1.5" fill="#fff" stroke="none"/><circle cx="28" cy="19" r="1.5" fill="#fff" stroke="none"/><path d="M14 44c6-2 14-2 20 0" stroke="#8fbf5a"/>`),
  computer: S(`<rect x="6" y="9" width="24" height="18" rx="2" stroke="#7b63c6"/><rect x="10" y="13" width="16" height="10" stroke="#7b63c6"/><path d="M18 27v5M12 33h12M4 38h28l-2 5H6z" stroke="#7b63c6"/><rect x="34" y="8" width="9" height="22" rx="1.5" stroke="#7b63c6"/><path d="M37 13h3M37 17h3M38 30c0 6 4 6 6 9" stroke="#7b63c6"/><path d="M3 5l3 3M18 2v4M33 5l-3 3" stroke="#7b63c6"/>`),
  balloon: S(`<path d="M24 6c8 0 12 6 12 12 0 8-8 13-12 15-4-2-12-7-12-15 0-6 4-12 12-12z" fill="#2c8d96" stroke="#1f6c74"/><path d="M24 33c-2 4 3 6 0 12" stroke="#1f6c74"/><path d="M20 12c-2 1-3 3-3 5" stroke="#fff"/><path d="M38 6l3-3M41 12h4M38 18l3 2" stroke="#e4a23a"/>`),
  heart: S(`<path d="M24 40C10 31 6 23 9 16c3-6 11-7 15 0 4-7 12-6 15 0 3 7-1 15-15 24z" fill="#f28aa7" stroke="#d4567d"/>`),
  cake: S(`<path d="M10 26h28v14H10z" fill="#fde3ef" stroke="#7a5ac0"/><path d="M10 31c4 3 6-3 9 0s6-3 10 0 6-3 9 0" stroke="#7a5ac0"/><path d="M18 26v-8M24 26v-9M30 26v-8" stroke="#e8a33a"/><path d="M18 15c-1-2 1-4 0-5M24 14c-1-2 1-4 0-5M30 15c-1-2 1-4 0-5" stroke="#f05a5a"/>`),
  smiley: S(`<circle cx="24" cy="24" r="16" stroke="#6b5bd0"/><circle cx="18" cy="21" r="1.5" fill="#6b5bd0"/><circle cx="30" cy="21" r="1.5" fill="#6b5bd0"/><path d="M17 29c4 4 10 4 14 0M10 14l-4-4M38 14l4-4" stroke="#6b5bd0"/>`),
  swirl: S(`<path d="M24 24c2-1 2-4 0-4s-4 2-4 4 3 7 7 7 8-4 8-9-5-10-11-10-12 5-12 12 6 14 14 14" stroke="#e8728d"/>`),
};

// Hand-drawn looking rectangle path (wobbly edges), seeded so it stays the same on every load.
export function wobblyRect(x, y, w, h, seed = 7, wobble = 3) {
  let s = seed;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 - 0.5; };
  const pts = [];
  const edge = (x0, y0, x1, y1) => {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(4, Math.round(len / 60));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      pts.push([x0 + (x1 - x0) * t + rnd() * wobble, y0 + (y1 - y0) * t + rnd() * wobble]);
    }
  };
  // Corners overshoot a little, like a pencil line that doesn't quite close.
  edge(x - 4, y + 2, x + w, y - 1);
  edge(x + w + 1, y - 3, x + w - 1, y + h);
  edge(x + w + 3, y + h + 1, x, y + h - 1);
  edge(x + 1, y + h + 4, x - 1, y);
  pts.push([x + 6, y + 1]);
  return 'M' + pts.map(p => p.map(v => v.toFixed(1)).join(' ')).join(' L');
}
