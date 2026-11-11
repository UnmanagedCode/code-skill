import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { makeRoots } from './fixtures/roots.mjs';
import { setSkillOverride } from '../src/overrides/settingsFile.js';

const ORIGINAL = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] }, skillOverrides: { other: 'name-only' }, zeta: [1, 2, { k: null }] };

async function settings(t, content) {
  const roots = await makeRoots(t, content === undefined ? {} : { files: { 'home/.claude/settings.json': content } });
  return { roots, file: roots.p('home/.claude/settings.json') };
}

// Invariant: only skillOverrides[name] changes; every other key and value survives, in order.
test('sets one key and leaves the rest deep-equal and in order', async (t) => {
  const { file } = await settings(t, JSON.stringify(ORIGINAL, null, 2));
  assert.deepEqual(await setSkillOverride(file, 'mine', 'off'), { changed: true });
  const after = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(after, { ...ORIGINAL, skillOverrides: { other: 'name-only', mine: 'off' } });
  assert.deepEqual(Object.keys(after), Object.keys(ORIGINAL));
  await setSkillOverride(file, 'mine', undefined);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), ORIGINAL);
});

test('indent is preserved (4 spaces, tabs) and a trailing newline written', async (t) => {
  for (const indent of ['    ', '\t']) {
    const { file } = await settings(t, JSON.stringify({ a: 1 }, null, indent));
    await setSkillOverride(file, 'x', 'off');
    const text = await fs.readFile(file, 'utf8');
    assert.equal(text, `${JSON.stringify({ a: 1, skillOverrides: { x: 'off' } }, null, indent)}\n`);
  }
});

test('a missing file is created with just skillOverrides', async (t) => {
  const { file } = await settings(t);
  await setSkillOverride(file, 'x', 'off');
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { skillOverrides: { x: 'off' } });
});

test('an unchanged value does not rewrite the file', async (t) => {
  const { file } = await settings(t, JSON.stringify({ skillOverrides: { x: 'off' } }));
  const before = await fs.stat(file);
  assert.deepEqual(await setSkillOverride(file, 'x', 'off'), { changed: false });
  assert.equal((await fs.stat(file)).mtimeMs, before.mtimeMs);
});

// Invariant: a settings file Code Skill can't safely parse is never touched.
test('unparseable → SETTINGS_UNPARSEABLE with bytes untouched', async (t) => {
  const { file } = await settings(t, '{ "a": 1, // comment\n}');
  const bytes = await fs.readFile(file);
  await assert.rejects(setSkillOverride(file, 'x', 'off'), { code: 'SETTINGS_UNPARSEABLE' });
  assert.deepEqual(await fs.readFile(file), bytes);
});

test('array or non-object skillOverrides → SETTINGS_SHAPE', async (t) => {
  for (const content of ['[1,2]', '{"skillOverrides":[]}', '"str"']) {
    const { file } = await settings(t, content);
    await assert.rejects(setSkillOverride(file, 'x', 'off'), { code: 'SETTINGS_SHAPE' });
    assert.equal(await fs.readFile(file, 'utf8'), content);
  }
});

test('symlinked settings file → SYMLINK_REFUSED', async (t) => {
  const roots = await makeRoots(t, { files: { 'elsewhere.json': '{}' }, symlinks: { 'home/.claude/settings.json': 'elsewhere.json' } });
  await assert.rejects(setSkillOverride(roots.p('home/.claude/settings.json'), 'x', 'off'), { code: 'SYMLINK_REFUSED' });
  assert.equal(await fs.readFile(roots.p('elsewhere.json'), 'utf8'), '{}');
});

// Invariant: a concurrent writer's change is never lost — retry on change, then refuse.
test('a change during the write retries and keeps the other writer\'s key', async (t) => {
  const { file } = await settings(t, JSON.stringify({ a: 1 }));
  const beforeCommit = async (attempt) => {
    if (attempt === 0) await fs.writeFile(file, JSON.stringify({ a: 1, theirs: true }));
  };
  await setSkillOverride(file, 'x', 'off', { hooks: { beforeCommit } });
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { a: 1, theirs: true, skillOverrides: { x: 'off' } });
});

test('a file that keeps changing → SETTINGS_BUSY, other writer wins, no temp files left', async (t) => {
  const { roots, file } = await settings(t, JSON.stringify({ a: 1 }));
  let n = 0;
  const beforeCommit = async () => fs.writeFile(file, JSON.stringify({ a: 1, n: ++n }));
  await assert.rejects(setSkillOverride(file, 'x', 'off', { hooks: { beforeCommit } }), { code: 'SETTINGS_BUSY' });
  assert.equal(n, 3);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { a: 1, n: 3 });
  assert.deepEqual((await fs.readdir(roots.p('home/.claude'))).filter((f) => f.endsWith('.tmp')), []);
});

// Invariant: a file that turns into a symlink between attempts is never replaced — the check runs before every read.
test('settings file swapped for a symlink mid-write → retry refuses SYMLINK_REFUSED, link kept', async (t) => {
  const roots = await makeRoots(t, { files: { 'home/.claude/settings.json': '{"a":1}\n', 'dotfiles/settings.json': '{"theirs":true}\n' } });
  const file = roots.p('home/.claude/settings.json');
  const beforeCommit = async (attempt) => {
    if (attempt !== 0) return;
    await fs.rm(file);
    await fs.symlink(roots.p('dotfiles/settings.json'), file);
  };
  await assert.rejects(setSkillOverride(file, 'x', 'off', { hooks: { beforeCommit } }), { code: 'SYMLINK_REFUSED' });
  assert.ok((await fs.lstat(file)).isSymbolicLink());
  assert.equal(await fs.readFile(roots.p('dotfiles/settings.json'), 'utf8'), '{"theirs":true}\n');
});

// Invariant: an unparseable settings file's content never leaks into the refusal message.
test('SETTINGS_UNPARSEABLE names the file only, never its content', async (t) => {
  const { file } = await settings(t, '{"apiKey": "sk-SECRET-123456", oops}');
  const err = await setSkillOverride(file, 'x', 'off').catch((e) => e);
  assert.equal(err.code, 'SETTINGS_UNPARSEABLE');
  assert.equal(err.message, `${file} is not valid JSON; fix it by hand first`);
});
