import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listSkillDirs, pluginJsonName } from './walkSkills.js';
import { readSkillRecord } from './record.js';

// Convention skills cc writes per session launch under
// <store>/convention-skills/<instanceId>/<ns>/. Shown as the union over the
// live folders: one record per (invokeName, content), listing the sessions that carry it.
// A broken plugin.json or SKILL.md is reported and skipped; the rest still lists.
export async function discover({ config, conductor, warn }) {
  const base = path.join(config.storeDir, 'convention-skills');
  let instanceDirs;
  try {
    instanceDirs = (await fs.readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  let instances = [];
  try {
    instances = await conductor.listInstances();
  } catch (e) {
    warn('convention', `session names unavailable: ${e.message}`);
  }
  const byId = new Map(instances.map((i) => [i.id, i]));
  const merged = new Map();
  for (const instanceId of instanceDirs) {
    const inst = byId.get(instanceId);
    const session = inst
      ? { instanceId, label: inst.displayLabel || inst.title || instanceId, status: inst.status ?? null }
      : { instanceId, label: '(no instance row)', status: null };
    const nsDirs = (await fs.readdir(path.join(base, instanceId), { withFileTypes: true })).filter((d) => d.isDirectory());
    for (const nsDir of nsDirs) {
      const root = path.join(base, instanceId, nsDir.name);
      let namespace;
      try {
        namespace = await pluginJsonName(root);
      } catch (e) {
        warn('convention', `${root}: ${e.message}`);
        continue;
      }
      if (!namespace) continue;
      for (const d of await listSkillDirs(path.join(root, 'skills'))) {
        let rec;
        try {
          rec = await readSkillRecord({ source: 'convention', ownerKey: '', owner: { label: 'Settings → Conventions', namespace }, namespace, dirName: d.dirName, skillMdPath: d.skillMdPath });
        } catch (e) {
          warn('convention', `${d.skillMdPath}: ${e.message}`);
          continue;
        }
        const key = `${rec.invokeName}\0${rec.sha}`;
        const seen = merged.get(key);
        if (seen) {
          seen.sessions.push(session);
          continue;
        }
        rec.id = `convention:${namespace}#${rec.sha.slice(0, 8)}:${d.dirName}`;
        rec.sessions = [session];
        merged.set(key, rec);
      }
    }
  }
  return [...merged.values()];
}
