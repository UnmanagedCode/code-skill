import { promises as fs } from 'node:fs';
import { parseSkillMd, skillFields } from '../skillFile.js';
import { sha256 } from '../fsx/atomicWrite.js';

export const WRITABLE_SOURCES = Object.freeze(['user', 'project']);

// Reads one SKILL.md into a SkillRecord (override and cost are attached later by the inventory).
export async function readSkillRecord({ source, ownerKey, owner, namespace = null, dirName, skillMdPath }) {
  const bytes = await fs.readFile(skillMdPath);
  const parsed = parseSkillMd(bytes.toString('utf8'));
  const fields = skillFields(parsed.frontmatter);
  const warnings = [...parsed.errors];
  if (fields.name !== null && fields.name !== dirName) warnings.push(`name "${fields.name}" ≠ directory "${dirName}"`);
  if (!fields.description) warnings.push('no description: the listing shows only the name');
  const writable = WRITABLE_SOURCES.includes(source);
  return {
    id: `${source}:${ownerKey}:${dirName}`,
    source,
    owner,
    writable,
    toggleable: writable,
    dirName,
    name: fields.name,
    invokeName: namespace ? `${namespace}:${dirName}` : dirName,
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

// Records for every skill folder in `dirs`, with shared owner fields.
export async function readAll(dirs, fields) {
  const out = [];
  for (const d of dirs) out.push(await readSkillRecord({ ...fields, dirName: d.dirName, skillMdPath: d.skillMdPath }));
  return out;
}
