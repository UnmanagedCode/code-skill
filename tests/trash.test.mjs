import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { boot } from './helpers.mjs';
import { makeRoots, skillMd, snapshotTree } from './fixtures/roots.mjs';
import { moveToTrash, inspectEntry, takeFromTrash } from '../src/trash.js';

const FILES = {
  'home/.claude/skills/gone/SKILL.md': skillMd('gone', 'Going'),
  'home/.claude/skills/gone/scripts/run.sh': '#!/bin/sh\necho hi\n',
};
const LINKS = { 'home/.claude/skills/gone/scripts/latest': 'run.sh' };

// Invariant: delete is reversible and stays inside the plugin's data dir.
test('delete moves the folder into <dataDir>/trash with meta; restore puts it back byte-identical', async (t) => {
  const app = await boot(t, { files: FILES });
  const original = await snapshotTree(app.roots.p('home/.claude/skills/gone'));
  const del = await app.json('POST', '/api/skills/delete', { scope: 'user', name: 'gone' });
  assert.equal(del.status, 200);
  const { trashId } = del.body;
  assert.match(trashId, /^\d+-[0-9a-f]{8}$/);
  await assert.rejects(fs.access(app.roots.p('home/.claude/skills/gone')));
  const meta = JSON.parse(await fs.readFile(app.roots.p('data/trash', trashId, 'meta.json'), 'utf8'));
  assert.deepEqual({ ...meta, deletedAt: 'x' }, { trashId, scope: 'user', project: null, name: 'gone', originalPath: app.roots.p('home/.claude/skills/gone'), deletedAt: 'x' });
  assert.deepEqual((await app.json('GET', '/api/trash')).body.entries.map((e) => e.trashId), [trashId]);

  const back = await app.json('POST', `/api/trash/${trashId}/restore`);
  assert.equal(back.status, 200);
  assert.equal(back.body.skill.id, 'user:~:gone');
  assert.deepEqual(await snapshotTree(app.roots.p('home/.claude/skills/gone')), original);
  assert.deepEqual((await app.json('GET', '/api/trash')).body.entries, []);
});

test('restore onto an existing skill → RESTORE_CONFLICT, both kept', async (t) => {
  const app = await boot(t, { files: FILES });
  const { trashId } = (await app.json('POST', '/api/skills/delete', { scope: 'user', name: 'gone' })).body;
  await app.json('POST', '/api/skills', { scope: 'user', name: 'gone', description: 'new one', body: '' });
  const res = await app.json('POST', `/api/trash/${trashId}/restore`);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'RESTORE_CONFLICT');
  await fs.access(app.roots.p('data/trash', trashId, 'skill', 'SKILL.md'));
});

test('restore into a project that is no longer registered → UNKNOWN_PROJECT', async (t) => {
  const app = await boot(t, { files: { 'projects/projA/.claude/skills/p/SKILL.md': skillMd('p', 'x') } });
  const { trashId } = (await app.json('POST', '/api/skills/delete', { scope: 'project', project: 'projA', name: 'p' })).body;
  app.fake.state.projects = app.fake.state.projects.filter((p) => p.name !== 'projA');
  assert.equal((await app.json('POST', `/api/trash/${trashId}/restore`)).body.code, 'UNKNOWN_PROJECT');
});

test('a malformed or unknown trash id → 404', async (t) => {
  const app = await boot(t);
  for (const id of ['..', '123-zzzzzzzz', '1-0123abcd']) {
    assert.equal((await app.json('POST', `/api/trash/${encodeURIComponent(id)}/restore`)).status, 404, id);
  }
});

