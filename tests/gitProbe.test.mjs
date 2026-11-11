import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { makeRoots, skillMd } from './fixtures/roots.mjs';
import { createGitProbe, gitReport } from '../src/gitProbe.js';
import { boot, fakeGit } from './helpers.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { stdio: 'pipe' });
const inGitRepo = (dir) => { try { execFileSync('git', ['-C', dir, 'rev-parse'], { stdio: 'pipe' }); return true; } catch { return false; } };

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
  const probe = createGitProbe();
  assert.equal(await probe.classify(repo, roots.p('projects/projA/.claude/skills/tracked/SKILL.md')), 'tracked');
  assert.equal(await probe.classify(repo, roots.p('projects/projA/.claude/skills/tracked')), 'tracked', 'a folder holding tracked files');
  assert.equal(await probe.classify(repo, roots.p('projects/projA/.claude/skills/fresh/SKILL.md')), 'untracked');
  assert.equal(await probe.classify(repo, roots.p('projects/projA/.claude/settings.local.json')), 'ignored');
  await fs.rm(roots.p('projects/projA/.claude/skills/tracked'), { recursive: true });
  assert.equal(await probe.classify(repo, roots.p('projects/projA/.claude/skills/tracked')), 'tracked', 'removed but still in the index');
  if (!inGitRepo(roots.root)) {
    assert.equal(await probe.classify(roots.p('projects/projB'), roots.p('projects/projB/.claude/skills/x/SKILL.md')), 'no-repo');
    assert.equal(await probe.dirty(roots.p('projects/projB'), roots.p('projects/projB/.claude/skills/x/SKILL.md')), false);
  }
});

// Invariant: "dirty" is what `git status` reports for the path — exactly what makes cc's merge refuse PARENT_DIRTY.
test('dirty comes from git status: untracked and modified are dirty; ignored and unchanged-tracked are not', async (t) => {
  const roots = await makeRoots(t, {
    files: {
      'projects/projA/.gitignore': 'ignored.json\n',
      'projects/projA/ignored.json': '{}',
      'projects/projA/.claude/skills/kept/SKILL.md': 'same',
      'projects/projA/.claude/skills/new/SKILL.md': 'n',
    },
  });
  const repo = roots.p('projects/projA');
  git(repo, 'init', '-q');
  git(repo, 'add', '.gitignore', '.claude/skills/kept');
  git(repo, 'commit', '-q', '-m', 'init');
  const probe = createGitProbe();
  const d = (rel) => probe.dirty(repo, roots.p('projects/projA', rel));
  assert.equal(await d('.claude/skills/kept'), false);
  assert.equal(await d('ignored.json'), false);
  assert.equal(await d('.claude/skills/new'), true);
  await fs.writeFile(roots.p('projects/projA/.claude/skills/kept/SKILL.md'), 'changed');
  assert.equal(await d('.claude/skills/kept'), true);
});

// Invariant: restoring a committed skill byte-identically leaves the main checkout clean.
test('delete then restore a committed project skill: dirty, then dirty:false (real git through the API)', async (t) => {
  const app = await boot(t, { files: { 'projects/projA/.claude/skills/p/SKILL.md': skillMd('p', 'committed') } }, { git: createGitProbe() });
  const repo = app.roots.p('projects/projA');
  git(repo, 'init', '-q');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  const del = await app.json('POST', '/api/skills/delete', { scope: 'project', project: 'projA', name: 'p' });
  assert.deepEqual(del.body.git, { path: '.claude/skills/p', status: 'tracked', dirty: true });
  const back = await app.json('POST', `/api/trash/${del.body.trashId}/restore`);
  assert.deepEqual(back.body.git, { path: '.claude/skills/p', status: 'tracked', dirty: false });
});

// Invariant: the probe never runs a program the repository's config names (core.fsmonitor).
test('a repo-configured core.fsmonitor hook is not run by the probe', async (t) => {
  const roots = await makeRoots(t, { files: { 'projects/projA/.claude/skills/a/SKILL.md': 'a', 'hook.sh': '#!/bin/sh\ntouch "$(dirname "$0")/fsmonitor-ran"\nexit 1\n' } });
  const repo = roots.p('projects/projA');
  await fs.chmod(roots.p('hook.sh'), 0o755);
  git(repo, 'init', '-q');
  git(repo, 'add', '.');
  git(repo, 'config', 'core.fsmonitor', roots.p('hook.sh'));
  const probe = createGitProbe();
  await gitReport(probe, repo, roots.p('projects/projA/.claude/skills/a'));
  await assert.rejects(fs.access(roots.p('fsmonitor-ran')), 'the probe ran the fsmonitor hook');
  // Liveness: plain git status in this repo does run it.
  try { git(repo, 'status', '--porcelain'); } catch { /* the hook exits 1; git may complain */ }
  await fs.access(roots.p('fsmonitor-ran'));
});

// Invariant: git runs via execFile with an argument array (no shell), hardened, relative to the project.
test('git is invoked as execFile("git", [-C, project, hardening…, args]) with GIT_OPTIONAL_LOCKS=0', async () => {
  const calls = [];
  const execFile = (file, args, opts, cb) => { calls.push([file, args, opts.env.GIT_OPTIONAL_LOCKS]); cb(null, ' M x\n', ''); };
  const probe = createGitProbe({ execFile });
  assert.equal(await probe.classify('/p', '/p/.claude/skills/a'), 'tracked');
  assert.equal(await probe.dirty('/p', '/p/.claude/skills/a'), true);
  assert.deepEqual(calls, [
    ['git', ['-C', '/p', '-c', 'core.fsmonitor=', '-c', 'core.untrackedCache=false', 'ls-files', '--error-unmatch', '--', '.claude/skills/a'], '0'],
    ['git', ['-C', '/p', '-c', 'core.fsmonitor=', '-c', 'core.untrackedCache=false', 'status', '--porcelain', '--untracked-files=all', '--', '.claude/skills/a'], '0'],
  ]);
});

// Invariant: every project-scope write route reports git state; user writes don't.
test('project writes carry a git report; user writes carry null', async (t) => {
  const g = fakeGit('untracked', true);
  const app = await boot(t, { files: { 'home/.claude/skills/u/SKILL.md': skillMd('u', 'u') } }, { git: g });
  const create = await app.json('POST', '/api/skills', { scope: 'project', project: 'projA', name: 'p', description: 'd', body: '' });
  assert.deepEqual(create.body.git, { path: '.claude/skills/p', status: 'untracked', dirty: true });
  g.status = 'ignored';
  g.dirtyValue = false;
  const toggle = await app.json('PUT', '/api/skills/enabled', { scope: 'project', project: 'projA', name: 'p', enabled: false });
  assert.deepEqual(toggle.body.git, { path: '.claude/settings.local.json', status: 'ignored', dirty: false });
  const detail = await app.json('GET', '/api/skills/detail?id=project:projA:p');
  g.status = 'tracked';
  g.dirtyValue = true;
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
