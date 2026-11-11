import { execFile as nodeExecFile } from 'node:child_process';
import path from 'node:path';

const TIMEOUT_MS = 5000;
// Never let a repo's config run a program from these read-only probes:
// no fsmonitor hook, no untracked cache, no optional index lock writes.
const HARDEN = ['-c', 'core.fsmonitor=', '-c', 'core.untrackedCache=false'];

// Inspects a path inside a project's main checkout after Code Skill wrote (or
// removed) it, because a dirty main checkout makes cc's merge_worktree refuse
// (PARENT_DIRTY). git runs via execFile, never a shell; `execFile` is injectable.
export function createGitProbe({ execFile = nodeExecFile } = {}) {
  const run = (cwd, args) => new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...HARDEN, ...args], { timeout: TIMEOUT_MS, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? err?.message ?? '') });
    });
  });
  const fail = (projectPath, r) => {
    if (/not a git repository/i.test(r.stderr)) return 'no-repo';
    console.error(`code-skill: git check failed in ${projectPath}: ${r.stderr.trim() || `exit ${r.code}`}`);
    return 'unknown';
  };
  return {
    // → 'tracked' | 'untracked' | 'ignored' | 'no-repo' | 'unknown'
    async classify(projectPath, absPath) {
      const rel = path.relative(projectPath, absPath);
      const tracked = await run(projectPath, ['ls-files', '--error-unmatch', '--', rel]);
      if (tracked.code === 0) return 'tracked';
      if (tracked.code !== 1) return fail(projectPath, tracked);
      const ignored = await run(projectPath, ['check-ignore', '-q', '--', rel]);
      if (ignored.code === 0) return 'ignored';
      if (ignored.code === 1) return 'untracked';
      return fail(projectPath, ignored);
    },
    // Whether `git status` reports anything under the path: true / false, or null when it can't tell.
    async dirty(projectPath, absPath) {
      const r = await run(projectPath, ['status', '--porcelain', '--untracked-files=all', '--', path.relative(projectPath, absPath)]);
      if (r.code === 0) return r.stdout.trim() !== '';
      return fail(projectPath, r) === 'no-repo' ? false : null;
    },
  };
}

// What a project-scope change did to the main checkout's git state. → { path, status, dirty }
export async function gitReport(git, projectPath, absPath) {
  return { path: path.relative(projectPath, absPath), status: await git.classify(projectPath, absPath), dirty: await git.dirty(projectPath, absPath) };
}
