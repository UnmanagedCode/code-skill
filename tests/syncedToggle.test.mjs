import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { boot } from './helpers.mjs';
import { skillMd, snapshotTree, ORG, ACCT } from './fixtures/roots.mjs';

const BUCKET = `home/.claude/skills/synced/${ORG}_${ACCT}`;
const SETTINGS = 'home/.claude/settings.json';
const KEY = 'anthropic-skills:pdf';
const synced = (extra = {}) => ({
  'home/.claude.json': { oauthAccount: { organizationUuid: ORG, accountUuid: ACCT } },
  [`${BUCKET}/pdf/SKILL.md`]: skillMd('pdf', 'Work with PDFs'),
  ...extra,
});
const readJson = async (app, rel) => JSON.parse(await fs.readFile(app.roots.p(rel), 'utf8'));
const toggle = (app, enabled, scope = 'synced') => app.json('PUT', '/api/skills/enabled', { scope, name: 'pdf', enabled });
const syncedRow = async (app) => (await app.json('GET', '/api/inventory')).body.skills.find((s) => s.id === 'synced:~:pdf');

// Invariant: disabling a synced skill writes exactly the namespaced key into user settings, touching nothing else.
test('disable synced → only skillOverrides["anthropic-skills:pdf"]="off" in user settings.json', async (t) => {
  const app = await boot(t, { files: synced({ [SETTINGS]: { model: 'opus', skillOverrides: { other: 'off', pdf: 'on' } } }) });
  const before = await snapshotTree(app.roots.root);
  const res = await toggle(app, false);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.override.effective, 'off');
  assert.equal(res.body.git, null);
  assert.deepEqual(await readJson(app, SETTINGS), { model: 'opus', skillOverrides: { other: 'off', pdf: 'on', [KEY]: 'off' } });
  const after = await snapshotTree(app.roots.root);
  const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]).filter((k) => !k.endsWith('/'));
  assert.deepEqual(changed, [SETTINGS], 'bucket and every other file untouched');
  await assert.rejects(fs.access(app.roots.p('home/.claude/settings.local.json')));
});

// Invariant: enabling removes only the key Code Skill wrote.
test('enable after disable removes only the namespaced key', async (t) => {
  const app = await boot(t, { files: synced({ [SETTINGS]: { skillOverrides: { other: 'off' } } }) });
  await toggle(app, false);
  const res = await toggle(app, true);
  assert.equal(res.body.override.effective, 'on');
  assert.deepEqual(await readJson(app, SETTINGS), { skillOverrides: { other: 'off' } });
});

// Invariant: the inventory honours the bare alias for synced skills, so cost, totals and baseline follow the effective state.
test('bare "pdf": "off" alone → effective off, not listed, totals and baseline drop', async (t) => {
  const on = await boot(t, { files: synced() });
  const off = await boot(t, { files: synced({ [SETTINGS]: { skillOverrides: { pdf: 'off' } } }) });
  const a = (await on.json('GET', '/api/inventory')).body;
  const b = (await off.json('GET', '/api/inventory')).body;
  const row = b.skills.find((s) => s.id === 'synced:~:pdf');
  assert.equal(row.override.effective, 'off');
  assert.equal(row.cost.listing, 'hidden');
  assert.equal(row.cost.chars, 0);
  const total = (inv) => inv.totals.find((x) => x.key === 'synced:~');
  assert.ok(total(a).chars > 0);
  assert.equal(total(b).chars, 0);
  assert.ok(b.budget.baseline.chars < a.budget.baseline.chars);
});

// Invariant: enabling must beat a bare "off" via an explicit namespaced "on", leaving the bare key alone.
test('enable with bare off → writes namespaced "on", bare key untouched', async (t) => {
  const app = await boot(t, { files: synced({ [SETTINGS]: { skillOverrides: { pdf: 'off' } } }) });
  const res = await toggle(app, true);
  assert.equal(res.status, 200);
  assert.equal(res.body.override.effective, 'on');
  assert.deepEqual(await readJson(app, SETTINGS), { skillOverrides: { pdf: 'off', [KEY]: 'on' } });
});

