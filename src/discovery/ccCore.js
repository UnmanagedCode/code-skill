import path from 'node:path';
import { listSkillDirs, pluginJsonName } from './walkSkills.js';
import { readAll } from './record.js';

// code-conductor's own Claude plugin (<CONDUCTOR_PROJECT_DIR>/claude-plugin), passed to every session.
export async function discover({ config, warn }) {
  if (!config.coreDir) return [];
  const namespace = await pluginJsonName(config.coreDir);
  if (!namespace) {
    warn('cc-core', `${config.coreDir} has no .claude-plugin/plugin.json`);
    return [];
  }
  const dirs = await listSkillDirs(path.join(config.coreDir, 'skills'));
  return readAll(dirs, { source: 'cc-core', ownerKey: namespace, owner: { label: 'code-conductor (core)', namespace }, namespace });
}
