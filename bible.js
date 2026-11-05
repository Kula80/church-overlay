// Offline Bibles: download whole translations once from the free Bible API
// (bible.helloao.org, texts from eBible.org), or import a file, then browse
// and look up references without internet.
const fs = require('fs');
const path = require('path');

const API = 'https://bible.helloao.org';

// Standard book codes with English names, so "John 3:16" works in any translation.
const BOOKS = [
  ['GEN', 'Genesis', 'gn'], ['EXO', 'Exodus', 'ex'], ['LEV', 'Leviticus', 'lv'], ['NUM', 'Numbers', 'nm'],
  ['DEU', 'Deuteronomy', 'dt'], ['JOS', 'Joshua', 'jsh'], ['JDG', 'Judges', 'jdgs jg'], ['RUT', 'Ruth', 'rth'],
  ['1SA', '1 Samuel', '1sm'], ['2SA', '2 Samuel', '2sm'], ['1KI', '1 Kings', '1kgs'], ['2KI', '2 Kings', '2kgs'],
  ['1CH', '1 Chronicles', '1chr'], ['2CH', '2 Chronicles', '2chr'], ['EZR', 'Ezra', ''], ['NEH', 'Nehemiah', ''],
  ['EST', 'Esther', ''], ['JOB', 'Job', 'jb'], ['PSA', 'Psalms', 'ps psalm pss'], ['PRO', 'Proverbs', 'prv'],
  ['ECC', 'Ecclesiastes', 'qoh'], ['SNG', 'Song of Solomon', 'song songofsongs sos canticles'], ['ISA', 'Isaiah', ''],
  ['JER', 'Jeremiah', ''], ['LAM', 'Lamentations', ''], ['EZK', 'Ezekiel', 'eze ezk'], ['DAN', 'Daniel', 'dn'],
  ['HOS', 'Hosea', ''], ['JOL', 'Joel', 'jl'], ['AMO', 'Amos', ''], ['OBA', 'Obadiah', 'ob'], ['JON', 'Jonah', 'jnh'],
  ['MIC', 'Micah', ''], ['NAM', 'Nahum', ''], ['HAB', 'Habakkuk', ''], ['ZEP', 'Zephaniah', ''], ['HAG', 'Haggai', ''],
  ['ZEC', 'Zechariah', ''], ['MAL', 'Malachi', ''],
  ['MAT', 'Matthew', 'mt matt'], ['MRK', 'Mark', 'mk mrk'], ['LUK', 'Luke', 'lk'], ['JHN', 'John', 'jn jhn'],
  ['ACT', 'Acts', ''], ['ROM', 'Romans', 'rm'], ['1CO', '1 Corinthians', ''], ['2CO', '2 Corinthians', ''],
  ['GAL', 'Galatians', ''], ['EPH', 'Ephesians', ''], ['PHP', 'Philippians', 'phil php'], ['COL', 'Colossians', ''],
  ['1TH', '1 Thessalonians', ''], ['2TH', '2 Thessalonians', ''], ['1TI', '1 Timothy', ''], ['2TI', '2 Timothy', ''],
  ['TIT', 'Titus', ''], ['PHM', 'Philemon', 'phm phlm'], ['HEB', 'Hebrews', ''], ['JAS', 'James', 'jas jm'],
  ['1PE', '1 Peter', '1pt'], ['2PE', '2 Peter', '2pt'], ['1JN', '1 John', '1jn 1jhn'], ['2JN', '2 John', '2jn'],
  ['3JN', '3 John', '3jn'], ['JUD', 'Jude', 'jud'], ['REV', 'Revelation', 'rv revelations apocalypse'],
];
const BOOK_INDEX = new Map(BOOKS.map(([id], i) => [id, i]));

// Friendlier on-screen labels for common translations (editable in the app).
const LABELS = {
  eng_kjv: 'KJV', ENGWEBP: 'WEB', BSB: 'BSB', eng_asv: 'ASV', eng_ylt: 'YLT', eng_bbe: 'BBE', eng_dby: 'Darby',
  twi_asa: 'Asante Twi', twi_aka: 'Akuapem Twi', ewe_bib: 'Ewe',
};

