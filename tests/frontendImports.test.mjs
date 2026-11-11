import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot } from './helpers.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Embedded in cc, the page is served under this prefix (cc's proxy strips it before the backend).
const BASE = 'http://h/plugins/code-skill/';

// The URL path a frontend file is served at: public/<f> → /<f>, shared/<f> → /shared/<f>.
const servedPath = (rel) => (rel.startsWith('public/') ? rel.slice('public/'.length) : rel);

async function moduleFiles() {
  const out = [];
  for (const dir of ['public', 'shared']) {
    for (const ent of await fs.readdir(path.join(REPO, dir), { withFileTypes: true, recursive: true })) {
      if (ent.isFile() && ent.name.endsWith('.js')) out.push(path.relative(REPO, path.join(ent.parentPath ?? ent.path, ent.name)));
    }
  }
  return out.sort();
}

export function specifiers(src) {
  const out = [];
  for (const re of [/\b(?:import|export)\s+(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g]) {
    for (const m of src.matchAll(re)) out.push(m[1]);
  }
  return out;
}

// → the absolute embedded URL a specifier in `fromRel` loads, or an error string.
function resolveEmbedded(fromRel, spec) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return `bare or absolute specifier "${spec}"`;
  const url = new URL(spec, new URL(servedPath(fromRel), BASE)).href;
  return url.startsWith(BASE) ? url : `"${spec}" in ${fromRel} resolves outside the plugin prefix: ${url}`;
}

// Invariant: under cc's /plugins/code-skill/ prefix every module the page loads stays inside the prefix and is served.
test('every import in public/ and shared/ resolves inside the embedded prefix to a served file', async (t) => {
  const app = await boot(t);
  const targets = new Set();
  const problems = [];
  for (const rel of await moduleFiles()) {
    for (const spec of specifiers(await fs.readFile(path.join(REPO, rel), 'utf8'))) {
      const r = resolveEmbedded(rel, spec);
      if (r.startsWith(BASE)) targets.add(r); else problems.push(r);
    }
  }
  // index.html's own relative assets (the two host URLs are cc's, not ours).
  const html = await fs.readFile(path.join(REPO, 'public/index.html'), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^\/plugin(Bridge\.js|Theme\.css)$/.test(m[1])) continue;
    const r = resolveEmbedded('public/index.html', m[1].startsWith('.') ? m[1] : `./${m[1]}`);
    if (m[1].startsWith('/')) problems.push(`root-relative URL ${m[1]} in index.html`);
    else if (r.startsWith(BASE)) targets.add(r); else problems.push(r);
  }
  assert.deepEqual(problems, []);
  assert.ok(targets.size > 10);
  for (const url of targets) {
    const res = await fetch(`${app.url}/${url.slice(BASE.length)}`);
    assert.equal(res.status, 200, url);
  }
});

// Invariant: the check stays live — it flags the specifier shape that broke the embedded page.
test('a ../../ import from views/ is flagged as leaving the prefix', () => {
  assert.match(resolveEmbedded('public/views/editor.js', '../../shared/cost.js'), /outside the plugin prefix/);
  assert.ok(resolveEmbedded('public/views/editor.js', '../shared/cost.js').startsWith(BASE));
  assert.deepEqual(specifiers("import { a } from './x.js';\nimport './y.js';\nexport { b } from '../z.js';\nawait import('./w.js');"), ['./x.js', './y.js', '../z.js', './w.js']);
});
