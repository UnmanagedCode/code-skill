import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateSkillName } from '../../shared/names.js';
import { refuse } from './errors.js';

export const WRITABLE_SCOPES = Object.freeze(['user', 'project']);

const inside = (root, p) => {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const lstatOrNull = async (p) => {
  try { return await fs.lstat(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};

// Write routes accept only {scope, project?, name}; anything else is read-only.
export function assertWritableScope(scope) {
  if (!WRITABLE_SCOPES.includes(scope)) refuse('READ_ONLY_SOURCE', 403, `skills from "${scope}" are read-only here; only your own (user) and project skills can be changed`);
}

// A registered, local cc project, looked up by exact name. The client never sends a path.
export async function resolveLocalProject(conductor, name) {
  if (typeof name !== 'string' || name === '') refuse('UNKNOWN_PROJECT', 400, 'a project name is required for project scope');
  const row = (await conductor.listProjects()).find((p) => p.name === name);
  if (!row) refuse('UNKNOWN_PROJECT', 404, `no registered project named "${name}"`);
  if (row.system !== 'local' || typeof row.path !== 'string') refuse('PROJECT_NOT_LOCAL', 400, `project "${name}" is not on this machine`);
  return row;
}

// Resolves where a user/project skill lives, enforcing containment:
// the skills base must really lie inside its owner root, the skill folder
// must be a real directory directly under it, SKILL.md a regular file.
// `create: true` makes the base folder first (refusing a symlinked .claude).
// → { root, base, dir, skillMd, exists, projectPath? }
export async function resolveSkillTarget({ scope, project, name }, { config, conductor }, { create = false } = {}) {
  assertWritableScope(scope);
  const nameCheck = validateSkillName(name);
  if (!nameCheck.ok) refuse(nameCheck.code, 400, nameCheck.message);

  let root;
  let base;
  let projectPath;
  if (scope === 'user') {
    root = config.claudeDir;
    base = path.join(root, 'skills');
  } else {
    projectPath = (await resolveLocalProject(conductor, project)).path;
    root = projectPath;
    const dotClaude = path.join(root, '.claude');
    const st = await lstatOrNull(dotClaude);
    if (st?.isSymbolicLink()) refuse('PATH_ESCAPE', 400, `${dotClaude} is a symlink; refusing to write through it`);
    base = path.join(dotClaude, 'skills');
  }
  if (create) {
    try {
      await fs.mkdir(base, { recursive: true });
    } catch (e) {
      if (e.code === 'EEXIST' || e.code === 'ENOTDIR' || e.code === 'ENOENT') refuse('SKILLS_DIR_UNUSABLE', 409, `${base} is not a usable folder (a dangling symlink or a file); fix it by hand first`);
      throw e;
    }
  }

  let realRoot;
  let realBase;
  try {
    realRoot = await fs.realpath(root);
    realBase = await fs.realpath(base);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return { root, base, dir: path.join(base, name), skillMd: path.join(base, name, 'SKILL.md'), exists: false, projectPath };
  }
  if (!inside(realRoot, realBase)) refuse('PATH_ESCAPE', 400, `${base} resolves outside ${root}`);

  const dir = path.join(base, name);
  const skillMd = path.join(dir, 'SKILL.md');
  const dirStat = await lstatOrNull(dir);
  if (dirStat) {
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) refuse('SYMLINK_REFUSED', 400, `${dir} is not a real directory`);
    if (path.dirname(await fs.realpath(dir)) !== realBase) refuse('PATH_ESCAPE', 400, `${dir} resolves outside ${base}`);
    const mdStat = await lstatOrNull(skillMd);
    if (mdStat && (mdStat.isSymbolicLink() || !mdStat.isFile())) refuse('SYMLINK_REFUSED', 400, `${skillMd} is not a regular file`);
  }
  return { root, base, dir, skillMd, exists: Boolean(dirStat), projectPath };
}
