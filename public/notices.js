import { h } from './dom.js';

// When a change reaches sessions, by where the skill lives.
export function pickupNotice(skill) {
  switch (skill.source) {
    case 'user': return 'Running sessions pick this up within seconds — Claude Code watches skill folders. If ~/.claude/skills did not exist when a session started, only new sessions see it.';
    case 'project': return 'Running sessions pick this up within seconds — Claude Code watches skill folders. If this project had no .claude/skills folder when a session started, only new sessions see it.';
    case 'cc-core':
    case 'cc-plugin': return 'Fixed per session at creation; new sessions get changes.';
    case 'convention': return 'Regenerated each time a session launches.';
    case 'host-plugin': return 'Managed by the Claude Code plugin it ships with.';
    case 'synced': return 'Synced from claude.ai.';
    default: return null;
  }
}

export const TOGGLE_NOTICE = 'Claude Code reloads settings in running sessions; new sessions always get it.';

export const projectWriteNotice = (project) => `Written to the main checkout of ${project} (uncommitted). Worktree sessions see it once it's merged into their branch.`;

// The warning after a project write left the main checkout dirty; null when it didn't.
export function gitNotice(project, git) {
  if (!git) return null;
  if (git.dirty === null) return `Couldn't check git status for ${project}; if ${git.path} is now uncommitted, commit it, or cc merges into this project will be refused.`;
  if (!git.dirty) return null;
  return `${project}'s main checkout now has an uncommitted change (${git.path}, ${git.status}): commit it, or cc merges into this project will be refused.`;
}

export const notice = (kind, ...children) => h('div', { className: `notice notice-${kind}`, role: kind === 'error' ? 'alert' : undefined }, ...children);
