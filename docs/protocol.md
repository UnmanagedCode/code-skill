# Protocol

> See also: [README](../README.md) · [features](features.md) · [architecture](architecture.md)

All routes are under `/api`, JSON in and out. Refusals answer `{ ok: false, code, message, ...extra }` with the status shown. Write routes take `{scope, project?, name}` — never a path or an id. `scope` outside `user` / `project` → **403 `READ_ONLY_SOURCE`**.

## Routes

| Method / path | Body / query | Success | Refusals |
|---|---|---|---|
| GET `health` | – | `{ok:true}` | – |
| GET `inventory` | – | `InventoryResponse` | 502 `CONDUCTOR_UNREACHABLE` (only when cc is down; failing file sources go to `sourceErrors`) |
| GET `skills/detail?id=` | an id from the inventory (resolved by recomputing it) | `{skill, frontmatterText, body, files: string[], etag}` — `files` relative, regular files only, depth ≤ 3, at most 200 | 404 `NOT_FOUND` |
| POST `skills/validate` | `{dirName, frontmatterText, body}` | `{ok, errors[], description, whenToUse, cost}` | 400 `BAD_REQUEST` |
| POST `skills` | `{scope, project?, name, description, body}` | 201 `{id, etag, git, skill}` | 400 `INVALID_NAME`, `RESERVED_NAME`, `INVALID_FRONTMATTER`, `PATH_ESCAPE`, `SYMLINK_REFUSED`, `PROJECT_NOT_LOCAL`, `BAD_REQUEST`; 404 `UNKNOWN_PROJECT`; 409 `EXISTS`, `SKILLS_DIR_UNUSABLE` (the skills folder is a dangling symlink or a file). Input checks run before any folder is made. |
| PUT `skills/content` | `{scope, project?, name, frontmatterText, body, baseEtag}` | `{id, etag, git, skill}` | as above, plus 404 `NOT_FOUND`, 409 `STALE`; `INVALID_FRONTMATTER` carries `errors[]` |
| PUT `skills/enabled` | `{scope, project?, name, enabled}` (`name` = folder name) | `{override, git}` | 409 `POLICY_LOCKED`, `NAME_MISMATCH` (frontmatter `name` ≠ folder), `SETTINGS_UNPARSEABLE`, `SETTINGS_SHAPE`, `SETTINGS_BUSY`, `SYMLINK_REFUSED` (the settings file is a symlink; the message says what to edit by hand); 400 `PATH_ESCAPE`, `BAD_REQUEST`; 404 `NOT_FOUND` |
| POST `skills/delete` | `{scope, project?, name}` | `{trashId, git}` | 404 `NOT_FOUND`; 400 `PATH_ESCAPE`, `SYMLINK_REFUSED` |
| GET `trash` | – | `{entries: TrashMeta[]}` newest first | – |
| POST `trash/:trashId/restore` | – (`trashId` must match `^\d+-[0-9a-f]{8}$`) | `{id, git, skill}` | 404 `NOT_FOUND` (unknown or malformed entry); 400 `SYMLINK_REFUSED` (a symlink in the entry); 409 `RESTORE_CONFLICT`, `SKILLS_DIR_UNUSABLE`; 404 `UNKNOWN_PROJECT`; 400 `PROJECT_NOT_LOCAL`, `PATH_ESCAPE`, `SYMLINK_REFUSED`, `INVALID_NAME`; 403 `READ_ONLY_SOURCE` |
| GET `usage` | – | `UsageResponse` (concurrent calls share one scan) | – |

Any route: body > 256 KiB → 413 `BODY_TOO_LARGE`; malformed JSON → 400 `BAD_JSON`; unknown `/api` route → 404 `NOT_FOUND`; unexpected failure → 500 `INTERNAL` (logged).

