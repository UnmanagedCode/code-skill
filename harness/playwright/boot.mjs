// Boots server.js against fixture roots (tests/fixtures/roots.mjs) and the
// fake cc (tests/fixtures/fakeConductor.mjs): a home with user, synced and
// host-plugin skills, two projects (projA a git repo), cc core and a cc
// plugin, convention skills for two sessions, transcripts with usage, and a
// hostile skill. Every path the server sees is inside the fixture.
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHarness } from './codePlaywright.mjs';
import { makeRoots, skillMd, ORG, ACCT } from '../../tests/fixtures/roots.mjs';
import { startFakeConductor } from '../../tests/fixtures/fakeConductor.mjs';
import { skillCall, blobCopy, lines } from '../../tests/fixtures/transcripts.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const HOSTILE_BODY = '# Hostile\n\nThis body tries <img src=x onerror=alert(1)> and [click me](javascript:alert(1)).\n\n<script>alert(2)</script>\n\nA [safe link](https://example.com/docs).\n';
const days = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

const convention = (inst, ns, name, desc) => ({
  [`projects/.code-conductor/convention-skills/${inst}/${ns}/.claude-plugin/plugin.json`]: { name: ns },
  [`projects/.code-conductor/convention-skills/${inst}/${ns}/skills/${name}/SKILL.md`]: skillMd(name, desc),
});

export const FIXTURE_FILES = {
  'home/.claude/skills/pdf-tools/SKILL.md': skillMd('pdf-tools', 'Extract text and tables from PDF files, merge or split PDF documents', { whenToUse: 'when the user works with PDF files' }),
  'home/.claude/skills/pdf-helper/SKILL.md': skillMd('pdf-helper', 'Extract tables and text from PDF files; merge or split PDF documents', { whenToUse: 'when the user works with PDF files' }),
  'home/.claude/skills/release-notes/SKILL.md': skillMd('release-notes', 'Draft release notes from merged pull requests since the last tag'),
  'home/.claude/skills/hostile/SKILL.md': skillMd('hostile', 'Renders <img src=x onerror=alert(1)> safely', { body: HOSTILE_BODY }),
  'home/.claude/skills/terse/SKILL.md': skillMd('terse', 'Answer in as few words as possible'),
  'home/.claude/skills/renamed-folder/SKILL.md': skillMd('old-name', 'Its frontmatter name disagrees with its folder'),
  'home/.claude/skills/long-winded/SKILL.md': skillMd('long-winded', `${'A very long description that keeps going. '.repeat(45)}`),
  'home/.claude/settings.json': { model: 'opus', skillOverrides: { terse: 'name-only' } },
  'home/.claude.json': { oauthAccount: { organizationUuid: ORG, accountUuid: ACCT } },
  [`home/.claude/skills/synced/${ORG}_${ACCT}/skill-creator/SKILL.md`]: skillMd('skill-creator', 'Create new skills, improve existing ones and run evals'),
  'home/.claude/plugins/installed_plugins.json': { version: 2, plugins: { 'toolbox@market': [{ scope: 'user', installPath: '__ROOT__/home/.claude/plugins/cache/toolbox' }] } },
  'home/.claude/plugins/cache/toolbox/.claude-plugin/plugin.json': { name: 'toolbox' },
  'home/.claude/plugins/cache/toolbox/skills/regex/SKILL.md': skillMd('regex', 'Write and explain regular expressions'),
  'projects/projA/.claude/skills/release-notes/SKILL.md': skillMd('release-notes', 'Project flavour of release notes'),
  'projects/projA/.claude/skills/lint-rules/SKILL.md': skillMd('lint-rules', 'Apply this project\'s lint conventions before committing'),
  'projects/projA/README.md': '# projA\n',
  'cc/claude-plugin/.claude-plugin/plugin.json': { name: 'code-conductor' },
  'cc/claude-plugin/skills/scripting/SKILL.md': skillMd('scripting', 'Use when cc tool results need filtering or aggregating before you read them'),
  'cc/claude-plugin/skills/worktree-hooks/SKILL.md': skillMd('worktree-hooks', 'Use when writing or debugging a cc worktree hook'),
  'projects/code-review/conductor.plugin.json': { id: 'code-review', claudePlugin: 'claude-plugin' },
  'projects/code-review/claude-plugin/.claude-plugin/plugin.json': { name: 'code-review' },
  'projects/code-review/claude-plugin/skills/review-dialog/SKILL.md': skillMd('review-dialog', 'Take part in a code-review plugin review'),
  ...convention('inst-1', 'cc-conductor', 'kanban-etiquette', 'How to file and move kanban cards'),
  ...convention('inst-2', 'cc-conductor', 'kanban-etiquette', 'How to file and move kanban cards'),
  ...convention('inst-2', 'cc-custom-project', 'house-style', 'Follow the house style for docs'),
  'home/.claude/projects/-w-projA/s1.jsonl': lines(
    skillCall({ id: 'u1', skill: 'pdf-tools', ts: days(1), sessionId: 's1' }),
    blobCopy({ id: 'u1', skill: 'pdf-tools' }),
    skillCall({ id: 'u2', skill: 'pdf-tools', ts: days(3), sessionId: 's1' }),
    skillCall({ id: 'u3', skill: 'code-conductor:scripting', ts: days(2), sessionId: 's1' }),
    skillCall({ id: 'u4', skill: 'retired-skill', ts: days(40), sessionId: 's1' }),
  ),
  'projects/.code-conductor/claude-config/box/.claude/projects/-w/s2.jsonl': lines(skillCall({ id: 'u5', skill: 'anthropic-skills:skill-creator', ts: days(5), sessionId: 's2' })),
};

