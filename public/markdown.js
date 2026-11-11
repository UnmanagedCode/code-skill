// A small allowlist markdown renderer for SKILL.md previews. Raw HTML is never
// interpreted: it stays literal text. parseMarkdown builds an AST of allowed
// tags only; renderMarkdown turns it into nodes with createElement/createTextNode.

export const ALLOWED_TAGS = Object.freeze(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'pre', 'code', 'em', 'strong', 'a', 'blockquote', 'hr', 'br']);
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:'];

const el = (tag, children = [], attrs = {}) => ({ type: 'el', tag, attrs, children });
const text = (value) => ({ type: 'text', value });

// An absolute http(s)/mailto URL, normalised; anything else → null.
export function safeHref(url) {
  try {
    const u = new URL(String(url).trim());
    return SAFE_SCHEMES.includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

// Nesting beyond this renders as text, keeping recursion (and the stack) bounded.
const MAX_DEPTH = 16;

// Inline syntax by forward scanning: each closing delimiter is found with
// indexOf, and a search that failed is remembered, so the parse stays linear
// on pathological input (long backtick runs, thousands of unclosed "[x](").
export function parseInline(s, depth = 0) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push(text(buf)); buf = ''; } };
  const failed = new Set();            // delimiters with no closer after the current position
  const find = (needle, from) => {
    if (failed.has(needle)) return -1;
    const at = s.indexOf(needle, from);
    if (at === -1) failed.add(needle);
    return at;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      const run = '`'.repeat(n);
      let close = find(run, i + n);
      // The closer must be a run of exactly n backticks.
      while (close !== -1 && s[close + n] === '`') {
        let end = close + n;
        while (s[end] === '`') end++;
        close = s.indexOf(run, end);
      }
      if (close === -1) { failed.add(run); buf += run; i += n; continue; }
      flush();
      out.push(el('code', [text(s.slice(i + n, close).replace(/^ (.*) $/s, '$1'))]));
      i = close + n;
      continue;
    }
    if ((c === '*' || c === '_') && depth < MAX_DEPTH) {
      const strong = s[i + 1] === c;
      const delim = strong ? c + c : c;
      const startAt = i + delim.length;
      const close = s[startAt] && !/\s/.test(s[startAt]) ? find(delim, startAt + 1) : -1;
      const inner = close === -1 ? '' : s.slice(startAt, close);
      if (inner && !/\s$/.test(inner)) {
        flush();
        out.push(el(strong ? 'strong' : 'em', parseInline(inner, depth + 1)));
        i = close + delim.length;
        continue;
      }
      buf += delim;
      i += delim.length;
      continue;
    }
    if (c === '[' && depth < MAX_DEPTH) {
      const closeText = find(']', i + 1);
      if (closeText !== -1 && s[closeText + 1] === '(') {
        const label = s.slice(i + 1, closeText);
        const closeUrl = find(')', closeText + 2);
        const url = closeUrl === -1 ? '' : s.slice(closeText + 2, closeUrl);
        if (label && !label.includes('\n') && url && !/\s/.test(url)) {
          const href = safeHref(url);
          flush();
          if (href) out.push(el('a', parseInline(label, depth + 1), { href, rel: 'noopener noreferrer', target: '_blank' }));
          else out.push(text(s.slice(i, closeUrl + 1)));
          i = closeUrl + 1;
          continue;
        }
      }
      buf += c;
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const ITEM = /^\s{0,3}([-*+]|\d{1,9}[.)])\s+(.*)$/;

// "Title ##" → "Title", by scanning from the end (no backtracking regex).
function stripClosingHashes(t) {
  let end = t.length;
  while (end > 0 && /\s/.test(t[end - 1])) end--;
  let h = end;
  while (h > 0 && t[h - 1] === '#') h--;
  if (h < end && (h === 0 || /\s/.test(t[h - 1]))) end = h;
  while (end > 0 && /\s/.test(t[end - 1])) end--;
  return t.slice(0, end);
}

export function parseMarkdown(src, depth = 0) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = FENCE.exec(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      blocks.push(el('pre', [el('code', [text(body.join('\n'))])]));
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push(el(`h${heading[1].length}`, parseInline(stripClosingHashes(heading[2] ?? ''))));
      i++;
      continue;
    }
    if (HR.test(line)) { blocks.push(el('hr')); i++; continue; }
    if (QUOTE.test(line) && depth < MAX_DEPTH) {
      const inner = [];
      while (i < lines.length && QUOTE.test(lines[i])) inner.push(lines[i++].replace(QUOTE, ''));
      blocks.push(el('blockquote', parseMarkdown(inner.join('\n'), depth + 1)));
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      const ordered = /\d/.test(item[1]);
      const items = [];
      while (i < lines.length) {
        const it = ITEM.exec(lines[i]);
        if (it && /\d/.test(it[1]) === ordered) { items.push([it[2]]); i++; continue; }
        if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) { items[items.length - 1].push(lines[i].trim()); i++; continue; }
        break;
      }
      blocks.push(el(ordered ? 'ol' : 'ul', items.map((parts) => el('li', parseInline(parts.join(' '))))));
      continue;
    }
    const para = [];
    // The first line always joins, so a block the checks above declined (e.g. too-deep quotes) still advances.
    para.push(lines[i++].trim());
    while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !HR.test(lines[i]) && !QUOTE.test(lines[i]) && !ITEM.test(lines[i])) {
      para.push(lines[i++].trim());
    }
    blocks.push(el('p', parseInline(para.join(' '))));
  }
  return blocks;
}

// AST → a <div class="markdown"> built only with doc.createElement / doc.createTextNode.
export function renderMarkdown(ast, doc) {
  const build = (node) => {
    if (node.type === 'text') return doc.createTextNode(node.value);
    if (!ALLOWED_TAGS.includes(node.tag)) return doc.createTextNode('');
    const e = doc.createElement(node.tag);
    if (node.tag === 'a') {
      const href = safeHref(node.attrs.href);
      if (href) {
        e.href = href;
        e.rel = 'noopener noreferrer';
        e.target = '_blank';
      }
    }
    for (const c of node.children) e.appendChild(build(c));
    return e;
  };
  const root = doc.createElement('div');
  root.className = 'markdown';
  for (const b of ast) root.appendChild(build(b));
  return root;
}
