import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.mjs';
import { skillMd } from './fixtures/roots.mjs';

const FILES = {
  'home/.claude/skills/shared/SKILL.md': skillMd('shared', 'User copy'),
  'home/.claude/skills/solo/SKILL.md': skillMd('solo', 'Only mine', { whenToUse: 'when alone' }),
  'home/.claude/skills/quiet/SKILL.md': skillMd('quiet', 'Hidden', { extra: 'disable-model-invocation: true\n' }),
  'home/.claude/skills/long/SKILL.md': skillMd('long', 'x'.repeat(2000)),
  'projects/projA/.claude/skills/shared/SKILL.md': skillMd('shared', 'Project copy'),
  'projects/projA/.claude/skills/twin/SKILL.md': skillMd('twin', 'A twin'),
  'projects/projB/.claude/skills/twin/SKILL.md': skillMd('twin', 'B twin'),
  'cc/claude-plugin/.claude-plugin/plugin.json': { name: 'code-conductor' },
  'cc/claude-plugin/skills/core/SKILL.md': skillMd('core', 'Core skill'),
  'home/.claude/settings.json': { skillOverrides: { solo: 'name-only' } },
};

// Invariant: per-owner totals add up to the per-skill costs, and each skill's cost reflects its override.
test('totals per owner equal the sum of their skills', async (t) => {
  const app = await boot(t, { files: FILES });
  const { body: inv } = await app.json('GET', '/api/inventory');
  const byKey = Object.fromEntries(inv.totals.map((x) => [x.key, x]));
  for (const total of inv.totals) {
    const mine = inv.skills.filter((s) => s.id.startsWith(`${total.key}:`));
    assert.equal(total.chars, mine.reduce((a, s) => a + s.cost.chars, 0), total.key);
    assert.equal(total.count, mine.length, total.key);
  }
  assert.deepEqual(Object.keys(byKey).sort(), ['cc-core:code-conductor', 'project:projA', 'project:projB', 'user:~']);
  const s = Object.fromEntries(inv.skills.map((x) => [x.id, x]));
  assert.equal(s['user:~:solo'].cost.listing, 'name-only');
  assert.equal(s['user:~:solo'].cost.chars, 'solo'.length + 2);
  assert.equal(s['user:~:quiet'].cost.listing, 'hidden');
  assert.equal(s['user:~:long'].cost.truncated, true);
  assert.ok(s['user:~:long'].warnings.some((w) => /truncated at 1536/.test(w)));
  assert.equal(s['cc-core:code-conductor:core'].override, null);
});

// Invariant: duplicates are flagged only when the two can meet in one session.
test('user vs project same name → shadowed; two projects with one name → not a duplicate', async (t) => {
  const app = await boot(t, { files: FILES });
  const { body: inv } = await app.json('GET', '/api/inventory');
  assert.deepEqual(inv.duplicates, [{ invokeName: 'shared', ids: ['user:~:shared', 'project:projA:shared'], note: 'user skill wins; project copy is shadowed' }]);
  assert.ok(inv.skills.find((x) => x.id === 'project:projA:shared').warnings.includes('shadowed by user skill'));
});

// Invariant: a failing source degrades visibly; the rest of the inventory still loads.
test('a failing source → sourceErrors entry, other sources listed', async (t) => {
  const app = await boot(t, { files: { ...FILES, 'home/.claude/plugins/installed_plugins.json': '{broken' } });
  const { status, body: inv } = await app.json('GET', '/api/inventory');
  assert.equal(status, 200);
  assert.deepEqual(inv.sourceErrors.map((e) => e.source), ['host-plugin']);
  assert.ok(inv.skills.some((x) => x.id === 'user:~:solo'));
});

test('cc unreachable → 502 CONDUCTOR_UNREACHABLE', async (t) => {
  const app = await boot(t, { files: FILES });
  await app.fake.close();
  const res = await app.json('GET', '/api/inventory');
  assert.equal(res.status, 502);
  assert.equal(res.body.code, 'CONDUCTOR_UNREACHABLE');
});

// Invariant: the budget is shown for 200k and 1M plus every live session's context size.
test('budget contexts: 200k, 1M and live contextWindowTokens; baseline = every-session sources', async (t) => {
  const app = await boot(t, { files: FILES }, { conductor: { instances: [{ id: 'a', contextWindowTokens: 1_000_000 }, { id: 'b', contextWindowTokens: 500_000 }, { id: 'c' }] } });
  const { body: inv } = await app.json('GET', '/api/inventory');
  assert.deepEqual(inv.budget.contexts, [
    { contextTokens: 200_000, chars: 8000, live: false },
    { contextTokens: 500_000, chars: 20_000, live: true },
    { contextTokens: 1_000_000, chars: 40_000, live: true },
  ]);
  const every = inv.skills.filter((s) => ['user', 'cc-core'].includes(s.source) && s.cost.chars > 0);
  assert.equal(inv.budget.baseline.count, every.length);
  assert.equal(inv.budget.baseline.chars, every.reduce((a, s) => a + s.cost.chars, 0) + every.length - 1);
});

test('convention variants: one duplicate "differs between sessions"; namespace total counts one variant', async (t) => {
  const conv = (inst, desc) => ({
    [`projects/.code-conductor/convention-skills/${inst}/cc-x/.claude-plugin/plugin.json`]: { name: 'cc-x' },
    [`projects/.code-conductor/convention-skills/${inst}/cc-x/skills/r/SKILL.md`]: skillMd('r', desc),
  });
  const app = await boot(t, { files: { ...conv('i1', 'short'), ...conv('i2', 'a longer description') } });
  const { body: inv } = await app.json('GET', '/api/inventory');
  assert.equal(inv.duplicates.length, 1);
  assert.equal(inv.duplicates[0].note, 'differs between sessions');
  const total = inv.totals.find((x) => x.key === 'convention:cc-x');
  assert.equal(total.count, 1);
  assert.equal(total.chars, Math.max(...inv.skills.filter((s) => s.source === 'convention').map((s) => s.cost.chars)));
});
