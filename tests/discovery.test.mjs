import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depsFor } from './helpers.mjs';
import { skillMd, ORG, ACCT } from './fixtures/roots.mjs';
import * as hostUser from '../src/discovery/hostUser.js';
import * as project from '../src/discovery/project.js';
import * as synced from '../src/discovery/synced.js';
import * as hostPlugins from '../src/discovery/hostPlugins.js';
import * as ccCore from '../src/discovery/ccCore.js';
import * as ccPlugins from '../src/discovery/ccPlugins.js';
import * as convention from '../src/discovery/convention.js';

const ctxOf = (env, warnings) => ({
  ...env.deps,
  warn: (source, message) => warnings.push({ source, message }),
  localProjects: async () => (await env.deps.conductor.listProjects()).filter((p) => p.system === 'local'),
});

async function run(t, mod, spec, conductor) {
  const env = await depsFor(t, spec, conductor);
  const warnings = [];
  return { records: await mod.discover(ctxOf(env, warnings)), warnings, env };
}
const names = (records) => records.map((r) => r.invokeName).sort();
const plugin = (name) => ({ name, version: '1.0.0' });

// Invariant: the user source is exactly what the CLI loads from ~/.claude/skills, and never follows links out.
test('user: finds skills/<n>/SKILL.md; skips synced/, dot-dirs, folders without SKILL.md, symlinked folders', async (t) => {
  const { records } = await run(t, hostUser, {
    files: {
      'home/.claude/skills/alpha/SKILL.md': skillMd('alpha', 'Alpha'),
      'home/.claude/skills/.hidden/SKILL.md': skillMd('hidden', 'H'),
      'home/.claude/skills/empty/notes.md': 'no skill',
      'home/.claude/skills/synced/x_y/s/SKILL.md': skillMd('s', 'S'),
      'elsewhere/linked/SKILL.md': skillMd('linked', 'L'),
    },
    symlinks: { 'home/.claude/skills/linked': 'elsewhere/linked' },
  });
  assert.deepEqual(names(records), ['alpha']);
  const [a] = records;
  assert.equal(a.id, 'user:~:alpha');
  assert.equal(a.writable, true);
  assert.equal(a.toggleable, true);
  assert.equal(a.namespace, null);
});

test('user: name ≠ folder and broken frontmatter become warnings, not failures', async (t) => {
  const { records } = await run(t, hostUser, {
    files: { 'home/.claude/skills/one/SKILL.md': skillMd('other', 'x'), 'home/.claude/skills/two/SKILL.md': 'no frontmatter' },
  });
  assert.match(records.find((r) => r.dirName === 'one').warnings.join(), /≠ directory/);
  assert.match(records.find((r) => r.dirName === 'two').warnings.join(), /frontmatter: missing/);
});

// Invariant: project skills come from cc's project list, not a directory walk.
test('project: only local /api/projects rows; unregistered dirs ignored', async (t) => {
  const { records } = await run(t, project, {
    files: {
      'projects/projA/.claude/skills/pa/SKILL.md': skillMd('pa', 'A'),
      'projects/stray/.claude/skills/stray/SKILL.md': skillMd('stray', 'S'),
    },
  });
  assert.deepEqual(names(records), ['pa']);
  assert.equal(records[0].id, 'project:projA:pa');
  assert.equal(records[0].owner.project, 'projA');
});

test('project: non-local rows are skipped', async (t) => {
  const env = await depsFor(t, { files: { 'projects/projA/.claude/skills/pa/SKILL.md': skillMd('pa', 'A') } });
  env.fake.state.projects = [{ ...env.roots.projects[0], system: 'docker-x' }];
  assert.deepEqual(await project.discover(ctxOf(env, [])), []);
});

// Invariant: synced skills match the CLI's listing for the signed-in account (F10).
test('synced: bucket from .claude.json oauthAccount, namespace anthropic-skills', async (t) => {
  const { records } = await run(t, synced, {
    files: {
      'home/.claude.json': { oauthAccount: { organizationUuid: ORG, accountUuid: ACCT } },
      [`home/.claude/skills/synced/${ORG}_${ACCT}/skill-creator/SKILL.md`]: skillMd('skill-creator', 'Create skills'),
      'home/.claude/skills/synced/other_bucket/nope/SKILL.md': skillMd('nope', 'N'),
    },
  });
  assert.deepEqual(names(records), ['anthropic-skills:skill-creator']);
  assert.equal(records[0].writable, false);
});

test('synced: no account → no records, no error', async (t) => {
  assert.deepEqual((await run(t, synced, { files: { 'home/.claude.json': {} } })).records, []);
});

// Invariant: host plugins follow installed_plugins.json v2 and enabledPlugins (F11).
test('host-plugin: namespace from plugin.json; enabled from enabledPlugins per scope', async (t) => {
  const { records } = await run(t, hostPlugins, {
    files: {
      'home/.claude/plugins/installed_plugins.json': {
        version: 2,
        plugins: {
          'tools@mkt': [{ scope: 'user', installPath: '__ROOT__/home/.claude/plugins/cache/tools' }],
          'off@mkt': [{ scope: 'user', installPath: '__ROOT__/home/.claude/plugins/cache/off' }],
          'proj@mkt': [{ scope: 'local', projectPath: '__ROOT__/projects/projA', installPath: '__ROOT__/home/.claude/plugins/cache/proj' }],
        },
      },
      'home/.claude/plugins/cache/tools/.claude-plugin/plugin.json': plugin('toolbox'),
      'home/.claude/plugins/cache/tools/skills/hammer/SKILL.md': skillMd('hammer', 'Hit'),
      'home/.claude/plugins/cache/off/skills/saw/SKILL.md': skillMd('saw', 'Cut'),
      'home/.claude/plugins/cache/proj/skills/drill/SKILL.md': skillMd('drill', 'Bore'),
      'home/.claude/settings.json': { enabledPlugins: { 'tools@mkt': true, 'off@mkt': false } },
      'projects/projA/.claude/settings.local.json': { enabledPlugins: { 'proj@mkt': true } },
    },
  });
  assert.deepEqual(names(records), ['off:saw', 'proj:drill', 'toolbox:hammer']);
  const by = Object.fromEntries(records.map((r) => [r.invokeName, r]));
  assert.equal(by['toolbox:hammer'].enabled, true);
  assert.equal(by['off:saw'].enabled, false);
  assert.equal(by['proj:drill'].enabled, true);
  assert.equal(by['proj:drill'].owner.scope, 'local');
  assert.equal(by['toolbox:hammer'].writable, false);
});

