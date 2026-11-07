// Output page - add to OBS as a Browser Source (1920x1080).
const stage = document.getElementById('stage');
const lt = document.getElementById('lt');
const els = {
  tag: document.getElementById('tag'),
  title: document.getElementById('title'),
  text: document.getElementById('text'),
  subs: document.getElementById('subs'),
  grid: document.getElementById('grid'),
};

const subsHtml = (subs, current) => (subs || [])
  .map((s, i) => `<li class="${i === current ? 'current' : ''}">${richHtml(s)}</li>`)
  .join('');

let current = null;      // JSON of the live item currently on screen
let theme = null;
let countdownTimer = null;
let swapTimer = null;

// The stage is 1920 wide; its height follows the window so the bottom of the stage
// is always the bottom of the window, even when the source isn't exactly 16:9.
function fitStage() {
  const scale = window.innerWidth / 1920;
  stage.style.transform = `scale(${scale})`;
  stage.style.height = `${window.innerHeight / scale}px`;
}
window.addEventListener('resize', fitStage);
fitStage();

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function applyTheme(t) {
  const s = stage.style;
  s.setProperty('--accent', t.accent);
  s.setProperty('--bg', hexToRgba(t.bg, t.bgOpacity));
  s.setProperty('--text', t.text);
  s.setProperty('--font', t.font);
  s.setProperty('--scale', t.fontScale);
  s.setProperty('--width', `${t.width}%`);
  s.setProperty('--bottom', `${t.bottom}px`);
  s.setProperty('--fullbg', hexToRgba(t.bg, t.fullOpacity ?? 0.9));
  lt.classList.remove('pos-left', 'pos-center', 'pos-right', 'anim-slide', 'anim-fade');
  lt.classList.add(`pos-${t.position}`, `anim-${t.animation}`);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function render(item) {
  clearInterval(countdownTimer);
  els.tag.textContent = '';
  els.title.textContent = '';
  els.text.innerHTML = '';
  els.text.className = 'lt-text';
  els.subs.innerHTML = '';
  els.grid.innerHTML = '';
  els.grid.className = 'lt-grid';
  let wide = false;

  switch (item.type) {
    case 'bible': {
      const verseHtml = vs => vs.length > 1
        ? vs.map(v => `<span class="vnum">${v.verse}</span>${escapeHtml(v.text)}`).join(' ')
        : escapeHtml(vs[0].text);
      els.tag.textContent = `${item.reference} · ${item.translation}`;
      els.text.classList.add('reading');
      els.text.innerHTML = verseHtml(item.verses);
      if (item.second) {
        els.text.innerHTML += `<div class="second"><div class="second-ref">${escapeHtml(item.second.reference)} · ${escapeHtml(item.second.translation)}</div>${verseHtml(item.second.verses)}</div>`;
      }
      break;
    }
    case 'note':
      els.tag.textContent = richPlain(item.tag);
      els.title.innerHTML = richHtml(item.title);
      els.text.textContent = item.text || '';
      els.subs.innerHTML = subsHtml(item.subs, item.current);
      break;
    case 'outline': {
      // All points; more than 3 flow into a second column (1-3 left, 4-6 right).
      els.tag.textContent = richPlain(item.tag);
      // Today's scriptures can get long: add columns (up to 5) to keep the text readable.
      const cols = item.src === 'scriptures' ? Math.min(5, Math.max(item.points.length > 3 ? 2 : 1, Math.ceil(item.points.length / 7)))
        : item.points.length > 3 ? 2 : 1;
      els.grid.classList.add('outline');
      els.grid.style.setProperty('--cols', cols);
      const perCol = Math.ceil(item.points.length / cols);
      const pointHtml = (p, i) => {
        const state = item.current < 0 ? '' : i === item.current ? ' current' : ' dim';
        // The current point shows its sub-points; "Show all points" shows every point's.
        const pointSubs = i === item.current ? item.subs : item.current < 0 ? item.allSubs?.[i] : null;
        const subs = pointSubs?.length ? `<ul class="lt-subs">${subsHtml(pointSubs, i === item.current ? item.subCurrent : -1)}</ul>` : '';
        return `<div class="pt${state}">${item.numbered ? `<span class="pn">${i + 1}</span>` : '<span class="pn">•</span>'}
          <div><div class="pt-text">${richHtml(p)}</div>${subs}</div></div>`;
      };
      // Each column stacks its own points, so a long list of sub-points leaves no gap in the column next to it.
      els.grid.innerHTML = Array.from({ length: cols }, (_, c) => `<div class="ol-col">${item.points
        .slice(c * perCol, (c + 1) * perCol).map((p, j) => pointHtml(p, c * perCol + j)).join('')}</div>`).join('');
      wide = cols > 1;
      break;
    }
    case 'compare':
      // Chosen points next to each other, each with its sub-points.
      els.tag.textContent = richPlain(item.tag);
      els.grid.classList.add('compare');
      els.grid.style.setProperty('--cols', item.columns.length);
      els.grid.innerHTML = item.columns.map(c => `
        <div class="col">
          <div class="col-title">${item.numbered ? `<span class="pn">${c.n}</span>` : ''}${richHtml(c.title)}</div>
          <ul class="lt-subs">${subsHtml(c.subs, -1)}</ul>
        </div>`).join('');
      wide = true;
      break;
    case 'lyrics':
      els.tag.textContent = item.tag || '';
      els.text.classList.add('lyrics');
      els.text.innerHTML = item.lines.map(escapeHtml).join('<br>');
      break;
    case 'name':
      els.title.textContent = item.name;
      els.text.textContent = item.role || '';
      break;
    case 'giving': {
      // Giving details with a QR code to scan (e.g. a payment link or MoMo number).
      els.tag.textContent = item.tag || 'Giving';
      els.title.textContent = item.title || '';
      // Text too long for a QR code shouldn't stop the details showing. The control panel warns about it.
      let qr = '';
      try { qr = item.qr ? qrSvg(item.qr) : ''; } catch {}
      els.text.innerHTML = `<div class="giving">${qr ? `<div class="giving-qr">${qr}</div>` : ''}
        <div class="giving-lines">${(item.lines || []).map(l => `<div>${richHtml(l)}</div>`).join('')}</div></div>`;
      wide = !!qr;
      break;
    }
    case 'message':
      els.tag.textContent = item.tag || '';
      els.title.textContent = item.title || '';
      els.text.classList.add('keep-lines', 'reading');
      els.text.innerHTML = richHtml(item.text);
      break;
    case 'countdown': {
      els.tag.textContent = item.label || 'Service begins in';
      els.text.classList.add('countdown');
      const tick = () => {
        const left = item.target - Date.now();
        const was = els.text.textContent;
        els.text.textContent = left > 0 ? formatRemaining(left) : (item.endText || 'Welcome!');
        // The end text can be much longer than the clock.
        if (left <= 0 && was !== els.text.textContent) autoFit();
      };
      tick();
      countdownTimer = setInterval(tick, 250);
      break;
    }
  }
  lt.classList.toggle('no-tag', !els.tag.textContent);
  lt.classList.toggle('wide', wide);
  // A short list of references: the box hugs the list instead of spreading it out.
  lt.classList.toggle('snug', item.src === 'scriptures');
  lt.classList.toggle('full', theme?.layout === 'full');
  autoFit();
}

// Shrink long passages so they never overflow the lower third (or the screen).
function autoFit() {
  let fit = 1;
  lt.style.setProperty('--fit', fit);
  const full = lt.classList.contains('full');
  const box = lt.querySelector('.lt-box');
  const room = (stage.offsetHeight || 1080) - 160 - (stage.classList.contains('has-ticker') ? 64 : 0);
  const tooBig = () => full
    ? els.tag.offsetHeight + box.scrollHeight > room || box.scrollWidth > box.clientWidth + 1
    // The box clips what doesn't fit, so measure its content rather than its visible size.
    : els.tag.offsetHeight + box.scrollHeight > 460 || box.scrollWidth > box.clientWidth;
  // The smallest size is the same whatever the Text size setting is, so a large
  // setting can still shrink as far as a small one.
  const smallest = (full ? 12 : 18) / (40 * (Number(theme?.fontScale) || 1));
  const shrink = () => {
    for (fit = 1; ; fit -= 0.05) {
      lt.style.setProperty('--fit', fit);
      if (!tooBig() || fit <= smallest) return;
    }
  };
  shrink();
  // Still too much in a narrow box: use the wide box rather than lose any text.
  if (tooBig() && !full && !lt.classList.contains('wide')) {
    lt.classList.add('wide');
    shrink();
  }
  reportFit(tooBig(), parseFloat(getComputedStyle(lt).fontSize));
}

// The control panel's preview tells the operator when text is cut off or very small.
function reportFit(cut, px) {
  if (window.parent !== window) window.parent.postMessage({ fit: { cut, small: px < 24 } }, location.origin);
}

function show(item) {
  const key = JSON.stringify(item);
  if (key === current) return;
  const wasVisible = current !== null;
  current = item ? key : null;
  clearTimeout(swapTimer);

  if (!item) {
    lt.classList.remove('show');
    clearInterval(countdownTimer);
    return;
  }
  if (wasVisible) {
    // Fade out, swap content, fade back in.
    lt.classList.remove('show');
    swapTimer = setTimeout(() => { render(item); lt.classList.add('show'); }, 300);
  } else {
    render(item);
    requestAnimationFrame(() => requestAnimationFrame(() => lt.classList.add('show')));
  }
}

function onState(s) {
  if (JSON.stringify(s.theme) !== JSON.stringify(theme)) {
    theme = s.theme;
    applyTheme(theme);
    applyBackground(theme);
    if (current) { render(JSON.parse(current)); }
  }
  if (s.ticker) applyTicker(s.ticker);
  if (s.logo) applyLogo(s.logo);
  show(s.live);
}

// ---------- Full screen background picture or video ----------
let bgUrl = null;
function applyBackground(t) {
  const url = t.fullBg || '';
  if (url === bgUrl) return;
  bgUrl = url;
  document.getElementById('ltbg').innerHTML = !url ? ''
    : /\.(mp4|webm|mov)$/i.test(url) ? `<video src="${escapeHtml(url)}" autoplay loop muted playsinline></video>`
    : `<img src="${escapeHtml(url)}" alt="">`;
  lt.classList.toggle('has-bg', !!url);
}

// ---------- Ticker ----------
const ticker = document.getElementById('ticker');
let tickerKey = '';
function applyTicker(t) {
  const key = JSON.stringify(t);
  if (key === tickerKey) return;
  tickerKey = key;
  const on = !!(t.on && richPlain(t.text).trim());
  ticker.classList.toggle('show', on);
  stage.classList.toggle('has-ticker', on);
  if (current) autoFit();
  if (!on) return;
  document.getElementById('tkLabel').textContent = t.label || '';
  ticker.classList.toggle('no-label', !t.label);
  const text = document.getElementById('tkText');
  // Each line is one item. Short text is repeated until it fills the bar, then
  // doubled so the loop has no gap.
  const line = t.text.split(/\n+/).map(x => x.trim()).filter(x => richPlain(x).trim()).map(richHtml).join('<span class="tk-sep">•</span>')
    + '<span class="tk-sep">•</span>';
  text.innerHTML = `<span>${line}</span>`;
  requestAnimationFrame(() => {
    const one = text.firstElementChild.offsetWidth || 1;
    const fill = text.parentElement.offsetWidth;
    const unit = line.repeat(Math.max(1, Math.ceil(fill / one)));
    text.innerHTML = `<span>${unit}</span><span>${unit}</span>`;
    const w = text.firstElementChild.offsetWidth;
    text.style.setProperty('--tk-w', `${w}px`);
    text.style.animationDuration = `${w / (Number(t.speed) || 120)}s`;
  });
}

// ---------- Corner logo ----------
const logo = document.getElementById('logo');
let logoKey = '';
function applyLogo(l) {
  const key = JSON.stringify(l);
  if (key === logoKey) return;
  logoKey = key;
  logo.className = `logo corner-${l.corner || 'top-right'}`;
  logo.style.setProperty('--logo-size', `${(Number(l.size) || 10) * 19.2}px`);
  logo.style.opacity = l.on && (l.image || l.text) ? (l.opacity ?? 0.9) : 0;
  logo.innerHTML = l.image ? `<img src="${escapeHtml(l.image)}" alt="">` : `<span>${escapeHtml(l.text || '')}</span>`;
}

if (new URLSearchParams(location.search).has('preview')) {
  // Inside the control panel: it passes state in, so the preview doesn't use
  // up one of the browser's few connections to the server.
  window.addEventListener('message', e => {
    if (e.origin === location.origin && e.data?.theme) onState(e.data);
  });
} else {
  // EventSource reconnects by itself if the server restarts.
  new EventSource('/events').onmessage = e => onState(JSON.parse(e.data));
}
