# Handoff: gnome-provider-limits, v1 implementation continuation

## Context

Repository: `/home/francisco/gnome-provider-limits`
Remote: `git@github.com:FranciscoKnebel/gnome-provider-limits.git`
Branch: `main` (only 1 commit: "Initial commit")
All work is uncommitted (untracked + modified files).

This is a GNOME Shell extension that shows session limits of multiple AI
coding providers (Codex, Claude, OpenCode) in the top bar. The design phase
is complete; scaffolding is in place; implementation of reader internals and
GObject type fixes is the next focus.

## What was done in the previous session

1. **Grilling session** (using `grilling` + `domain-modeling` skills):
   interviewed the user about every aspect of the design, producing 19 ADRs
   and a glossary.

2. **Scaffolding**: TypeScript project structure with `tsc`, `oxlint`,
   `oxfmt`, `jasmine`. All 14 source files stubbed with real interfaces and
   partial implementations. GSettings schema with 15 keys. CI workflow.
   `AGENTS.md` for contribution guidelines.

3. **Translation**: all ADRs and `CONTEXT.md` translated from Portuguese to
   English (repo is public, all content must be English).

4. **Verification**: `npm run format:check` passes. `npm run lint` passes
   (0 errors, 1 warning). `npm run typecheck` has 26 errors, all from
   GObject.registerClass + TS type inference (see "Next steps" below).

## Reference artifacts (do not re-read all; reference by path as needed)

- **ADRs**: `docs/adr/0001-*.md` through `docs/adr/0019-*.md`, covering 19 decisions (kept locally, not tracked in repo).
  Key ones for implementation:
  - `0011-http-direct-with-disk-tokens.md`: reader HTTP strategy
  - `0016-reader-interface-helpers.md`: BaseReader interface, helper shapes
  - `0013-error-handling-three-levels.md`: FieldStatus, fallback chains
  - `0018-field-formatting-by-type.md`: formatField() contract
  - `0019-security-policy.md`: no caching credentials, redactForLog
- **Glossary**: `CONTEXT.md` with 10 domain terms
- **Contribution guide**: `AGENTS.md` (symlinked as `CLAUDE.md`)
- **Reference extension** (installed locally):
  `~/.local/share/gnome-shell/extensions/codex-usage-indicator@stone.dev/`:
  uses `Soup.Session` with Bearer token, `Adw` prefs, `PanelMenu.Button`.
  Useful as a working JS example of the GJS patterns we need.
- **CodexBar docs** (web): `https://github.com/steipete/CodexBar/blob/main/docs/`
  These files document the exact API endpoints,
  payload shapes, and fallback chains per provider. These are the source of
  truth for reader implementations.

## Current state of checks

```
npm run format:check  → PASS
npm run lint          → PASS (0 errors, 1 warning: preserve-caught-error in sqlite.ts)
npm run typecheck     → 26 errors (all GObject.registerClass type inference)
npm run test          → not yet runnable (jasmine needs GJS runner setup)
```

## Next steps (in priority order)

### 1. Fix GObject.registerClass TypeScript type inference (26 errors)

This is the blocker. Nothing else can be typechecked until these are
resolved. The errors fall into 3 categories:

**a) `resource:///` module resolution (5 errors)**
`tsconfig.json` cannot find modules like
`resource:///org/gnome/shell/extensions/extension.js`. The `@girs/gnome-shell`
package provides ambient declarations via `*-ambient.d.ts` files, but they
need to be referenced. Current `src/globals.d.ts` has `/// <reference>`
directives but they may not be picked up. Check:

- `node_modules/@girs/gnome-shell/dist/extensions/extension-ambient.d.ts`
  declares `module "resource:///org/gnome/shell/extensions/extension.js"`.
- The `prefs.ts` import path has wrong case:
  `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js` (capital S)
  vs the ambient declaration which uses lowercase
  `resource:///org/gnome/shell/extensions/...`. Fix the import path in
  `src/prefs.ts` line 8.

**b) GObject parent members not inherited (14 errors)**
Classes registered via `GObject.registerClass()` don't inherit parent members
in TS's type inference. Affected:

- `ProviderLimitsIndicator` (extends `PanelMenu.Button`): missing `add_child`,
  `menu`, etc.
- `PanelWidget` (extends `PopupMenu.PopupMenuSection`): missing `removeAll`,
  `addMenuItem`.
- `ProviderLimitsPreferencesPage` (extends `Adw.PreferencesPage`): missing
  `_settings` (it's a custom field, not parent, so needs `declare` like
  `extension.ts` already does for its fields).
- `StatusBarWidget` (extends `St.BoxLayout`): missing `add_child`,
  `remove_child`.

Fix: add `declare` field declarations for custom fields (pattern already used
in `extension.ts` lines 25-33). For parent members (`add_child`, `menu`,
`addMenuItem`, `removeAll`), either:

- Study the gjsify/gnome-shell hello-world example:
  `node_modules/@girs/gnome-shell/` repo has `examples/hello-world/`. Check
  their `tsconfig.json` and class patterns.
- Or use type assertions (`this as unknown as PanelMenu.Button`).add_child(...)
  as a last resort.
- Or check if `@girs/gnome-shell` expects a different `tsconfig` `paths`
  mapping.

**c) Misc (7 errors)**

- `src/extension.ts:69`: `require()` is not available in ESM/GJS. Replace
  with a static import of `PROVIDER_NAMES` at the top of the file (it was
  originally there but got moved to `require` during a fix attempt).
- `src/extension.ts:175`: `ProviderLimitsIndicator` used as type but it's a
  value (from `registerClass`). Use `InstanceType<typeof
ProviderLimitsIndicator>` or restructure.
- `src/prefs.ts:145`: `getSettings()` doesn't exist on
  `ExtensionPreferences`. Check the `@girs/gnome-shell` type for the correct
  method name (might be `this.getSettings()` via `ExtensionPreferences`
  base class. Verify the ambient declaration).
- `src/ui/statusBar.ts:66`: `string` not assignable to `FieldType`. The
  `_getFieldType` method returns `string` but should return `FieldType`.
  Change the return type annotation.

### 2. Implement reader TODOs

Each reader has `// TODO:` markers. The payloads and endpoints are documented
in CodexBar docs (see reference artifacts above).

**Codex reader** (`src/readers/codex.ts`):

- `_fetchUsage(token)`: use `helpers/http.ts` `HttpClient.getJson()` with
  header `Authorization: Bearer <token>`, URL
  `https://chatgpt.com/backend-api/wham/usage`. Parse
  `CodexRateLimitsPayload`.
- `_readFromDisk()`: use `helpers/sqlite.ts` `querySqlite()` on
  `~/.codex/logs_2.sqlite`, query: `SELECT feedback_log_body FROM logs WHERE
feedback_log_body LIKE '%codex.rate_limits%' ORDER BY ts DESC LIMIT 1`.
  Parse the JSON from `feedback_log_body`.

**Claude reader** (`src/readers/claude.ts`):

- `_fetchUsage(token)`: use `HttpClient.getJson()` with headers
  `Authorization: Bearer <token>` and `anthropic-beta: oauth-2025-04-20`,
  URL `https://api.anthropic.com/api/oauth/usage`. Parse
  `ClaudeUsagePayload`.
- `_readFromCli()`: use `helpers/subprocess.ts` to invoke `claude
--allowed-tools ""` in a PTY, send `/usage`, parse rendered "Current
  session" and "Current week" output. This is the most complex fallback.
  study CodexBar's `ClaudeStatusProbe.swift` for parsing patterns.

**OpenCode reader** (`src/readers/opencode.ts`):

- `_readFromDisk()`: use `querySqlite()` on
  `~/.local/share/opencode/opencode.db`, query `SELECT SUM(cost) as
total_cost, COUNT(*) as sessions_count FROM session` + read
  `~/.local/share/opencode/auth.json` for `openai.expires` (token
  expiry). v1 is disk-only; web cookies for real limits come in v1.x.

### 3. Implement `helpers/subprocess.ts` `readPipe()`

