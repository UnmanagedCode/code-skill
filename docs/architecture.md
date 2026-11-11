# Architecture

> See also: [README](../README.md) · [features](features.md) · [protocol](protocol.md)

## Layout

```
server.js                 entry: loadConfig(process.env), mkdir dataDir, listen
src/config.js             loadConfig(env) — the only reader of env in src/
src/app.js                createApp(config, deps) / createServer; deps = {conductor, git, usage}, real ones when omitted
src/conductorClient.js    cc REST client (unreachable → Refusal CONDUCTOR_UNREACHABLE)
src/inventory.js          buildInventory: runs SOURCES, attaches override + cost, duplicates, totals, budget; findSkill
src/discovery/            one module per source, each discover(ctx) → SkillRecord[]
  walkSkills.js record.js   listSkillDirs, pluginJsonName; readSkillRecord
src/similarity.js         nearDuplicates (Jaccard on listing-text word sets, NEAR_DUP_THRESHOLD)
src/skillFile.js          parseSkillMd (lenient), validateFrontmatter (strict), composeSkillMd, buildSkillMd
src/overrides/            layers.js readLayers; effective.js effectiveFor; settingsFile.js setSkillOverride
src/safety/               resolve.js resolveSkillTarget, resolveLocalProject; errors.js Refusal
src/fsx/atomicWrite.js    writeFileAtomic, sha256
src/authoring.js          createSkill, updateSkill, setEnabled, deleteSkill, restoreSkill
src/trash.js              moveToTrash, listTrash, readTrashEntry, takeFromTrash, moveDir
src/gitProbe.js           createGitProbe (execFile git, injectable), gitReport
src/usage/                transcriptRoots.js, scanFile.js, usageIndex.js
src/http/                 routes.js, static.js, securityHeaders.js, errorHandler.js
shared/                   cost.js, names.js — imported by the backend and served to the browser
public/                   no-build ES modules: app.js (shell), dom.js (h/mount), api.js (only fetch), markdown.js,
                          format.js, notices.js, views/{inventory,usage,trash,editor,confirm}.js, theme files
```

## Config

| Field | From |
|---|---|
| `dataDir` | `CONDUCTOR_PLUGIN_DATA_DIR` (required, absolute) |
| `conductorUrl` | `CONDUCTOR_URL` (required) |
| `projectsRoot` | `PROJECTS_ROOT` (required, absolute) |
| `claudeDir` | `CLAUDE_CONFIG_DIR` (empty = unset), else `$HOME/.claude` |
| `claudeJson` | `<CLAUDE_CONFIG_DIR>/.claude.json`, else `$HOME/.claude.json` |
| `coreDir` | `<CONDUCTOR_PROJECT_DIR>/claude-plugin`, or null |
| `storeDir` | `<PROJECTS_ROOT>/.code-conductor` |
| `managedDir` | `CODE_SKILL_MANAGED_DIR`, else `/etc/claude-code` |
| `port` / `host` | `PORT` / `HOST`, defaults in `loadConfig` |

## Source discovery

The inventory is computed per request (no cache). A thrown source error becomes a `sourceErrors` entry; only `CONDUCTOR_UNREACHABLE` fails the request.

- **user** — `listSkillDirs(<claudeDir>/skills)` minus `synced`. `listSkillDirs` takes real directories (no symlinks, no dot-dirs) holding a regular `SKILL.md`.
- **project** — each `/api/projects` row with `system === 'local'`: `<path>/.claude/skills`.
- **synced** — bucket `<claudeDir>/skills/synced/<organizationUuid>_<accountUuid>` from `claudeJson`'s `oauthAccount`; namespace `anthropic-skills`. No account / bucket → nothing.
- **host-plugin** — `<claudeDir>/plugins/installed_plugins.json` (`version: 2`). Namespace = `<installPath>/.claude-plugin/plugin.json` `name`, else the key before `@`. `enabled` = `enabledPlugins[key] === true` in user settings (user/managed scope) or the entry's project `settings.json` / `settings.local.json` (project / local scope).
- **cc-core** — `<coreDir>/skills`, namespace from its plugin.json.
- **cc-plugin** — `/api/plugins` rows with `enabled && system === 'local' && errors.length === 0`; checkout = the project's path, or the `/worktrees` row matching `activeVersion.name`; root = `claudePlugin` from its `conductor.plugin.json`, which must stay inside the checkout; skipped (with a source error) without `.claude-plugin/plugin.json`.
- **convention** — `<storeDir>/convention-skills/*/*/` with a plugin.json; merged by (invokeName, sha256); sessions labelled from `/api/instances` (`displayLabel`, else `title`), else "(no instance row)".

