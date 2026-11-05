// Word-style text: bold, italic, underline, capitals, colour and size.
// Text is stored as plain lines with markers around the styled words, e.g. ⟦b⟧Faith⟦/b⟧ pleases God,
// so a sermon's points and sub-points are still just lines, and text with no markers needs no changes.
(function (root) {
  const COLORS = { gold: '#d4a017', red: '#ff6b6b', blue: '#6cb6ff', green: '#5ee08a' };
  const SIZES = { big: '5', small: '2' };
  // Capitals are shown, not typed in, so the original spelling comes back when they're turned off.
  const CASE_FONTS = { caps: 'RichCaps', title: 'RichTitle', lower: 'RichLower' };
  const TOKEN = /⟦(\/?)(b|i|u|c:\w+|s:\w+|t:\w+)⟧/g;
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isTag = name => !name.includes(':');

  function render(str, open, close) {
    let out = '', last = 0;
    const stack = [];
    for (const m of String(str ?? '').matchAll(TOKEN)) {
      out += esc(m.input.slice(last, m.index));
      last = m.index + m[0].length;
      const name = m[2];
      if (!m[1]) {
        stack.push(name);
        out += open(name);
      } else if (stack.includes(name)) {
        for (let n = stack.pop(); ; n = stack.pop()) {
          out += close(n);
          if (n === name) break;
        }
      }
    }
    out += esc(String(str ?? '').slice(last));
    while (stack.length) out += close(stack.pop());
    return out;
  }

  // For the screen and the point list.
  const richHtml = str => render(str,
    n => (isTag(n) ? `<${n}>` : `<span class="rt-${n.split(':')[1]}">`),
    n => (isTag(n) ? `</${n}>` : '</span>'));

  // For places that can't show styling, like the top bar and the label above the box.
  const richPlain = str => String(str ?? '').replace(TOKEN, '');

  // Same styling in the form the browser's editing commands use, so they can undo it.
  const editHtml = str => render(str,
    n => {
      if (isTag(n)) return `<${n}>`;
      const [type, val] = n.split(':');
      if (type === 't') return `<font face="${CASE_FONTS[val] || ''}">`;
      return type === 'c' ? `<font color="${COLORS[val] || ''}">` : `<font size="${SIZES[val] || 3}">`;
    },
    n => (isTag(n) ? `</${n}>` : '</font>'));

  function colorName(value) {
    let hex = (value || '').trim().toLowerCase();
    const rgb = hex.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgb) hex = `#${rgb.slice(1, 4).map(v => Number(v).toString(16).padStart(2, '0')).join('')}`;
    return Object.keys(COLORS).find(k => COLORS[k] === hex);
  }

  // The markers an element stands for, outermost first.
  function tokensFor(el) {
    const tag = el.tagName;
    const names = [];
    if (tag === 'B' || tag === 'STRONG') names.push('b');
    if (tag === 'I' || tag === 'EM') names.push('i');
    if (tag === 'U') names.push('u');
    const st = el.style;
    if (st) {
      if (Number(st.fontWeight) >= 600 || st.fontWeight === 'bold') names.push('b');
      if (st.fontStyle === 'italic') names.push('i');
      if (st.textDecorationLine?.includes('underline') || st.textDecoration?.includes('underline')) names.push('u');
    }
    const color = colorName(tag === 'FONT' ? el.getAttribute('color') : st?.color);
    if (color) names.push(`c:${color}`);
    if (tag === 'FONT') {
      const size = Object.keys(SIZES).find(k => SIZES[k] === el.getAttribute('size'));
      if (size) names.push(`s:${size}`);
      const textCase = Object.keys(CASE_FONTS).find(k => CASE_FONTS[k] === el.getAttribute('face'));
      if (textCase) names.push(`t:${textCase}`);
    }
    return [...new Set(names)];
  }

  function serialize(box) {
    const lines = [];
    let cur = '';
    const flush = () => { lines.push(cur); cur = ''; };
    const walk = node => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          cur += child.data.replace(/\u00a0/g, ' ').replace(/\n/g, ' ');
        } else if (child.nodeType === 1) {
          if (child.tagName === 'BR') {
            // The browser ends a line with a spare <br>; only a <br> with text after it is a line break.
            if (child.nextSibling) flush();
          } else if (/^(DIV|P|LI|UL|OL|H[1-6])$/.test(child.tagName)) {
            if (cur) flush();
            const before = lines.length;
            walk(child);
            if (cur || lines.length === before) flush();
          } else {
            const names = tokensFor(child);
            names.forEach(n => { cur += `⟦${n}⟧`; });
            walk(child);
            names.slice().reverse().forEach(n => { cur += `⟦/${n}⟧`; });
          }
        }
      }
    };
    walk(box);
    if (cur) flush();
    return lines.join('\n').replace(/⟦(b|i|u|c:\w+|s:\w+|t:\w+)⟧⟦\/\1⟧/g, '');
  }

  // A Word-style box that keeps a hidden textarea up to date, so the code using the textarea needn't change.
  function createRichEditor({ source, box, toolbar }) {
    box.dataset.placeholder = source.placeholder || '';
    const inBox = () => {
      const sel = getSelection();
      return sel.rangeCount && box.contains(sel.anchorNode) && box.contains(sel.focusNode);
    };
    const updateEmpty = () => box.classList.toggle('is-empty', !box.textContent);
    const load = () => {
      box.innerHTML = (source.value || '').split('\n').map(l => `<div>${editHtml(l) || '<br>'}</div>`).join('');
      updateEmpty();
    };
    const changed = () => {
      updateEmpty();
      const text = serialize(box);
      if (text === source.value) return;
      source.value = text;
      source.dispatchEvent(new Event('input', { bubbles: true }));
    };
    // The browser's own answer depends on the box's font size, so read the styling itself.
    // The element holding the first selected letter. Ctrl+A selects the box itself, not any text in it.
    const elementAtCursor = () => {
      const sel = getSelection();
      if (!sel.rangeCount) return null;
      const range = sel.getRangeAt(0);
      let node = sel.anchorNode;
      if (!range.collapsed) {
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          const nothingPicked = (t === range.startContainer && range.startOffset === t.length)
            || (t === range.endContainer && range.endOffset === 0);
          if (t.length && !nothingPicked && range.intersectsNode(t)) { node = t; break; }
        }
      }
      return node?.nodeType === 3 ? node.parentElement : node;
    };
    const sizeAtCursor = () => elementAtCursor()?.closest?.('font[size]')?.getAttribute('size') || '3';
    const caseAtCursor = () => {
      const face = elementAtCursor()?.closest?.('font[face]')?.getAttribute('face');
      return Object.keys(CASE_FONTS).find(k => CASE_FONTS[k] === face);
    };
    const markToolbar = () => {
      if (!inBox()) return;
      const q = c => { try { return document.queryCommandValue(c); } catch { return ''; } };
      const color = colorName(q('foreColor'));
      const size = sizeAtCursor();
      toolbar.querySelectorAll('button').forEach(b => {
        const { cmd, color: c, size: s, case: k } = b.dataset;
        if (k) b.classList.toggle('on', k === caseAtCursor());
        if (['bold', 'italic', 'underline'].includes(cmd)) b.classList.toggle('on', document.queryCommandState(cmd));
        if (c) b.classList.toggle('on', c === 'default' ? !color : c === color);
        if (s) b.classList.toggle('on', s === size);
      });
    };
    const firstText = line => (line.nodeType === 3 ? line : document.createTreeWalker(line, NodeFilter.SHOW_TEXT).nextNode());
    const subMark = line => firstText(line)?.data.match(/^\s*[-*•]\s*/);
    // The lines a selection really covers: selecting a whole line can end at the very start of the next one.
    const selectedLines = range => [...box.childNodes].filter(line => {
      if (!range.intersectsNode(line)) return false;
      if (range.collapsed) return true;
      const upToEnd = document.createRange();
      upToEnd.selectNodeContents(line);
      upToEnd.setEnd(range.endContainer, range.endOffset);
      return !!upToEnd.toString() || !line.textContent;
    });
    // "- " at the start of a line makes it a sub-point. Like Word's bullets, the button makes all the
    // selected lines the same, so a mix of points and sub-points never swaps round.
    const toggleSub = () => {
      const sel = getSelection();
      const picked = selectedLines(sel.getRangeAt(0));
      const firstLine = [...box.childNodes].find(line => line.textContent.trim());
      // A sub-point belongs to the point above it, so the first line of the notes stays a point.
      const lines = picked.filter(line => line !== firstLine && (picked.length === 1 || line.textContent.trim()));
      const remove = lines.length && lines.every(subMark);
      for (const line of lines) {
        const text = firstText(line);
        const has = subMark(line);
        // Through the browser's editing commands, so Ctrl+Z can undo it.
        if (remove) {
          sel.setBaseAndExtent(text, 0, text, has[0].length);
          document.execCommand('delete');
        } else if (!has) {
          sel.collapse(text || line, 0);
          document.execCommand('insertText', false, '- ');
        }
      }
      if (picked.length) {
        const range = document.createRange();
        range.setStart(picked[0], 0);
        const last = picked[picked.length - 1];
        range.setEnd(last, last.nodeType === 3 ? last.length : last.childNodes.length);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    };

    // The browser can only raise a word's first letter, so Aa has to make the rest of "HAVE" small in the text itself.
    const lowerRestOfWords = () => {
      const sel = getSelection();
      const range = sel.getRangeAt(0);
      if (range.collapsed) return;
      const offsetOf = (node, offset) => {
        const before = document.createRange();
        before.selectNodeContents(box);
        before.setEnd(node, offset);
        return before.toString().length;
      };
      const start = offsetOf(range.startContainer, range.startOffset);
      const end = offsetOf(range.endContainer, range.endOffset);
      const textNodes = () => {
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        return nodes;
      };
      // Find a place by its count of letters, because each edit can replace the browser's text pieces.
      const pointAt = (n, isEnd) => {
        let left = 0;
        for (const t of textNodes()) {
          if (n < left + t.length || (isEnd && n === left + t.length)) return [t, n - left];
          left += t.length;
        }
        return [box, box.childNodes.length];
      };
      const parts = textNodes().filter(t => range.intersectsNode(t)).map(t => {
        const from = t === range.startContainer ? range.startOffset : 0;
        const to = t === range.endContainer ? range.endOffset : t.length;
        const was = t.data.slice(from, to);
        const now = t.data.slice(0, to).replace(/(?<=\p{L}['’]?)\p{Lu}/gu, (c, i) => (i >= from ? c.toLowerCase() : c)).slice(from);
        // Replace only from the first changed letter to the last. That always starts inside a word, so the
        // new letters keep this piece's own styling and don't pick up the styling of the piece before it.
        let head = 0;
        while (head < was.length && was[head] === now[head]) head++;
        let tail = 0;
        while (tail < was.length - head && tail < now.length - head && was[was.length - 1 - tail] === now[now.length - 1 - tail]) tail++;
        return { at: offsetOf(t, from) + head, length: was.length - head - tail, now: now.slice(head, now.length - tail) };
      }).filter(p => p.length);
      for (const { at, length, now } of parts) {
        sel.setBaseAndExtent(...pointAt(at), ...pointAt(at + length, true));
        document.execCommand('insertText', false, now);
      }
      sel.setBaseAndExtent(...pointAt(start), ...pointAt(end, true));
    };

    box.addEventListener('input', changed);
    box.addEventListener('paste', e => {
      // Paste as plain text: styling from Word or a website can't be shown on screen.
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
    document.addEventListener('selectionchange', markToolbar);
    // Keep the selection in the text when a toolbar button is pressed.
    toolbar.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
    toolbar.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (!inBox()) box.focus();
      const { cmd, color, size, sub, case: textCase } = btn.dataset;
      document.execCommand('styleWithCSS', false, false);
      if (cmd) document.execCommand(cmd);
      if (color) document.execCommand('foreColor', false, COLORS[color] || getComputedStyle(box).color);
      if (size) document.execCommand('fontSize', false, sizeAtCursor() === size ? '3' : size);
      if (sub !== undefined) toggleSub();
      if (textCase === 'title' && caseAtCursor() !== 'title') lowerRestOfWords();
      if (textCase) document.execCommand('fontName', false, caseAtCursor() === textCase ? getComputedStyle(box).fontFamily : CASE_FONTS[textCase]);
      changed();
      markToolbar();
    });
    document.execCommand('defaultParagraphSeparator', false, 'div');
    return { load };
  }

  root.richHtml = richHtml;
  root.richPlain = richPlain;
  root.createRichEditor = createRichEditor;
})(window);
