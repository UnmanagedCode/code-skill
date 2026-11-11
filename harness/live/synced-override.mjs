// Live check of the synced-skill override key against a real `claude` (never writing the caller's settings or credentials).
//   RUN_REAL_CLAUDE=1 node harness/live/synced-override.mjs <source-claude-config-dir> [skill-name] [--real-config]
// Default mode: copies .claude.json, a minimal settings.json and the signed-in bucket into a throwaway config dir,
// passes the OAuth token from <source>/.credentials.json in memory (never copied, never printed) and puts the
// overrides in that dir's settings.json (the user layer). Baseline it needs: the CLI must list the synced skill with
// no override; a token-only copy of the config dir has been seen not to (only bundled skills are listed), which
// makes every case unjudgeable.
// --real-config: runs claude with CLAUDE_CONFIG_DIR=<source> (its login and synced skills) from a temp project and
// puts the overrides in <tmpcwd>/.claude/settings.local.json. That exercises the merged-settings lookup the user
// layer shares, not the user settings file itself. The CLI writes its ordinary session state into <source>; this
// script never touches <source>/settings.json or the credentials.
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

if (process.env.RUN_REAL_CLAUDE !== '1') {
  console.log('skipped: set RUN_REAL_CLAUDE=1 to run against the real claude CLI');
  process.exit(0);
}
const args = process.argv.slice(2);
const realConfig = args.includes('--real-config');
const [source, skillArg] = args.filter((a) => !a.startsWith('--'));
if (!source) {
  console.error('usage: RUN_REAL_CLAUDE=1 node harness/live/synced-override.mjs <source-claude-config-dir> [skill-name] [--real-config]');
  process.exit(2);
}
const TIMEOUT_MS = 120_000;

const cpDir = (from, to) => fs.cp(from, to, { recursive: true, verbatimSymlinks: true });

async function initInfo({ configDir, cwd, token }) {
  const env = { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: configDir };
  if (!realConfig) env.HOME = configDir;
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
  const child = spawn('claude', ['-p', 'Reply OK', '--output-format', 'stream-json', '--verbose', '--max-turns', '1', '--model', 'haiku'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
  await new Promise((r) => child.on('close', r));
  clearTimeout(timer);
  for (const line of out.split('\n')) {
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.type === 'system' && msg.subtype === 'init') return { skills: msg.skills ?? [], slash: msg.slash_commands ?? [] };
  }
  throw new Error(`no system/init line from claude (stderr: ${(token ? err.replace(token, '***') : err).slice(0, 300)})`);
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'code-skill-live-'));
let exitCode = 0;
try {
  await fs.chmod(tmp, 0o700);
  const cwd = path.join(tmp, 'cwd');
  await fs.mkdir(path.join(cwd, '.claude'), { recursive: true });
  let configDir = path.join(tmp, 'config');
  let token;

  const claudeJsonText = await fs.readFile(path.join(source, '.claude.json'), 'utf8');
  const account = JSON.parse(claudeJsonText).oauthAccount;
  if (!account?.organizationUuid || !account?.accountUuid) throw new Error('source .claude.json has no signed-in oauthAccount');
  const bucketName = `${account.organizationUuid}_${account.accountUuid}`;
  const bucketDir = path.join(realConfig ? source : configDir, 'skills', 'synced', bucketName);
  if (realConfig) {
    configDir = source;
  } else {
    await fs.mkdir(configDir, { mode: 0o700 });
    await fs.writeFile(path.join(configDir, '.claude.json'), claudeJsonText, { mode: 0o600 });
    await cpDir(path.join(source, 'skills', 'synced', bucketName), bucketDir);
    token = JSON.parse(await fs.readFile(path.join(source, '.credentials.json'), 'utf8'))?.claudeAiOauth?.accessToken;
    if (!token) throw new Error('no claudeAiOauth.accessToken in the source credentials');
  }

  const bucketSkills = (await fs.readdir(bucketDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  const name = skillArg ?? (bucketSkills.includes('xlsx') ? 'xlsx' : bucketSkills[0]);
  if (!name || !bucketSkills.includes(name)) throw new Error(`synced skill "${name}" not in the bucket`);
  const key = `anthropic-skills:${name}`;
  const settingsFile = realConfig ? path.join(cwd, '.claude', 'settings.local.json') : path.join(configDir, 'settings.json');
  console.log(`mode: ${realConfig ? 'real config dir, overrides in the temp project settings.local.json' : 'throwaway config dir, overrides in its settings.json'}`);
  console.log(`target skill: ${key} (${bucketSkills.length} synced skills in the bucket)`);

  const cases = [
    { label: 'baseline (no override)', overrides: undefined, expectPresent: true },
    { label: 'namespaced off', overrides: { [key]: 'off' }, expectPresent: false },
    { label: 'namespaced on + bare off', overrides: { [key]: 'on', [name]: 'off' }, expectPresent: true },
    { label: 'bare off only', overrides: { [name]: 'off' }, expectPresent: false },
  ];
  const results = [];
  for (const c of cases) {
    await fs.writeFile(settingsFile, JSON.stringify(c.overrides ? { skillOverrides: c.overrides } : {}), { mode: 0o600 });
    const { skills, slash } = await initInfo({ configDir, cwd, token });
    const present = skills.includes(key);
    results.push({ ...c, present, ok: present === c.expectPresent });
    console.log(`${present === c.expectPresent ? 'PASS' : 'FAIL'}  ${c.label}: ${key} ${present ? 'present' : 'absent'} (expected ${c.expectPresent ? 'present' : 'absent'}; ${skills.length} skills listed)`);
    if (c.label.startsWith('baseline') && !present) {
      const alt = [...skills, ...slash].filter((n) => n.includes(name));
      console.log(`baseline invalid: ${key} not listed. Names containing "${name}" in skills/slash_commands: ${alt.length ? alt.join(', ') : 'none'}`);
      break;
    }
  }
  if (!results.every((r) => r.ok) || results.length < cases.length) exitCode = 1;
} catch (e) {
  console.error(`live check failed: ${e.message}`);
  exitCode = 1;
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}
process.exit(exitCode);
