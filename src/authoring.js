import { promises as fs } from 'node:fs';
import { resolveSkillTarget, assertWritableScope } from './safety/resolve.js';
import { refuse } from './safety/errors.js';
import { validateSkillName } from '../shared/names.js';
import { writeFileAtomic, sha256 } from './fsx/atomicWrite.js';
import { buildSkillMd, composeSkillMd, validateFrontmatter, parseSkillMd, skillFields } from './skillFile.js';
import { setSkillOverride } from './overrides/settingsFile.js';
import { readLayers, userSettingsFile, localSettingsFile } from './overrides/layers.js';
import { effectiveFor } from './overrides/effective.js';
import { moveToTrash, inspectEntry, takeFromTrash } from './trash.js';
import { gitReport } from './gitProbe.js';

// Create / edit / enable-disable / delete / restore for user and project
// skills. deps = { config, conductor, git }. Every path comes from
// resolveSkillTarget; project writes report their effect on the checkout's git state.

export const skillId = (scope, project, name) => `${scope}:${scope === 'user' ? '~' : project}:${name}`;

const needString = (v, what) => {
  if (typeof v !== 'string') refuse('BAD_REQUEST', 400, `${what} must be a string`);
};

const projectGit = (deps, t, absPath) => (t.projectPath ? gitReport(deps.git, t.projectPath, absPath) : null);

export async function createSkill(deps, { scope, project, name, description, body }) {
  // Everything checkable without the filesystem is checked first, so a refused create makes no folders.
  assertWritableScope(scope);
  const nameCheck = validateSkillName(name);
  if (!nameCheck.ok) refuse(nameCheck.code, 400, nameCheck.message);
  needString(body, 'body');
  if (typeof description !== 'string' || description.trim() === '') refuse('INVALID_FRONTMATTER', 400, 'description must be a non-empty string');
  const t = await resolveSkillTarget({ scope, project, name }, deps, { create: true });
  if (t.exists) refuse('EXISTS', 409, `a skill named "${name}" already exists there`);
  const text = buildSkillMd({ name, description }, body);
  try {
    await fs.mkdir(t.dir);
  } catch (e) {
    if (e.code === 'EEXIST') refuse('EXISTS', 409, `a skill named "${name}" already exists there`);
    throw e;
  }
  await writeFileAtomic(t.skillMd, text);
  return { id: skillId(scope, project, name), etag: sha256(text), git: await projectGit(deps, t, t.dir) };
}

export async function readSkillBytes(skillMd) {
  try {
    return await fs.readFile(skillMd);
  } catch (e) {
    if (e.code === 'ENOENT') refuse('NOT_FOUND', 404, 'that skill no longer exists');
    throw e;
  }
}

export async function updateSkill(deps, { scope, project, name, frontmatterText, body, baseEtag }) {
  needString(frontmatterText, 'frontmatterText');
  needString(body, 'body');
  const t = await resolveSkillTarget({ scope, project, name }, deps);
  if (!t.exists) refuse('NOT_FOUND', 404, 'that skill no longer exists');
  const current = await readSkillBytes(t.skillMd);
  if (sha256(current) !== baseEtag) refuse('STALE', 409, 'SKILL.md changed since you opened it; reload to see the new version');
  const { errors } = validateFrontmatter(frontmatterText, name);
  if (errors.length) refuse('INVALID_FRONTMATTER', 400, errors.join('; '), { errors });
  const text = composeSkillMd(frontmatterText, body);
  await writeFileAtomic(t.skillMd, text);
  return { id: skillId(scope, project, name), etag: sha256(text), git: await projectGit(deps, t, t.skillMd) };
}

async function overrideState(deps, record) {
  const local = (await deps.conductor.listProjects()).filter((p) => p.system === 'local' && typeof p.path === 'string');
  return effectiveFor(record, await readLayers(deps.config, local));
}

// Disable writes "off"; enable removes our key and writes "on" only if a lower layer still turns it off.
export async function setEnabled(deps, { scope, project, name, enabled }) {
  if (typeof enabled !== 'boolean') refuse('BAD_REQUEST', 400, 'enabled must be true or false');
  const t = await resolveSkillTarget({ scope, project, name }, deps);
  if (!t.exists) refuse('NOT_FOUND', 404, 'that skill no longer exists');
  // The CLI keys skillOverrides on the frontmatter name; toggle only when it agrees with the folder.
  const declared = skillFields(parseSkillMd((await readSkillBytes(t.skillMd)).toString('utf8')).frontmatter).name;
  if (declared && declared !== name) refuse('NAME_MISMATCH', 409, `SKILL.md names this skill "${declared}" but its folder is "${name}"; make them match before enabling or disabling it`);
  const record = { source: scope, dirName: name, name: declared, owner: { project } };
  const before = await overrideState(deps, record);
  if (before.lockedByPolicy) refuse('POLICY_LOCKED', 409, 'managed policy sets this skill; it cannot be changed here');
  const file = scope === 'user' ? userSettingsFile(deps.config) : localSettingsFile(t.projectPath);
  const opts = { containRoot: t.root };
  if (!enabled) {
    await setSkillOverride(file, name, 'off', opts);
  } else {
    await setSkillOverride(file, name, undefined, opts);
    if ((await overrideState(deps, record)).effective !== 'on') await setSkillOverride(file, name, 'on', opts);
  }
  return { override: await overrideState(deps, record), git: await projectGit(deps, t, file) };
}

export async function deleteSkill(deps, { scope, project, name }) {
  const t = await resolveSkillTarget({ scope, project, name }, deps);
  if (!t.exists) refuse('NOT_FOUND', 404, 'that skill no longer exists');
  const trashId = await moveToTrash(deps.config, { scope, project, name, dir: t.dir });
  return { trashId, git: await projectGit(deps, t, t.dir) };
}

export async function restoreSkill(deps, trashId) {
  const inspected = await inspectEntry(deps.config, trashId);
  const { meta } = inspected;
  assertWritableScope(meta.scope);
  const t = await resolveSkillTarget({ scope: meta.scope, project: meta.project, name: meta.name }, deps, { create: true });
  if (t.exists) refuse('RESTORE_CONFLICT', 409, `a skill named "${meta.name}" exists there now; rename or delete it first`);
  await takeFromTrash(inspected, t.dir);
  return { id: skillId(meta.scope, meta.project, meta.name), git: await projectGit(deps, t, t.dir) };
}
