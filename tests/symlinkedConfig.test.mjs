import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { boot } from './helpers.mjs';
import { skillMd } from './fixtures/roots.mjs';

// Invariant: a ~/.claude that is a symlink (dotfiles setup) works for reads and for toggles, which land in the link's target.
test('~/.claude symlinked into a dotfiles repo: inventory reads it, toggles write through it', async (t) => {
  const app = await boot(t, {
    files: { 'dotfiles/claude/skills/mine/SKILL.md': skillMd('mine', 'Mine'), 'dotfiles/claude/settings.json': { model: 'opus' } },
    symlinks: { 'home/.claude': 'dotfiles/claude' },
  });
  const inv = (await app.json('GET', '/api/inventory')).body;
  assert.deepEqual(inv.sourceErrors.filter((e) => e.source !== 'cc-core'), []);
  assert.ok(inv.skills.some((s) => s.id === 'user:~:mine'));
  const res = await app.json('PUT', '/api/skills/enabled', { scope: 'user', name: 'mine', enabled: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(JSON.parse(await fs.readFile(app.roots.p('dotfiles/claude/settings.json'), 'utf8')), { model: 'opus', skillOverrides: { mine: 'off' } });
  assert.ok((await fs.lstat(app.roots.p('home/.claude'))).isSymbolicLink(), 'the link stays a link');
});

// Invariant: a symlinked settings file is read through (like the CLI) but never replaced by a write.
test('settings.json itself a symlink: state read through the link; a toggle refuses and says why', async (t) => {
  const app = await boot(t, {
    files: { 'home/.claude/skills/mine/SKILL.md': skillMd('mine', 'Mine'), 'dotfiles/settings.json': { skillOverrides: { mine: 'off' } } },
    symlinks: { 'home/.claude/settings.json': 'dotfiles/settings.json' },
  });
  const inv = (await app.json('GET', '/api/inventory')).body;
  assert.deepEqual(inv.sourceErrors.filter((e) => e.source !== 'cc-core'), []);
  assert.equal(inv.skills.find((s) => s.id === 'user:~:mine').override.effective, 'off');
  const target = await fs.readFile(app.roots.p('dotfiles/settings.json'));
  const res = await app.json('PUT', '/api/skills/enabled', { scope: 'user', name: 'mine', enabled: true });
  assert.equal(res.body.code, 'SYMLINK_REFUSED');
  assert.match(res.body.message, /is a symlink.*replace your link/s);
  assert.match(res.body.message, /Remove "mine" from "skillOverrides"/);
  assert.ok((await fs.lstat(app.roots.p('home/.claude/settings.json'))).isSymbolicLink());
  assert.deepEqual(await fs.readFile(app.roots.p('dotfiles/settings.json')), target);
});

// Invariant: rewriting a settings file or SKILL.md keeps its permission bits (settings may hold secrets).
test('atomic writes keep the existing file mode', async (t) => {
  const app = await boot(t, { files: { 'home/.claude/skills/mine/SKILL.md': skillMd('mine', 'Mine'), 'home/.claude/settings.json': { token: 'secret' } } });
  await fs.chmod(app.roots.p('home/.claude/settings.json'), 0o600);
  await fs.chmod(app.roots.p('home/.claude/skills/mine/SKILL.md'), 0o640);
  await app.json('PUT', '/api/skills/enabled', { scope: 'user', name: 'mine', enabled: false });
  assert.equal((await fs.stat(app.roots.p('home/.claude/settings.json'))).mode & 0o777, 0o600);
  const { etag } = (await app.json('GET', '/api/skills/detail?id=user:~:mine')).body;
  const saved = await app.json('PUT', '/api/skills/content', { scope: 'user', name: 'mine', frontmatterText: 'name: mine\ndescription: new', body: '', baseEtag: etag });
  assert.equal(saved.status, 200);
  assert.equal((await fs.stat(app.roots.p('home/.claude/skills/mine/SKILL.md'))).mode & 0o777, 0o640);
});
