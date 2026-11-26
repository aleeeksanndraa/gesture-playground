// Where pieces come from and go to. Two backends with the same functions:
//
//   server   · the little Node server in this folder (server.js) on the laptop. Default.
//   supabase · no server at all: the board and the phone page are static files (e.g. on GitHub
//              Pages) and the photos live in a free Supabase project. Used when js/config.js has
//              supabaseUrl + supabaseAnonKey. The table and bucket are set up with supabase.sql.
//
// A piece is { id, slot, url, t }: slot is its place in the house (0, 1, 2, ... in upload order).
import { CONFIG } from './config.js';
import qrcode from './qrcode.js';

// Supabase is used on GitHub Pages (or anywhere with ?online); the laptop server keeps its own storage.
export const online = !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey) &&
  (location.hostname.endsWith('github.io') || new URLSearchParams(location.search).has('online'));

// ---------- Node server ----------
const server = {
  async info() { return (await fetch('/api/info')).json(); },
  async next() { return (await (await fetch('/api/next', { cache: 'no-store' })).json()).slot; },
  async list() { return (await fetch('/api/pieces')).json(); },
  async upload(dataUrl) {
    const r = await fetch('/api/pieces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: dataUrl }) });
    const piece = await r.json();
    if (!r.ok) throw new Error(piece.error || 'Could not send');
    return piece;
  },
  subscribe({ onPiece, onInfo, onOnline }) {
    let opened = false;
    const es = new EventSource('/api/stream');
    es.addEventListener('piece', e => onPiece(JSON.parse(e.data)));
    es.addEventListener('info', e => onInfo(JSON.parse(e.data).phoneUrl));
    es.onopen = () => { onOnline(true, opened); opened = true; };
    es.onerror = () => onOnline(false);
  },
  qr(url) { return '/api/qr.svg?u=' + encodeURIComponent(url); },
};

// ---------- Supabase ----------
const base = (CONFIG.supabaseUrl || '').replace(/\/$/, ''), key = CONFIG.supabaseAnonKey;
// New-style keys (sb_publishable_…) go only in the apikey header; old anon JWTs also as a bearer token.
const H = key && key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
const toPiece = (row, slot) => ({ id: row.id, slot, url: `${base}/storage/v1/object/public/pieces/${row.path}`, t: Date.parse(row.created_at) });
let known = [];   // rows in upload order; a piece's slot is its index here
async function rows(afterId = 0) {
  const r = await fetch(`${base}/rest/v1/pieces?select=id,path,created_at&id=gt.${afterId}&order=id.asc&limit=10000`, { headers: H, cache: 'no-store' });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}
const supabase = {
  async info() { return { phoneUrl: new URL('phone.html', location.href).href }; },
  async next() {
    const r = await fetch(`${base}/rest/v1/pieces?select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' }, cache: 'no-store' });
    return +((r.headers.get('content-range') || '').split('/')[1] || 0);
  },
  async list() { known = await rows(); return known.map(toPiece); },
  async upload(dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    if (blob.size > 2.5e6) throw new Error('That picture is too big. Try again.');
    const path = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const up = await fetch(`${base}/storage/v1/object/pieces/${path}`, { method: 'POST', headers: { ...H, 'Content-Type': 'image/jpeg' }, body: blob });
    if (!up.ok) throw new Error('Could not send the photo. Try again.');
    const r = await fetch(`${base}/rest/v1/pieces`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ path }) });
    if (!r.ok) throw new Error('Could not send. Try again.');
    const [row] = await r.json();
    return { ...toPiece(row, Math.max(0, (await this.next()) - 1)) };
  },
  // New pieces: a light poll every 3 s (no extra library, works everywhere).
  subscribe({ onPiece, onOnline }) {
    const tick = async () => {
      try {
        const fresh = await rows(known.length ? known[known.length - 1].id : 0);
        for (const row of fresh) { known.push(row); onPiece(toPiece(row, known.length - 1)); }
        onOnline(true, false);
      } catch { onOnline(false); }
    };
    setInterval(tick, 3000);
  },
  qr(url) {
    const q = qrcode(0, 'M'); q.addData(url); q.make();
    const n = q.getModuleCount(), m = 2; let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#0b0d18"/></svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  },
};

export const api = online ? supabase : server;
