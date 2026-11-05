// Control panel - open in a browser or dock inside OBS.
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const PANEL = Math.random().toString(36).slice(2); // tells this panel's own saves from another panel's
const api = {
  get: url => fetch(url).then(r => r.json()),
  send: (method, url, body) => fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Panel': PANEL },
    body: JSON.stringify(body),
  }).then(r => r.json()),
};
const store = {
  async get(key, fallback) {
    const { value } = await api.get(`/api/store/${key}`);
    return value ?? fallback;
  },
  set: (key, value) => api.send('PUT', `/api/store/${key}`, { value }),
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
// confirm() popups are blocked in OBS docks, so destructive buttons ask for a second click instead.
function confirmClick(btn, action, ask = 'Click again to delete') {
  const reset = () => {
    clearTimeout(btn.armTimer);
    delete btn.dataset.armed;
    btn.textContent = btn.dataset.label;
    btn.classList.remove('danger');
  };
  if (btn.dataset.armed) { reset(); action(); return; }
  btn.dataset.label = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = ask;
  btn.classList.add('danger');
  btn.armTimer = setTimeout(reset, 3000);
}
function lsGet(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function lsSet(key, value) { try { localStorage.setItem(key, value); } catch {} }

// ---------- Live state ----------
let live = null;
let theme = {};

const goLive = item => api.send('POST', '/api/live', { live: item });
const clearLive = () => api.send('POST', '/api/live', { live: null });

function describe(item) {
  if (!item) return 'Nothing on screen';
  if (item.src === 'auto') return `⏱ ${describe({ ...item, src: '' })}`;
  switch (item.type) {
    case 'bible': return `Bible · ${item.reference} (${item.translation})`;
    case 'note': return `Notes · ${richPlain(item.title)}`;
    case 'outline': return item.src === 'scriptures' ? "Today's scriptures" : `Notes (all points) · ${richPlain(item.title)}`;
    case 'compare': return `Notes (side by side) · ${richPlain(item.title)}`;
    case 'lyrics': return `Song · ${item.title} (${item.label})`;
    case 'name': return `Name · ${item.name}`;
    case 'message': return `Message · ${item.title || richPlain(item.text)}`;
    case 'countdown': return `Countdown · ${item.label}`;
    case 'giving': return `Giving · ${item.title || item.tag || 'details'}`;
  }
  return 'Live';
}

let lastState = null;
const postToPreview = () => lastState && $('#preview').contentWindow?.postMessage(lastState, location.origin);
$('#preview').addEventListener('load', postToPreview);

// The preview measures what's on screen and says if it doesn't fit.
function showFit(fit) {
  const el = $('#fitWarn');
  el.classList.toggle('hidden', !fit?.cut && !fit?.small);
  el.classList.toggle('cut', !!fit?.cut);
  el.textContent = fit?.cut
    ? "⚠ Not everything fits: some text is cut off. Show less at a time, or switch to Full screen."
    : fit?.small ? '⚠ The text is very small because there is a lot of it. Viewers may not be able to read it.' : '';
}
window.addEventListener('message', e => {
  if (e.origin === location.origin && e.data?.fit) showFit(live ? e.data.fit : null);
});

let connected = true;
function onState(s) {
  live = s.live;
  theme = s.theme;
  lastState = s;
  postToPreview();
  if (!live) showFit(null);
  $('#onair').classList.toggle('live', !!live);
  // The server has stopped (its window was closed): buttons do nothing until it's back, so say so.
  $('#onairText').textContent = connected ? describe(live) : '⚠ Not connected. Is the Church Overlay window still open?';
  $('#onair').classList.toggle('offline', !connected);
  $$('[data-src]').forEach(el => {
    el.classList.toggle('live', !!live && el.dataset.src === live.src);
    if (!el.classList.contains('live')) el.classList.remove('stale');
  });
  markScripturesStale();
  fillStyleForm();
  markLayout();
  if (s.auto) renderAuto(s.auto);
  if (s.ticker) renderTicker(s.ticker);
  if (s.logo) renderLogo(s.logo);
}

function connect() {
  const es = new EventSource('/events');
  es.onmessage = e => { connected = true; onState(JSON.parse(e.data)); };
  es.onerror = () => { connected = false; onState({ live: null, theme }); };
  es.addEventListener('store', e => {
    const { key, from } = JSON.parse(e.data);
    if (from !== PANEL) refreshStore(key);
  });
  // Stream Deck / remote buttons (see Style tab)
  es.addEventListener('remote', e => {
    const { cmd } = JSON.parse(e.data);
    if (cmd === 'next' || cmd === 'prev') stepActive(cmd === 'next' ? 1 : -1);
    if (cmd === 'order-next' || cmd === 'order-prev') stepOrder(cmd === 'order-next' ? 1 : -1);
  });
}

// ---------- Tabs ----------
let activeTab = lsGet('tab', 'bible');
function selectTab(name) {
  activeTab = name;
  lsSet('tab', name);
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach(t => t.classList.toggle('hidden', t.id !== `tab-${name}`));
}
$('#tabs').addEventListener('click', e => {
  if (e.target.dataset.tab) selectTab(e.target.dataset.tab);
});

// ---------- Bible ----------
let bibles = [];       // installed translations
let bibleBooks = [];   // books of the selected translation
let bibleBook = null;  // book id being browsed
let passage = null;
let verseIndex = -1;
let recent = [];
let lastQuery = null;  // { ref } or { book, chapter }: re-run when the translation changes

const bibleId = () => $('#bibleTranslation').value;

async function loadBibles(selectId) {
  bibles = await api.get('/api/bibles');
  const sel = $('#bibleTranslation');
  const want = selectId || sel.value || lsGet('translation', '');
  sel.innerHTML = bibles.length
    ? bibles.map(b => `<option value="${b.id}">${escapeHtml(b.label)} — ${escapeHtml(b.name)}</option>`).join('')
    : '<option value="">No Bibles yet — download one</option>';
  if (bibles.some(b => b.id === want)) sel.value = want;
  renderSecond();
  renderInstalled();
  if (!bibles.length) openManager(true);
  await loadBooks();
}

async function loadBooks() {
  const books = bibleId() ? await api.get(`/api/bibles/${bibleId()}/books`) : [];
  bibleBooks = Array.isArray(books) ? books : [];
  // After a reload, open the chapter that was open last time.
  if (!lastQuery) { try { lastQuery = JSON.parse(lsGet('bibleOpen', 'null')); } catch {} }
  if (lastQuery) return runQuery(lastQuery);
  showBooks({ open: false });
}

function setView(view) {
  $('#bibleBooks').classList.toggle('hidden', view !== 'books');
  $('#bibleChapters').classList.toggle('hidden', view !== 'chapters');
  $('#bibleResult').classList.toggle('hidden', view !== 'verses');
  const book = bibleBooks.find(b => b.id === bibleBook);
  const parts = ['<button class="crumb" data-go="books">All books</button>'];
  if (view !== 'books' && book) parts.push(`<button class="crumb" data-go="chapters">${escapeHtml(book.name)}</button>`);
  if (view === 'verses' && passage) parts.push(`<span>${escapeHtml(passage.reference)}</span>`);
  // While browsing books or chapters, offer a way back to the verses that were open,
  // or a way to close the list when nothing is open yet.
  const back = view === 'verses' || view === 'none' ? ''
    : passage ? `<button class="btn small primary" data-go="back">‹ Back to ${escapeHtml(passage.reference)}</button>`
    : '<button class="btn small" data-go="close">✕ Close</button>';
  $('#bibleCrumbs').innerHTML = bibleBooks.length ? back + parts.join('<span class="sep">›</span>') : '';
  $('#bibleBackBottom').innerHTML = back;
}

let backQuery = null; // what was open before browsing, for "Back to ..."
function showBooks({ open = true } = {}) {
  if (lastQuery) backQuery = lastQuery;
  lastQuery = null;
  const grid = list => `<div class="book-grid">${list
    .map(b => `<button class="bookbtn" data-book="${b.id}">${escapeHtml(b.name)}</button>`).join('')}</div>`;
  const groups = [['Old Testament', 'OT'], ['New Testament', 'NT'], ['Other books', 'Other']]
    .map(([title, t]) => [title, bibleBooks.filter(b => b.testament === t)])
    .filter(([, list]) => list.length);
  $('#bibleBooks').innerHTML = bibleBooks.length
    ? groups.map(([title, list]) => `<div class="section-label">${title}</div>${grid(list)}`).join('')
    : '<p class="hint">Download a Bible to start browsing.</p>';
  setView(open || !bibleBooks.length ? 'books' : 'none');
}

function showChapters(bookId) {
  const book = bibleBooks.find(b => b.id === bookId);
  if (!book) return showBooks();
  bibleBook = bookId;
  if (book.chapters === 1) return openChapter(bookId, 1);
  $('#bibleChapters').innerHTML = `<div class="chapter-grid">${Array.from({ length: book.chapters },
    (_, i) => `<button class="chapbtn" data-chapter="${i + 1}">${i + 1}</button>`).join('')}</div>`;
  setView('chapters');
}

function showResult(data) {
  if (data.error) {
    $('#bibleError').textContent = data.error;
    return false;
  }
  $('#bibleError').textContent = '';
  passage = data;
  bibleBook = data.bookId;
  if (lastQuery) lsSet('bibleOpen', JSON.stringify(lastQuery));
  verseIndex = -1;
  renderPassage();
  setView('verses');
  return true;
}

async function openChapter(bookId, c) {
  lastQuery = { book: bookId, chapter: c };
  showResult(await api.get(`/api/bibles/${bibleId()}/chapter?book=${bookId}&c=${c}`));
}

// Next/previous chapter, crossing into the next/previous book.
function stepChapter(delta) {
  if (!passage) return;
  const bi = bibleBooks.findIndex(b => b.id === passage.bookId);
  let c = passage.chapter + delta;
  let book = bibleBooks[bi];
  if (c < 1 && bi > 0) { book = bibleBooks[bi - 1]; c = book.chapters; }
  if (c > book.chapters && bi < bibleBooks.length - 1) { book = bibleBooks[bi + 1]; c = 1; }
  if (c >= 1 && c <= book.chapters) openChapter(book.id, c);
}

// A verse reference ("Matthew 2:2") opens the whole chapter with that verse on screen,
// so Next verse carries on when the pastor keeps reading.
async function findBible(ref, { show = true } = {}) {
  ref = ref.trim();
  if (!ref) return;
  if (!bibleId()) { $('#bibleError').textContent = 'Download a Bible first.'; return; }
  $('#bibleRef').value = ref;
  lastQuery = { ref };
  const data = await api.get(`/api/bible?ref=${encodeURIComponent(ref)}&t=${bibleId()}`);
  const oneChapter = !data.error && !data.whole && data.verses.every(v => v.chapter === data.chapter);
  if (oneChapter) {
    const full = await api.get(`/api/bibles/${bibleId()}/chapter?book=${data.bookId}&c=${data.chapter}`);
    if (!showResult(full)) return;
    const a = full.verses.findIndex(v => v.verse === data.verses[0].verse);
    const b = full.verses.findIndex(v => v.verse === data.verses[data.verses.length - 1].verse);
    markVerses(a, b);
    if (show) showVerses(a, b);
  } else if (!showResult(data)) {
    return;
  }
  recent = [ref, ...recent.filter(r => r !== ref)].slice(0, 12);
  store.set('bibleRecent', recent);
  renderRecent();
}

const runQuery = q => (q.ref ? findBible(q.ref, { show: false }) : openChapter(q.book, q.chapter));

// ----- Bible manager -----
const QUICK = [
  ['eng_kjv', 'KJV (English)'], ['ENGWEBP', 'WEB (English)'], ['BSB', 'BSB (English)'],
  ['twi_asa', 'Asante Twi'], ['twi_aka', 'Akuapem Twi'], ['ewe_bib', 'Ewe'],
];
let catalog = null;
// English library: the best-known ones first, then the rest.
const ENGLISH_FIRST = ['eng_kjv', 'eng_kja', 'BSB', 'ENGWEBP', 'eng_webu', 'eng_net', 'eng_asv', 'eng_lsv',
  'eng_msb', 'eng_gnv', 'eng_dra', 'eng_ylt', 'eng_dby', 'eng_bbe', 'eng_wbs', 'eng_rv5'];

function openManager(show) {
  $('#bibleManager').classList.toggle('hidden', !show);
  $('#bibleBrowse').classList.toggle('hidden', show);
  if (show) { renderQuick(); searchCatalog(); renderEnglish(); }
}

function renderInstalled() {
  $('#bibleInstalled').innerHTML = bibles.length ? bibles.map(b => `
    <div class="item">
      <div class="body">
        <input class="label-input" data-label="${b.id}" value="${escapeHtml(b.label)}" title="Label shown on screen">
        <div class="sub">${escapeHtml(b.name)}${b.language ? ` · ${escapeHtml(b.language)}` : ''} · ${escapeHtml(b.credit || '')}</div>
      </div>
      <div class="actions"><button class="btn small" data-remove="${b.id}">Delete</button></div>
    </div>`).join('') : '<p class="hint">No Bibles installed yet. Add one below.</p>';
}

function renderQuick() {
  const have = new Set(bibles.map(b => b.id));
  $('#bibleQuick').innerHTML = QUICK.map(([id, label]) => have.has(id)
    ? `<button class="btn" disabled>✓ ${label}</button>`
    : `<button class="btn" data-download="${id}">+ ${label}</button>`).join('');
}

// Loads the list of downloadable Bibles once; shows any error in listEl.
let catalogLoading = null;
async function loadCatalog(listEl) {
  if (catalog) return true;
  listEl.innerHTML = '<p class="hint">Loading the list of Bibles…</p>';
  catalogLoading ||= api.get('/api/bibles/catalog');
  const data = await catalogLoading;
  catalogLoading = null;
  if (data.error) { listEl.innerHTML = `<p class="error">${escapeHtml(data.error)}</p>`; return false; }
  catalog = data;
  return true;
}

const catalogScope = n => (n >= 66 ? 'Full Bible' : n === 27 ? 'New Testament' : `${n} books`);
function catalogItems(list) {
  const have = new Set(bibles.map(b => b.id));
  return list.map(t => `
    <div class="item">
      <div class="body">
        <strong>${escapeHtml(t.englishName || t.name)}</strong>
        <div class="sub">${escapeHtml(t.languageName)} · ${catalogScope(t.books)} · ${t.publicDomain ? 'Public domain' : 'Free, credit required'}</div>
      </div>
      <div class="actions">${have.has(t.id)
        ? '<button class="btn small" disabled>Installed</button>'
        : `<button class="btn small primary" data-download="${t.id}">Download</button>`}</div>
    </div>`).join('');
}

async function searchCatalog() {
  const listEl = $('#catalogList');
  if (!await loadCatalog(listEl)) return;
  const q = $('#catalogSearch').value.trim().toLowerCase();
  if (!q) { listEl.innerHTML = '<p class="hint">Type a language or name to search.</p>'; return; }
  const matches = catalog
    .filter(t => `${t.name} ${t.englishName} ${t.languageName} ${t.language} ${t.short}`.toLowerCase().includes(q))
    .sort((a, b) => b.books - a.books);
  const shown = matches.slice(0, 50);
  listEl.innerHTML = matches.length ? catalogItems(shown)
    + (matches.length > 50 ? `<p class="hint">Showing the top 50 of ${matches.length}. Type more of the name to find others.</p>` : '')
    : '<p class="hint">No matches. Try another spelling, or import a file below.</p>';
}

async function renderEnglish() {
  const listEl = $('#englishList');
  if (!await loadCatalog(listEl)) return;
  const rank = t => { const i = ENGLISH_FIRST.indexOf(t.id); return i < 0 ? ENGLISH_FIRST.length : i; };
  const english = catalog
    .filter(t => t.language === 'eng')
    .sort((a, b) => rank(a) - rank(b) || b.books - a.books || (a.englishName || a.name).localeCompare(b.englishName || b.name));
  $('#englishCount').textContent = english.length;
  listEl.innerHTML = catalogItems(english);
}

async function downloadBible(btn) {
  const id = btn.dataset.download;
  btn.disabled = true;
  btn.textContent = 'Downloading…';
  const res = await api.send('POST', '/api/bibles/download', { id });
  if (res.error) {
    btn.disabled = false;
    btn.textContent = 'Retry';
    $('#bibleError').textContent = res.error;
    return;
  }
  lastQuery = null;
  await loadBibles(res.id);
  renderQuick();
  searchCatalog();
  renderEnglish();
}

$('#bibleManageBtn').addEventListener('click', () => openManager(true));
$('#bibleManagerClose').addEventListener('click', () => openManager(false));
$('#bibleManager').addEventListener('click', e => {
  const dl = e.target.closest('[data-download]');
  if (dl && !dl.disabled) downloadBible(dl);
  const rm = e.target.closest('[data-remove]');
  if (rm) confirmClick(rm, async () => {
    await api.send('DELETE', `/api/bibles/${rm.dataset.remove}`);
    secondCache.clear();
    chapterCache.clear();
    if (passage?.translation === bibles.find(b => b.id === rm.dataset.remove)?.label) passage = null;
    lastQuery = null;
    await loadBibles();
    renderQuick();
  });
});
$('#bibleInstalled').addEventListener('change', async e => {
  const id = e.target.dataset.label;
  if (!id) return;
  await api.send('PUT', `/api/bibles/${id}`, { label: e.target.value });
  secondCache.clear();
  await loadBibles(bibleId());
});
$('#catalogSearch').addEventListener('input', debounce(searchCatalog, 250));
$('#importBtn').addEventListener('click', () => {
  const file = $('#importFile').files[0];
  const status = $('#importStatus');
  if (!file) { status.textContent = 'Choose a file first.'; return; }
  status.textContent = 'Importing…';
  const reader = new FileReader();
  reader.onload = async () => {
    const res = await api.send('POST', '/api/bibles/import', {
      label: $('#importLabel').value, filename: file.name, content: reader.result,
    });
    if (res.error) { status.textContent = `Import failed: ${res.error}`; return; }
    status.textContent = `Imported "${res.label}".`;
    $('#importFile').value = '';
    $('#importLabel').value = '';
    lastQuery = null;
    await loadBibles(res.id);
  };
  reader.readAsText(file);
});

function renderRecent() {
  $('#bibleRecent').innerHTML = recent
    .map(r => `<button class="chip" type="button" data-ref="${escapeHtml(r)}">${escapeHtml(r)}</button>`)
    .join('') + (recent.length ? '<button class="btn small chips-clear" type="button" data-clear>Clear</button>' : '');
}

function bibleSrc(a, b) { return `bible:${passage.translation}:${passage.reference}:${a}-${b}`; }

function renderPassage() {
  $('#bibleTitle').textContent = `${passage.reference} · ${passage.translation}`;
  $('#bibleShowAll').dataset.src = bibleSrc(0, passage.verses.length - 1);
  $('#bibleVerses').innerHTML = passage.verses.map((v, i) => `
    <button class="item${i === verseIndex ? ' selected' : ''}" data-i="${i}" data-src="${bibleSrc(i, i)}">
      <span class="num">${v.verse}</span><span class="body">${escapeHtml(v.text)}</span>
    </button>`).join('');
  stopPaging();
  if (live) onState({ live, theme });
}

// "Show whole passage" puts every verse up; the same button then says "Show less"
// and goes through the passage a few verses at a time.
let pageStart = -1; // first verse of the current group, or -1 when not going through it
let pageSize = 0;   // verses per group; 0 = whole passage
let perScreenN = Number(lsGet('versesPerScreen', '2')) || 2;
const perScreen = () => perScreenN;
const markPerScreen = () => $$('#biblePerScreen [data-n]').forEach(btn => btn.classList.toggle('primary', Number(btn.dataset.n) === perScreenN));
function showPage(start, size) {
  const last = passage.verses.length - 1;
  pageSize = size;
  const n = size || passage.verses.length;
  start = Math.max(0, Math.min(Math.floor(start / n), Math.floor(last / n)) * n);
  const end = Math.min(start + n - 1, last);
  pageStart = verseIndex = start;
  $$('#bibleVerses .item').forEach(el => {
    const i = Number(el.dataset.i);
    el.classList.toggle('selected', i >= start && i <= end);
  });
  $(`#bibleVerses [data-i="${start}"]`).scrollIntoView({ block: 'nearest' });
  const pages = Math.ceil(passage.verses.length / n);
  $('#biblePager').classList.toggle('hidden', pages < 2);
  const [v1, v2] = [passage.verses[start].verse, passage.verses[end].verse];
  $('#biblePagerText').textContent = `${v1 === v2 ? `Verse ${v1}` : `Verses ${v1}–${v2}`} (${start / n + 1} of ${pages})`;
  $('#biblePagePrev').disabled = start === 0;
  $('#biblePageNext').disabled = end === last;
  $('#bibleShowAll').textContent = size ? 'Show whole passage' : 'Show less';
  showVerses(start, end);
}
const stepPage = dir => showPage(pageStart + dir * (pageSize || passage.verses.length), pageSize);
function stopPaging() {
  pageStart = -1;
  $('#biblePager').classList.add('hidden');
  $('#bibleShowAll').textContent = 'Show whole passage';
}

async function showVerses(a, b) {
  if (a > b) [a, b] = [b, a];
  const verses = passage.verses.slice(a, b + 1);
  const first = verses[0];
  const last = verses[verses.length - 1];
  let reference = `${first.book} ${first.chapter}:${first.verse}`;
  if (verses.length > 1) {
    reference += first.chapter === last.chapter ? `-${last.verse}` : `-${last.chapter}:${last.verse}`;
  }
  const item = { type: 'bible', src: bibleSrc(a, b), bookId: passage.bookId, reference, translation: passage.translation, verses };
  logScriptures(verses, passage.bookId);
  // A second translation picked: show both together (it's a quick local lookup).
  const second = await secondFor(passage.bookId, verses);
  goLive(second ? { ...item, second } : item);
}

// ---------- Second translation (e.g. English + Twi) ----------
const secondCache = new Map();
function renderSecond() {
  const sel = $('#bibleSecond');
  const want = sel.value || lsGet('bible2', '');
  sel.innerHTML = '<option value="">+ Second translation: none</option>' + bibles
    .map(b => `<option value="${b.id}">+ ${escapeHtml(b.label)}</option>`).join('');
  sel.value = bibles.some(b => b.id === want) ? want : '';
}
async function secondFor(bookId, verses) {
  const id = $('#bibleSecond').value;
  if (!id || id === bibleId()) return null;
  const out = [];
  let label = '', book = '';
  for (const ch of [...new Set(verses.map(v => v.chapter))]) {
    const key = `${id}:${bookId}:${ch}`;
    if (!secondCache.has(key)) secondCache.set(key, api.get(`/api/bibles/${id}/chapter?book=${bookId}&c=${ch}`).catch(() => ({})));
    const data = await secondCache.get(key);
    if (!data.verses) return null;
    label = data.translation;
    book = data.verses[0]?.book || book;
    const want = new Set(verses.filter(v => v.chapter === ch).map(v => v.verse));
    out.push(...data.verses.filter(v => want.has(v.verse)));
  }
  if (!out.length) return null;
  const first = out[0], last = out[out.length - 1];
  let reference = `${book} ${first.chapter}:${first.verse}`;
  if (out.length > 1) reference += first.chapter === last.chapter ? `-${last.verse}` : `-${last.chapter}:${last.verse}`;
  return { reference, translation: label, verses: out };
}
$('#bibleSecond').addEventListener('change', e => {
  lsSet('bible2', e.target.value);
  // Update the verse on screen straight away.
  if (live?.type === 'bible' && passage && live.src?.startsWith('bible:')) {
    const [a, b] = live.src.split(':').pop().split('-').map(Number);
    if (!isNaN(a)) showVerses(a, b);
  }
});

// ---------- Today's scriptures: every verse shown today, to recap at the end of the sermon ----------
const todayKey = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
let scriptureLog = { date: todayKey(), list: [] }; // list: [{ book, chapter, from, to }]
const fmtScripture = e => `${e.book} ${e.chapter}:${e.from}${e.to > e.from ? `-${e.to}` : ''}`;

function logScriptures(verses, bookId) {
  if (scriptureLog.date !== todayKey()) scriptureLog = { date: todayKey(), list: [] };
  for (const v of verses) {
    // Stepping through 2:1, 2:2, 2:3 becomes one entry: Matthew 2:1-3.
    // Matched by book code, so John and Yohane are the same book when the translation changes.
    const e = scriptureLog.list.find(x => (x.bookId ? x.bookId === bookId : x.book === v.book) && x.chapter === v.chapter && v.verse >= x.from - 1 && v.verse <= x.to + 1);
    if (e) { e.from = Math.min(e.from, v.verse); e.to = Math.max(e.to, v.verse); }
    else scriptureLog.list.push({ bookId, book: v.book, chapter: v.chapter, from: v.verse, to: v.verse });
  }
  store.set('scriptureLog', scriptureLog);
  renderScriptures();
}
function renderScriptures() {
  const list = scriptureLog.date === todayKey() ? scriptureLog.list : [];
  $('#scripturesCount').textContent = list.length ? `(${list.length})` : '';
  $('#scripturesList').innerHTML = list.length
    ? list.map((e, i) => `<span class="chip"><span data-open="${i}" title="Open">${escapeHtml(fmtScripture(e))}</span>
        <button class="chip-x" data-remove="${i}" title="Remove from list">✕</button></span>`).join('')
    : '<span class="hint">Every verse you show is added here, so you can show them all at the end of the sermon.</span>';
  markScripturesStale();
}
// While the list is on screen, the buttons turn blue when it changes: press to update.
// If the list has been emptied, pressing takes it off the screen.
function markScripturesStale() {
  const list = scriptureLog.date === todayKey() ? scriptureLog.list : [];
  const showing = live?.src === 'scriptures';
  const stale = showing && JSON.stringify(list.map(fmtScripture)) !== JSON.stringify(live.points);
  for (const btn of [$('#scripturesShow'), $('#notesScriptures')]) {
    btn.disabled = !list.length && !stale;
    btn.classList.toggle('stale', stale);
  }
}
function showScriptures() {
  if (scriptureLog.date !== todayKey() || !scriptureLog.list.length) {
    if (live?.src === 'scriptures') clearLive();
    return;
  }
  goLive({
    type: 'outline', src: 'scriptures', tag: "Today's scriptures", title: '', numbered: false,
    points: scriptureLog.list.map(fmtScripture), current: -1, subs: [],
  });
}
$('#scripturesShow').addEventListener('click', showScriptures);
$('#notesScriptures').addEventListener('click', showScriptures);
$('#scripturesHide').addEventListener('click', () => { if (live?.src === 'scriptures') clearLive(); });
$('#scripturesClear').addEventListener('click', e => confirmClick(e.currentTarget, () => {
  scriptureLog = { date: todayKey(), list: [] };
  store.set('scriptureLog', scriptureLog);
  renderScriptures();
}));
$('#scripturesList').addEventListener('click', e => {
  const { open, remove } = e.target.dataset;
  if (remove !== undefined) {
    scriptureLog.list.splice(Number(remove), 1);
    store.set('scriptureLog', scriptureLog);
    renderScriptures();
  }
  if (open !== undefined) {
    // Use the open translation's own name for the book, in case it was noted in another translation.
    const entry = scriptureLog.list[open];
    const book = bibleBooks.find(b => b.id === entry.bookId)?.name || entry.book;
    findBible(fmtScripture({ ...entry, book }));
  }
});

// Highlight verses a..b in the list (without putting them on screen).
function markVerses(a, b) {
  if (a < 0 || b < 0) return;
  verseIndex = b; // Next verse carries on after the last one shown
  $$('#bibleVerses .item').forEach(el => {
    const i = Number(el.dataset.i);
    el.classList.toggle('selected', i >= a && i <= b);
  });
  $(`#bibleVerses [data-i="${a}"]`)?.scrollIntoView({ block: 'center' });
}

function showVerse(i) {
  if (!passage || i < 0 || i >= passage.verses.length) return;
  verseIndex = i;
  stopPaging();
  $$('#bibleVerses .item').forEach(el => el.classList.toggle('selected', Number(el.dataset.i) === i));
  $(`#bibleVerses [data-i="${i}"]`).scrollIntoView({ block: 'nearest' });
  showVerses(i, i);
}

$('#bibleForm').addEventListener('submit', e => { e.preventDefault(); findBible($('#bibleRef').value); });

// ---------- Search suggestions: book -> chapter -> verse as you type ----------
const suggestEl = $('#bibleSuggest');
let suggestions = [];  // [{ html, value, go }]  go = open it, otherwise fill the box and keep typing
let suggestIndex = -1;
const chapterCache = new Map();
const normBook = t => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function matchBooks(text) {
  const q = normBook(text);
  if (!q) return [];
  const score = b => {
    const keys = [normBook(b.name), normBook(b.en || ''), b.id.toLowerCase(), ...(b.abbr || '').split(' ').filter(Boolean)];
    if (keys.some(k => k === q)) return 0;
    if (keys.some(k => k && k.startsWith(q))) return 1;
    if (q.length >= 3 && keys.some(k => k && k.includes(q))) return 2; // "ps" must not match "apocalypse"
    return -1;
  };
  return bibleBooks.map(b => [b, score(b)]).filter(([, sc]) => sc >= 0).sort((x, y) => x[1] - y[1]).map(([b]) => b);
}
const bookLabel = b => escapeHtml(b.name) + (b.en && normBook(b.en) !== normBook(b.name) ? ` <span class="sub">(${escapeHtml(b.en)})</span>` : '');

async function updateSuggest() {
  const q = $('#bibleRef').value;
  const m = q.match(/^\s*(\d?\s*[^\d:.]+?)\s*(?:(\d+)\s*(?:([:.])\s*(\d*))?)?\s*$/u);
  suggestions = [];
  if (m && bibleBooks.length) {
    const [, bookPart, chap, colon, verse] = m;
    const books = matchBooks(bookPart);
    const exact = books[0] && [books[0].name, books[0].en].some(n => n && normBook(n) === normBook(bookPart));
    if (!chap && exact && /\s$/.test(q)) {
      // "John " (book chosen): list its chapters.
      const b = books[0];
      suggestions = Array.from({ length: b.chapters }, (_, i) => ({ html: `${escapeHtml(b.name)} ${i + 1}`, value: `${b.name} ${i + 1}`, go: true }));
    } else if (!chap) {
      suggestions = books.slice(0, 8).map(b => ({
        html: `${bookLabel(b)} <span class="sub">· ${b.chapters} chapter${b.chapters > 1 ? 's' : ''}</span>`,
        value: `${b.name} `,
      }));
    } else if (!colon) {
      // Exact chapter in each matching book first (Joshua 3, Job 3, John 3), then 30, 31...
      const add = (b, c) => suggestions.push({ html: `${escapeHtml(b.name)} ${c}`, value: `${b.name} ${c}`, go: true });
      const six = books.slice(0, 6);
      for (const b of six) if (Number(chap) <= b.chapters) add(b, Number(chap));
      for (const b of six) {
        for (let c = Number(chap) * 10; c <= b.chapters && suggestions.length < 8; c++) {
          if (String(c).startsWith(chap)) add(b, c);
        }
      }
      suggestions = suggestions.slice(0, 8);
    } else if (books[0] && Number(chap) <= books[0].chapters) {
      const b = books[0];
      const key = `${bibleId()}:${b.id}:${chap}`;
      if (!chapterCache.has(key)) {
        chapterCache.set(key, api.get(`/api/bibles/${bibleId()}/chapter?book=${b.id}&c=${chap}`).catch(() => ({})));
      }
      const data = await chapterCache.get(key);
      if ($('#bibleRef').value !== q) return; // typing moved on while we waited
      suggestions = (data.verses || []).filter(v => String(v.verse).startsWith(verse)).slice(0, 8).map(v => ({
        html: `<b>${escapeHtml(b.name)} ${chap}:${v.verse}</b> <span class="sub">${escapeHtml(v.text.slice(0, 70))}${v.text.length > 70 ? '…' : ''}</span>`,
        value: `${b.name} ${chap}:${v.verse}`,
        go: true,
      }));
    }
  }
  suggestIndex = -1;
  renderSuggest();
}
function renderSuggest() {
  suggestEl.classList.toggle('hidden', !suggestions.length || document.activeElement !== $('#bibleRef'));
  suggestEl.innerHTML = suggestions.map((s, i) =>
    `<div class="suggest-item${i === suggestIndex ? ' active' : ''}" data-i="${i}">${s.html}</div>`).join('');
}
const hideSuggest = () => { suggestions = []; renderSuggest(); };
function pickSuggest(i) {
  const s = suggestions[i];
  if (!s) return;
  $('#bibleRef').value = s.value;
  if (s.go) { hideSuggest(); findBible(s.value); $('#bibleRef').blur(); }
  else { $('#bibleRef').focus(); updateSuggest(); } // book picked: now show its chapters
}
$('#bibleRef').addEventListener('input', updateSuggest);
$('#bibleRef').addEventListener('focus', updateSuggest);
$('#bibleRef').addEventListener('blur', () => setTimeout(hideSuggest, 150));
$('#bibleRef').addEventListener('keydown', e => {
  if (suggestEl.classList.contains('hidden')) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = suggestions.length;
    suggestIndex = e.key === 'ArrowDown' ? (suggestIndex + 1) % n : (suggestIndex - 1 + n) % n;
    renderSuggest();
  } else if ((e.key === 'Enter' || e.key === 'Tab') && suggestIndex >= 0) {
    e.preventDefault();
    pickSuggest(suggestIndex);
  } else if (e.key === 'Escape') {
    e.stopPropagation(); // close the list without clearing the screen
    hideSuggest();
  }
});
// mousedown keeps focus in the box, so the list doesn't close before the click lands.
suggestEl.addEventListener('mousedown', e => {
  e.preventDefault();
  const item = e.target.closest('.suggest-item');
  if (item) pickSuggest(Number(item.dataset.i));
});
$('#bibleRecent').addEventListener('click', e => {
  if (e.target.dataset.ref) findBible(e.target.dataset.ref);
  if (e.target.matches('[data-clear]')) confirmClick(e.target, () => {
    recent = [];
    store.set('bibleRecent', recent);
    renderRecent();
  });
});
$('#bibleShowAll').addEventListener('click', () => {
  if (!passage) return;
  // Whole passage on screen -> Show less (a few verses, starting at the top).
  if (pageStart >= 0 && !pageSize) showPage(0, perScreen());
  else showPage(0, 0);
});
// Next / previous verse (or group of verses when showing a few at a time), like ↑ ↓.
function stepBible(dir) {
  if (!passage) return;
  if (pageStart >= 0 && pageSize) return stepPage(dir);
  // Nothing picked yet, or the whole passage is up: start at the first verse.
  showVerse(verseIndex < 0 || pageStart >= 0 ? 0 : Math.max(0, Math.min(passage.verses.length - 1, verseIndex + dir)));
}
$('#bibleVersePrev').addEventListener('click', () => stepBible(-1));
$('#bibleVerseNext').addEventListener('click', () => stepBible(1));
$('#biblePagePrev').addEventListener('click', () => stepPage(-1));
$('#biblePageNext').addEventListener('click', () => stepPage(1));
// 1 / 2 / 3 puts that many verses on screen straight away, from where you are in the chapter.
markPerScreen();
$('#biblePerScreen').addEventListener('click', e => {
  const n = Number(e.target.dataset.n);
  if (!n || !passage) return;
  perScreenN = n;
  lsSet('versesPerScreen', String(n));
  markPerScreen();
  showPage(pageStart >= 0 ? pageStart : Math.max(verseIndex, 0), n);
});
$('#bibleVerses').addEventListener('click', e => {
  const el = e.target.closest('.item');
  if (!el) return;
  const i = Number(el.dataset.i);
  if (e.shiftKey && verseIndex >= 0) {
    showVerses(verseIndex, i);
  } else {
    showVerse(i);
  }
});
$('#bibleTranslation').addEventListener('change', async () => {
  lsSet('translation', bibleId());
  // If verses from the open chapter are on screen, show them in the new translation straight away.
  const sameChapter = live?.type === 'bible' && passage && (live.bookId
    ? live.bookId === passage.bookId && live.verses?.[0]?.chapter === passage.verses[0]?.chapter
    : live.src?.endsWith(`:${passage.reference}:${live.src.split(':').pop()}`));
  const onScreen = sameChapter ? live.src.split(':').pop().split('-').map(Number) : null;
  await loadBooks();
  if (onScreen && passage && !isNaN(onScreen[0]) && onScreen[1] < passage.verses.length) {
    const [a, b] = onScreen;
    if (a === b) showVerse(a); else showVerses(a, b);
  }
});
$('#bibleBackBottom').addEventListener('click', e => {
  const go = e.target.dataset.go;
  if (go) $(`#bibleCrumbs [data-go="${go}"]`).click();
});
$('#bibleCrumbs').addEventListener('click', e => {
  if (e.target.dataset.go === 'books') showBooks();
  if (e.target.dataset.go === 'close') setView('none');
  if (e.target.dataset.go === 'chapters') {
    if (lastQuery) backQuery = lastQuery;
    lastQuery = null;
    showChapters(bibleBook);
  }
  if (e.target.dataset.go === 'back') {
    lastQuery = backQuery;
    bibleBook = passage.bookId;
    setView('verses');
  }
});
$('#bibleBooks').addEventListener('click', e => { if (e.target.dataset.book) showChapters(e.target.dataset.book); });
$('#bibleChapters').addEventListener('click', e => {
  if (e.target.dataset.chapter) openChapter(bibleBook, Number(e.target.dataset.chapter));
});
$('#biblePrevCh').addEventListener('click', () => stepChapter(-1));
$('#bibleNextCh').addEventListener('click', () => stepChapter(1));

// ---------- Sermon notes ----------
let sermons = [];
let sermonId = null;
let outline = { topic: '', points: [] };
let outlineItems = [];
let outlineIndex = -1;

function parseNotes(src) {
  const doc = { topic: '', points: [] };
  for (const raw of src.split(/\r?\n/)) {
    // Styling can wrap a whole line, so look past it for the "#", "-" or "1." at the start.
    const trimmed = raw.trim();
    const lead = trimmed.match(/^(?:⟦[^⟧/][^⟧]*⟧)*/)[0];
    const rest = trimmed.slice(lead.length);
    const line = rest.trimStart();
    if (!richPlain(line).trim()) continue;
    if (line.startsWith('#')) {
      doc.topic = lead + line.replace(/^#+\s*/, '');
      continue;
    }
    const isSub = /^\s/.test(raw) || /^\s/.test(rest) || /^[-*•]/.test(line);
    if (isSub && doc.points.length) {
      doc.points[doc.points.length - 1].subs.push(lead + line.replace(/^[-*•]\s*/, ''));
    } else {
      // Strip typed numbering like "1." or "2)" - points are numbered for you.
      doc.points.push({ text: lead + line.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s+/, ''), subs: [] });
    }
  }
  return doc;
}

function buildOutlineItems(doc) {
  const items = [];
  if (doc.topic) items.push({ kind: 'topic' });
  doc.points.forEach((p, pi) => {
    items.push({ kind: 'point', pi });
    p.subs.forEach((_, si) => items.push({ kind: 'sub', pi, si }));
  });
  return items;
}

function noteSrc(it) {
  return it.kind === 'topic' ? 'note:topic' : `note:${it.pi}:${it.kind === 'sub' ? it.si : 'p'}`;
}

function noteLiveItem(it) {
  if (it.kind === 'topic') {
    return { type: 'note', src: noteSrc(it), tag: "Today's message", title: outline.topic, subs: [] };
  }
  const p = outline.points[it.pi];
  const number = $('#optNumber').checked;
  const reveal = $('#optReveal').checked;
  const tag = [outline.topic, number ? `Point ${it.pi + 1}` : ''].filter(Boolean).join(' · ');
  let subs = p.subs;
  let current = -1;
  if (it.kind === 'sub') {
    current = it.si;
    if (reveal) subs = p.subs.slice(0, it.si + 1);
  } else if (reveal) {
    subs = [];
  }
  if ($('#optAll').checked) {
    // Every point stays on screen; the current one is highlighted with its sub-points.
    return {
      type: 'outline', src: noteSrc(it), tag: outline.topic, title: p.text, numbered: number,
      points: outline.points.map(q => q.text), current: it.pi, subs, subCurrent: current,
    };
  }
  return { type: 'note', src: noteSrc(it), tag, title: p.text, subs, current };
}

const allPointsItem = () => ({
  type: 'outline', src: 'note:all', tag: outline.topic, title: 'All points', numbered: $('#optNumber').checked,
  points: outline.points.map(p => p.text), current: -1, subs: [],
  allSubs: outline.points.map(p => p.subs),
});
function showAllPoints() {
  if (!outline.points.length) return;
  $('#notesShowAll').classList.remove('stale');
  goLive(allPointsItem());
}

// Points picked with Ctrl+click for the side-by-side view.
let comparePoints = new Set();

function updateCompareButton() {
  const n = comparePoints.size;
  $('#notesCompare').disabled = n < 2;
  $('#notesCompare').textContent = n ? `Side by side (${n})` : 'Side by side';
}

function compareItem() {
  const picked = [...comparePoints].sort((a, b) => a - b).slice(0, 3);
  if (picked.length < 2) return null;
  const columns = picked.map(pi => ({ n: pi + 1, title: outline.points[pi].text, subs: outline.points[pi].subs }));
  return {
    type: 'compare', src: 'note:compare', tag: outline.topic, numbered: $('#optNumber').checked,
    title: columns.map(c => c.title).join(' vs '), columns,
  };
}
function showCompare() {
  const item = compareItem();
  if (!item) return;
  $('#notesCompare').classList.remove('stale');
  goLive(item);
}

// When the notes change under All points / side by side, turn that button blue
// so the user presses it to put the new version on screen.
function markNotesStale() {
  const views = { 'note:all': ['#notesShowAll', allPointsItem], 'note:compare': ['#notesCompare', compareItem] };
  const [btn, build] = views[live?.src] || [];
  if (!btn) return;
  const item = build();
  $(btn).classList.toggle('stale', !!item && JSON.stringify(item) !== JSON.stringify(live));
}

function renderOutline() {
  outline = parseNotes($('#notesText').value);
  // The title box wins; a "# Topic" line in the notes still works as a fallback.
  const title = $('#sermonTitle').value.trim();
  if (title) outline.topic = title;
  syncSermonTimer();
  outlineItems = buildOutlineItems(outline);
  comparePoints = new Set([...comparePoints].filter(pi => pi < outline.points.length));
  updateCompareButton();
  markNotesStale();
  if (!outlineItems.length) {
    $('#notesOutline').innerHTML = '<p class="hint">Type your notes in the box. The outline appears here.</p>';
    return;
  }
  $('#notesOutline').innerHTML = outlineItems.map((it, i) => {
    const src = noteSrc(it);
    if (it.kind === 'topic') {
      return `<button class="item topic" data-i="${i}" data-src="${src}"><span class="body">${richHtml(outline.topic)}</span></button>`;
    }
    const p = outline.points[it.pi];
    if (it.kind === 'point') {
      return `<button class="item point${comparePoints.has(it.pi) ? ' marked' : ''}" data-i="${i}" data-src="${src}"><span class="num">${it.pi + 1}</span><span class="body">${richHtml(p.text)}</span></button>`;
    }
    return `<button class="item subpoint" data-i="${i}" data-src="${src}"><span class="num">•</span><span class="body">${richHtml(p.subs[it.si])}</span></button>`;
  }).join('');
  markOutlineSelection();
  if (live) onState({ live, theme });
}

function markOutlineSelection() {
  $$('#notesOutline .item').forEach(el => el.classList.toggle('selected', Number(el.dataset.i) === outlineIndex));
}

function showOutline(i) {
  if (i < 0 || i >= outlineItems.length) return;
  outlineIndex = i;
  markOutlineSelection();
  $(`#notesOutline [data-i="${i}"]`).scrollIntoView({ block: 'nearest' });
  goLive(noteLiveItem(outlineItems[i]));
}

function currentSermon() { return sermons.find(s => s.id === sermonId); }

function renderSermonSelect() {
  $('#sermonSelect').innerHTML = sermons.map(s => {
    const title = s.title || richPlain(parseNotes(s.text).topic) || 'Untitled sermon';
    const date = new Date(s.updated).toLocaleDateString();
    return `<option value="${s.id}"${s.id === sermonId ? ' selected' : ''}>${escapeHtml(title)} — ${date}</option>`;
  }).join('');
}

const notesEditor = createRichEditor({ source: $('#notesText'), box: $('#notesBox'), toolbar: $('#notesBar') });
function openSermon(id) {
  sermonId = id;
  lsSet('sermon', id);
  $('#sermonTitle').value = currentSermon()?.title || '';
  $('#notesText').value = currentSermon()?.text || '';
  notesEditor.load();
  outlineIndex = -1;
  renderOutline();
  renderSermonSelect();
}

function newSermon() {
  const s = { id: String(Date.now()), text: '', updated: Date.now() };
  sermons.unshift(s);
  store.set('sermons', sermons);
  openSermon(s.id);
  $('#sermonTitle').focus();
}

const saveSermons = debounce(() => {
  store.set('sermons', sermons);
  renderSermonSelect();
}, 600);

[['notesText', 'text'], ['sermonTitle', 'title']].forEach(([elId, field]) => {
  $(`#${elId}`).addEventListener('input', e => {
    const s = currentSermon();
    if (s) { s[field] = e.target.value; s.updated = Date.now(); }
    renderOutline();
    saveSermons();
  });
});
$('#notesOutline').addEventListener('click', e => {
  const el = e.target.closest('.item');
  if (!el) return;
  const it = outlineItems[Number(el.dataset.i)];
  if ((e.ctrlKey || e.metaKey) && it.kind === 'point') {
    if (comparePoints.has(it.pi)) comparePoints.delete(it.pi);
    else if (comparePoints.size < 3) comparePoints.add(it.pi);
    el.classList.toggle('marked', comparePoints.has(it.pi));
    updateCompareButton();
    return;
  }
  showOutline(Number(el.dataset.i));
});
$('#notesShowAll').addEventListener('click', showAllPoints);
// Each tab's Hide only takes its own kind of item off screen.
$('#bibleHide').addEventListener('click', () => { if (live?.type === 'bible') clearLive(); });
$('#songHide').addEventListener('click', () => { if (live?.type === 'lyrics') clearLive(); });
// Hide only takes sermon notes off screen (a point, all points, side by side, or the title).
$('#notesHide').addEventListener('click', () => {
  if (['note', 'outline', 'compare'].includes(live?.type)) clearLive();
});

// The sermon title on the timer looks the same as clicking the title in the outline.
const sermonTimerItem = () => ({ type: 'note', tag: "Today's message", title: outline.topic, subs: [], timer: 'sermon' });
$('#notesTimer').addEventListener('click', e => {
  if (sermonTimerOn()) return sendAuto({ on: false });
  if (!outline.topic) {
    e.target.textContent = 'Type a sermon title first';
    return setTimeout(() => markTimer(e.target, false, ' (title)'), 2000);
  }
  sendAuto({ on: true, item: sermonTimerItem() });
});
// Keep the timer showing the latest title when it is edited or another sermon is picked.
const syncSermonTimer = debounce(() => {
  if (sermonTimerOn() && outline.topic && outline.topic !== lastAuto.item.title) sendAuto({ item: sermonTimerItem() });
}, 600);
$('#notesCompare').addEventListener('click', showCompare);
$('#sermonSelect').addEventListener('change', e => openSermon(e.target.value));
$('#sermonNew').addEventListener('click', newSermon);
$('#sermonDelete').addEventListener('click', e => confirmClick(e.currentTarget, () => {
  sermons = sermons.filter(s => s.id !== sermonId);
  if (!sermons.length) sermons.push({ id: String(Date.now()), text: '', updated: Date.now() });
  store.set('sermons', sermons);
  openSermon(sermons[0].id);
}));
['optNumber', 'optReveal', 'optAll'].forEach(id => $(`#${id}`).addEventListener('change', e => {
  lsSet(id, e.target.checked ? '1' : '0');
  refreshNotesLive();
}));
// Re-show whatever sermon note is on screen with the new options, keeping the same view.
// Uses what is live (not the last click), so it also works after the panel is reloaded.
function refreshNotesLive() {
  const src = live?.src || '';
  // All points / side by side: turn the button blue so the user presses it to update the screen.
  if (src === 'note:all' || src === 'note:compare') return markNotesStale();
  if (!src.startsWith('note:')) return;
  const i = outlineItems.findIndex(it => noteSrc(it) === src);
  if (i >= 0) goLive(noteLiveItem(outlineItems[i]));
}

// ---------- Songs ----------
let songs = [];
let songId = null;
let songSlides = [];
let songIndex = -1;

const SECTION_RE = /^(?:\[(.+)\]|((?:verse|chorus|pre-?chorus|bridge|tag|intro|outro|ending|refrain)(?:\s*\d+)?)\s*:?)$/i;
const titleCase = s => s.replace(/\b\w/g, c => c.toUpperCase());

// Split lyrics into sections: "[Chorus]"-style labels, or blank lines between sections.
function parseSong(text) {
  const sections = [];
  let cur = null;
  const start = label => { cur = { label, lines: [] }; sections.push(cur); };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(SECTION_RE);
    if (m) { start(titleCase((m[1] || m[2]).trim())); continue; }
    if (!line) {
      if (cur && cur.lines.length) cur = null;
      continue;
    }
    if (!cur) start('');
    cur.lines.push(line);
  }
  // Unlabeled sections continue the verse numbering ("Verse 1" labeled -> next is "Verse 2").
  let verse = 0;
  return sections
    .filter(s => s.lines.length)
    .map(s => {
      const n = s.label.match(/^Verse\s*(\d+)$/i);
      if (n) verse = Math.max(verse, Number(n[1]));
      return { ...s, label: s.label || `Verse ${++verse}` };
    });
}

