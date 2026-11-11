# Features

> See also: [README](../README.md) · [protocol](protocol.md) · [architecture](architecture.md)

## Tabs

State lives in the URL: `?tab=usage|trash` (Inventory is the default) and `?skill=<id>` for the open side pane.

### Inventory

- **Listing budget** — the listing that *every* session carries (user, claude.ai-synced, user/managed-scope installed plugins, cc core, cc plugins) against the budget for 200k and 1M contexts plus each distinct `contextWindowTokens` of live cc sessions (tagged "live session"). Budget = context tokens × 4 × 1% chars. Over budget, Claude Code shortens descriptions.
- **Totals by owner** — skills, chars, ~tokens per owner, and which sessions list them (every session / sessions in a project / a convention namespace's sessions).
- **Skills table** — click a row (or its name) to open the side pane. Columns: invoke name, source, owner, ~tokens, listing state (full / name only / not listed, `cut` when the text passes 1536 chars), uses, last used, state. ⚠ marks warnings, duplicate names and near-duplicates (hover for the notes). Filter box (name, description, owner) and source chips. With the side pane open, owner, listing and last-used columns hide.
- **State column** — a switch for user and project skills (disabled, with a tooltip, when the frontmatter `name` differs from the folder name); "read-only" (hover: owner) for everything else; "plugin enabled/disabled" for installed Claude Code plugins. A policy-locked skill's switch is disabled.
- **Source errors** — a source that fails to load shows a banner; the rest still lists.

### Usage

- Scan stats: transcripts seen, bytes read, ms. The first scan reads every transcript; later ones read only appended bytes. **Rescan** re-runs it.
- **Most used** — count, distinct sessions, last used.
- **Never fired** — installed skills with no recorded call.
- **Invoked but no longer installed** — calls to names no source provides now.
- Calls survive Claude Code deleting old transcripts (kept in the usage cache).

### Trash

Deleted skills with where they came from and when; **Restore** puts the folder back (refused if a skill of that name exists there now, or the project is no longer registered).

## Side pane

- **Read-only skills** — owner badge, pickup notice, path, carrying sessions (convention skills), rendered preview, raw `SKILL.md`, file list.
- **Your and project skills** — `Frontmatter (YAML)` and `Body (Markdown)` editors with a live check (debounced 400 ms: listing cost, frontmatter errors), Save (refused if the file changed on disk since opening: *Reload*), Preview, Enable/Disable, Delete (in-page confirmation; the notice offers *Undo*).
- **New skill** — where (you, or a registered local project), name (live rule check), description (live cost), body.
- **Run evals with skill-creator** — shown when `anthropic-skills:skill-creator` is installed: a ready prompt naming the skill's path, with Copy.

## Sources and owner labels

| Source | Where | Owner label | Writable / toggleable |
|---|---|---|---|
| `user` | `~/.claude/skills/<name>/` | you (~/.claude/skills) | yes |
| `project` | `<project main checkout>/.claude/skills/<name>/` | project `<name>` | yes |
| `synced` | `~/.claude/skills/synced/<org>_<account>/` (signed-in account) | claude.ai sync | no |
| `host-plugin` | `installed_plugins.json` entries | Claude Code plugin `<name@marketplace>` | no |
| `cc-core` | `<cc>/claude-plugin` | code-conductor (core) | no |
| `cc-plugin` | an enabled cc plugin's `claudePlugin` root | cc plugin `<id>` | no |
| `convention` | `<PROJECTS_ROOT>/.code-conductor/convention-skills/<instance>/<ns>/` | Settings → Conventions | no |

## Toggle semantics

- Overrides are keyed on the skill's name — frontmatter `name`, else the folder name — as the CLI keys them. When `name` and the folder disagree the skill is flagged and can't be toggled here.
- Disable writes `"off"` for that name: into `~/.claude/settings.json` (your skill) or the project's `.claude/settings.local.json` (project skill).
- Enable removes that key; if a lower layer (e.g. your user settings, for a project skill) still turns it off, it writes `"on"` instead.
- Managed policy (`managed-settings.json`, `managed-settings.d/*.json`, `remote-settings.json`) wins and can't be changed here.
- `name-only` and `user-invocable-only` values (set via `/skills`) are shown, not offered.
- Settings files that are symlinks are read through (as the CLI does). Toggling one is refused with an explanation of what to edit by hand, because the atomic write would replace the link. A symlinked `~/.claude` folder works normally.

## Pickup notices

| Change | When sessions see it |
|---|---|
| Your / project skill created, edited, deleted | Running sessions within seconds (Claude Code watches skill folders); if the skills folder didn't exist when a session started, only new sessions. |
| Project skill write | Lands in the main checkout, uncommitted; worktree sessions see it after it's merged into their branch. |
| Enable / disable | Running sessions when Claude Code reloads settings; new sessions always. |
| cc core / cc plugin skills | Fixed per session at creation; new sessions get changes. |
| Convention skills | Regenerated at each session launch. |

## Dirty-tree warning

After any project-scope write, the response carries the written path's git state; `dirty` is whether `git status --porcelain` reports the path (so restoring a committed skill unchanged is clean). When dirty, the UI says: commit it, or cc merges into this project will be refused (`PARENT_DIRTY`).