// Invariant: across filesystems (EXDEV) the move copies, then removes the source.
test('EXDEV rename falls back to copy + remove', async (t) => {
  const roots = await makeRoots(t, { files: FILES });
  for (const [rel, target] of Object.entries(LINKS)) await fs.symlink(target, roots.p(rel));
  const config = roots.config('http://127.0.0.1:1');
  const src = roots.p('home/.claude/skills/gone');
  const original = await snapshotTree(src, { mtimes: false });
  assert.equal(original['scripts/latest'], 'link:run.sh');
  let renames = 0;
  const rename = async () => { renames++; throw Object.assign(new Error('cross-device'), { code: 'EXDEV' }); };
  const trashId = await moveToTrash(config, { scope: 'user', name: 'gone', dir: src }, { rename });
  assert.equal(renames, 1);
  await assert.rejects(fs.access(src));
  assert.deepEqual(await snapshotTree(roots.p('data/trash', trashId, 'skill'), { mtimes: false }), original, 'same files, bytes, modes and link targets');
});

const META = (trashId, name = 'pwn') => ({ trashId, scope: 'user', project: null, name, originalPath: '/x', deletedAt: '2026-11-01T00:00:00.000Z' });
const VICTIM = { 'outside/victim/SKILL.md': skillMd('victim', 'not yours'), 'outside/victim/secret.txt': 'secret' };

async function restoreRefused(t, spec, trashId, code) {
  const app = await boot(t, spec);
  const before = await snapshotTree(app.roots.root);
  const res = await app.json('POST', `/api/trash/${trashId}/restore`);
  assert.equal(res.body.code, code, JSON.stringify(res.body));
  assert.deepEqual(await snapshotTree(app.roots.root), before, 'nothing moved');
  assert.deepEqual((await app.json('GET', '/api/trash')).body.entries, [], 'listing skips it too');
}

// Invariant: restore moves only a real folder that lives inside the trash, described by a real meta.json.
test('symlinked entry folder → SYMLINK_REFUSED, nothing moved', (t) => restoreRefused(t, {
  files: { ...VICTIM, 'outside/fake/meta.json': META('1-aaaaaaaa'), 'outside/fake/skill/SKILL.md': skillMd('pwn', 'x') },
  symlinks: { 'data/trash/1-aaaaaaaa': 'outside/fake' },
}, '1-aaaaaaaa', 'SYMLINK_REFUSED'));

test('symlinked skill/ → SYMLINK_REFUSED, the target is not installed', (t) => restoreRefused(t, {
  files: { ...VICTIM, 'data/trash/1-bbbbbbbb/meta.json': META('1-bbbbbbbb') },
  symlinks: { 'data/trash/1-bbbbbbbb/skill': 'outside/victim' },
}, '1-bbbbbbbb', 'SYMLINK_REFUSED'));

test('symlinked meta.json → SYMLINK_REFUSED', (t) => restoreRefused(t, {
  files: { ...VICTIM, 'outside/meta.json': META('1-cccccccc'), 'data/trash/1-cccccccc/skill/SKILL.md': skillMd('pwn', 'x') },
  symlinks: { 'data/trash/1-cccccccc/meta.json': 'outside/meta.json' },
}, '1-cccccccc', 'SYMLINK_REFUSED'));

// Invariant: a malformed entry is "not found", never a 500.
test('meta.json a folder, bad JSON, wrong shape, or no skill/ → 404 NOT_FOUND', async (t) => {
  for (const files of [
    { 'data/trash/1-dddddddd/meta.json/x': 'x', 'data/trash/1-dddddddd/skill/SKILL.md': 'x' },
    { 'data/trash/1-dddddddd/meta.json': '{nope', 'data/trash/1-dddddddd/skill/SKILL.md': 'x' },
    { 'data/trash/1-dddddddd/meta.json': '[1]', 'data/trash/1-dddddddd/skill/SKILL.md': 'x' },
    { 'data/trash/1-dddddddd/meta.json': META('1-dddddddd') },
  ]) await restoreRefused(t, { files }, '1-dddddddd', 'NOT_FOUND');
});