export const EMBED_PREFIX = '/plugins/code-skill';

// A stand-in for cc's plugin proxy: serves the backend under EMBED_PREFIX with
// the prefix stripped; every other path (cc's own, incl. the two host URLs) is a 404.
export async function startPrefixProxy(targetUrl) {
  const target = new URL(targetUrl);
  const server = http.createServer((req, res) => {
    if (req.url === EMBED_PREFIX) {
      res.writeHead(301, { location: `${EMBED_PREFIX}/` });
      return res.end();
    }
    if (!req.url.startsWith(`${EMBED_PREFIX}/`)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found (outside the plugin prefix)');
    }
    const upstream = http.request({ hostname: target.hostname, port: target.port, method: req.method, path: req.url.slice(EMBED_PREFIX.length), headers: req.headers }, (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    upstream.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(upstream);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}${EMBED_PREFIX}/`, close: () => new Promise((r) => server.close(r)) };
}

export async function bootFixture() {
  const roots = await makeRoots(null, { files: FIXTURE_FILES });
  execFileSync('git', ['-C', roots.p('projects/projA'), 'init', '-q']);
  execFileSync('git', ['-C', roots.p('projects/projA'), 'add', '.']);
  const fake = await startFakeConductor(null, {
    projects: [...roots.projects, { name: 'code-review', path: roots.p('projects/code-review'), system: 'local' }],
    plugins: [{ id: 'code-review', project: 'code-review', system: 'local', enabled: true, errors: [], activeVersion: { type: 'main' } }],
    instances: [
      { id: 'inst-1', displayLabel: 'projA · fix flaky test', status: 'running', contextWindowTokens: 1_000_000 },
      { id: 'inst-2', title: 'docs pass', status: 'idle', contextWindowTokens: 200_000 },
    ],
  });
  const { bootServer } = await loadHarness();
  const env = roots.env(fake.url);
  // CLAUDE_CONFIG_DIR unset so HOME/.claude applies, as on the host.
  const srv = await bootServer({ cwd: REPO_ROOT, entry: 'server.js', env: { ...env, CLAUDE_CONFIG_DIR: '' }, silent: true });
  const proxy = await startPrefixProxy(srv.url);
  return {
    // `url`: the page as cc embeds it (under /plugins/code-skill/); `standaloneUrl`: the backend directly.
    roots, fake, srv, url: proxy.url, standaloneUrl: `${srv.url}/`,
    async close() {
      await proxy.close();
      await srv.close();
      await fake.close();
      const { rm } = await import('node:fs/promises');
      await rm(roots.root, { recursive: true, force: true });
    },
  };
}
