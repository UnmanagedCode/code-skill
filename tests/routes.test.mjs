import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.mjs';
import { skillMd } from './fixtures/roots.mjs';
import { skillCall, lines } from './fixtures/transcripts.mjs';

const FILES = {
  'home/.claude/skills/alpha/SKILL.md': skillMd('alpha', 'Alpha skill'),
  'home/.claude/skills/alpha/scripts/a.sh': 'echo',
  'home/.claude/projects/-w/s.jsonl': lines(skillCall({ id: 'x1', skill: 'alpha' })),
};

// Invariant: every route answers the shapes documented in docs/protocol.md.
test('GET health, inventory, usage, trash', async (t) => {
  const app = await boot(t, { files: FILES });
  assert.deepEqual((await app.json('GET', '/api/health')).body, { ok: true });
  const inv = (await app.json('GET', '/api/inventory')).body;
  assert.deepEqual(Object.keys(inv).sort(), ['budget', 'duplicates', 'nearDuplicates', 'projects', 'skills', 'sourceErrors', 'totals']);
  const alpha = inv.skills.find((s) => s.id === 'user:~:alpha');
  for (const k of ['id', 'source', 'owner', 'writable', 'toggleable', 'dirName', 'name', 'invokeName', 'namespace', 'path', 'description', 'whenToUse', 'disableModelInvocation', 'userInvocable', 'override', 'cost', 'warnings']) assert.ok(k in alpha, k);
  assert.equal('sha' in alpha, false);
  const usage = (await app.json('GET', '/api/usage')).body;
  assert.deepEqual(usage.skills, [{ invokeName: 'alpha', count: 1, lastUsedAt: '2026-11-01T10:00:00.000Z', sessions: 1 }]);
  for (const k of ['files', 'filesRead', 'bytesRead', 'ms', 'at']) assert.ok(k in usage.scan, k);
  assert.deepEqual((await app.json('GET', '/api/trash')).body, { entries: [] });
});

test('GET skills/detail: frontmatter, body, files, etag; unknown id → 404', async (t) => {
  const app = await boot(t, { files: FILES });
  const d = await app.json('GET', '/api/skills/detail?id=user:~:alpha');
  assert.equal(d.status, 200);
  assert.equal(d.body.frontmatterText, 'name: alpha\ndescription: "Alpha skill"');
  assert.deepEqual(d.body.files, ['SKILL.md', 'scripts/a.sh']);
  assert.match(d.body.etag, /^[0-9a-f]{64}$/);
  // Ids resolve only through the inventory: a path-like id is just unknown.
  for (const id of ['user:~:../../etc', '/etc/passwd', '']) {
    const r = await app.json('GET', `/api/skills/detail?id=${encodeURIComponent(id)}`);
    assert.equal(r.status, 404);
    assert.equal(r.body.code, 'NOT_FOUND');
  }
});

test('POST skills/validate returns description, cost and errors', async (t) => {
  const app = await boot(t);
  const ok = (await app.json('POST', '/api/skills/validate', { dirName: 'abc', frontmatterText: 'name: abc\ndescription: hello', body: '' })).body;
  assert.equal(ok.ok, true);
  assert.equal(ok.description, 'hello');
  assert.equal(ok.cost.chars, 3 + 4 + 5);
  const bad = (await app.json('POST', '/api/skills/validate', { dirName: 'abc', frontmatterText: 'name: zzz', body: '' })).body;
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 2);
});

// Invariant: request bodies are bounded and must be JSON objects.
test('body over 256 KiB → 413 BODY_TOO_LARGE; bad JSON → 400 BAD_JSON', async (t) => {
  const app = await boot(t);
  const big = await app.json('POST', '/api/skills', { scope: 'user', name: 'big', description: 'd', body: 'x'.repeat(300 * 1024) });
  assert.equal(big.status, 413);
  assert.equal(big.body.code, 'BODY_TOO_LARGE');
  const bad = await app.json('POST', '/api/skills', '{nope');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'BAD_JSON');
  const arr = await app.json('POST', '/api/skills/validate', [1]);
  assert.equal(arr.body.code, 'BAD_REQUEST');
});

test('unknown API route → JSON 404', async (t) => {
  const app = await boot(t);
  const r = await app.json('GET', '/api/nope');
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'NOT_FOUND');
});
