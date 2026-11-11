import path from 'node:path';
import { listSkillDirs } from './walkSkills.js';
import { readAll } from './record.js';

// <project main checkout>/.claude/skills for each local project cc knows about.
export async function discover({ localProjects, warn }) {
  const out = [];
  for (const p of await localProjects()) {
    const dirs = await listSkillDirs(path.join(p.path, '.claude', 'skills'));
    out.push(...await readAll(dirs, { source: 'project', ownerKey: p.name, owner: { label: `project ${p.name}`, project: p.name } }, warn));
  }
  return out;
}
