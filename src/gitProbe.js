import { execFile as nodeExecFile } from 'node:child_process';
import path from 'node:path';

const TIMEOUT_MS = 5000;

// Classifies a path inside a project's main checkout after Code Skill wrote
// (or removed) it, because a dirty main checkout makes cc's merge_worktree
// refuse (PARENT_DIRTY). git runs via execFile, never a shell; `execFile` is
// injectable for tests.
// classify → 'tracked' | 'untracked' | 'ignored' | 'no-repo' | 'unknown'
export function createGitProbe({ execFile = nodeExecFile } = {}) {
  const run = (cwd, args) => new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { timeout: TIMEOUT_MS }, (err, _stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stderr: String(stderr ?? err?.message ?? '') });
    });
  });
  const fail = (projectPath, r) => {
    if (/not a git repository/i.test(r.stderr)) return 'no-repo';
    console.error(`code-skill: git status check failed in ${projectPath}: ${r.stderr.trim() || `exit ${r.code}`}`);
    return 'unknown';
  };
  return {
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
  };
}

// What a project-scope change did to the main checkout's git state.
// kind 'write': the path now exists; 'delete': it was removed.
// → { path, status, dirty: boolean | null }
export async function gitReport(git, projectPath, absPath, kind) {
  const status = await git.classify(projectPath, absPath);
  const dirty = status === 'unknown' ? null
    : kind === 'delete' ? status === 'tracked'
      : status === 'tracked' || status === 'untracked';
  return { path: path.relative(projectPath, absPath), status, dirty };
}