// Each section becomes one or more screens, depending on "lines per screen".
function buildSongSlides(sections, perScreen) {
  const slides = [];
  sections.forEach(s => {
    const n = perScreen || s.lines.length;
    for (let i = 0; i < s.lines.length; i += n) {
      slides.push({ label: s.label, lines: s.lines.slice(i, i + n), first: i === 0 });
    }
  });
  return slides;
}

function currentSong() { return songs.find(s => s.id === songId); }
const songSrc = i => `song:${songId}:${i}`;

function renderSongSlides() {
  const song = currentSong();
  songSlides = buildSongSlides(parseSong(song?.text || ''), Number($('#songLines').value));
  $('#songShow').disabled = !songSlides.length;
  if (!songSlides.length) {
    $('#songSlides').innerHTML = '<p class="hint">This song has no lyrics yet. Paste or type them in the box (or use ⬆ Upload songs), and the sections appear here to click.</p>';
    return;
  }
  $('#songSlides').innerHTML = songSlides.map((sl, i) => `
    ${sl.first ? `<div class="section-label">${escapeHtml(sl.label)}</div>` : ''}
    <button class="item${i === songIndex ? ' selected' : ''}" data-i="${i}" data-src="${songSrc(i)}">
      <span class="body">${sl.lines.map(escapeHtml).join('<br>')}</span>
    </button>`).join('');
  if (live) onState({ live, theme });
}