## Override layers

Read fresh per request (`readLayers`), merged later-wins: user `<claudeDir>/settings.json` → project `<p>/.claude/settings.json` → local `<p>/.claude/settings.local.json` → policy (`<managedDir>/managed-settings.json`, `<managedDir>/managed-settings.d/*.json` sorted, `<claudeDir>/remote-settings.json`). User skills use user → policy (and report every project/local entry as `otherProjects`); project skills use the full chain for their project. Keys are bare skill names (the folder name); values outside the CLI's four are ignored. Unparseable layers are skipped and reported (`source: 'settings'`).

## Usage cache

`<dataDir>/usage-cache.json` = `{version: 1, files: {[absPath]: {ino, size, mtimeMs, offset, gone?}}, calls: {[toolUseId]: {skill, ts, sessionId, file}}}`, written atomically after each scan.

- Roots: `<claudeDir>/projects` and `<storeDir>/claude-config/*/.claude/projects`; every `*.jsonl` to depth 4, symlinked folders not followed.
- Per file: unchanged ino/size/mtime → skip; same ino and size ≥ offset → read from offset; otherwise drop the file's calls and rescan from 0. Only complete lines are consumed.
- Files that disappear are marked `gone`; their calls stay. An unreadable cache is logged and rebuilt.

## Trash

`<dataDir>/trash/<trashId>/skill/` (the moved folder) and `meta.json` (`TrashMeta`). `trashId` = `<epochMs>-<8 hex>`. Moves use `rename`, falling back on `EXDEV` to recursive copy (symlinks verbatim) then remove. Restore re-runs every containment check for the original scope/project/name. The `skillOverrides` key is left as it was on delete.

## Write safety

- **Names** — `validateSkillName` (`shared/names.js`): `NAME_RE`, minus `RESERVED_NAMES`.
- **Projects** — must be a `/api/projects` row with that exact name and `system === 'local'`.
- **Containment** (`resolveSkillTarget`) — base = `<claudeDir>/skills` or `<project>/.claude/skills`; a symlinked `<project>/.claude` is refused; `realpath(base)` must be inside `realpath(owner root)`; the skill folder must be a real directory directly under it; `SKILL.md` a regular file.
- **Settings** (`setSkillOverride`) — file must be regular or missing, its folder inside the owner root; parse failure / non-object → refuse with the file untouched; only `skillOverrides[name]` changes; indent detected and kept; the read-modify-write re-checks the file's stat just before rename and retries up to 3 times, then `SETTINGS_BUSY`.
- **Atomic writes** — temp file `.<base>.<rand>.tmp` (exclusive create), fsync, rename; temp removed on failure.
- **Edits** — `baseEtag` must match the current bytes (`STALE`); frontmatter is written verbatim (`composeSkillMd`).
- **Git** — after project writes, `git -C <project> ls-files --error-unmatch -- <rel>`, then `check-ignore -q`, via `execFile`.

## Frontend safety

- Only `public/dom.js` creates nodes: `h(tag, props, ...children)`; props from an allowlist, handlers only as functions, strings only as text nodes.
- `public/markdown.js` is the only place an `href` is set, through `safeHref` (http, https, mailto).
- `public/api.js` is the only `fetch` call site and refuses root-relative paths.
- `tests/frontendSafety.test.mjs` bans HTML sinks, `eval`, `setAttribute`, inline style, location assignment and stray `fetch`/`href` across `public/` and `shared/`; each rule carries a sample it must flag.

## Tests

- `npm test` → `tests/run.mjs` (node:test `run()`, `concurrency: 1`).
- `tests/fixtures/roots.mjs` `makeRoots(t, {files, symlinks})` — a fresh mkdtemp tree (fake HOME, projects, store, cc core, managed dir, data dir); file contents may use `__ROOT__`. `snapshotTree` for "nothing else changed" checks.
- `tests/fixtures/fakeConductor.mjs` — fake cc on port 0 with live, mutable state (`state.fail[route]` forces a status).
- `tests/fixtures/transcripts.mjs` — record builders matching the CLI's shapes; `fakeDoc.mjs` — a trapping fake document.
- `tests/helpers.mjs` — `boot(t, spec, {conductor, git})` (app on port 0 with a fake git probe) and `depsFor`.
- `tests/testIsolation.test.mjs` keeps tests and the harness off the real home and `server.js`.
- Harness: `harness/playwright/boot.mjs` builds a rich fixture (including a git-initialised project and a hostile skill) and spawns `server.js` with fixture env only; `golden-path.mjs` drives the UI and writes `harness/playwright/screenshots/`.
