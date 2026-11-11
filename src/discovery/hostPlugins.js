import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listSkillDirs, pluginJsonName } from './walkSkills.js';
import { readAll } from './record.js';
import { readSettingsObject } from '../overrides/settingsFile.js';
import { userSettingsFile, projectSettingsFile, localSettingsFile } from '../overrides/layers.js';

// Claude Code plugins installed on the host (<claudeDir>/plugins/installed_plugins.json, v2).
// A plugin's skills cost listing space only while it is enabled for that scope.
export async function discover({ config, warn }) {
  const file = path.join(config.claudeDir, 'plugins', 'installed_plugins.json');
  let doc;
  try {
    doc = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw new Error(`${file}: ${e.message}`);
  }
  if (doc?.version !== 2 || doc.plugins === null || typeof doc.plugins !== 'object') throw new Error(`${file}: expected {version: 2, plugins: {…}}`);

  const enabledIn = async (settingsFile, key) => {
    try {
      return (await readSettingsObject(settingsFile)).obj.enabledPlugins?.[key] === true;
    } catch (e) {
      warn('host-plugin', `${settingsFile}: ${e.message}`);
      return false;
    }
  };

  const out = [];
  for (const [key, installs] of Object.entries(doc.plugins)) {
    for (const inst of Array.isArray(installs) ? installs : []) {
      if (typeof inst?.installPath !== 'string') continue;
      const projectScoped = inst.scope === 'project' || inst.scope === 'local';
      if (projectScoped && typeof inst.projectPath !== 'string') continue;
      const settings = inst.scope === 'project' ? projectSettingsFile(inst.projectPath)
        : inst.scope === 'local' ? localSettingsFile(inst.projectPath)
          : userSettingsFile(config);
      const enabled = await enabledIn(settings, key);
      let namespace;
      try {
        namespace = (await pluginJsonName(inst.installPath)) ?? key.split('@')[0];
      } catch (e) {
        warn('host-plugin', e.message);
        continue;
      }
      const ownerKey = projectScoped ? `${key}(${inst.scope} ${inst.projectPath})` : key;
      const label = `Claude Code plugin ${key}${projectScoped ? ` (${inst.scope}: ${inst.projectPath})` : ''}`;
      const recs = await readAll(await listSkillDirs(path.join(inst.installPath, 'skills')), {
        source: 'host-plugin', ownerKey, owner: { label, plugin: key, namespace, scope: inst.scope ?? 'user' }, namespace,
      });
      for (const r of recs) r.enabled = enabled;
      out.push(...recs);
    }
  }
  return out;
}
