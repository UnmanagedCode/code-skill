import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { boot } from './helpers.mjs';
import { makeRoots, skillMd } from './fixtures/roots.mjs';
import { parseSkillMd } from '../src/skillFile.js';
import { writeFileAtomic, sha256 } from '../src/fsx/atomicWrite.js';

// Invariant: create writes a parseable SKILL.md whose name equals its folder.
test('create a user skill → parseable SKILL.md, returned in the inventory shape', async (t) => {
  const app = await boot(t);
  const res = await app.json('POST', '/api/skills', { scope: 'user', name: 'fresh', description: 'Does: fresh things', body: '# Fresh\n' });
  assert.equal(res.status, 201);
  assert.equal(res.body.skill.id, 'user:~:fresh');
  assert.equal(res.body.skill.writable, true);
  const text = await fs.readFile(app.roots.p('home/.claude/skills/fresh/SKILL.md'), 'utf8');
  assert.equal(res.body.etag, sha256(text));
  const parsed = parseSkillMd(text);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.frontmatter, { name: 'fresh', description: 'Does: fresh things' });
  assert.equal(parsed.body, '# Fresh\n');
});

test('create a project skill makes .claude/skills in the main checkout', async (t) => {
  const app = await boot(t);
  const res = await app.json('POST', '/api/skills', { scope: 'project', project: 'projB', name: 'pb', description: 'd', body: '' });
  assert.equal(res.status, 201);
  assert.equal(res.body.skill.id, 'project:projB:pb');
  await fs.access(app.roots.p('projects/projB/.claude/skills/pb/SKILL.md'));
});

test('create on an existing name → EXISTS; empty description → INVALID_FRONTMATTER', async (t) => {
  const app = await boot(t, { files: { 'home/.claude/skills/taken/SKILL.md': skillMd('taken', 'x') } });
  assert.equal((await app.json('POST', '/api/skills', { scope: 'user', name: 'taken', description: 'd', body: '' })).body.code, 'EXISTS');
  const bad = await app.json('POST', '/api/skills', { scope: 'user', name: 'new', description: '  ', body: '' });
  assert.equal(bad.body.code, 'INVALID_FRONTMATTER');
  await assert.rejects(fs.access(app.roots.p('home/.claude/skills/new')));
});

// Invariant: an edit never overwrites a version the editor didn't see.
test('edit with a stale etag → STALE and the file is unchanged', async (t) => {
  const app = await boot(t, { files: { 'home/.claude/skills/e/SKILL.md': skillMd('e', 'old') } });
  const file = app.roots.p('home/.claude/skills/e/SKILL.md');
  const before = await fs.readFile(file);
  const res = await app.json('PUT', '/api/skills/content', { scope: 'user', name: 'e', frontmatterText: 'name: e\ndescription: new', body: 'b', baseEtag: sha256('something else') });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'STALE');
  assert.deepEqual(await fs.readFile(file), before);
});

// Invariant: edits keep the user's YAML verbatim (comments, order, quoting).
test('edit writes frontmatter verbatim, comments preserved', async (t) => {
  const app = await boot(t, { files: { 'home/.claude/skills/e/SKILL.md': skillMd('e', 'old') } });
  const file = app.roots.p('home/.claude/skills/e/SKILL.md');
  const detail = await app.json('GET', '/api/skills/detail?id=user:~:e');
  const fm = "# keep me\ndescription: 'new one'   # trailing\nname: e";
  const res = await app.json('PUT', '/api/skills/content', { scope: 'user', name: 'e', frontmatterText: fm, body: 'Body\n', baseEtag: detail.body.etag });
  assert.equal(res.status, 200);
  assert.equal(await fs.readFile(file, 'utf8'), `---\n${fm}\n---\n\nBody\n`);
  assert.equal(res.body.skill.description, 'new one');
});

test('name ≠ folder → INVALID_FRONTMATTER listing the errors; file unchanged', async (t) => {
  const app = await boot(t, { files: { 'home/.claude/skills/e/SKILL.md': skillMd('e', 'old') } });
  const detail = await app.json('GET', '/api/skills/detail?id=user:~:e');
  const res = await app.json('PUT', '/api/skills/content', { scope: 'user', name: 'e', frontmatterText: 'name: other\ndescription: x', body: '', baseEtag: detail.body.etag });
  assert.equal(res.body.code, 'INVALID_FRONTMATTER');
  assert.ok(Array.isArray(res.body.errors));
  assert.equal(await fs.readFile(app.roots.p('home/.claude/skills/e/SKILL.md'), 'utf8'), skillMd('e', 'old'));
});

// Invariant: writes are atomic — a failed rename leaves the original bytes and no temp file.
test('an injected rename failure leaves the original and no .tmp', async (t) => {
  const roots = await makeRoots(t, { files: { 'home/.claude/skills/a/SKILL.md': 'original' } });
  const file = roots.p('home/.claude/skills/a/SKILL.md');
  const rename = async () => { throw Object.assign(new Error('boom'), { code: 'EIO' }); };
  await assert.rejects(writeFileAtomic(file, 'new bytes', { rename }), /boom/);
  assert.equal(await fs.readFile(file, 'utf8'), 'original');
  assert.deepEqual(await fs.readdir(roots.p('home/.claude/skills/a')), ['SKILL.md']);
});
