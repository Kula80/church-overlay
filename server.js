// Church Overlay - local server for OBS lower thirds.
// Zero dependencies: run with `node server.js` (Node 18+).
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 5500;
const PUBLIC = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });
const MEDIA = path.join(DATA, 'media'); // uploaded logos and backgrounds
fs.mkdirSync(MEDIA, { recursive: true });
const bibles = require('./bible')(DATA);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

const DEFAULT_THEME = {
  position: 'left',      // left | center | right
  width: 62,             // % of screen width
  bottom: 70,            // px from bottom of a 1080p canvas
  accent: '#d4a017',
  bg: '#0f1b2d',
  bgOpacity: 0.88,
  text: '#ffffff',
  font: "'Segoe UI', Arial, sans-serif",
  fontScale: 1,
  animation: 'slide',    // slide | fade
  layout: 'lower',       // lower | full (full screen)
  fullOpacity: 0.9,      // full screen backdrop
};

function readJSON(file, fallback) {
  const full = path.join(DATA, file);
  let text;
  try { text = fs.readFileSync(full, 'utf8'); } catch { return fallback; }
  try { return JSON.parse(text); }
  catch {
    // Keep a damaged file, so the next save can't wipe what might still be rescued from it.
    const copy = `${full}.damaged-${Date.now()}`;
    try { fs.copyFileSync(full, copy); } catch {}
    console.error(`  ${file} could not be read. A copy was kept as ${path.basename(copy)}. Use Restore from backup if something is missing.`);
    return fallback;
  }
}
// Write to a spare file first, so a power cut mid-save can't leave a half-written file.
function writeJSON(file, value) {
  const full = path.join(DATA, file);
  const temp = `${full}.tmp`;
  const text = JSON.stringify(value, null, 2);
  fs.writeFileSync(temp, text);
  try { fs.renameSync(temp, full); }
  catch { fs.writeFileSync(full, text); fs.rmSync(temp, { force: true }); } // e.g. antivirus has the file open
}

// What is on screen right now + the look of the lower third.
const state = {
  live: null,
  theme: { ...DEFAULT_THEME, ...readJSON('theme.json', {}) },
};
// Notes, saved names, messages, history - anything the control panel keeps.
const store = readJSON('store.json', {});

// Name tag timer: shows a name for a while, hides it for a while, and repeats.
// Settings are kept, but it always starts stopped so it never pops up by surprise.
const UNIT_MS = { sec: 1e3, min: 60e3, hour: 3600e3 };
state.auto = {
  showFor: 30, showUnit: 'sec', hideFor: 10, hideUnit: 'min',
  ...readJSON('auto.json', {}),
  on: false, item: null, nextAt: null, hideAt: null,
};
const AUTO_SRC = 'auto';

// Scrolling ticker along the bottom: separate from the lower third, so both can show.
// The text is kept, but it always starts off.
state.ticker = { text: '', label: '', speed: 120, ...readJSON('ticker.json', {}), on: false };
// Church logo (or name) in a corner of the stream, kept on across restarts.
state.logo = { on: false, image: '', text: '', corner: 'top-right', size: 10, opacity: 0.9, ...readJSON('logo.json', {}) };
const saveTicker = () => { const { on, ...t } = state.ticker; writeJSON('ticker.json', t); };
function saveAuto() {
  const { showFor, showUnit, hideFor, hideUnit } = state.auto;
  writeJSON('auto.json', { showFor, showUnit, hideFor, hideUnit });
}
function autoTick() {
  const a = state.auto;
  const now = Date.now();
  let changed = false;
  if (a.hideAt && now >= a.hideAt) {
    if (state.live?.src === AUTO_SRC) state.live = null;
    a.hideAt = null;
    a.nextAt = a.on ? now + a.hideFor * UNIT_MS[a.hideUnit] : null;
    changed = true;
  }
  // Wait for a free screen so it never covers a verse or song.
  if (a.on && a.item && a.nextAt && now >= a.nextAt && !state.live) {
    state.live = { ...a.item, src: AUTO_SRC };
    a.hideAt = now + a.showFor * UNIT_MS[a.showUnit];
    a.nextAt = null;
    changed = true;
  }
  if (changed) broadcast();
}
setInterval(autoTick, 1000);

const clients = new Set();
function broadcast() {
  const msg = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) res.write(msg);
}

function readBody(req, limit = 50e6) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > limit) { reject(new Error('File too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); }
    });
  });
}

// Raw upload straight to a file (logos, background pictures and videos).
function saveUpload(req, file, limit = 300e6) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const out = fs.createWriteStream(file);
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new Error('File too large')); req.destroy(); out.destroy(); fs.rm(file, () => {}); }
    });
    req.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

function lanUrls() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => `http://${a.address}:${PORT}/control.html`);
}

