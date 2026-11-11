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

const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\s](?:[^*]*[^*\s])?)\*|_([^_\s](?:[^_]*[^_\s])?)_|\[([^\]\n]+)\]\(([^)\s]+)\)/;

export function parseInline(s) {
  const out = [];
  let rest = s;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) { out.push(text(rest)); break; }
    if (m.index) out.push(text(rest.slice(0, m.index)));
    if (m[1]) out.push(el('code', [text(m[2].replace(/^ (.*) $/, '$1'))]));
    else if (m[3] !== undefined || m[4] !== undefined) out.push(el('strong', parseInline(m[3] ?? m[4])));
    else if (m[5] !== undefined || m[6] !== undefined) out.push(el('em', parseInline(m[5] ?? m[6])));
    else {
      const href = safeHref(m[8]);
      out.push(href ? el('a', parseInline(m[7]), { href, rel: 'noopener noreferrer', target: '_blank' }) : text(m[0]));
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const ITEM = /^\s{0,3}([-*+]|\d{1,9}[.)])\s+(.*)$/;

export function parseMarkdown(src) {
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
      blocks.push(el(`h${heading[1].length}`, parseInline(heading[2])));
      i++;
      continue;
    }
    if (HR.test(line)) { blocks.push(el('hr')); i++; continue; }
    if (QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && QUOTE.test(lines[i])) inner.push(lines[i++].replace(QUOTE, ''));
      blocks.push(el('blockquote', parseMarkdown(inner.join('\n'))));
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
