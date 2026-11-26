// Drawing storage. Two adapters with the same interface:
//   save(drawing) -> id, list() -> [drawing], get(id) -> drawing, subscribe(fn) -> unsubscribe
// A drawing is { id, createdAt, png (data URL), strokes, width, height, people }.
//
// LocalStore: IndexedDB in this browser + BroadcastChannel, so gallery.html open in another
// tab/window on the same machine updates live. Works offline (good for an exhibition laptop).
//
// SupabaseStore: the online gallery. Enabled when js/config.js has supabaseUrl + supabaseAnonKey.
// Table + bucket setup is in README.md. UNTESTED against a live project so far.

import { CONFIG } from './config.js';

const DB = 'gesture-playground';
const STORE = 'drawings';
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('gesture-playground') : null;

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const tx = async (mode, fn) => {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out.result ?? out);
    t.onerror = () => rej(t.error);
  });
};

export const LocalStore = {
  name: 'local',
  async save(drawing) {
    await tx('readwrite', s => s.put(drawing));
    channel?.postMessage({ type: 'saved', id: drawing.id });
    return drawing.id;
  },
  async list() {
    const all = await tx('readonly', s => s.getAll());
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },
  async get(id) { return tx('readonly', s => s.get(id)); },
  subscribe(fn) {
    if (!channel) return () => {};
    const h = e => e.data?.type === 'saved' && fn(e.data.id);
    channel.addEventListener('message', h);
    return () => channel.removeEventListener('message', h);
  },
};

function dataUrlToBlob(url) {
  const [head, b64] = url.split(',');
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: head.match(/:(.*?);/)[1] });
}

export const SupabaseStore = {
  name: 'supabase',
  headers() {
    return { apikey: CONFIG.supabaseAnonKey, Authorization: `Bearer ${CONFIG.supabaseAnonKey}` };
  },
  async save(drawing) {
    const base = CONFIG.supabaseUrl;
    const path = `${drawing.id}.png`;
    await fetch(`${base}/storage/v1/object/drawings/${path}`, {
      method: 'POST', headers: { ...this.headers(), 'Content-Type': 'image/png' }, body: dataUrlToBlob(drawing.png),
    });
    const row = {
      id: drawing.id, created_at: new Date(drawing.createdAt).toISOString(),
      image_path: path, strokes: drawing.strokes, width: drawing.width, height: drawing.height, people: drawing.people,
    };
    const r = await fetch(`${base}/rest/v1/drawings`, {
      method: 'POST', headers: { ...this.headers(), 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(row),
    });
    if (!r.ok) throw new Error(`Supabase insert failed: ${r.status}`);
    channel?.postMessage({ type: 'saved', id: drawing.id });
    return drawing.id;
  },
  fromRow(r) {
    return {
      id: r.id, createdAt: Date.parse(r.created_at), width: r.width, height: r.height, people: r.people, strokes: r.strokes,
      png: `${CONFIG.supabaseUrl}/storage/v1/object/public/drawings/${r.image_path}`,
    };
  },
  async list() {
    const r = await fetch(`${CONFIG.supabaseUrl}/rest/v1/drawings?select=id,created_at,image_path,width,height,people&order=created_at.desc&limit=200`, { headers: this.headers() });
    return (await r.json()).map(x => this.fromRow(x));
  },
  async get(id) {
    const r = await fetch(`${CONFIG.supabaseUrl}/rest/v1/drawings?id=eq.${encodeURIComponent(id)}&select=*`, { headers: this.headers() });
    const [row] = await r.json();
    return row && this.fromRow(row);
  },
  subscribe(fn) {
    // Simple polling; swap for Supabase Realtime when the project grows.
    let last = null;
    const tick = async () => {
      try { const [top] = await this.list(); if (top && top.id !== last) { if (last) fn(top.id); last = top.id; } } catch {}
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  },
};

export const store = CONFIG.supabaseUrl && CONFIG.supabaseAnonKey ? SupabaseStore : LocalStore;

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
