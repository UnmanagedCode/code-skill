# Code Skill

A code-conductor (cc) plugin that shows every Claude Code skill your cc sessions get, what each costs in the system prompt, which ones ever fire, and lets you author your own skills safely.

- **Inventory** — every skill source (yours, projects', claude.ai-synced, installed Claude Code plugins, cc core, cc plugins, convention skills) with its owner, listing cost, duplicate and near-duplicate flags, and the listing budget for each context size in use.
- **Usage** — Skill tool calls counted from session transcripts: most used, never fired, invoked but no longer installed.
- **Authoring** — create, edit, enable/disable and delete (to a restorable trash) your own `~/.claude/skills` skills and your projects' `.claude/skills` skills. Everything else is read-only.

UI-only plugin: an Express backend plus a no-build vanilla-JS page. No MCP tools.

## Quick start

```bash
npm install
npm test                                          # node:test suite on fixture roots
CC_PROJECTS_ROOT=/path/to/projects npm run harness  # Playwright golden path → harness/playwright/screenshots/
```

In cc: add this repo as a plugin project, Rescan, enable `code-skill`, then open **Code Skill** in the sidebar (served at `/plugins/code-skill/`).

Standalone (for development) it needs the variables cc normally provides:

```bash
CONDUCTOR_PLUGIN_DATA_DIR=/tmp/code-skill-data CONDUCTOR_URL=http://127.0.0.1:8787 PROJECTS_ROOT=/path/to/projects npm start
```

## Key defaults

| Setting | Value |
|---|---|
| Port | `PORT`, else `7420`; host `HOST`, else `127.0.0.1` |
| Claude config dir | `CLAUDE_CONFIG_DIR`, else `$HOME/.claude` (same rule as cc and the CLI) |
| Data dir | `CONDUCTOR_PLUGIN_DATA_DIR` (created at start): `trash/<trashId>/{skill/, meta.json}`, `usage-cache.json` |
| Managed policy dir | `/etc/claude-code` (`CODE_SKILL_MANAGED_DIR` overrides it, for tests) |
| Request body limit | 256 KiB |

## What it writes (nothing else)

1. `~/.claude/skills/<name>/SKILL.md`, and moving `~/.claude/skills/<name>/` to and from the trash.
2. `<project main checkout>/.claude/skills/<name>/SKILL.md`, and moving that folder to and from the trash.
3. Exactly the `skillOverrides.<name>` key of `~/.claude/settings.json` (your skills) or `<project>/.claude/settings.local.json` (project skills).
4. Anything under its data dir.

Project writes change the project's main checkout; the UI warns when that leaves it dirty, because cc refuses worktree merges into a dirty main checkout. Write-safety rules: [docs/architecture.md](docs/architecture.md#write-safety).

## Docs

- [docs/features.md](docs/features.md) — tabs, sources, toggles, pickup notices.
- [docs/protocol.md](docs/protocol.md) — HTTP routes, refusal codes, wire shapes, manifest, headers.
- [docs/architecture.md](docs/architecture.md) — modules, discovery, override layers, usage cache, trash, write safety, tests.

## Known limitations

- Skills built into the Claude Code binary are not inventoried.
- Nested `<subdir>/.claude/skills`, `--add-dir` directories and legacy `.claude/commands` are not covered.
- Project skills are read from and written to main checkouts only, not worktrees.
- Plugin skills (cc core, cc plugins, conventions, installed plugins, claude.ai-synced) can't be toggled: `skillOverrides` doesn't apply to them.
- Skills invoked by typing `/name` are not counted; only Skill tool calls are.
- The trash has no purge.
- The listing cost formula tracks Claude Code CLI 2.1.319.
- `enable` after a disable leaves an empty `"skillOverrides": {}` in the settings file.
