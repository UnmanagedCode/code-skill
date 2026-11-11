import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoots } from './fixtures/roots.mjs';
import { readLayers } from '../src/overrides/layers.js';
import { effectiveFor, overrideKeysOf } from '../src/overrides/effective.js';

const so = (o) => ({ skillOverrides: o });
const userRec = { source: 'user', dirName: 's', owner: {} };
const projRec = { source: 'project', dirName: 's', owner: { project: 'projA' } };

async function layersFor(t, files) {
  const roots = await makeRoots(t, { files });
  return readLayers(roots.config('http://127.0.0.1:1'), roots.projects);
}

// Invariant: on/off agrees with the CLI's merge order user < project < local < policy (F7).
test('project skill: local beats project beats user', async (t) => {
  const layers = await layersFor(t, {
    'home/.claude/settings.json': so({ s: 'off' }),
    'projects/projA/.claude/settings.json': so({ s: 'name-only' }),
    'projects/projA/.claude/settings.local.json': so({ s: 'on' }),
  });
  const e = effectiveFor(projRec, layers);
  assert.equal(e.effective, 'on');
  assert.deepEqual(e.layers.map((l) => [l.layer, l.value]), [['user', 'off'], ['project', 'name-only'], ['local', 'on']]);
  assert.equal(e.lockedByPolicy, false);
});

test('absent everywhere → on', async (t) => {
  assert.equal(effectiveFor(projRec, await layersFor(t, {})).effective, 'on');
});

test('policy wins and locks; managed-settings.d applies in sorted order after managed-settings.json', async (t) => {
  const layers = await layersFor(t, {
    'projects/projA/.claude/settings.local.json': so({ s: 'on' }),
    'managed/managed-settings.json': so({ s: 'on' }),
    'managed/managed-settings.d/20-b.json': so({ s: 'off' }),
    'managed/managed-settings.d/10-a.json': so({ s: 'name-only' }),
  });
  const e = effectiveFor(projRec, layers);
  assert.equal(e.effective, 'off');
  assert.equal(e.lockedByPolicy, true);
  assert.deepEqual(e.layers.filter((l) => l.layer === 'policy').map((l) => l.value), ['on', 'name-only', 'off']);
});

test('remote-settings.json counts as policy', async (t) => {
  const e = effectiveFor(userRec, await layersFor(t, { 'home/.claude/remote-settings.json': so({ s: 'off' }) }));
  assert.equal(e.effective, 'off');
  assert.equal(e.lockedByPolicy, true);
});

// Invariant: a user skill's state ignores project layers, but reports them.
test('user skill: user layer only, other projects listed', async (t) => {
  const layers = await layersFor(t, {
    'home/.claude/settings.json': so({ s: 'name-only' }),
    'projects/projB/.claude/settings.local.json': so({ s: 'off' }),
  });
  const e = effectiveFor(userRec, layers);
  assert.equal(e.effective, 'name-only');
  assert.deepEqual(e.otherProjects, [{ project: 'projB', layer: 'local', key: 's', value: 'off' }]);
});

test('an unparseable layer is skipped and reported', async (t) => {
  const layers = await layersFor(t, { 'projects/projA/.claude/settings.json': '{nope', 'projects/projA/.claude/settings.local.json': so({ s: 'off' }) });
  assert.equal(layers.errors.length, 1);
  assert.match(layers.errors[0].message, /settings\.json/);
  assert.equal(effectiveFor(projRec, layers).effective, 'off');
});

test('values outside the CLI set are ignored', async (t) => {
  assert.equal(effectiveFor(userRec, await layersFor(t, { 'home/.claude/settings.json': so({ s: 'disabled' }) })).effective, 'on');
});

// Invariant: a synced skill is decided by its namespaced key, which beats the bare alias whichever layer each is in;
// the bare alias is dropped when a user skill reserves the name.
const syncedRec = { source: 'synced', dirName: 's', owner: {} };
test('overrideKeysOf: namespaced first, bare alias unless a user skill reserves the name', () => {
  assert.deepEqual(overrideKeysOf(userRec), ['s']);
  assert.deepEqual(overrideKeysOf(syncedRec, new Set()), ['anthropic-skills:s', 's']);
  assert.deepEqual(overrideKeysOf(syncedRec, new Set(['s'])), ['anthropic-skills:s']);
});

test('synced: namespaced beats bare across layers; bare alone applies', async (t) => {
  const keys = overrideKeysOf(syncedRec);
  const eff = async (files) => effectiveFor(syncedRec, await layersFor(t, files), keys);
  assert.equal((await eff({ 'home/.claude/settings.json': so({ 'anthropic-skills:s': 'on', s: 'off' }) })).effective, 'on');
  assert.equal((await eff({ 'home/.claude/settings.json': so({ 'anthropic-skills:s': 'off', s: 'on' }) })).effective, 'off');
  assert.equal((await eff({ 'home/.claude/settings.json': so({ s: 'off' }) })).effective, 'off');
  assert.equal((await eff({})).effective, 'on');
});

test('synced: a policy alias value raises the result only when policy lacks the namespaced key', async (t) => {
  const keys = overrideKeysOf(syncedRec);
  const raised = effectiveFor(syncedRec, await layersFor(t, {
    'home/.claude/settings.json': so({ 'anthropic-skills:s': 'on' }),
    'managed/managed-settings.json': so({ s: 'off' }),
  }), keys);
  assert.equal(raised.effective, 'off');
  assert.equal(raised.lockedByPolicy, true);
  const kept = effectiveFor(syncedRec, await layersFor(t, {
    'home/.claude/settings.json': so({ 'anthropic-skills:s': 'off' }),
    'managed/managed-settings.json': so({ 'anthropic-skills:s': 'on', s: 'off' }),
  }), keys);
  assert.equal(kept.effective, 'on', 'policy sets the namespaced key, so its alias does not raise');
});