function songLiveItem(i) {
  const song = currentSong();
  const sl = songSlides[i];
  return {
    type: 'lyrics',
    src: songSrc(i),
    title: song.title || 'Untitled song',
    label: sl.label,
    tag: $('#songShowTitle').checked ? song.title : '',
    lines: sl.lines,
  };
}

function showSongSlide(i) {
  if (i < 0 || i >= songSlides.length) return;
  songIndex = i;
  $$('#songSlides .item').forEach(el => el.classList.toggle('selected', Number(el.dataset.i) === i));
  $(`#songSlides [data-i="${i}"]`).scrollIntoView({ block: 'nearest' });
  goLive(songLiveItem(i));
}

function renderSongSelect() {
  const sorted = [...songs].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  $('#songSelect').innerHTML = sorted.map(s =>
    `<option value="${s.id}"${s.id === songId ? ' selected' : ''}>${escapeHtml(s.title || 'Untitled song')}${s.author ? ` — ${escapeHtml(s.author)}` : ''}</option>`
  ).join('');
}

function openSong(id) {
  songId = id;
  lsSet('song', id);
  const song = currentSong();
  $('#songTitle').value = song?.title || '';
  $('#songAuthor').value = song?.author || '';
  $('#songText').value = song?.text || '';
  songIndex = -1;
  renderSongSlides();
  renderSongSelect();
}

