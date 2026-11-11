import path from 'node:path';
import { listSkillDirs } from './walkSkills.js';
import { readAll } from './record.js';

// ~/.claude/skills/<name>/SKILL.md (the claude.ai `synced` folder is its own source).
export async function discover({ config, warn }) {
  const dirs = await listSkillDirs(path.join(config.claudeDir, 'skills'), { exclude: ['synced'] });
  return readAll(dirs, { source: 'user', ownerKey: '~', owner: { label: 'you (~/.claude/skills)' } }, warn);
}