The `readPipe()` function is a placeholder returning `''`. Implement async
reading from `Gio.InputStream` using `Gio.DataInputStream.read_line_async()`
or `Gio.InputStream.read_all_async()`. Reference:
`~/.local/share/gnome-shell/extensions/codex-usage-indicator@stone.dev/` for
GJS async patterns.

### 4. Implement prefs field lists (ADR-0017)

`src/prefs.ts` currently has only the General page + a basic per-provider
page with CLI path entry. Missing:

- "Status bar fields" sortable list with DnD + "+" popover + "−" remove
- "Panel fields" sortable list (same pattern)
- Dynamic page add/remove on `<provider>-enabled` toggle
- Field preview formatted by `type` using `formatField()` from
  `src/formatters.ts`

Use `Gtk.ListBox` with `Gtk.DragSource`/`Gtk.DropTarget` per row (GTK4 DnD).
Each row = `Adw.ActionRow` with field label + formatted preview suffix.

### 5. Create i18n files

`src/po/POTFILES.in` lists source files. Need:

- Generate `gnome-provider-limits.pot` from source strings wrapped in `_()`
- Create `en.po` (base, identity translations)
- Create `pt_BR.po` (Brazilian Portuguese translation)

### 6. Create symbolic icon

`src/icons/provider-limits-symbolic.svg`, a simple symbolic SVG icon for
the status bar. Can be a minimal gauge/meter shape. Reference existing
symbolic icons in `/usr/share/icons/Adwaita/scalable/status/` for style.

### 7. Reader tests

Create `tests/readers/*.test.ts` with payload fixtures captured from real
provider disk state. Fixtures in `tests/fixtures/`. Mock `Soup.Session`,
`Gio.Subprocess`, `Gio.File`. Test parsing and fallback chains per ADR-0013.

### 8. Smoke test

```bash
npm run install:local
gnome-extensions enable gnome-provider-limits@franciscoknebel.com
# Verify shell doesn't crash, data appears in top bar
```

## Suggested skills

- **`grilling`**: if the user wants to stress-test any remaining design
  decisions before implementation (e.g., the GObject type fix approach, or
  the OpenCode cookie import strategy for v1.x).
- **`domain-modeling`**: if new domain terms emerge during implementation
  (e.g., cookie import mechanics, PTY parsing patterns). Update
  `CONTEXT.md` and add ADRs if hard-to-reverse decisions come up.
- **`customize-opencode`**: if the user wants to adjust opencode's own
  configuration (skills, commands, agents) while working on this project.

## Environment notes

- Node.js 22+ (via nvm at `~/.nvm/versions/node/v22.16.0/`)
- GNOME Shell 50.1 on Ubuntu 26.04 LTS
- `gjs` and `gnome-extensions` CLI available
- `python3` available (for SQLite helper)
- `sqlite3` CLI NOT installed (hence the python3 approach, per ADR-0005)
- Provider CLIs installed: `~/.local/bin/claude`, `~/.local/bin/codex`,
  `~/.opencode/bin/opencode`
- Real provider state on disk for testing:
  - `~/.codex/auth.json`, `~/.codex/logs_2.sqlite` (has `codex.rate_limits`)
  - `~/.claude/.credentials.json`, `~/.claude.json`
  - `~/.local/share/opencode/opencode.db`, `~/.local/share/opencode/auth.json`
- Claude org auth is currently expired ("Your organization does not have
  access to Claude"). Claude reader will hit this during testing; useful for
  testing the error handling path (ADR-0013).

## Key decisions to respect

- **No JSON in GSettings** (ADR-0008): all config is native typed keys
- **No credential caching** (ADR-0019): read from disk every refresh
- **No keyring/libsecret** (ADR-0019): reuse provider's own disk credentials
- **English only** in all code, docs, commits, issues, PRs
- **TypeScript strict mode**: no `any` without justification
- **oxfmt + oxlint**: run `npm run format` and `npm run lint` before
  committing. Floating promises are errors.
- **No comments** unless necessary for clarity (AGENTS.md)
