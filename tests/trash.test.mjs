import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { boot } from './helpers.mjs';
import { makeRoots, skillMd, snapshotTree } from './fixtures/roots.mjs';
import { moveToTrash } from '../src/trash.js';

const FILES = {
  'home/.claude/skills/gone/SKILL.md': skillMd('gone', 'Going'),
  'home/.claude/skills/gone/scripts/run.sh': '#!/bin/sh\necho hi\n',
};

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
  const config = roots.config('http://127.0.0.1:1');
  const src = roots.p('home/.claude/skills/gone');
  const original = await snapshotTree(src);
  let renames = 0;
  const rename = async () => { renames++; throw Object.assign(new Error('cross-device'), { code: 'EXDEV' }); };
  const trashId = await moveToTrash(config, { scope: 'user', name: 'gone', dir: src }, { rename });
  assert.equal(renames, 1);
  await assert.rejects(fs.access(src));
  const copied = await snapshotTree(roots.p('data/trash', trashId, 'skill'));
  assert.deepEqual(Object.keys(copied).sort(), Object.keys(original).sort());
});
