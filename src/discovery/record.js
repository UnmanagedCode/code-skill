import { promises as fs } from 'node:fs';
import { parseSkillMd, skillFields } from '../skillFile.js';
import { sha256 } from '../fsx/atomicWrite.js';

export const WRITABLE_SOURCES = Object.freeze(['user', 'project']);

// The name Claude Code knows a skill by (and keys skillOverrides on): frontmatter `name`, else the folder name.
export const skillNameOf = (record) => record.name || record.dirName;

// Reads one SKILL.md into a SkillRecord (override and cost are attached later by the inventory).
export async function readSkillRecord({ source, ownerKey, owner, namespace = null, dirName, skillMdPath }) {
  const bytes = await fs.readFile(skillMdPath);
  const parsed = parseSkillMd(bytes.toString('utf8'));
  const fields = skillFields(parsed.frontmatter);
  const warnings = [...parsed.errors];
  const writable = WRITABLE_SOURCES.includes(source);
  const nameMismatch = Boolean(fields.name) && fields.name !== dirName;
  if (nameMismatch) warnings.push(`name "${fields.name}" ≠ directory "${dirName}"${writable ? ': enable/disable is off until they match' : ''}`);
  if (!fields.description) warnings.push('no description: the listing shows only the name');
  const skillName = fields.name || dirName;
  return {
    id: `${source}:${ownerKey}:${dirName}`,
    source,
    owner,
    writable,
    toggleable: writable && !nameMismatch,
    dirName,
    name: fields.name,
    invokeName: namespace ? `${namespace}:${skillName}` : skillName,
    namespace,
    path: skillMdPath,
    description: fields.description,
    whenToUse: fields.whenToUse,
    disableModelInvocation: fields.disableModelInvocation,
    userInvocable: fields.userInvocable,
    override: null,
    cost: null,
    warnings,
    sha: sha256(bytes),
  };
}

// Records for every skill folder in `dirs`, with shared owner fields. An
// unreadable SKILL.md is reported through `warn(source, message)` and skipped.
export async function readAll(dirs, fields, warn) {
  const out = [];
  for (const d of dirs) {
    try {
      out.push(await readSkillRecord({ ...fields, dirName: d.dirName, skillMdPath: d.skillMdPath }));
    } catch (e) {
      warn(fields.source, `${d.skillMdPath}: ${e.message}`);
    }
  }
  return out;
}
