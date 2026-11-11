import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { boot } from './helpers.mjs';
import { skillMd } from './fixtures/roots.mjs';

const FILES = {
  'home/.claude/skills/mine/SKILL.md': skillMd('mine', 'Mine'),
  'projects/projA/.claude/skills/proj/SKILL.md': skillMd('proj', 'Proj'),
};
const readJson = async (f) => JSON.parse(await fs.readFile(f, 'utf8'));

// Invariant: disabling a user skill writes "off" into ~/.claude/settings.json.
test('disable a user skill → off in user settings.json; enable removes it', async (t) => {
  const app = await boot(t, { files: FILES });
  const off = await app.json('PUT', '/api/skills/enabled', { scope: 'user', name: 'mine', enabled: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.override.effective, 'off');
  assert.equal(off.body.git, null);
  assert.deepEqual(await readJson(app.roots.p('home/.claude/settings.json')), { skillOverrides: { mine: 'off' } });
  const on = await app.json('PUT', '/api/skills/enabled', { scope: 'user', name: 'mine', enabled: true });
  assert.equal(on.body.override.effective, 'on');
  assert.deepEqual(await readJson(app.roots.p('home/.claude/settings.json')), { skillOverrides: {} });
});

// Invariant: project toggles go to the project's settings.local.json, never its committed settings.json.
test('disable a project skill → settings.local.json only', async (t) => {
  const app = await boot(t, { files: FILES });
  const res = await app.json('PUT', '/api/skills/enabled', { scope: 'project', project: 'projA', name: 'proj', enabled: false });
  assert.equal(res.status, 200);
  assert.deepEqual(await readJson(app.roots.p('projects/projA/.claude/settings.local.json')), { skillOverrides: { proj: 'off' } });
  await assert.rejects(fs.access(app.roots.p('projects/projA/.claude/settings.json')));
});

test('enable when a lower layer says off → explicit "on" in local', async (t) => {
  const app = await boot(t, { files: { ...FILES, 'home/.claude/settings.json': { skillOverrides: { proj: 'off' } } } });
  const res = await app.json('PUT', '/api/skills/enabled', { scope: 'project', project: 'projA', name: 'proj', enabled: true });
  assert.equal(res.body.override.effective, 'on');
  assert.deepEqual(await readJson(app.roots.p('projects/projA/.claude/settings.local.json')), { skillOverrides: { proj: 'on' } });
  assert.deepEqual(await readJson(app.roots.p('home/.claude/settings.json')), { skillOverrides: { proj: 'off' } }, 'user layer untouched');
});

test('enable with no lower layer → our key removed', async (t) => {
  const app = await boot(t, { files: { ...FILES, 'projects/projA/.claude/settings.local.json': { other: 1, skillOverrides: { proj: 'off' } } } });
  await app.json('PUT', '/api/skills/enabled', { scope: 'project', project: 'projA', name: 'proj', enabled: true });
  assert.deepEqual(await readJson(app.roots.p('projects/projA/.claude/settings.local.json')), { other: 1, skillOverrides: {} });
});

// Invariant: managed policy can't be overridden from here.
test('policy-locked → POLICY_LOCKED, nothing written', async (t) => {
  const app = await boot(t, { files: { ...FILES, 'managed/managed-settings.json': { skillOverrides: { mine: 'off' } } } });
  const res = await app.json('PUT', '/api/skills/enabled', { scope: 'user', name: 'mine', enabled: true });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'POLICY_LOCKED');
  await assert.rejects(fs.access(app.roots.p('home/.claude/settings.json')));
});

test('a missing skill → 404; a read-only source → 403', async (t) => {
  const app = await boot(t, { files: FILES });
  assert.equal((await app.json('PUT', '/api/skills/enabled', { scope: 'user', name: 'ghost', enabled: false })).status, 404);
  assert.equal((await app.json('PUT', '/api/skills/enabled', { scope: 'cc-core', name: 'mine', enabled: false })).status, 403);
  assert.equal((await app.json('PUT', '/api/skills/enabled', { scope: 'user', name: 'mine', enabled: 'no' })).status, 400);
});

// Invariant: overrides and the invoke name follow the frontmatter name (as the CLI does); a name that
// disagrees with its folder is flagged and can't be toggled.
test('frontmatter name ≠ folder: keyed on the name, flagged, toggle refused with NAME_MISMATCH', async (t) => {
  const app = await boot(t, { files: {
    'home/.claude/skills/folder/SKILL.md': skillMd('declared', 'Mismatched'),
    'home/.claude/settings.json': { skillOverrides: { declared: 'off', folder: 'on' } },
  } });
  const s = (await app.json('GET', '/api/inventory')).body.skills.find((x) => x.id === 'user:~:folder');
  assert.equal(s.invokeName, 'declared');
  assert.equal(s.override.effective, 'off', 'read from the "declared" key, not the folder key');
  assert.equal(s.cost.listing, 'hidden');
  assert.equal(s.toggleable, false);
  assert.ok(s.warnings.some((w) => /≠ directory "folder".*enable\/disable is off/.test(w)));
  const before = await fs.readFile(app.roots.p('home/.claude/settings.json'));
  const res = await app.json('PUT', '/api/skills/enabled', { scope: 'user', name: 'folder', enabled: true });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'NAME_MISMATCH');
  assert.deepEqual(await fs.readFile(app.roots.p('home/.claude/settings.json')), before);
});

test('frontmatter without a name falls back to the folder name', async (t) => {
  const app = await boot(t, { files: {
    'home/.claude/skills/bare/SKILL.md': '---\ndescription: no name\n---\n\nbody\n',
    'home/.claude/settings.json': { skillOverrides: { bare: 'name-only' } },
  } });
  const s = (await app.json('GET', '/api/inventory')).body.skills.find((x) => x.id === 'user:~:bare');
  assert.deepEqual([s.invokeName, s.toggleable, s.override.effective], ['bare', true, 'name-only']);
  assert.equal((await app.json('PUT', '/api/skills/enabled', { scope: 'user', name: 'bare', enabled: false })).status, 200);
});