`etag` = sha256 hex of the SKILL.md bytes. `git` is `null` for user-scope writes, else `GitReport`. `skill` is the fresh `SkillRecord` (or `null` if it can't be found).

## Shapes

```ts
type Source = 'user'|'project'|'synced'|'host-plugin'|'cc-core'|'cc-plugin'|'convention';

type SkillRecord = {
  id: string;            // `${source}:${ownerKey}:${dirName}`; ownerKey: user '~', project <name>, synced '~',
                         // host-plugin '<name>@<mkt>' (project/local scope adds '(<scope> <projectPath>)'),
                         // cc-core <namespace>, cc-plugin <cc plugin id>, convention `${ns}#${sha8}`
  source: Source;
  owner: { label: string; project?: string; plugin?: string; namespace?: string; scope?: string /* host-plugin */ };
  writable: boolean;                               // true exactly for user and project
  toggleable: boolean;                             // writable, and frontmatter name absent or equal to dirName
  dirName: string; name: string | null;            // frontmatter name
  invokeName: string;                              // skillName = name || dirName; namespace ? `${namespace}:${skillName}` : skillName
  namespace: string | null;
  path: string;                                    // absolute SKILL.md path (display only)
  description: string; whenToUse: string | null;
  disableModelInvocation: boolean; userInvocable: boolean;
  override: null | {                               // set for every writable record; keyed on skillName, like the CLI
    effective: 'on'|'name-only'|'user-invocable-only'|'off';
    layers: { layer: 'user'|'project'|'local'|'policy'; file: string; value: string }[];
    lockedByPolicy: boolean;
    otherProjects?: { project: string; layer: 'project'|'local'; value: string }[];   // user skills only
  };
  cost: { listing: 'full'|'name-only'|'hidden'; chars: number; tokens: number; truncated: boolean };
  enabled?: boolean;                               // host-plugin only
  sessions?: { instanceId: string; label: string; status: string | null }[];   // convention only
  warnings: string[];
};

type InventoryResponse = {
  skills: SkillRecord[];
  projects: string[];                              // registered local project names (new-skill targets)
  totals: { key: string; label: string; source: Source; everySession: boolean; count: number; chars: number; tokens: number }[];
  budget: {
    contexts: { contextTokens: number; chars: number; live: boolean }[];   // 200k, 1M, plus live contextWindowTokens; ascending
    baseline: { count: number; chars: number; tokens: number };            // what every session lists
  };
  duplicates: { invokeName: string; ids: string[]; note: string }[];
  nearDuplicates: { a: string; b: string; score: number }[];
  sourceErrors: { source: Source | 'settings'; message: string }[];
};

type UsageResponse = {
  skills: { invokeName: string; count: number; lastUsedAt: string | null; sessions: number }[];   // most used first
  scan: { files: number; filesRead: number; bytesRead: number; malformedLines: number; ms: number; at: string };
};

type GitReport = {
  path: string;                                    // relative to the project
  status: 'tracked'|'untracked'|'ignored'|'no-repo'|'unknown';   // git ls-files / check-ignore
  dirty: boolean | null;                           // git status --porcelain reports the path; false outside a repo; null if git failed
};

type TrashMeta = { trashId: string; scope: 'user'|'project'; project: string | null; name: string; originalPath: string; deletedAt: string };
```

Duplicate notes: `user skill wins; project copy is shadowed`, `same invoke name from several sources`, `differs between sessions` (convention variants).

## Static files

`/` → `public/index.html`; `/<file>.(js|css)` and `/views/<file>.js` from `public/`; `/shared/<file>.js` from `shared/`. Names match `[A-Za-z0-9][A-Za-z0-9_-]*` + extension. Everything else is 404 — including `/pluginBridge.js` and `/pluginTheme.css` standalone. No SPA fallback. `Cache-Control: no-store`.

## Response headers (every response)

- `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'` (`CSP` in `src/http/securityHeaders.js`)
- `X-Content-Type-Options: nosniff`

## Manifest

`conductor.plugin.json`: id `code-skill`, `backend.start` `npm start`, `backend.healthPath` `/api/health`, `frontend.path` `/`, `frontend.navLabel` `Code Skill`. No `mcp`.

## cc API consumed

`GET /api/projects`, `GET /api/plugins` (`rows`), `GET /api/projects/:name/worktrees`, `GET /api/instances` on `CONDUCTOR_URL`, no auth, 5 s timeout each.