// Stream Deck / remote buttons: the server handles clear itself, the open control panel does the rest.
// Tells the other open panels (a phone and the OBS dock, say) that saved data changed, so they
// don't later save over it with their older copy.
function storeChanged(key, from) {
  const msg = `event: store\ndata: ${JSON.stringify({ key, from })}\n\n`;
  for (const res of clients) res.write(msg);
}

const REMOTE = ['next', 'prev', 'clear', 'order-next', 'order-prev', 'ticker-on', 'ticker-off', 'logo-on', 'logo-off'];
function remoteCommand(cmd, arg) {
  if (cmd === 'clear') { state.live = null; broadcast(); return; }
  if (cmd === 'ticker-on' || cmd === 'ticker-off') { state.ticker.on = cmd === 'ticker-on'; broadcast(); return; }
  if (cmd === 'logo-on' || cmd === 'logo-off') { state.logo.on = cmd === 'logo-on'; writeJSON('logo.json', state.logo); broadcast(); return; }
  const msg = `event: remote\ndata: ${JSON.stringify({ cmd, arg })}\n\n`;
  for (const res of clients) res.write(msg);
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;

    if (p === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify(state)}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }

    if (p === '/api/state' && req.method === 'GET') return send(res, 200, state);

    if (p === '/api/live' && req.method === 'POST') {
      const { live } = await readBody(req);
      state.live = live || null;
      broadcast();
      return send(res, 200, { ok: true });
    }

    if (p === '/api/auto' && req.method === 'POST') {
      const body = await readBody(req);
      const a = state.auto;
      for (const k of ['showFor', 'showUnit', 'hideFor', 'hideUnit']) if (body[k] !== undefined) a[k] = body[k];
      a.showFor = Math.max(1, Number(a.showFor) || 1);
      a.hideFor = Math.max(1, Number(a.hideFor) || 1);
      if (!UNIT_MS[a.showUnit]) a.showUnit = 'sec';
      if (!UNIT_MS[a.hideUnit]) a.hideUnit = 'min';
      const showing = state.live?.src === AUTO_SRC;
      if (body.on === false) {
        if (showing) state.live = null;
        Object.assign(a, { on: false, item: null, nextAt: null, hideAt: null });
      } else if (body.on === true && body.item) {
        // Start (or switch to another name): show it straight away.
        if (showing) state.live = null;
        Object.assign(a, { on: true, item: body.item, nextAt: Date.now(), hideAt: null });
      } else if (body.item && a.on) {
        a.item = body.item; // e.g. letter case changed
        if (showing) state.live = { ...a.item, src: AUTO_SRC };
      }
      saveAuto();
      autoTick();
      broadcast();
      return send(res, 200, a);
    }

    if (p === '/api/ticker' && req.method === 'POST') {
      const body = await readBody(req);
      for (const k of ['on', 'text', 'label', 'speed']) if (body[k] !== undefined) state.ticker[k] = body[k];
      state.ticker.speed = Math.min(400, Math.max(20, Number(state.ticker.speed) || 120));
      saveTicker();
      broadcast();
      return send(res, 200, state.ticker);
    }

    if (p === '/api/logo' && req.method === 'POST') {
      Object.assign(state.logo, await readBody(req));
      writeJSON('logo.json', state.logo);
      broadcast();
      return send(res, 200, state.logo);
    }

    if (p === '/api/media' && req.method === 'POST') {
      const ext = path.extname(url.searchParams.get('name') || '').toLowerCase();
      if (!/^\.(png|jpe?g|gif|webp|svg|mp4|webm|mov)$/.test(ext)) return send(res, 400, { error: 'Use a picture (PNG, JPG, GIF, WebP, SVG) or a video (MP4, WebM, MOV).' });
      const name = `${Date.now()}${ext}`;
      await saveUpload(req, path.join(MEDIA, name));
      return send(res, 200, { url: `/media/${name}` });
    }

    if (p === '/api/info' && req.method === 'GET') return send(res, 200, { phoneUrls: lanUrls(), port: PORT });

    const remote = p.match(/^\/api\/remote\/([\w-]+)$/);
    if (remote) {
      if (!REMOTE.includes(remote[1])) return send(res, 404, { error: `Unknown command. Use one of: ${REMOTE.join(', ')}` });
      remoteCommand(remote[1], url.searchParams.get('n'));
      return send(res, 200, { ok: true, command: remote[1], panelsOpen: clients.size });
    }

    if (p === '/api/backup' && req.method === 'GET') {
      const { showFor, showUnit, hideFor, hideUnit } = state.auto;
      const { on, ...ticker } = state.ticker;
      const backup = { app: 'church-overlay', version: 1, saved: new Date().toISOString(), store, theme: state.theme, ticker, logo: state.logo, auto: { showFor, showUnit, hideFor, hideUnit } };
      res.writeHead(200, {
        'Content-Type': MIME['.json'],
        'Content-Disposition': `attachment; filename="church-overlay-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      });
      return res.end(JSON.stringify(backup, null, 2));
    }

    if (p === '/api/restore' && req.method === 'POST') {
      const b = await readBody(req, 50e6);
      if (b.app !== 'church-overlay' || !b.store) return send(res, 400, { error: "That isn't a Church Overlay backup file." });
      const keys = new Set([...Object.keys(store), ...Object.keys(b.store)]);
      for (const k of Object.keys(store)) delete store[k];
      Object.assign(store, b.store);
      writeJSON('store.json', store);
      for (const k of keys) storeChanged(k);
      if (b.theme) { state.theme = { ...DEFAULT_THEME, ...b.theme }; writeJSON('theme.json', state.theme); }
      if (b.ticker) { Object.assign(state.ticker, b.ticker, { on: false }); saveTicker(); }
      if (b.logo) { state.logo = { ...state.logo, ...b.logo }; writeJSON('logo.json', state.logo); }
      if (b.auto) { Object.assign(state.auto, b.auto); saveAuto(); }
      broadcast();
      return send(res, 200, { ok: true });
    }

    if (p === '/api/theme' && req.method === 'POST') {
      const { theme, reset } = await readBody(req);
      state.theme = reset ? { ...DEFAULT_THEME } : { ...state.theme, ...theme };
      writeJSON('theme.json', state.theme);
      broadcast();
      return send(res, 200, state.theme);
    }

    if (p === '/api/bible' && req.method === 'GET') {
      const ref = (url.searchParams.get('ref') || '').trim();
      const t = url.searchParams.get('t') || '';
      if (!ref) return send(res, 400, { error: 'Enter a reference, e.g. John 3:16' });
      try { return send(res, 200, bibles.lookup(t, ref)); }
      catch (e) { return send(res, 404, { error: e.message }); }
    }

    // Installed Bibles, the download catalog, import, browse
    if (p.startsWith('/api/bibles')) {
      try {
        if (p === '/api/bibles' && req.method === 'GET') return send(res, 200, bibles.list());
        if (p === '/api/bibles/catalog') return send(res, 200, await bibles.catalog());
        if (p === '/api/bibles/download' && req.method === 'POST') {
          const { id } = await readBody(req);
          return send(res, 200, await bibles.download(id));
        }
        if (p === '/api/bibles/import' && req.method === 'POST') {
          return send(res, 200, bibles.importFile(await readBody(req, 40e6)));
        }
        const m = p.match(/^\/api\/bibles\/([\w-]+)(?:\/(books|chapter))?$/);
        if (m) {
          const [, id, sub] = m;
          if (sub === 'books') return send(res, 200, bibles.books(id));
          if (sub === 'chapter') {
            return send(res, 200, bibles.chapter(id, url.searchParams.get('book'), Number(url.searchParams.get('c')) || 1));
          }
          if (req.method === 'PUT') return send(res, 200, bibles.rename(id, (await readBody(req)).label));
          if (req.method === 'DELETE') { bibles.remove(id); return send(res, 200, { ok: true }); }
        }
        return send(res, 404, { error: 'Not found' });
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
    }

    const storeMatch = p.match(/^\/api\/store\/([\w-]+)$/);
    if (storeMatch) {
      const key = storeMatch[1];
      if (req.method === 'GET') return send(res, 200, { value: store[key] ?? null });
      if (req.method === 'PUT') {
        const { value } = await readBody(req);
        store[key] = value;
        writeJSON('store.json', store);
        storeChanged(key, req.headers['x-panel']);
        return send(res, 200, { ok: true });
      }
    }

    // Static files, and uploaded media from data/media
    const isMedia = p.startsWith('/media/');
    const root = isMedia ? MEDIA : PUBLIC;
    const file = isMedia ? decodeURIComponent(p.slice(7)) : (p === '/' ? '/control.html' : decodeURIComponent(p));
    const full = path.normalize(path.join(root, file));
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404); return res.end('Not found');
    }
    // A file can be busy (antivirus, a copy in progress), so answer rather than stop the server.
    const stream = fs.createReadStream(full);
    stream.on('error', () => { if (res.headersSent) res.destroy(); else { res.writeHead(503); res.end('Busy, try again'); } });
    stream.on('open', () => {
      // no-cache: browsers and OBS check for a newer copy, so an updated program shows up after a refresh.
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      stream.pipe(res);
    });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.on('error', e => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`\n  Church Overlay is already running. Use the window that is already open, or close it and try again.\n  Control panel: http://localhost:${PORT}/control.html\n`);
  process.exit(1);
});

// One bad moment must not take the screen down in the middle of a service.
process.on('uncaughtException', e => console.error('  Problem (still running):', e.message));
process.on('unhandledRejection', e => console.error('  Problem (still running):', e?.message || e));

server.listen(PORT, () => {
  console.log('');
  console.log('  Church Overlay is running');
  console.log(`  Control panel : http://localhost:${PORT}/control.html`);
  console.log(`  OBS overlay   : http://localhost:${PORT}/overlay.html   (Browser Source, 1920x1080)`);
  console.log('');
});
