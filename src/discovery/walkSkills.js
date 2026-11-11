import { promises as fs } from 'node:fs';
import path from 'node:path';

// Skill folders directly under `skillsRoot`: real (non-symlink) directories,
// not dot-dirs, not in `exclude`, holding a regular SKILL.md file. A missing
// root is an empty list. → [{ dirName, dir, skillMdPath }] sorted by name.
export async function listSkillDirs(skillsRoot, { exclude = [] } = {}) {
  let entries;
  try {
    entries = await fs.readdir(skillsRoot, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return [];
    throw e;
  }
  const out = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.') || exclude.includes(ent.name)) continue;
    const dir = path.join(skillsRoot, ent.name);
    const skillMdPath = path.join(dir, 'SKILL.md');
    try {
      if (!(await fs.lstat(skillMdPath)).isFile()) continue;
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    out.push({ dirName: ent.name, dir, skillMdPath });
  }
  return out.sort((a, b) => a.dirName.localeCompare(b.dirName));
}

// The `name` of a Claude Code plugin root (`<root>/.claude-plugin/plugin.json`), or null when absent.
export async function pluginJsonName(root) {
  let text;
  try {
    text = await fs.readFile(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  }
  const name = JSON.parse(text)?.name;
  if (typeof name !== 'string' || name === '') throw new Error(`${path.join(root, '.claude-plugin', 'plugin.json')} has no "name"`);
  return name;
}
