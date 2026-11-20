#!/usr/bin/env node
// Piece of Home: tiny server for the puzzle board.
// No npm install needed, only Node 18+.
//
//   node server.js              → board on http://localhost:8080, phones on the same Wi-Fi
//   TUNNEL=1 node server.js     → also opens a free public https link (needs `cloudflared`),
//                                  so phones can join over mobile data
//   PUBLIC_URL=https://… node server.js → use your own public address for the QR code
//
// It does three things: serves the pages, stores the pieces phones send (in ./data), and pushes
// every new piece to the board live (Server-Sent Events).

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const qrcode = require('./vendor/qrcode.js');

const PORT = Number(process.env.PORT || 8080);
const HERE = __dirname;
const REPO = path.join(HERE, '..');
const DATA = path.join(HERE, 'data');
const PIECES_DIR = path.join(DATA, 'pieces');
const DB = path.join(DATA, 'pieces.json');
const MAX_UPLOAD = 4 * 1024 * 1024;

fs.mkdirSync(PIECES_DIR, { recursive: true });
let pieces = [];
try { pieces = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { pieces = []; }
const save = () => fs.writeFile(DB, JSON.stringify(pieces), () => {});

// ---------- addresses ----------
function lanIp() {
  const all = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal);
  const pref = all.find(a => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a.address));
  return (pref || all[0] || { address: 'localhost' }).address;
}
let publicBase = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/$/, '') : null;
const phoneUrl = () => `${publicBase || `http://${lanIp()}:${PORT}`}/phone`;

// ---------- live updates ----------
const clients = new Set();
function broadcast(type, payload) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20000);

// ---------- static files ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.task': 'application/octet-stream',
  '.woff2': 'font/woff2',
};
// URL prefix → folder. The hand tracking (MediaPipe + model + gesture code) is shared with the
// Doodle Away playground in the folder above, so it isn't copied twice.
const MOUNTS = [
  ['/pieces/', PIECES_DIR],
  ['/shared/', path.join(REPO, 'js')],
  ['/vendor/', path.join(REPO, 'vendor')],
  ['/models/', path.join(REPO, 'models')],
  ['/fonts/', path.join(REPO, 'fonts')],
  ['/', path.join(HERE, 'public')],
];
function serveStatic(req, res, urlPath) {
  if (urlPath === '/' ) urlPath = '/board.html';
  if (urlPath === '/phone' || urlPath === '/phone/') urlPath = '/phone.html';
  for (const [prefix, dir] of MOUNTS) {
    if (!urlPath.startsWith(prefix)) continue;
    const file = path.join(dir, decodeURIComponent(urlPath.slice(prefix.length)));
    if (!file.startsWith(dir)) break;                       // no ../ tricks
    return fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
      const long = prefix === '/pieces/' || prefix === '/vendor/' || prefix === '/models/';
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': long ? 'public, max-age=86400' : 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
    });
  }
  res.writeHead(404); res.end('Not found');
}

// ---------- API ----------
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text); qr.make();
  const n = qr.getModuleCount(), q = 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#0b0d18"/></svg>`;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/api/info') return json(res, 200, { phoneUrl: phoneUrl(), count: pieces.length });
  if (p === '/api/next') return json(res, 200, { slot: pieces.length });
  if (p === '/api/pieces' && req.method === 'GET') return json(res, 200, pieces);
  if (p === '/api/qr.svg') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    return res.end(qrSvg(phoneUrl()));
  }
  if (p === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: info\ndata: ${JSON.stringify({ phoneUrl: phoneUrl() })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (p === '/api/pieces' && req.method === 'POST') {
    let body;
    try { body = JSON.parse((await readBody(req, MAX_UPLOAD)).toString('utf8')); }
    catch { return json(res, 413, { error: 'That picture is too big. Try again.' }); }
    const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(body && body.image || '');
    if (!m) return json(res, 400, { error: 'No picture in the upload.' });
    const buf = Buffer.from(m[2], 'base64');
    const id = (pieces.length ? pieces[pieces.length - 1].id : 0) + 1;
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const file = `${id}.${ext}`;
    fs.writeFileSync(path.join(PIECES_DIR, file), buf);
    const piece = { id, slot: pieces.length, url: `/pieces/${file}`, t: Date.now() };
    pieces.push(piece); save();
    broadcast('piece', piece);
    console.log(`  + piece ${id} (${Math.round(buf.length / 1024)} KB)`);
    return json(res, 200, piece);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, p);
}

http.createServer((req, res) => handle(req, res).catch(err => { console.error(err); try { json(res, 500, { error: 'Server error' }); } catch {} }))
  .listen(PORT, () => {
    console.log(`\n  Piece of Home is running.\n`);
    console.log(`  Board (open on the laptop):  http://localhost:${PORT}`);
    console.log(`  Phones (QR code on board):   ${phoneUrl()}`);
    console.log(`  ${pieces.length} pieces so far. Press Ctrl+C to stop.\n`);
    if (process.env.TUNNEL) startTunnel();
  });

// Optional: a free temporary https address via Cloudflare, so phones can use mobile data.
function startTunnel() {
  let proc;
  try { proc = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`]); }
  catch { return console.log('  (TUNNEL: cloudflared is not installed, see README)'); }
  proc.on('error', () => console.log('  (TUNNEL: cloudflared is not installed, see README)'));
  const look = buf => {
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf.toString());
    if (m && publicBase !== m[0]) {
      publicBase = m[0];
      console.log(`  Public link for phones:      ${phoneUrl()}\n`);
      broadcast('info', { phoneUrl: phoneUrl() });
    }
  };
  proc.stdout.on('data', look); proc.stderr.on('data', look);
  process.on('exit', () => proc.kill());
  process.on('SIGINT', () => process.exit());
}
