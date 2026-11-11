import os from 'node:os';
import path from 'node:path';

// The only reader of process environment in src/: server.js passes
// process.env here, tests pass a fixture object.
export function loadConfig(env) {
  const need = (name) => {
    const v = env[name];
    if (!v) throw new Error(`code-skill: ${name} is not set (the host provides it)`);
    if (!path.isAbsolute(v) && name !== 'CONDUCTOR_URL') throw new Error(`code-skill: ${name} must be an absolute path, got "${v}"`);
    return v;
  };
  const dataDir = need('CONDUCTOR_PLUGIN_DATA_DIR');
  const conductorUrl = need('CONDUCTOR_URL');
  const projectsRoot = need('PROJECTS_ROOT');
  const home = env.HOME || os.homedir();
  // Same resolution as cc and the CLI: CLAUDE_CONFIG_DIR, else ~/.claude (an empty value counts as unset).
  const configDir = env.CLAUDE_CONFIG_DIR || null;
  const claudeDir = configDir ?? path.join(home, '.claude');
  return {
    port: Number(env.PORT) || 7420,
    host: env.HOST || '127.0.0.1',
    dataDir,
    conductorUrl,
    projectsRoot,
    claudeDir,
    claudeJson: configDir ? path.join(configDir, '.claude.json') : path.join(home, '.claude.json'),
    coreDir: env.CONDUCTOR_PROJECT_DIR ? path.join(env.CONDUCTOR_PROJECT_DIR, 'claude-plugin') : null,
    storeDir: path.join(projectsRoot, '.code-conductor'),
    // Managed-policy settings dir; the override exists for tests and the harness.
    managedDir: env.CODE_SKILL_MANAGED_DIR || '/etc/claude-code',
  };
}