// Invariant: cc core skills are namespaced and never editable.
test('cc-core: namespaced by plugin.json, read-only', async (t) => {
  const { records } = await run(t, ccCore, {
    files: { 'cc/claude-plugin/.claude-plugin/plugin.json': plugin('code-conductor'), 'cc/claude-plugin/skills/scripting/SKILL.md': skillMd('scripting', 'Script') },
  });
  assert.deepEqual(names(records), ['code-conductor:scripting']);
  assert.deepEqual([records[0].writable, records[0].toggleable], [false, false]);
});

// Invariant: cc plugin skills mirror cc's claudePluginDirs selection.
test('cc-plugin: enabled+local+error-free only; worktree activeVersion; .. and missing plugin.json skipped', async (t) => {
  const pluginFiles = (dir, ns, claudePlugin = 'claude') => ({
    [`${dir}/conductor.plugin.json`]: { id: ns, claudePlugin },
    [`${dir}/claude/.claude-plugin/plugin.json`]: plugin(ns),
    [`${dir}/claude/skills/${ns}-skill/SKILL.md`]: skillMd(`${ns}-skill`, ns),
  });
  const env = await depsFor(t, {
    files: {
      ...pluginFiles('projects/pmain', 'pmain'),
      ...pluginFiles('wt/pwt', 'pwt'),
      ...pluginFiles('projects/pwt', 'pwt-main'),
      ...pluginFiles('projects/pdis', 'pdis'),
      ...pluginFiles('projects/perr', 'perr'),
      ...pluginFiles('projects/pesc', 'pesc', '../pmain/claude'),
      'projects/pnojson/conductor.plugin.json': { id: 'pnojson', claudePlugin: 'claude' },
      'projects/pnojson/claude/skills/x/SKILL.md': skillMd('x', 'x'),
    },
  });
  const warnings = [];
  const root = env.roots.root;
  const proj = (name) => ({ name, path: `${root}/projects/${name}`, system: 'local' });
  env.fake.state.projects = ['pmain', 'pwt', 'pdis', 'perr', 'pesc', 'pnojson'].map(proj);
  env.fake.state.worktrees = { pwt: [{ worktreeName: 'v2', worktreePath: `${root}/wt/pwt` }] };
  const row = (id, extra = {}) => ({ id, project: id, system: 'local', enabled: true, errors: [], activeVersion: { type: 'main' }, ...extra });
  env.fake.state.plugins = [row('pmain'), row('pwt', { activeVersion: { type: 'worktree', name: 'v2' } }), row('pdis', { enabled: false }), row('perr', { errors: ['bad'] }), row('pesc'), row('pnojson')];
  const records = await ccPlugins.discover(ctxOf(env, warnings));
  assert.deepEqual(names(records), ['pmain:pmain-skill', 'pwt:pwt-skill']);
  assert.equal(records.find((r) => r.namespace === 'pmain').id, 'cc-plugin:pmain:pmain-skill');
  const messages = warnings.map((w) => w.message);
  assert.ok(messages.some((m) => /pesc.*leaves its checkout/.test(m)));
  assert.ok(messages.some((m) => /pnojson.*no \.claude-plugin\/plugin\.json/.test(m)));
});

// Invariant: convention skills are the union across live per-session folders, with attribution (§2).
test('convention: identical copies merge with their sessions; differing content stays separate', async (t) => {
  const ns = (inst, body) => ({
    [`projects/.code-conductor/convention-skills/${inst}/cc-conductor/.claude-plugin/plugin.json`]: plugin('cc-conductor'),
    [`projects/.code-conductor/convention-skills/${inst}/cc-conductor/skills/review/SKILL.md`]: skillMd('review', 'Review', { body }),
  });
  const { records } = await run(t, convention, { files: { ...ns('i1', 'same'), ...ns('i2', 'same'), ...ns('i3', 'different') } }, {
    instances: [{ id: 'i1', displayLabel: 'Worker one', status: 'running' }, { id: 'i2', title: 'Two', status: 'idle' }],
  });
  assert.equal(records.length, 2);
  const merged = records.find((r) => r.sessions.length === 2);
  assert.deepEqual(merged.sessions, [{ instanceId: 'i1', label: 'Worker one', status: 'running' }, { instanceId: 'i2', label: 'Two', status: 'idle' }]);
  assert.match(merged.id, /^convention:cc-conductor#[0-9a-f]{8}:review$/);
  const lone = records.find((r) => r.sessions.length === 1);
  assert.deepEqual(lone.sessions, [{ instanceId: 'i3', label: '(no instance row)', status: null }]);
  assert.equal(merged.invokeName, 'cc-conductor:review');
  assert.deepEqual([merged.writable, merged.toggleable], [false, false]);
});
