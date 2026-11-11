import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readSettingsObject } from './settingsFile.js';

// The settings files whose skillOverrides decide a skill's state, read fresh
// per request. Merge order (later wins) follows the CLI: user, project, local,
// then policy. An unreadable layer is skipped and reported in `errors`.

export const userSettingsFile = (config) => path.join(config.claudeDir, 'settings.json');
export const projectSettingsFile = (projectPath) => path.join(projectPath, '.claude', 'settings.json');
export const localSettingsFile = (projectPath) => path.join(projectPath, '.claude', 'settings.local.json');

async function policyFiles(config) {
  const files = [path.join(config.managedDir, 'managed-settings.json')];
  const dropIn = path.join(config.managedDir, 'managed-settings.d');
  try {
    const names = (await fs.readdir(dropIn)).filter((n) => n.endsWith('.json')).sort();
    files.push(...names.map((n) => path.join(dropIn, n)));
  } catch (e) {
    if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e;
  }
  files.push(path.join(config.claudeDir, 'remote-settings.json'));
  return files;
}

// → { user: Layer, policy: Layer[], perProject: { [name]: { project: Layer, local: Layer } }, errors[] }
// Layer = { layer, file, overrides: {} }
export async function readLayers(config, projects) {
  const errors = [];
  const read = async (layer, file) => {
    try {
      const { obj } = await readSettingsObject(file);
      return { layer, file, overrides: obj.skillOverrides ?? {} };
    } catch (e) {
      errors.push({ source: 'settings', message: `${file}: ${e.message}` });
      return { layer, file, overrides: {} };
    }
  };
  const user = await read('user', userSettingsFile(config));
  const policy = [];
  for (const f of await policyFiles(config)) policy.push(await read('policy', f));
  const perProject = {};
  for (const p of projects) {
    perProject[p.name] = {
      project: await read('project', projectSettingsFile(p.path)),
      local: await read('local', localSettingsFile(p.path)),
    };
  }
  return { user, policy, perProject, errors };
}
