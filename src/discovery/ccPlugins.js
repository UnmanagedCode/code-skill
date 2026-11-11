import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listSkillDirs, pluginJsonName } from './walkSkills.js';
import { readAll } from './record.js';

const inside = (root, p) => {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// The Claude plugin root a cc plugin contributes (its manifest's `claudePlugin`),
// for each enabled, local, error-free cc plugin — mirroring what cc hands sessions.
export async function discover({ conductor, localProjects, warn }) {
  const projects = new Map((await localProjects()).map((p) => [p.name, p]));
  const out = [];
  for (const row of await conductor.listPlugins()) {
    if (!row.enabled || row.system !== 'local' || (row.errors ?? []).length) continue;
    const project = projects.get(row.project);
    if (!project) {
      warn('cc-plugin', `cc plugin ${row.id}: project "${row.project}" is not a local project`);
      continue;
    }
    let checkout = project.path;
    if (row.activeVersion?.type === 'worktree') {
      const wt = (await conductor.listWorktrees(row.project)).find((w) => w.worktreeName === row.activeVersion.name);
      if (!wt) {
        warn('cc-plugin', `cc plugin ${row.id}: active worktree "${row.activeVersion.name}" not found`);
        continue;
      }
      checkout = wt.worktreePath;
    }
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(path.join(checkout, 'conductor.plugin.json'), 'utf8'));
    } catch (e) {
      warn('cc-plugin', `cc plugin ${row.id}: ${e.message}`);
      continue;
    }
    if (typeof manifest.claudePlugin !== 'string') continue;
    const root = path.resolve(checkout, manifest.claudePlugin);
    if (!inside(checkout, root)) {
      warn('cc-plugin', `cc plugin ${row.id}: claudePlugin "${manifest.claudePlugin}" leaves its checkout; skipped`);
      continue;
    }
    let namespace;
    try {
      namespace = await pluginJsonName(root);
    } catch (e) {
      warn('cc-plugin', `cc plugin ${row.id}: ${e.message}`);
      continue;
    }
    if (!namespace) {
      warn('cc-plugin', `cc plugin ${row.id}: ${root} has no .claude-plugin/plugin.json; cc skips it too`);
      continue;
    }
    const dirs = await listSkillDirs(path.join(root, 'skills'));
    out.push(...await readAll(dirs, { source: 'cc-plugin', ownerKey: row.id, owner: { label: `cc plugin ${row.id}`, plugin: row.id, namespace }, namespace }));
  }
  return out;
}
