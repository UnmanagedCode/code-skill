import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function files() {
  const out = [];
  for (const dir of ['public', 'shared']) {
    for (const ent of await fs.readdir(path.join(REPO, dir), { withFileTypes: true, recursive: true })) {
      if (ent.isFile() && ent.name.endsWith('.js')) out.push(path.relative(REPO, path.join(ent.parentPath ?? ent.path, ent.name)));
    }
  }
  return out.sort();
}

// Comments stripped so prose can't trip (or hide) a rule.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

// [label, regex, file allowed to match (or null), a bad sample the rule must flag]
const RULES = [
  ['innerHTML', /\binnerHTML\b/, null, 'el.innerHTML = x'],
  ['outerHTML', /\bouterHTML\b/, null, 'el.outerHTML = x'],
  ['insertAdjacentHTML', /\binsertAdjacentHTML\b/, null, 'el.insertAdjacentHTML("x", y)'],
  ['document.write', /\bdocument\.write(ln)?\s*\(/, null, 'document.write(x)'],
  ['DOMParser', /\bDOMParser\b/, null, 'new DOMParser()'],
  ['createContextualFragment', /\bcreateContextualFragment\b/, null, 'r.createContextualFragment(x)'],
  ['srcdoc', /\bsrcdoc\b/, null, 'f.srcdoc = x'],
  ['eval', /\beval\s*\(/, null, 'eval(x)'],
  ['new Function', /\bnew\s+Function\b/, null, 'new Function(x)'],
  ['setAttribute', /\bsetAttribute(NS)?\s*\(/, null, 'el.setAttribute("href", x)'],
  ['style', /\.style\b|\bstyle\s*=|\bstyle\s*:/, null, 'el.style.color = x'],
  ['location assignment', /\blocation(\.href)?\s*=[^=]/, null, 'location.href = x'],
  ['fetch outside api.js', /\bfetch\s*\(/, 'public/api.js', 'fetch("api/x")'],
  ['root-relative fetch', /\bfetch\s*\(\s*[`'"]\//, null, "fetch('/api/x')"],
  ['href assignment outside markdown.js', /\.href\s*=[^=]|\bhref\s*:/, 'public/markdown.js', 'a.href = x'],
];

// Invariant: the UI never parses strings as HTML, styles inline, or fetches outside api.js.
test('no banned DOM/XSS sinks in public/ and shared/', async () => {
  const list = await files();
  assert.ok(list.includes('public/app.js') && list.includes('shared/cost.js'));
  const hits = [];
  for (const f of list) {
    const src = stripComments(await fs.readFile(path.join(REPO, f), 'utf8'));
    for (const [label, re, allowed] of RULES) if (f !== allowed && re.test(src)) hits.push(`${f}: ${label}`);
  }
  assert.deepEqual(hits, []);
});

// Invariant: each rule stays live — it still flags its bad sample.
test('every rule flags its bad sample', () => {
  for (const [label, re, , bad] of RULES) assert.match(bad, re, label);
});
