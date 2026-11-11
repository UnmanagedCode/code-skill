import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, renderMarkdown, safeHref, ALLOWED_TAGS } from '../public/markdown.js';
import { fakeDoc, walk } from './fixtures/fakeDoc.mjs';

const HOSTILE = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '[x](javascript:alert(1))',
  '[x](data:text/html,<script>alert(1)</script>)',
  '[x]( JAVASCRIPT:alert(1))',
  '<a href="javascript:alert(1)">raw</a>',
  '**bold *nested* bold** _em_ `<b>code</b>`',
  '> <iframe src=x></iframe>\n> quote',
  '- <svg onload=alert(1)>\n- [ok](https://example.com/a)',
  '```\n<script>alert(1)</script>\n```',
  '# <h1>heading</h1>',
].join('\n\n');

const astNodes = (nodes, out = []) => {
  for (const n of nodes) {
    out.push(n);
    if (n.children) astNodes(n.children, out);
  }
  return out;
};

// Invariant: only allowlisted tags and attributes, only http(s)/mailto links; raw HTML stays text.
test('hostile input → AST of allowed tags, safe hrefs, raw HTML only as text', () => {
  const nodes = astNodes(parseMarkdown(HOSTILE));
  for (const n of nodes) {
    if (n.type === 'text') continue;
    assert.ok(ALLOWED_TAGS.includes(n.tag), n.tag);
    for (const k of Object.keys(n.attrs)) assert.ok(['href', 'rel', 'target'].includes(k), k);
    if (n.tag === 'a') assert.match(n.attrs.href, /^(https?|mailto):/);
  }
  const links = nodes.filter((n) => n.tag === 'a');
  assert.deepEqual(links.map((l) => l.attrs.href), ['https://example.com/a']);
  const texts = nodes.filter((n) => n.type === 'text').map((n) => n.value).join('');
  for (const raw of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '[x](javascript:alert(1))', '<a href="javascript:alert(1)">raw</a>']) assert.ok(texts.includes(raw), raw);
});

test('safeHref keeps http, https and mailto only', () => {
  assert.equal(safeHref('https://a.b/c'), 'https://a.b/c');
  assert.equal(safeHref('mailto:x@y.z'), 'mailto:x@y.z');
  for (const bad of ['javascript:alert(1)', ' JavaScript:x', 'data:text/html,x', 'vbscript:x', '/relative', 'file:///etc/passwd']) assert.equal(safeHref(bad), null, bad);
});

test('the supported syntax maps to the expected tags', () => {
  const tags = (src) => parseMarkdown(src).map((n) => n.tag);
  assert.deepEqual(tags('# a\n\npara\n\n- x\n- y\n\n1. one\n\n> q\n\n---\n\n```\ncode\n```'), ['h1', 'p', 'ul', 'ol', 'blockquote', 'hr', 'pre']);
  const p = parseMarkdown('a **b** *c* `d` [e](https://e.x)')[0];
  assert.deepEqual(p.children.filter((n) => n.type === 'el').map((n) => n.tag), ['strong', 'em', 'code', 'a']);
});

// Invariant: rendering uses only createElement/createTextNode — never an HTML parser.
test('renderMarkdown builds nodes with createElement/createTextNode only', () => {
  const { doc, calls } = fakeDoc();
  const root = renderMarkdown(parseMarkdown(HOSTILE), doc);
  assert.deepEqual([...new Set(calls)].sort(), ['createElement', 'createTextNode']);
  const els = walk(root).filter((n) => n.nodeType === 1);
  for (const e of els.slice(1)) assert.ok(ALLOWED_TAGS.includes(e.tagName.toLowerCase()), e.tagName);
  const a = els.find((e) => e.tagName === 'A');
  assert.deepEqual([a.href, a.rel, a.target], ['https://example.com/a', 'noopener noreferrer', '_blank']);
});

test('a forged AST node with a disallowed tag or href renders inert', () => {
  const { doc } = fakeDoc();
  const root = renderMarkdown([
    { type: 'el', tag: 'script', attrs: {}, children: [{ type: 'text', value: 'x' }] },
    { type: 'el', tag: 'a', attrs: { href: 'javascript:alert(1)' }, children: [{ type: 'text', value: 'y' }] },
  ], doc);
  const els = walk(root).filter((n) => n.nodeType === 1);
  assert.deepEqual(els.map((e) => e.tagName), ['DIV', 'A']);
  assert.equal(els[1].href, undefined);
});

// Generous bound: linear parsing takes milliseconds here; the old regex took seconds on the smaller inputs.
const BOUND_MS = 1500;
const PATHOLOGICAL = {
  '8,000 backticks': '`'.repeat(8000),
  '100k "[x]("': '[x]('.repeat(100_000),
  '100k "["': '['.repeat(100_000),
  '100k "*"': '*'.repeat(100_000),
  '50k "_a"': '_a'.repeat(50_000),
  '50k "**a"': '**a'.repeat(50_000),
  'mixed runs': '` `` ``` [a](b *c _d **e '.repeat(20_000),
  'heading of spaces': `# ${' '.repeat(200_000)}x`,
  '50k nested quotes': '>'.repeat(50_000),
};

// Invariant: the preview can't freeze the page — parsing is near-linear on hostile input.
for (const [label, input] of Object.entries(PATHOLOGICAL)) {
  test(`pathological input parses fast: ${label}`, () => {
    const t0 = performance.now();
    const ast = parseMarkdown(input);
    const ms = performance.now() - t0;
    assert.ok(ms < BOUND_MS, `${label}: ${Math.round(ms)} ms`);
    assert.ok(Array.isArray(ast));
  });
}

test('1 MB of realistic prose parses fast and keeps its structure', () => {
  const para = 'Use **this skill** when the user asks about `config files`, *YAML* front matter or [the docs](https://example.com/docs). Keep answers short_and_clear.';
  const unit = `## Section\n\n${para}\n\n- item one with \`code\`\n- item [two](https://example.com)\n\n> a quote\n\n\`\`\`\nconst x = 1;\n\`\`\`\n\n`;
  const input = unit.repeat(Math.ceil(1_000_000 / unit.length));
  const t0 = performance.now();
  const ast = parseMarkdown(input);
  assert.ok(performance.now() - t0 < BOUND_MS * 2);
  assert.equal(ast.filter((n) => n.tag === 'h2').length, Math.ceil(1_000_000 / unit.length));
  assert.ok(ast.some((n) => n.tag === 'p' && n.children.some((c) => c.tag === 'a')));
});

test('inline basics still parse after the linear rewrite', () => {
  const tags = (s) => parseMarkdown(s)[0].children.map((n) => (n.type === 'el' ? n.tag : `"${n.value}"`));
  assert.deepEqual(tags('a `b` c'), ['"a "', 'code', '" c"']);
  assert.deepEqual(tags('``a ` b``'), ['code']);
  assert.equal(parseMarkdown('``a ` b``')[0].children[0].children[0].value, 'a ` b');
  assert.deepEqual(tags('**s** *e* __u__ _v_'), ['strong', '" "', 'em', '" "', 'strong', '" "', 'em']);
  assert.deepEqual(tags('unclosed `tick and * star'), ['"unclosed `tick and * star"']);
  assert.deepEqual(parseMarkdown('# Title ##')[0].children, [{ type: 'text', value: 'Title' }]);
  assert.deepEqual(parseMarkdown('# C#')[0].children, [{ type: 'text', value: 'C#' }]);
});