// Lower-case, number words to digits, letters and digits only ("I Cor." -> "1cor").
function norm(s) {
  return String(s).toLowerCase().trim()
    .replace(/^(first|1st|i)\s+/, '1').replace(/^(second|2nd|ii)\s+/, '2').replace(/^(third|3rd|iii)\s+/, '3')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function cleanText(t) {
  if (Array.isArray(t)) t = t.map(p => (typeof p === 'string' ? p : p.text || '')).join(' ');
  // ¶ is the KJV's paragraph mark: useful in print, confusing on a livestream.
  return String(t ?? '').replace(/¶/g, '').replace(/\s+/g, ' ').trim();
}

// helloao "complete" JSON -> our compact { id, name, chapters: [{ n, v: [[verse, text]] }] }
function fromHelloao(json) {
  return json.books.map(b => ({
    id: b.id,
    name: b.commonName || b.name,
    chapters: b.chapters.map(ch => ({
      n: ch.chapter.number,
      v: ch.chapter.content.filter(c => c.type === 'verse').map(v => [v.number, cleanText(v.content ?? v.text)]),
    })).filter(c => c.v.length),
  }));
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function englishBookId(name) {
  const n = norm(name);
  for (const [id, en, abbr] of BOOKS) {
    if ([id.toLowerCase(), norm(en), ...abbr.split(' ').filter(Boolean)].includes(n)) return id;
  }
  const prefix = BOOKS.find(([, en]) => n.length >= 2 && norm(en).startsWith(n));
  return prefix ? prefix[0] : null;
}

// CSV / TSV rows of Book, Chapter, Verse, Text -> compact books
function fromRows(text) {
  const books = [];
  const byKey = new Map();
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cols = raw.includes('\t') ? raw.split('\t') : splitCsvLine(raw);
    if (cols.length < 4) continue;
    const [bookName, c, v, ...rest] = cols.map(s => s.trim());
    if (!/^\d+$/.test(c) || !/^\d+$/.test(v)) continue; // header or junk
    let book = byKey.get(bookName);
    if (!book) {
      const id = englishBookId(bookName) || `X${books.length + 1}`;
      book = { id, name: bookName, chapters: [] };
      byKey.set(bookName, book);
      books.push(book);
    }
    const n = Number(c);
    let chapter = book.chapters.find(ch => ch.n === n);
    if (!chapter) { chapter = { n, v: [] }; book.chapters.push(chapter); }
    chapter.v.push([Number(v), cleanText(rest.join(','))]);
  }
  const order = b => BOOK_INDEX.get(b.id) ?? 999;
  books.sort((a, b) => order(a) - order(b));
  for (const b of books) {
    b.chapters.sort((x, y) => x.n - y.n);
    for (const ch of b.chapters) ch.v.sort((x, y) => x[0] - y[0]);
  }
  return books;
}

module.exports = function createBibles(dataDir) {
  const DIR = path.join(dataDir, 'bibles');
  const INDEX = path.join(DIR, 'index.json');
  const CATALOG = path.join(dataDir, 'bible-catalog.json');
  fs.mkdirSync(DIR, { recursive: true });

  let index = {};
  try { index = JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch {}
  const saveIndex = () => fs.writeFileSync(INDEX, JSON.stringify(index, null, 2));
  const loaded = new Map();

  function load(id) {
    if (!index[id]) throw new Error('That Bible is not installed.');
    if (!loaded.has(id)) loaded.set(id, JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8')));
    return loaded.get(id);
  }

  function save(meta, books) {
    if (!books.length) throw new Error('No verses found in that file.');
    fs.writeFileSync(path.join(DIR, `${meta.id}.json`), JSON.stringify(books));
    index[meta.id] = meta;
    saveIndex();
    loaded.set(meta.id, books);
    return meta;
  }

  async function catalog() {
    try {
      const stat = fs.statSync(CATALOG);
      if (Date.now() - stat.mtimeMs < 7 * 864e5) return JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
    } catch {}
    const unavailable = () => {
      // No internet: an old list is better than none.
      try { return JSON.parse(fs.readFileSync(CATALOG, 'utf8')); }
      catch { throw new Error('Could not load the list of Bibles. Check the internet connection.'); }
    };
    const r = await fetch(`${API}/api/available_translations.json`, { signal: AbortSignal.timeout(60000) }).catch(() => null);
    if (!r?.ok) return unavailable();
    const list = (await r.json()).translations.map(t => ({
      id: t.id,
      name: t.name,
      englishName: t.englishName,
      short: t.shortName,
      language: t.language,
      languageName: t.languageEnglishName || t.languageName || t.language,
      books: t.numberOfBooks,
      publicDomain: !!t.license?.publicDomain,
      attribution: t.license?.attribution === 'required',
      website: t.website,
      link: t.simpleCompleteTranslationApiLink || t.completeTranslationApiLink,
    }));
    fs.writeFileSync(CATALOG, JSON.stringify(list));
    return list;
  }

  async function download(id) {
    const entry = (await catalog()).find(t => t.id === id);
    if (!entry) throw new Error('Unknown translation.');
    const r = await fetch(`${API}${entry.link}`, { signal: AbortSignal.timeout(300000) }).catch(() => null);
    if (!r) throw new Error('Download failed. Check the internet connection.');
    if (!r.ok) throw new Error(`Download failed (${r.status}).`);
    const books = fromHelloao(await r.json());
    return save({
      id,
      label: LABELS[id] || entry.short || id,
      name: entry.englishName || entry.name,
      language: entry.languageName,
      credit: entry.publicDomain ? 'Public domain' : `Free to use; credit: ${entry.name}`,
      source: 'download',
    }, books);
  }

  function importFile({ label, filename = '', content }) {
    label = String(label || '').trim() || filename.replace(/\.[^.]+$/, '') || 'Imported Bible';
    content = String(content).replace(/^\ufeff/, ''); // Excel and Notepad can add this mark at the start
    let books;
    if (/^\s*[{[]/.test(content)) {
      const json = JSON.parse(content);
      if (json.books?.[0]?.chapters?.[0]?.chapter) books = fromHelloao(json);
      else if (json.books?.[0]?.chapters?.[0]?.v) books = json.books;
      else throw new Error('Unrecognised JSON Bible format.');
    } else {
      books = fromRows(content);
    }
    // Ids go in web addresses, so only plain letters and digits ("Gã Bible" -> "import_gabible").
    const id = `import_${norm(label).normalize('NFD').replace(/[^a-z0-9]/g, '') || Date.now()}`;
    return save({ id, label, name: label, language: '', credit: 'Imported file', source: 'import' }, books);
  }

  function remove(id) {
    delete index[id];
    saveIndex();
    loaded.delete(id);
    fs.rmSync(path.join(DIR, `${id}.json`), { force: true });
  }

  function rename(id, label) {
    if (!index[id]) throw new Error('That Bible is not installed.');
    index[id].label = String(label).trim() || index[id].label;
    saveIndex();
    return index[id];
  }

  function books(id) {
    return load(id).map(b => {
      const i = BOOK_INDEX.get(b.id);
      const en = i === undefined ? null : BOOKS[i];
      return {
        id: b.id, name: b.name, chapters: b.chapters.length, testament: i === undefined ? 'Other' : i < 39 ? 'OT' : 'NT',
        // English name and abbreviations, so search suggestions work with English names in any translation.
        en: en ? en[1] : '', abbr: en ? en[2] : '',
      };
    });
  }

  // Match "John", "Jn", "1 Cor", or the translation's own book name ("Yohane").
  function findBook(bible, name) {
    const n = norm(name);
    if (!n) return null;
    const keys = b => {
      const en = BOOKS[BOOK_INDEX.get(b.id)];
      return [b.id.toLowerCase(), norm(b.name), ...(en ? [norm(en[1]), ...en[2].split(' ').filter(Boolean)] : [])];
    };
    return bible.find(b => keys(b).includes(n))
      || (n.length >= 2 && bible.find(b => keys(b).some(k => k.startsWith(n))))
      || null;
  }

  function passage(id, book, c1, v1, c2, v2) {
    const label = index[id].label;
    const verses = [];
    for (const ch of book.chapters) {
      if (ch.n < c1 || ch.n > c2) continue;
      for (const [v, text] of ch.v) {
        if ((ch.n === c1 && v < v1) || (ch.n === c2 && v > v2)) continue;
        verses.push({ book: book.name, chapter: ch.n, verse: v, text: cleanText(text) });
      }
    }
    if (!verses.length) throw new Error('Those verses are not in this translation.');
    const first = verses[0];
    const last = verses[verses.length - 1];
    const whole = v1 === 1 && v2 === Infinity && c1 === c2;
    let reference = `${book.name} ${c1}`;
    if (!whole) {
      reference += `:${first.verse}`;
      if (verses.length > 1) reference += first.chapter === last.chapter ? `-${last.verse}` : `-${last.chapter}:${last.verse}`;
    }
    return { reference, translation: label, bookId: book.id, chapter: c1, whole, verses };
  }

  function chapter(id, bookId, c) {
    const book = load(id).find(b => b.id === bookId);
    if (!book) throw new Error('That book is not in this translation.');
    return passage(id, book, c, 1, c, Infinity);
  }

  // "John 3:16", "John 3:16-18", "John 3:16-4:2", "Psalm 23", "Yohane 3:16"
  function lookup(id, ref) {
    const bible = load(id);
    const m = ref.trim().match(/^(.+?)\s*(\d+)(?:\s*[:.]\s*(\d+)(?:\s*[-–]\s*(?:(\d+)\s*[:.]\s*)?(\d+))?)?$/);
    const book = findBook(bible, m ? m[1] : ref);
    if (!book) throw new Error(`Couldn't find the book in "${ref}". Try e.g. John 3:16 or 1 Cor 13:4-7.`);
    if (!m) return passage(id, book, 1, 1, 1, Infinity);
    const c1 = Number(m[2]);
    if (!m[3]) return passage(id, book, c1, 1, c1, Infinity);
    const v1 = Number(m[3]);
    const c2 = m[4] ? Number(m[4]) : c1;
    const v2 = m[5] ? Number(m[5]) : v1;
    return passage(id, book, c1, v1, c2, v2);
  }

  const list = () => Object.values(index).sort((a, b) => a.label.localeCompare(b.label));

  return { list, catalog, download, importFile, remove, rename, books, chapter, lookup };
};