// Invariant: read-side precedence — the namespaced key beats the bare one.
test('namespaced on + bare off → on; namespaced off + bare on → off', async (t) => {
  const a = await boot(t, { files: synced({ [SETTINGS]: { skillOverrides: { [KEY]: 'on', pdf: 'off' } } }) });
  assert.equal((await syncedRow(a)).override.effective, 'on');
  const b = await boot(t, { files: synced({ [SETTINGS]: { skillOverrides: { [KEY]: 'off', pdf: 'on' } } }) });
  assert.equal((await syncedRow(b)).override.effective, 'off');
});

// Invariant: a bare name reserved by a user skill is not an alias for the synced skill.
test('user skill "pdf" exists + bare pdf off → synced stays on', async (t) => {
  const app = await boot(t, { files: synced({ 'home/.claude/skills/pdf/SKILL.md': skillMd('pdf', 'Mine'), [SETTINGS]: { skillOverrides: { pdf: 'off' } } }) });
  assert.equal((await syncedRow(app)).override.effective, 'on');
  const user = (await app.json('GET', '/api/inventory')).body.skills.find((s) => s.id === 'user:~:pdf');
  assert.equal(user.override.effective, 'off');
});

// Invariant: managed policy wins and a locked synced skill is refused without writing.
test('managed namespaced off → 409 POLICY_LOCKED, nothing written; managed bare off → locked and off', async (t) => {
  const app = await boot(t, { files: synced({ 'managed/managed-settings.json': { skillOverrides: { [KEY]: 'off' } } }) });
  const before = await snapshotTree(app.roots.root);
  const res = await toggle(app, true);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'POLICY_LOCKED');
  assert.deepEqual(await snapshotTree(app.roots.root), before);
  const bare = await boot(t, { files: synced({ 'managed/managed-settings.json': { skillOverrides: { pdf: 'off' } } }) });
  const row = await syncedRow(bare);
  assert.equal(row.override.effective, 'off');
  assert.equal(row.override.lockedByPolicy, true);
});

// Invariant: the CLI keys on the frontmatter name, so a mismatch can't be toggled (the same rule as user skills).
test('synced folder whose frontmatter name differs → not toggleable, 409 NAME_MISMATCH', async (t) => {
  const app = await boot(t, { files: synced({ [`${BUCKET}/pdf/SKILL.md`]: skillMd('other', 'x') }) });
  assert.equal((await syncedRow(app)).toggleable, false);
  const res = await toggle(app, false);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'NAME_MISMATCH');
});

// Invariant: only a signed-in account's existing synced folder can be toggled.
test('no account, or unknown folder → 404 NOT_FOUND', async (t) => {
  const none = await boot(t, { files: { [`${BUCKET}/pdf/SKILL.md`]: skillMd('pdf', 'x') } });
  assert.equal((await toggle(none, false)).body.code, 'NOT_FOUND');
  const app = await boot(t, { files: synced() });
  const res = await app.json('PUT', '/api/skills/enabled', { scope: 'synced', name: 'nope', enabled: false });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'NOT_FOUND');
});

// Invariant: a symlinked settings file is never replaced; the refusal names the key.
test('symlinked user settings.json → 409 SYMLINK_REFUSED naming the key', async (t) => {
  const app = await boot(t, { files: synced({ 'dotfiles/settings.json': { model: 'opus' } }), symlinks: { [SETTINGS]: 'dotfiles/settings.json' } });
  const before = await snapshotTree(app.roots.root);
  const res = await toggle(app, false);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'SYMLINK_REFUSED');
  assert.match(res.body.message, /anthropic-skills:pdf/);
  assert.deepEqual(await snapshotTree(app.roots.root), before);
});

// Invariant: synced content stays non-writable; only the toggle is open.
test('content and delete routes still refuse synced → 403 READ_ONLY_SOURCE', async (t) => {
  const app = await boot(t, { files: synced() });
  const before = await snapshotTree(app.roots.root);
  const put = await app.json('PUT', '/api/skills/content', { scope: 'synced', name: 'pdf', frontmatterText: 'description: d', body: '', baseEtag: 'x' });
  const del = await app.json('POST', '/api/skills/delete', { scope: 'synced', name: 'pdf' });
  for (const res of [put, del]) {
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'READ_ONLY_SOURCE');
  }
  assert.deepEqual(await snapshotTree(app.roots.root), before);
});
