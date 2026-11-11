import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.mjs';
import { skillMd, snapshotTree } from './fixtures/roots.mjs';

const OUTSIDE = { 'outside/keep.txt': 'outside', 'outside/evil/SKILL.md': skillMd('evil', 'outside'), 'outside/plain.md': skillMd('linkmd', 'x') };

// Each refusal must leave the whole fixture tree byte- and mtime-identical.
async function refuses(t, { spec = {}, conductor, method, route, body, status, code }) {
  const app = await boot(t, { ...spec, files: { ...OUTSIDE, ...spec.files } }, { conductor });
  const before = await snapshotTree(app.roots.root);
  const res = await app.json(method, route, body);
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.code, code);
  assert.deepEqual(await snapshotTree(app.roots.root), before, 'nothing on disk changed');
}

// Invariant: only well-formed, non-reserved names reach the filesystem.
for (const name of ['../x', 'a/b', '.hidden', 'Upper', 'a'.repeat(65), '', 'x y']) {
  test(`name ${JSON.stringify(name).slice(0, 20)} → INVALID_NAME`, (t) => refuses(t, { method: 'POST', route: '/api/skills', body: { scope: 'user', name, description: 'd', body: '' }, status: 400, code: 'INVALID_NAME' }));
}
for (const name of ['synced', 'anthropic-skills']) {
  test(`name ${name} → RESERVED_NAME`, (t) => refuses(t, { method: 'POST', route: '/api/skills', body: { scope: 'user', name, description: 'd', body: '' }, status: 400, code: 'RESERVED_NAME' }));
}

// Invariant: project writes go only to registered local projects, named not pathed.
test('unknown project → UNKNOWN_PROJECT', (t) => refuses(t, { method: 'POST', route: '/api/skills', body: { scope: 'project', project: 'nope', name: 'a', description: 'd', body: '' }, status: 404, code: 'UNKNOWN_PROJECT' }));
test('remote project → PROJECT_NOT_LOCAL', (t) => refuses(t, {
  conductor: { projects: [{ name: 'far', path: '/srv/far', system: 'docker-box' }] },
  method: 'POST', route: '/api/skills', body: { scope: 'project', project: 'far', name: 'a', description: 'd', body: '' }, status: 400, code: 'PROJECT_NOT_LOCAL',
}));

// Invariant: containment — no write through a symlink that leaves the owner root.
test('<project>/.claude symlinked outside → PATH_ESCAPE', (t) => refuses(t, {
  spec: { symlinks: { 'projects/projA/.claude': 'outside' } },
  method: 'POST', route: '/api/skills', body: { scope: 'project', project: 'projA', name: 'a', description: 'd', body: '' }, status: 400, code: 'PATH_ESCAPE',
}));
test('~/.claude/skills symlinked outside → PATH_ESCAPE', (t) => refuses(t, {
  spec: { symlinks: { 'home/.claude/skills': 'outside' } },
  method: 'POST', route: '/api/skills', body: { scope: 'user', name: 'a', description: 'd', body: '' }, status: 400, code: 'PATH_ESCAPE',
}));
test('symlinked skill folder → SYMLINK_REFUSED (edit and delete)', async (t) => {
  const spec = { symlinks: { 'home/.claude/skills/evil': 'outside/evil' } };
  await refuses(t, { spec, method: 'PUT', route: '/api/skills/content', body: { scope: 'user', name: 'evil', frontmatterText: 'description: x', body: '', baseEtag: 'x' }, status: 400, code: 'SYMLINK_REFUSED' });
  await refuses(t, { spec, method: 'POST', route: '/api/skills/delete', body: { scope: 'user', name: 'evil' }, status: 400, code: 'SYMLINK_REFUSED' });
});
test('symlinked SKILL.md → SYMLINK_REFUSED', (t) => refuses(t, {
  spec: { files: { 'home/.claude/skills/linkmd/notes.txt': 'n' }, symlinks: { 'home/.claude/skills/linkmd/SKILL.md': 'outside/plain.md' } },
  method: 'PUT', route: '/api/skills/content', body: { scope: 'user', name: 'linkmd', frontmatterText: 'description: x', body: '', baseEtag: 'x' }, status: 400, code: 'SYMLINK_REFUSED',
}));

// Invariant: skills Code Skill doesn't own are read-only on every write route.
for (const scope of ['cc-core', 'cc-plugin', 'convention', 'synced', 'host-plugin', undefined]) {
  test(`scope ${scope} → READ_ONLY_SOURCE on every write route`, async (t) => {
    const app = await boot(t, { files: { ...OUTSIDE, 'cc/claude-plugin/skills/core/SKILL.md': skillMd('core', 'c') } });
    const before = await snapshotTree(app.roots.root);
    for (const [method, route, extra] of [
      ['POST', '/api/skills', { description: 'd', body: '' }],
      ['PUT', '/api/skills/content', { frontmatterText: 'description: d', body: '', baseEtag: 'x' }],
      ['PUT', '/api/skills/enabled', { enabled: false }],
      ['POST', '/api/skills/delete', {}],
    ]) {
      const res = await app.json(method, route, { scope, name: 'core', ...extra });
      assert.equal(res.status, 403, `${method} ${route}`);
      assert.equal(res.body.code, 'READ_ONLY_SOURCE');
    }
    assert.deepEqual(await snapshotTree(app.roots.root), before);
  });
}