function newSong() {
  const s = { id: String(Date.now()), title: '', author: '', text: '' };
  songs.push(s);
  store.set('songs', songs);
  openSong(s.id);
  $('#songTitle').focus();
}

const saveSongs = debounce(() => {
  store.set('songs', songs);
  renderSongSelect();
}, 600);

[['songTitle', 'title'], ['songAuthor', 'author'], ['songText', 'text']].forEach(([elId, field]) => {
  $(`#${elId}`).addEventListener('input', e => {
    const song = currentSong();
    if (!song) return;
    song[field] = e.target.value;
    if (field === 'text') renderSongSlides();
    saveSongs();
  });
});
$('#songSlides').addEventListener('click', e => {
  const el = e.target.closest('.item');
  if (el) showSongSlide(Number(el.dataset.i));
});
$('#songSelect').addEventListener('change', e => openSong(e.target.value));
$('#songShow').addEventListener('click', () => showSongSlide(Math.max(songIndex, 0)));
$('#songNew').addEventListener('click', newSong);

// ----- Upload song files -----
// SongSelect .txt (title on line 1, CCLI footer), ChordPro (.cho/.pro…), or plain lyrics.
const CHORD_RE = /^\(?[A-G][#b]?(?:m|maj|min|sus|dim|aug|add|M)?\d*(?:sus\d*|add\d*)?(?:\/[A-G][#b]?)?\)?$/;
const isChordLine = line => line.split(/\s+/).filter(Boolean).every(t => CHORD_RE.test(t) || /^[|\-x/.]+$/.test(t));
const fileTitle = name => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();

function parseChordPro(text, name) {
  let title = '', author = '';
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const d = line.match(/^\{\s*([\w-]+)\s*(?::\s*(.*?))?\s*\}$/);
    if (d) {
      const [, key, value = ''] = d;
      const k = key.toLowerCase();
      if (k === 'title' || k === 't') title = value;
      else if (['artist', 'subtitle', 'st', 'composer', 'lyricist'].includes(k)) author ||= value;
      else if (['comment', 'c', 'comment_italic', 'ci', 'comment_box', 'cb'].includes(k)) out.push('', `[${value}]`);
      else if (/^(start_of_chorus|soc)$/.test(k)) out.push('', `[${value || 'Chorus'}]`);
      else if (/^(start_of_verse|sov)$/.test(k)) out.push('', ...(value ? [`[${value}]`] : []));
      else if (/^(start_of_bridge|sob)$/.test(k)) out.push('', `[${value || 'Bridge'}]`);
      else if (/^(end_of_\w+|eo[cvb])$/.test(k)) out.push('');
      continue;
    }
    if (line.startsWith('#')) continue;
    const lyric = raw.replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();
    if (line && !lyric) continue; // a line of chords only
    out.push(lyric);
  }
  return { title: title || fileTitle(name), author, text: out.join('\n') };
}

function parseSongText(text, name) {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+$/, ''));
  // SongSelect: a CCLI footer at the end with the song number, writers and copyright.
  const footerAt = lines.findIndex(l => /^CCLI Song\s*#/i.test(l.trim()));
  let author = '';
  let body = lines;
  let title = '';
  if (footerAt >= 0) {
    const footer = lines.slice(footerAt);
    const songNo = footer[0].match(/#\s*(\d+)/)?.[1];
    author = [footer[1]?.trim(), songNo && `CCLI ${songNo}`].filter(Boolean).join(' · ');
    body = lines.slice(0, footerAt);
    const first = body.findIndex(l => l.trim());
    if (first >= 0 && !SECTION_RE.test(body[first].trim())) {
      title = body[first].trim();
      body = body.slice(first + 1);
    }
  }
  const cleaned = body.filter(l => !(l.trim() && isChordLine(l.trim())));
  return { title: title || fileTitle(name), author, text: cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

function parseSongFile(name, content) {
  const text = content.replace(/^﻿/, '');
  const chordPro = /\.(cho|chopro|chordpro|pro|crd)$/i.test(name) || /^\s*\{\s*(title|t)\s*:/im.test(text);
  return chordPro ? parseChordPro(text, name) : parseSongText(text, name);
}

$('#songUpload').addEventListener('click', () => $('#songFiles').click());
$('#songFiles').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  let added = 0, updated = 0, firstId = null;
  const skipped = [];
  for (const file of files) {
    const song = parseSongFile(file.name, await file.text());
    if (!parseSong(song.text).length) { skipped.push(file.name); continue; }
    // Same title again replaces the old copy instead of making a duplicate.
    const existing = songs.find(s => (s.title || '').trim().toLowerCase() === song.title.toLowerCase());
    if (existing) { Object.assign(existing, song); updated++; firstId ||= existing.id; }
    else {
      const s = { id: `${Date.now()}${added}`, ...song };
      songs.push(s);
      added++;
      firstId ||= s.id;
    }
  }
  // Drop the empty "Untitled" song a fresh install starts with.
  if (firstId) {
    songs = songs.filter(s => s.title || s.text);
    store.set('songs', songs);
    openSong(firstId);
  }
  const plural = n => `${n} song${n > 1 ? 's' : ''}`;
  const done = [added && `added ${plural(added)}`, updated && `updated ${plural(updated)}`].filter(Boolean).join(', ');
  const status = [done, skipped.length && `no lyrics found in ${skipped.join(', ')}`].filter(Boolean).join('. ');
  $('#songUploadStatus').textContent = status.charAt(0).toUpperCase() + status.slice(1);
});
$('#songDelete').addEventListener('click', e => confirmClick(e.currentTarget, () => {
  songs = songs.filter(s => s.id !== songId);
  if (!songs.length) songs.push({ id: String(Date.now()), title: '', author: '', text: '' });
  store.set('songs', songs);
  openSong(songs[0].id);
}));
$('#songLines').addEventListener('change', e => {
  lsSet('songLines', e.target.value);
  songIndex = -1;
  renderSongSlides();
});
$('#songShowTitle').addEventListener('change', e => {
  lsSet('songShowTitle', e.target.checked ? '1' : '0');
  if (live?.type === 'lyrics' && songIndex >= 0) goLive(songLiveItem(songIndex));
});

// ---------- Saved lists (names + messages) ----------
// isShowing(item, live) says whether that saved item is the one on screen, so Hide only hides it.
function savedList({ key, listEl, toLive, label, onTimer, onRender, isShowing, empty = 'Nothing saved yet.' }) {
  let items = [];
  const render = () => {
    listEl.innerHTML = items.length ? items.map((it, i) => `
      <div class="item" data-src="${key}:${i}">
        <div class="body">${label(it)}</div>
        <div class="actions">
          <button class="btn small primary" data-show="${i}">Show</button>
          <button class="btn small" data-hide="${i}">Hide</button>
          ${onTimer ? `<button class="btn small" data-timer="${i}" title="Show and hide on a timer">⏱ Timer</button>` : ''}
          <button class="btn small" data-del="${i}">✕</button>
        </div>
      </div>`).join('') : `<p class="hint">${empty}</p>`;
    if (live) onState({ live, theme });
    onRender?.(items);
  };
  listEl.addEventListener('click', e => {
    const { show, hide, timer, del } = e.target.dataset;
    if (show !== undefined) goLive({ ...toLive(items[show]), src: `${key}:${show}` });
    if (hide !== undefined && live && (live.src === `${key}:${hide}` || isShowing?.(items[hide], live))) clearLive();
    if (timer !== undefined) onTimer(items[timer]);
    if (del !== undefined) { items.splice(Number(del), 1); store.set(key, items); render(); }
  });
  return {
    async load() { items = await store.get(key, []); render(); },
    add(it) { items.unshift(it); store.set(key, items); render(); },
    items: () => items,
  };
}

// Letter case for name tags. The name and the title each have their own setting.
function applyCase(text, mode) {
  if (mode === 'upper') return text.toUpperCase();
  if (mode === 'lower') return text.toLowerCase();
  if (mode === 'title') return text.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
  return text;
}
const caseSelects = { name: $('#nameCase'), role: $('#roleCase') };
const nameItem = p => ({
  type: 'name',
  name: applyCase(p.name, caseSelects.name.value),
  role: applyCase(p.role || '', caseSelects.role.value),
  orig: { name: p.name, role: p.role || '' },
});
for (const [field, sel] of Object.entries(caseSelects)) {
  sel.value = lsGet(`${field}Case`, '');
  sel.addEventListener('change', () => {
    lsSet(`${field}Case`, sel.value);
    // Re-show the name on screen with the new case.
    if (lastAuto?.on && lastAuto.item.type === 'name') sendAuto({ item: nameItem(lastAuto.item.orig) });
    if (live?.type === 'name' && live.orig && live.src !== 'auto') goLive({ ...nameItem(live.orig), src: live.src });
  });
}

// ---------- Timer: show a name or the sermon title for a while, hide it, repeat (runs on the server) ----------
let lastAuto = null;
const samePerson = (a, b) => !!a && !!b && a.name === b.name && (a.role || '') === (b.role || '');
const timerFor = p => lastAuto?.on && lastAuto.item?.type === 'name' && samePerson(p, lastAuto.item.orig);
const sermonTimerOn = () => lastAuto?.on && lastAuto.item?.timer === 'sermon';
const sendAuto = (extra = {}) => api.send('POST', '/api/auto', {
  showFor: Number($('#autoShowFor').value),
  showUnit: $('#autoShowUnit').value,
  hideFor: Number($('#autoHideFor').value),
  hideUnit: $('#autoHideUnit').value,
  ...extra,
});
// The Timer button starts the timer for that name, or stops it if it is already running.
function toggleTimer(p) {
  if (!p?.name) return;
  sendAuto(timerFor(p) ? { on: false } : { on: true, item: nameItem(p) });
}
function renderAuto(a) {
  lastAuto = a;
  for (const [id, v] of [['#autoShowFor', a.showFor], ['#autoShowUnit', a.showUnit], ['#autoHideFor', a.hideFor], ['#autoHideUnit', a.hideUnit]]) {
    if (document.activeElement !== $(id)) $(id).value = v;
  }
  $('#autoStop').classList.toggle('hidden', !a.on);
  const people = names.items();
  $$('#namesList [data-timer]').forEach(btn => markTimer(btn, timerFor(people[btn.dataset.timer])));
  markTimer($('#nameTimer'), timerFor(readName()));
  markTimer($('#notesTimer'), sermonTimerOn(), ' (title)');
  renderAutoStatus();
}
function markTimer(btn, on, suffix = '') {
  btn.classList.toggle('on', !!on);
  btn.textContent = (on ? '⏱ Stop' : '⏱ Timer') + suffix;
}
function renderAutoStatus() {
  const a = lastAuto;
  if (!a) return;
  const time = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const who = !a.item ? '' : a.item.type === 'name'
    ? `${a.item.name}${a.item.role ? `, ${a.item.role}` : ''}`
    : `Sermon title "${richPlain(a.item.title)}"`;
  let text = 'Press ⏱ Timer on a name or on the sermon title (Sermon Notes) to start. It shows the name, hides it after the time above, and repeats.';
  if (a.on && a.hideAt) text = `Showing ${who} until ${time(a.hideAt)}`;
  else if (a.on && a.nextAt > Date.now()) text = `${who} is hidden. Shows again at ${time(a.nextAt)}`;
  else if (a.on) text = `${who}: waiting for the screen to be free (it never covers a verse or song).`;
  $('#autoStatus').textContent = text;
}
setInterval(renderAutoStatus, 1000);
$('#autoStop').addEventListener('click', () => sendAuto({ on: false }));
for (const id of ['#autoShowFor', '#autoShowUnit', '#autoHideFor', '#autoHideUnit']) {
  $(id).addEventListener('change', () => sendAuto());
}

const names = savedList({
  key: 'people',
  empty: 'Type a name and title above, then press <b>+ Save to list</b>. Save each speaker once and they stay here with their own Show, Hide and Timer buttons, so you never retype them.',
  listEl: $('#namesList'),
  toLive: nameItem,
  label: p => `<strong>${escapeHtml(p.name)}</strong><div class="sub">${escapeHtml(p.role)}</div>`,
  isShowing: (p, l) => samePerson(p, l.orig),
  onTimer: toggleTimer,
  onRender: () => lastAuto && renderAuto(lastAuto),
});
const readName = () => ({ name: $('#nameName').value.trim(), role: $('#nameRole').value.trim() });
$('#nameForm').addEventListener('submit', e => {
  e.preventDefault();
  const p = readName();
  if (p.name) { names.add(p); $('#nameForm').reset(); }
});
$('#nameShow').addEventListener('click', () => {
  const p = readName();
  if (p.name) goLive({ ...nameItem(p), src: 'name:typed' });
});
$('#nameHide').addEventListener('click', () => {
  if (live?.type === 'name' && (live.src === 'name:typed' || samePerson(readName(), live.orig))) clearLive();
});
$('#nameTimer').addEventListener('click', () => toggleTimer(readName()));
for (const id of ['#nameName', '#nameRole']) {
  $(id).addEventListener('input', () => lastAuto && markTimer($('#nameTimer'), timerFor(readName())));
}

const messages = savedList({
  key: 'messages',
  listEl: $('#msgList'),
  toLive: m => ({ type: 'message', ...m }),
  label: m => `${m.tag ? `<div class="sub">${escapeHtml(m.tag)}</div>` : ''}<strong>${escapeHtml(m.title)}</strong> ${richHtml(m.text)}`,
});
const msgEditor = createRichEditor({ source: $('#msgText'), box: $('#msgBox'), toolbar: $('#msgBar') });
msgEditor.load();
const hasMsg = m => m.title || richPlain(m.text).trim();
const readMsg = () => ({ tag: $('#msgTag').value.trim(), title: $('#msgTitle').value.trim(), text: $('#msgText').value.trim() });
$('#msgForm').addEventListener('submit', e => {
  e.preventDefault();
  const m = readMsg();
  if (hasMsg(m)) { messages.add(m); $('#msgForm').reset(); msgEditor.load(); }
});
$('#msgShow').addEventListener('click', () => {
  const m = readMsg();
  if (hasMsg(m)) goLive({ type: 'message', src: 'message:typed', ...m });
});
$('#msgHide').addEventListener('click', () => { if (live?.src === 'message:typed') clearLive(); });

// ---------- Countdown ----------
// minutes or clock is kept with the item, so one saved in the order of service counts from when it's used.
function startCountdown(target, how) {
  goLive({
    type: 'countdown',
    src: 'countdown',
    target,
    ...how,
    label: $('#cdLabel').value.trim(),
    endText: $('#cdEnd').value.trim(),
  });
}
function clockTarget(clock) {
  const [h, m] = clock.split(':').map(Number);
  const t = new Date(Date.now());
  t.setHours(h, m, 0, 0);
  if (t.getTime() < Date.now()) t.setDate(t.getDate() + 1);
  return t.getTime();
}
function countdownNow(item) {
  if (item.clock) return { ...item, target: clockTarget(item.clock) };
  return item.minutes ? { ...item, target: Date.now() + item.minutes * 60000 } : item;
}
$('#cdStop').addEventListener('click', () => { if (live?.type === 'countdown') clearLive(); });
$$('[data-min]').forEach(b => b.addEventListener('click', () => startCountdown(Date.now() + Number(b.dataset.min) * 60000, { minutes: Number(b.dataset.min) })));
$('#cdStartTime').addEventListener('click', () => {
  const clock = $('#cdTime').value;
  if (clock) startCountdown(clockTarget(clock), { clock });
});

// ---------- Style ----------
const styleForm = $('#styleForm');
function fillStyleForm() {
  for (const el of styleForm.elements) {
    if (el.name && document.activeElement !== el && theme[el.name] !== undefined) el.value = theme[el.name];
  }
}
const pushTheme = debounce(patch => api.send('POST', '/api/theme', { theme: patch }), 80);
let pendingTheme = {};
styleForm.addEventListener('input', e => {
  const el = e.target;
  pendingTheme[el.name] = el.type === 'range' ? Number(el.value) : el.value;
  pushTheme(pendingTheme);
});
styleForm.addEventListener('change', () => { pendingTheme = {}; });
// Lower third or full screen, and alignment, switched straight away (also for what is on screen now).
function markLayout() {
  const layout = theme.layout || 'lower';
  $$('#layoutSeg [data-layout]').forEach(b => b.classList.toggle('on', b.dataset.layout === layout));
  $$('#alignSeg [data-align]').forEach(b => b.classList.toggle('on', b.dataset.align === (theme.position || 'left')));
}
$('#layoutSeg').addEventListener('click', e => {
  const layout = e.target.dataset.layout;
  if (!layout) return;
  theme = { ...theme, layout };
  markLayout();
  api.send('POST', '/api/theme', { theme: { layout } });
});
// Align moves the box and its text left, centre or right (same as Style → Position).
$('#alignSeg').addEventListener('click', e => {
  const position = e.target.dataset.align;
  if (!position) return;
  theme = { ...theme, position };
  markLayout();
  api.send('POST', '/api/theme', { theme: { position } });
});
$('#styleReset').addEventListener('click', () => api.send('POST', '/api/theme', { reset: true }));
$('#styleTest').addEventListener('click', () => goLive({
  type: 'bible',
  src: 'test',
  reference: 'John 3:16',
  translation: 'KJV',
  verses: [{ verse: 16, text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.' }],
}));

// ---------- Order of service ----------
// Entries: { id, kind: 'live', item } (a saved screen) or { id, kind: 'song', songId } (a whole song).
let order = [];
let orderIndex = -1;
const saveOrder = () => store.set('serviceOrder', order);

function orderLabel(e) {
  if (e.kind === 'song') {
    const song = songs.find(s => s.id === e.songId);
    return song ? `Song · ${song.title || 'Untitled song'} (whole song)` : 'Song (deleted)';
  }
  return describe({ ...e.item, src: '' });
}

function renderOrder() {
  $('#orderList').innerHTML = order.length ? order.map((e, i) => `
    <div class="item${i === orderIndex ? ' selected' : ''}" data-i="${i}">
      <span class="num">${i + 1}</span>
      <div class="body">${escapeHtml(orderLabel(e))}</div>
      <div class="actions">
        <button class="btn small primary" data-oshow="${i}">Show</button>
        <button class="btn small" data-oup="${i}" title="Move up"${i ? '' : ' disabled'}>↑</button>
        <button class="btn small" data-odown="${i}" title="Move down"${i < order.length - 1 ? '' : ' disabled'}>↓</button>
        <button class="btn small" data-odel="${i}" title="Remove">✕</button>
      </div>
    </div>`).join('') : '<p class="hint">Nothing in the order yet.</p>';
  $('#orderPrev').disabled = $('#orderNext').disabled = !order.length;
}

function addToOrder(entry) {
  order.push({ id: `${Date.now()}`, ...entry });
  saveOrder();
  renderOrder();
}

function showOrder(i, { lastSection = false } = {}) {
  const e = order[i];
  if (!e) return;
  orderIndex = i;
  renderOrder();
  if (e.kind === 'song') {
    if (!songs.some(s => s.id === e.songId)) return;
    openSong(e.songId);
    showSongSlide(lastSection ? songSlides.length - 1 : 0);
  } else if (e.item.type === 'giving') {
    // Always today's details, in case a number changed after this was added.
    const g = readGiving();
    goLive(g.title || g.lines.length || g.qr ? { type: 'giving', src: 'giving', ...g } : e.item);
  } else {
    goLive(e.item.type === 'countdown' ? countdownNow(e.item) : e.item);
  }
}

// Next/previous: inside a song it moves section by section first.
function stepOrder(dir) {
  const e = order[orderIndex];
  if (e?.kind === 'song' && songId === e.songId) {
    const j = songIndex + dir;
    if (j >= 0 && j < songSlides.length) return showSongSlide(j);
  }
  const i = orderIndex + dir;
  if (i < 0 || i >= order.length) return;
  // Going back into a song lands on its last section.
  showOrder(i, { lastSection: dir < 0 });
}

$('#orderNext').addEventListener('click', () => stepOrder(1));
$('#orderPrev').addEventListener('click', () => stepOrder(-1));
$('#orderClear').addEventListener('click', e => confirmClick(e.currentTarget, () => {
  order = [];
  orderIndex = -1;
  saveOrder();
  renderOrder();
}));
$('#orderAdd').addEventListener('click', () => {
  if (!live) { $('#orderAdd').textContent = 'Put something on screen first'; setTimeout(() => { $('#orderAdd').textContent = '+ Add to order'; }, 2000); return; }
  const { src, ...item } = live;
  addToOrder({ kind: 'live', item: { ...item, src: `order:${Date.now()}` } });
  $('#orderAdd').textContent = `✓ Added (${order.length})`;
  setTimeout(() => { $('#orderAdd').textContent = '+ Add to order'; }, 1500);
});
$('#songToOrder').addEventListener('click', () => {
  if (!currentSong()) return;
  addToOrder({ kind: 'song', songId });
  $('#songToOrder').textContent = `✓ Added (${order.length})`;
  setTimeout(() => { $('#songToOrder').textContent = '+ Add song to order'; }, 1500);
});
$('#orderList').addEventListener('click', e => {
  const d = e.target.dataset;
  if (d.oshow !== undefined) showOrder(Number(d.oshow));
  const move = (i, j) => { [order[i], order[j]] = [order[j], order[i]]; if (orderIndex === i) orderIndex = j; else if (orderIndex === j) orderIndex = i; saveOrder(); renderOrder(); };
  if (d.oup !== undefined) move(Number(d.oup), Number(d.oup) - 1);
  if (d.odown !== undefined) move(Number(d.odown), Number(d.odown) + 1);
  if (d.odel !== undefined) {
    const i = Number(d.odel);
    order.splice(i, 1);
    if (orderIndex >= i) orderIndex--;
    saveOrder();
    renderOrder();
  }
});

// ---------- Keyboard ----------
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { clearLive(); return; }
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable;
  if (typing || e.ctrlKey || e.altKey || e.metaKey) return; // Ctrl+N, Alt+Left and so on belong to the browser
  if (e.key === 'n' || e.key === 'N') { if (order.length) stepOrder(1); return; }
  const step = { ArrowDown: 1, ArrowRight: 1, PageDown: 1, ArrowUp: -1, ArrowLeft: -1, PageUp: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  stepActive(step);
});
// Next/previous on whatever tab is open (keys, clickers and Stream Deck).
function stepActive(step) {
  if (activeTab === 'order') stepOrder(step);
  if (activeTab === 'bible') stepBible(step);
  if (activeTab === 'notes' && outlineItems.length) showOutline(Math.max(0, Math.min(outlineItems.length - 1, outlineIndex + step)));
  if (activeTab === 'songs' && songSlides.length) showSongSlide(Math.max(0, Math.min(songSlides.length - 1, songIndex + step)));
}
$('#clearBtn').addEventListener('click', clearLive);

// ---------- Giving ----------
const givEditor = createRichEditor({ source: $('#givLines'), box: $('#givBox'), toolbar: $('#givBar') });
givEditor.load();
const readGiving = () => ({
  tag: $('#givTag').value.trim(),
  title: $('#givTitle').value.trim(),
  lines: $('#givLines').value.split('\n').map(l => l.trim()).filter(l => richPlain(l).trim()),
  qr: $('#givQr').value.trim(),
});
// Says so when the QR text is too long, because the screen then shows the details without a code.
function checkGivingQr() {
  let tooLong = false;
  try { if ($('#givQr').value.trim()) qrSvg($('#givQr').value.trim()); } catch { tooLong = true; }
  $('#givQrWarn').classList.toggle('hidden', !tooLong);
}
const saveGiving = debounce(() => {
  const g = readGiving();
  store.set('giving', g);
  checkGivingQr();
  // Keep what's on screen up to date while editing.
  if (live?.src === 'giving') goLive({ type: 'giving', src: 'giving', ...g });
}, 500);
['givTag', 'givTitle', 'givLines', 'givQr'].forEach(id => $(`#${id}`).addEventListener('input', saveGiving));
$('#givShow').addEventListener('click', () => {
  const g = readGiving();
  if (g.title || g.lines.length || g.qr) goLive({ type: 'giving', src: 'giving', ...g });
});
$('#givHide').addEventListener('click', () => { if (live?.type === 'giving') clearLive(); });

// ---------- Ticker ----------
let tickerState = null;
let tkUnsent = false; // typed, but not sent to the server yet
const tkEditor = createRichEditor({ source: $('#tkTextIn'), box: $('#tkBox'), toolbar: $('#tkBar') });
tkEditor.load();
function renderTicker(t) {
  tickerState = t;
  // Don't reload while typing, or when nothing changed: that would lose the cursor and Ctrl+Z.
  if (!tkUnsent && document.activeElement !== $('#tkBox') && $('#tkTextIn').value !== (t.text || '')) {
    $('#tkTextIn').value = t.text || '';
    tkEditor.load();
  }
  if (!tkUnsent && document.activeElement !== $('#tkLabelIn')) $('#tkLabelIn').value = t.label || '';
  $('#tkSpeed').value = String(t.speed || 120);
  if (!$('#tkSpeed').value) $('#tkSpeed').value = '120';
  $('#tkStart').classList.toggle('live', !!t.on);
  $('#tkStart').textContent = t.on ? '● Ticker running' : '▶ Start ticker';
}
const sendTicker = patch => api.send('POST', '/api/ticker', patch);
const readTicker = () => ({ text: $('#tkTextIn').value, label: $('#tkLabelIn').value.trim(), speed: Number($('#tkSpeed').value) });
const pushTicker = debounce(() => { sendTicker(readTicker()).finally(() => { tkUnsent = false; }); }, 500);
['tkTextIn', 'tkLabelIn'].forEach(id => $(`#${id}`).addEventListener('input', () => { tkUnsent = true; pushTicker(); }));
$('#tkSpeed').addEventListener('change', () => sendTicker(readTicker()));
$('#tkStart').addEventListener('click', () => {
  const t = readTicker();
  if (!richPlain(t.text).trim()) { $('#tkBox').focus(); return; }
  sendTicker({ ...t, on: true });
});
$('#tkStop').addEventListener('click', () => sendTicker({ on: false }));

// ---------- Uploads (logo, background) ----------
async function uploadMedia(file) {
  const res = await fetch(`/api/media?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  return res.json();
}

// ---------- Full screen background ----------
$('#bgFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  $('#bgStatus').textContent = 'Uploading…';
  const res = await uploadMedia(file);
  e.target.value = '';
  if (res.error) { $('#bgStatus').textContent = res.error; return; }
  await api.send('POST', '/api/theme', { theme: { fullBg: res.url } });
  $('#bgStatus').textContent = `Background set: ${file.name}. It shows behind full screen items.`;
});
$('#bgRemove').addEventListener('click', async () => {
  await api.send('POST', '/api/theme', { theme: { fullBg: '' } });
  $('#bgStatus').textContent = 'Background removed.';
});

// ---------- Corner logo ----------
function renderLogo(l) {
  if (document.activeElement !== $('#logoText')) $('#logoText').value = l.text || '';
  $('#logoCorner').value = l.corner || 'top-right';
  if (document.activeElement !== $('#logoSize')) $('#logoSize').value = l.size ?? 10;
  if (document.activeElement !== $('#logoOpacity')) $('#logoOpacity').value = l.opacity ?? 0.9;
  $('#logoOn').classList.toggle('live', !!l.on);
  $('#logoOn').textContent = l.on ? '● Logo showing' : 'Show logo';
  $('#logoRemove').disabled = !l.image;
  $('#logoStatus').textContent = l.image ? 'Using your uploaded picture (text is used when there is no picture).' : '';
}
const sendLogo = patch => api.send('POST', '/api/logo', patch);
const pushLogoText = debounce(() => sendLogo({ text: $('#logoText').value.trim() }), 400);
$('#logoText').addEventListener('input', pushLogoText);
$('#logoCorner').addEventListener('change', e => sendLogo({ corner: e.target.value }));
const pushLogoLook = debounce(() => sendLogo({ size: Number($('#logoSize').value), opacity: Number($('#logoOpacity').value) }), 80);
['logoSize', 'logoOpacity'].forEach(id => $(`#${id}`).addEventListener('input', pushLogoLook));
$('#logoOn').addEventListener('click', () => sendLogo({ on: true }));
$('#logoOff').addEventListener('click', () => sendLogo({ on: false }));
$('#logoRemove').addEventListener('click', () => sendLogo({ image: '' }));
$('#logoFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  $('#logoStatus').textContent = 'Uploading…';
  const res = await uploadMedia(file);
  e.target.value = '';
  if (res.error) { $('#logoStatus').textContent = res.error; return; }
  sendLogo({ image: res.url, on: true });
});

// ---------- Phone, Stream Deck, backup ----------
async function renderPhone() {
  const info = await api.get('/api/info').catch(() => ({ phoneUrls: [] }));
  const urls = info.phoneUrls || [];
  $('#phoneQr').innerHTML = urls.length ? qrSvg(urls[0]) : '';
  $('#phoneUrls').innerHTML = urls.length
    ? urls.map(u => `<code class="copy">${escapeHtml(u)}</code>`).join('')
    : '<p class="hint">This computer isn\'t on a network right now.</p>';
  const base = (urls[0] || `${location.origin}/control.html`).replace(/\/control\.html$/, '');
  const cmds = [
    ['next', 'Next (verse, note line or song section)'], ['prev', 'Previous'], ['clear', 'Clear the screen'],
    ['order-next', 'Next in the order of service'], ['order-prev', 'Previous in the order'],
    ['ticker-on', 'Start the ticker'], ['ticker-off', 'Stop the ticker'], ['logo-on', 'Show the logo'], ['logo-off', 'Hide the logo'],
  ];
  $('#remoteList').innerHTML = cmds.map(([c, label]) => `<div class="remote"><span>${label}</span><code class="copy">${escapeHtml(`${base}/api/remote/${c}`)}</code></div>`).join('');
}

$('#restoreBtn').addEventListener('click', e => confirmClick(e.currentTarget, () => $('#restoreFile').click(), 'Click again: this replaces everything'));
$('#restoreFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { $('#restoreStatus').textContent = "That file isn't a backup."; return; }
  const res = await api.send('POST', '/api/restore', data);
  if (res.error) { $('#restoreStatus').textContent = res.error; return; }
  $('#restoreStatus').textContent = 'Restored. Reloading…';
  setTimeout(() => location.reload(), 800);
});

// ---------- Setup URLs ----------
$('#urlOverlay').textContent = `${location.origin}/overlay.html`;
$('#urlControl').textContent = `${location.origin}/control.html`;
// Narrow windows (like an OBS dock) start with this closed so it doesn't push the tabs down.
if (window.innerWidth <= 900) $('#obsSetup').removeAttribute('open');

// Some browsers, including OBS docks, can refuse the clipboard: try the older way too,
// and always say what happened so an old link isn't pasted by mistake.
function copyOldWay(text) {
  const box = document.createElement('textarea');
  box.value = text;
  document.body.append(box);
  box.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  box.remove();
  return ok;
}
document.addEventListener('click', async e => {
  const el = e.target.closest('.copy');
  if (!el) return;
  const text = el.textContent;
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = copyOldWay(text); }
  const cls = ok ? 'copied' : 'copy-failed';
  el.classList.remove('copied', 'copy-failed');
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 2500);
});

// ---------- Another panel saved something: take it in, so this panel never saves over it ----------
const focused = (...ids) => ids.some(id => document.activeElement === $(id));
const setUnfocused = (id, value) => { if (!focused(id)) $(id).value = value; };
// What is being typed here stays, and everything else comes from the other panel's save.
function mergeList(value, mine, editing) {
  if (!editing || !mine) return value;
  return value.some(x => x.id === mine.id) ? value.map(x => (x.id === mine.id ? mine : x)) : [...value, mine];
}
const onStoreChange = {
  songs(value) {
    const editing = focused('#songTitle', '#songAuthor', '#songText');
    songs = mergeList(value, currentSong(), editing);
    if (!songs.length) songs = [{ id: String(Date.now()), title: '', author: '', text: '' }];
    if (!currentSong()) openSong(songs[0].id);
    else if (!editing) {
      const song = currentSong();
      $('#songTitle').value = song.title || '';
      $('#songAuthor').value = song.author || '';
      $('#songText').value = song.text || '';
      renderSongSlides();
    }
    renderSongSelect();
    renderOrder();
  },
  sermons(value) {
    const editing = focused('#notesBox', '#sermonTitle');
    sermons = mergeList(value, currentSermon(), editing);
    if (!sermons.length) sermons = [{ id: String(Date.now()), text: '', updated: Date.now() }];
    if (!currentSermon()) openSermon(sermons[0].id);
    else if (!editing) {
      const sermon = currentSermon();
      $('#sermonTitle').value = sermon.title || '';
      if ($('#notesText').value !== (sermon.text || '')) {
        $('#notesText').value = sermon.text || '';
        notesEditor.load();
      }
      renderOutline();
    }
    renderSermonSelect();
  },
  serviceOrder(value) {
    order = value;
    if (orderIndex >= order.length) orderIndex = -1;
    renderOrder();
  },
  people: () => names.load(),
  messages: () => messages.load(),
  giving(value) {
    setUnfocused('#givTag', value.tag || '');
    setUnfocused('#givTitle', value.title || '');
    setUnfocused('#givQr', value.qr || '');
    if (!focused('#givBox') && $('#givLines').value !== (value.lines || []).join('\n')) {
      $('#givLines').value = (value.lines || []).join('\n');
      givEditor.load();
    }
    checkGivingQr();
  },
  bibleRecent(value) { recent = value; renderRecent(); },
  scriptureLog(value) { scriptureLog = value; renderScriptures(); },
};
async function refreshStore(key) {
  if (!onStoreChange[key]) return;
  const value = await store.get(key, null);
  if (value) onStoreChange[key](value);
}

// ---------- Start ----------
(async function init() {
  selectTab(activeTab);
  $('#optNumber').checked = lsGet('optNumber', '1') === '1';
  $('#optReveal').checked = lsGet('optReveal', '0') === '1';
  $('#optAll').checked = lsGet('optAll', '0') === '1';

  scriptureLog = await store.get('scriptureLog', scriptureLog);
  renderScriptures();
  recent = await store.get('bibleRecent', []);
  renderRecent();
  await loadBibles();

  sermons = await store.get('sermons', []);
  if (!sermons.length) sermons = [{ id: String(Date.now()), text: '', updated: Date.now() }];
  const saved = lsGet('sermon', null);
  openSermon(sermons.some(s => s.id === saved) ? saved : sermons[0].id);

  $('#songLines').value = lsGet('songLines', '0');
  $('#songShowTitle').checked = lsGet('songShowTitle', '0') === '1';
  songs = await store.get('songs', []);
  if (!songs.length) songs = [{ id: String(Date.now()), title: '', author: '', text: '' }];
  const savedSong = lsGet('song', null);
  openSong(songs.some(s => s.id === savedSong) ? savedSong : songs[0].id);

  await Promise.all([names.load(), messages.load()]);
  order = await store.get('serviceOrder', []);
  renderOrder();
  const giving = await store.get('giving', null);
  if (giving) {
    $('#givTag').value = giving.tag || '';
    $('#givTitle').value = giving.title || '';
    $('#givLines').value = (giving.lines || []).join('\n');
    givEditor.load();
    $('#givQr').value = giving.qr || '';
    checkGivingQr();
  }
  renderPhone();
  connect();
})();