// Invariant: restore re-checks the entry right before moving it, so swapping it for a symlink while the
// target is being resolved (restore asks cc about the project) can't move a folder from outside the trash.
test('entry swapped for a symlink during restore → refused, the outside folder untouched', async (t) => {
  const app = await boot(t, { files: {
    'projects/projA/.claude/skills/p/SKILL.md': skillMd('p', 'mine'),
    'outside/fake/skill/SKILL.md': skillMd('p', 'not yours'),
    'outside/fake/skill/secret.txt': 'secret',
  } });
  const { trashId } = (await app.json('POST', '/api/skills/delete', { scope: 'project', project: 'projA', name: 'p' })).body;
  const entry = app.roots.p('data/trash', trashId);
  await fs.writeFile(app.roots.p('outside/fake/meta.json'), JSON.stringify({ trashId, scope: 'project', project: 'projA', name: 'p', originalPath: '/x', deletedAt: 'x' }));
  const before = await snapshotTree(app.roots.p('outside'));
  let swapped = false;
  app.fake.state.onRequest = async (pathname) => {
    // restoreSkill's own project lookup happens after inspectEntry: swap the entry then.
    if (pathname !== '/api/projects' || swapped) return;
    swapped = true;
    await fs.rename(entry, `${entry}.aside`);
    await fs.symlink(app.roots.p('outside/fake'), entry);
  };
  const res = await app.json('POST', `/api/trash/${trashId}/restore`);
  assert.ok(swapped, 'the swap ran inside the window');
  assert.equal(res.body.code, 'SYMLINK_REFUSED', JSON.stringify(res.body));
  assert.deepEqual(await snapshotTree(app.roots.p('outside')), before, 'the outside folder is untouched');
  await assert.rejects(fs.access(app.roots.p('projects/projA/.claude/skills/p')));
});

test('skill/ swapped for a symlink after inspection → takeFromTrash refuses', async (t) => {
  const roots = await makeRoots(t, { files: { ...FILES, 'outside/victim/SKILL.md': 'v' } });
  const config = roots.config('http://127.0.0.1:1');
  const trashId = await moveToTrash(config, { scope: 'user', name: 'gone', dir: roots.p('home/.claude/skills/gone') });
  const inspected = await inspectEntry(config, trashId);
  await fs.rename(inspected.skillDir, `${inspected.skillDir}.aside`);
  await fs.symlink(roots.p('outside/victim'), inspected.skillDir);
  await assert.rejects(takeFromTrash(config, inspected, roots.p('home/.claude/skills/gone')), { code: 'SYMLINK_REFUSED' });
  await fs.access(roots.p('outside/victim/SKILL.md'));
  await assert.rejects(fs.access(roots.p('home/.claude/skills/gone')));
});

// Invariant: the trash lists only entries that could restore; a bad name or a read-only scope is skipped (and 404s).
test('entries with an invalid name, a reserved name or a read-only scope are not listed', async (t) => {
  const entry = (id, meta) => ({ [`data/trash/${id}/meta.json`]: { trashId: id, originalPath: '/x', deletedAt: '2026-11-01T00:00:00.000Z', ...meta }, [`data/trash/${id}/skill/SKILL.md`]: 'x' });
  const app = await boot(t, { files: {
    ...entry('1-00000001', { scope: 'user', project: null, name: '../escape' }),
    ...entry('1-00000002', { scope: 'user', project: null, name: 'synced' }),
    ...entry('1-00000003', { scope: 'cc-core', project: null, name: 'core' }),
    ...entry('1-00000004', { scope: 'project', project: null, name: 'p' }),
    ...entry('1-00000005', { scope: 'user', project: null, name: 'fine' }),
  } });
  assert.deepEqual((await app.json('GET', '/api/trash')).body.entries.map((e) => e.trashId), ['1-00000005']);
  for (const id of ['1-00000001', '1-00000002', '1-00000003', '1-00000004']) {
    assert.equal((await app.json('POST', `/api/trash/${id}/restore`)).body.code, 'NOT_FOUND', id);
  }
});
