// Where pieces come from and go to. Two backends with the same functions:
//
//   server   · the little Node server in this folder (server.js) on the laptop. Default.
//   supabase · no server at all: the board and the phone page are static files (e.g. on GitHub
//              Pages) and the photos live in a free Supabase project. Used when js/config.js has
//              supabaseUrl + supabaseAnonKey. The table and bucket are set up with supabase.sql.
//
// A piece is { id, slot, url, t, topic }: slot is its place in the house. A visitor can ask for a
// particular empty place (the QR inside the house); otherwise it takes the first free one.
// topic is what the photo is about (see topics.js), or null. redraw: a drawing over the piece
// already in that slot, which replaces its picture.
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
  async upload(dataUrl, { topic = null, slot = null, redraw = false } = {}) {
    const r = await fetch('/api/pieces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: dataUrl, topic, slot, redraw }) });
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
// Every board places rows the same way, in upload order: the asked-for slot if it is still free,
// otherwise the first free one.
let used = new Set(), cursor = 0, known = [];
function place(row) {
  let s = Number.isInteger(row.slot) && row.slot >= 0 ? row.slot : null;
  if (row.redraw && s != null && used.has(s)) return s;   // a drawing on an existing piece: same place
  if (s == null || used.has(s)) { while (used.has(cursor)) cursor++; s = cursor; }
  used.add(s); return s;
}
const toPiece = row => ({ id: row.id, slot: row._slot, topic: row.topic || null, redraw: !!row.redraw, url: `${base}/storage/v1/object/public/pieces/${row.path}`, t: Date.parse(row.created_at) });
let extra = true;   // the topic/slot columns exist (supabase.sql); older projects only have id, path, created_at
async function rows(afterId = 0) {
  const q = cols => fetch(`${base}/rest/v1/pieces?select=${cols}&id=gt.${afterId}&order=id.asc&limit=10000`, { headers: H, cache: 'no-store' });
  let r = extra ? await q('id,path,created_at,topic,slot,redraw') : null;
  if (!r || r.status === 400) { extra = false; r = await q('id,path,created_at'); }
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}
function take(fresh) {
  const seen = new Set(known.map(r => r.id)), out = [];
  for (const row of fresh) { if (seen.has(row.id)) continue; seen.add(row.id); row._slot = place(row); known.push(row); out.push(row); }
  return out.map(toPiece);
}
const supabase = {
  async info() { return { phoneUrl: new URL('phone.html', location.href).href }; },
  async next() {
    const r = await fetch(`${base}/rest/v1/pieces?select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' }, cache: 'no-store' });
    return +((r.headers.get('content-range') || '').split('/')[1] || 0);
  },
  async list() { used = new Set(); cursor = 0; known = []; return take(await rows()); },
  async upload(dataUrl, { topic = null, slot = null, redraw = false } = {}) {
    const blob = await (await fetch(dataUrl)).blob();
    if (blob.size > 2.5e6) throw new Error('That picture is too big. Try again.');
    const path = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const up = await fetch(`${base}/storage/v1/object/pieces/${path}`, { method: 'POST', headers: { ...H, 'Content-Type': 'image/jpeg' }, body: blob });
    if (!up.ok) throw new Error('Could not send the photo. Try again.');
    const ins = body => fetch(`${base}/rest/v1/pieces`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body) });
    let r = await ins({ path, topic, slot: Number.isInteger(slot) ? slot : null, redraw: !!redraw });
    if (r.status === 400) r = await ins({ path });   // the project has no topic/slot columns yet
    if (!r.ok) throw new Error('Could not send. Try again.');
    const [row] = await r.json();
    return { id: row.id, topic, slot, url: `${base}/storage/v1/object/public/pieces/${path}` };
  },
  // New pieces: a light poll every 3 s (no extra library, works everywhere).
  subscribe({ onPiece, onOnline }) {
    let busy = false;
    const tick = async () => {
      if (busy) return; busy = true;
      try {
        const fresh = await rows(known.length ? known[known.length - 1].id : 0);
        for (const p of take(fresh)) onPiece(p);
        onOnline(true, false);
      } catch { onOnline(false); }
      busy = false;
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
