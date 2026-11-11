// Fixture filesystem for tests and the harness: a fresh mkdtemp tree holding a
// fake HOME (~/.claude), PROJECTS_ROOT with projects and cc's store, a cc core
// plugin dir, a managed-policy dir and the plugin data dir. Nothing here
// touches the real machine's config.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config.js';

export const ORG = '11111111-aaaa';
export const ACCT = '22222222-bbbb';

export const skillMd = (name, description, { whenToUse, extra = '', body = `# ${name}\n\nDo the ${name} thing.\n` } = {}) =>
  `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n${whenToUse ? `when_to_use: ${JSON.stringify(whenToUse)}\n` : ''}${extra}---\n\n${body}`;

// spec.files: { relPath: string | object (JSON) }, with "__ROOT__" replaced by the fixture root; spec.symlinks: { relPath: target (absolute, or relative to root) }.
// → { root, p(rel), env(conductorUrl), config(conductorUrl), write(rel, content), projects }
export async function makeRoots(t, spec = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'code-skill-test-')));
  if (t) t.after(() => fs.rm(root, { recursive: true, force: true }));
  const p = (...rel) => path.join(root, ...rel);
  const write = async (rel, content) => {
    await fs.mkdir(path.dirname(p(rel)), { recursive: true });
    const text = typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`;
    await fs.writeFile(p(rel), text.replaceAll('__ROOT__', root));
  };
  for (const d of ['home/.claude', 'projects/projA', 'projects/projB', 'projects/.code-conductor', 'cc/claude-plugin', 'managed', 'data']) {
    if (!(d in (spec.symlinks ?? {}))) await fs.mkdir(p(d), { recursive: true });
  }
  for (const [rel, content] of Object.entries(spec.files ?? {})) await write(rel, content);
  for (const [rel, target] of Object.entries(spec.symlinks ?? {})) {
    await fs.mkdir(path.dirname(p(rel)), { recursive: true });
    await fs.symlink(path.isAbsolute(target) ? target : p(target), p(rel));
  }
  const env = (conductorUrl) => ({
    CONDUCTOR_PLUGIN_DATA_DIR: p('data'),
    CONDUCTOR_URL: conductorUrl,
    PROJECTS_ROOT: p('projects'),
    CONDUCTOR_PROJECT_DIR: p('cc'),
    HOME: p('home'),
    CODE_SKILL_MANAGED_DIR: p('managed'),
  });
  const projects = [
    { name: 'projA', path: p('projects/projA'), system: 'local', workspace: null, remoteId: null },
    { name: 'projB', path: p('projects/projB'), system: 'local', workspace: null, remoteId: null },
  ];
  return { root, p, write, env, config: (url) => loadConfig(env(url)), projects };
}

// Every file under `root` → { rel: mtime + content }, for "nothing else changed" checks.
// `{ mtimes: false }` compares content and link targets only (e.g. after a copy).
export async function snapshotTree(root, { mtimes = true } = {}) {
  const out = {};
  const walk = async (d) => {
    for (const ent of await fs.readdir(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      const rel = path.relative(root, abs);
      if (ent.isSymbolicLink()) out[rel] = `link:${await fs.readlink(abs)}`;
      else if (ent.isDirectory()) { out[`${rel}/`] = 'dir'; await walk(abs); }
      else {
        const st = await fs.stat(abs);
        out[rel] = `${mtimes ? st.mtimeMs : ''}:${(st.mode & 0o777).toString(8)}:${(await fs.readFile(abs)).toString('base64')}`;
      }
    }
  };
  await walk(root);
  return out;
}
