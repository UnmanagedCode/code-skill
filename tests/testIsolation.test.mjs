import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);

async function sources(dir) {
  const out = [];
  for (const ent of await fs.readdir(path.join(REPO, dir), { withFileTypes: true, recursive: true })) {
    if (ent.isFile() && /\.m?js$/.test(ent.name)) out.push(path.join(ent.parentPath ?? ent.path, ent.name));
  }
  return out.filter((f) => f !== SELF);
}

const BANNED = [
  ['os.homedir(', /\bos\.homedir\(/],
  ['process.env.HOME', /process\.env\.HOME\b/],
  ['import of server.js', /(?:\bfrom\s+|\bimport\s*\(?\s*)['"][^'"]*server\.js['"]/],
  ['loadConfig(process.env', /loadConfig\(\s*process\.env/],
];

// Invariant: tests and the harness can't reach the real ~/.claude or boot with the real PROJECTS_ROOT.
test('tests and harness never read the real home or import server.js', async () => {
  const files = [...await sources('tests'), ...await sources('harness')];
  assert.ok(files.length > 5);
  const hits = [];
  for (const f of files) {
    const text = await fs.readFile(f, 'utf8');
    for (const [label, re] of BANNED) if (re.test(text)) hits.push(`${path.relative(REPO, f)}: ${label}`);
  }
  assert.deepEqual(hits, []);
});

// Invariant: the scan stays live — each banned pattern still flags a sample.
test('each isolation pattern flags its sample', () => {
  const samples = [['x = os.homedir()'], ['process.env.HOME'], ["import '../server.js'", "import x from './server.js'", "await import('../server.js')"], ['loadConfig(process.env)']];
  BANNED.forEach(([, re], i) => samples[i].forEach((s) => assert.match(s, re)));
});
