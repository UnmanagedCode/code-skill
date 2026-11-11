import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { makeRoots, skillMd } from './fixtures/roots.mjs';
import { createGitProbe, gitReport } from '../src/gitProbe.js';
import { boot, fakeGit } from './helpers.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' });

// Invariant: after a project write, the path is classified exactly as git sees it.
test('classify: tracked, untracked, ignored, no-repo (real git, temp repo)', async (t) => {
  const roots = await makeRoots(t, {
    files: {
      'projects/projA/.gitignore': '.claude/settings.local.json\n',
      'projects/projA/.claude/settings.local.json': '{}',
      'projects/projA/.claude/skills/tracked/SKILL.md': 'x',
      'projects/projA/.claude/skills/fresh/SKILL.md': 'y',
      'projects/projB/.claude/skills/x/SKILL.md': 'z',
    },
  });
  const repo = roots.p('projects/projA');
  git(repo, 'init', '-q');
  git(repo, 'add', '.claude/skills/tracked/SKILL.md');
  // projB sits inside the temp tree, not a repo — unless the temp dir is itself in one.
  const probe = createGitProbe();
  assert.equal(await probe.classify(repo, roots.p('projects/projA/.claude/skills/tracked/SKILL.md')), 'tracked');
  assert.equal(await probe.classify(repo, roots.p('projects/projA/.claude/skills/tracked')), 'tracked', 'a folder holding tracked files');
  assert.equal(await probe.classify(repo, roots.p('projects/projA/.claude/skills/fresh/SKILL.md')), 'untracked');
  assert.equal(await probe.classify(repo, roots.p('projects/projA/.claude/settings.local.json')), 'ignored');
  await fs.rm(roots.p('projects/projA/.claude/skills/tracked'), { recursive: true });
  assert.equal(await probe.classify(repo, roots.p('projects/projA/.claude/skills/tracked')), 'tracked', 'removed but still in the index');
  const inRepo = (() => { try { git(roots.root, 'rev-parse'); return true; } catch { return false; } })();
  if (!inRepo) assert.equal(await probe.classify(roots.p('projects/projB'), roots.p('projects/projB/.claude/skills/x/SKILL.md')), 'no-repo');
});

// Invariant: git runs via execFile with an argument array (no shell), relative to the project.
test('git is invoked as execFile("git", [-C, project, …]) with a relative path', async () => {
  const calls = [];
  const execFile = (file, args, opts, cb) => { calls.push([file, args]); cb(null, '', ''); };
  assert.equal(await createGitProbe({ execFile }).classify('/p', '/p/.claude/skills/a'), 'tracked');
  assert.deepEqual(calls, [['git', ['-C', '/p', 'ls-files', '--error-unmatch', '--', '.claude/skills/a']]]);
});

// Invariant: "dirty" = what makes cc's merge refuse PARENT_DIRTY.
test('dirty: a write is dirty unless ignored; a delete only if tracked', async () => {
  const report = (status, kind) => gitReport({ classify: async () => status }, '/p', '/p/x', kind);
  assert.deepEqual(await report('tracked', 'write'), { path: 'x', status: 'tracked', dirty: true });
  assert.equal((await report('untracked', 'write')).dirty, true);
  assert.equal((await report('ignored', 'write')).dirty, false);
  assert.equal((await report('no-repo', 'write')).dirty, false);
  assert.equal((await report('unknown', 'write')).dirty, null);
  assert.equal((await report('tracked', 'delete')).dirty, true);
  assert.equal((await report('untracked', 'delete')).dirty, false);
});

// Invariant: every project-scope write route reports git state; user-scope writes don't.
test('project writes carry a git report; user writes carry null', async (t) => {
  const g = fakeGit('untracked');
  const app = await boot(t, { files: { 'home/.claude/skills/u/SKILL.md': skillMd('u', 'u') } }, { git: g });
  const create = await app.json('POST', '/api/skills', { scope: 'project', project: 'projA', name: 'p', description: 'd', body: '' });
  assert.deepEqual(create.body.git, { path: '.claude/skills/p', status: 'untracked', dirty: true });
  g.status = 'ignored';
  const toggle = await app.json('PUT', '/api/skills/enabled', { scope: 'project', project: 'projA', name: 'p', enabled: false });
  assert.deepEqual(toggle.body.git, { path: '.claude/settings.local.json', status: 'ignored', dirty: false });
  const detail = await app.json('GET', '/api/skills/detail?id=project:projA:p');
  g.status = 'tracked';
  const edit = await app.json('PUT', '/api/skills/content', { scope: 'project', project: 'projA', name: 'p', frontmatterText: 'name: p\ndescription: e', body: '', baseEtag: detail.body.etag });
  assert.equal(edit.body.git.path, '.claude/skills/p/SKILL.md');
  assert.equal(edit.body.git.dirty, true);
  const del = await app.json('POST', '/api/skills/delete', { scope: 'project', project: 'projA', name: 'p' });
  assert.equal(del.body.git.dirty, true);
  const restore = await app.json('POST', `/api/trash/${del.body.trashId}/restore`);
  assert.equal(restore.body.git.status, 'tracked');
  assert.equal((await app.json('PUT', '/api/skills/enabled', { scope: 'user', name: 'u', enabled: false })).body.git, null);
  assert.ok(g.calls.every((c) => c.projectPath === app.roots.p('projects/projA')));
});
