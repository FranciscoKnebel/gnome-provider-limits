# AGENTS.md — Provider Limits GNOME Extension

Guidelines for agents (and humans) contributing to this repository.

## Project

GNOME Shell extension that shows session limits of multiple AI coding
providers (Codex, Claude, OpenCode) in the top bar. Written in TypeScript,
transpiled to ESM JavaScript, runs in GJS (GNOME JavaScript).

## Language

All code, documentation, commits, issues, and PRs must be in **English**.

Read `CONTEXT.md` for the project glossary before making changes. Use the
terms defined there consistently. Don't introduce synonyms for terms that
already have a canonical name.

## Architecture

19 ADRs in `docs/adr/` cover all hard-to-reverse decisions. Read them before
making architectural changes. Key decisions:

- **ADR-0007:** Target GNOME Shell 45+, GJS/ESM, St + Adw. Sources in
  TypeScript, transpiled by `tsc` (no bundler).
- **ADR-0008:** All config in GSettings-native keys, prefixed per provider.
  No JSON embedded in strings.
- **ADR-0011:** Readers make HTTP calls to provider APIs using tokens/cookies
  already on disk (`~/.codex/auth.json`, `~/.claude/.credentials.json`).
  No own auth flow, no transmitting tokens to third parties.
- **ADR-0013:** Error handling at 3 levels: per field (FieldStatus), per
  reader (fallback chain), per provider (visible state in header). No error
  crashes the extension.
- **ADR-0016:** Readers implement `BaseReader` interface (`FIELDS` +
  `read()` → `ReaderResult`). Helpers (`http.ts`, `subprocess.ts`,
  `sqlite.ts`) are reusable wrappers.
- **ADR-0019:** Security — read tokens from disk every refresh, never cache
  credentials, never log credentials, never persist credentials ourselves,
  destroy everything in `disable()`.

## Development

### Prerequisites

- Node.js 22+
- GNOME Shell 45+ (for local testing)
- `glib-compile-schemas` (from `libglib2.0-dev-bin` or equivalent)
- `gnome-extensions` CLI (bundled with GNOME Shell)
- `python3` (for SQLite helper, stdlib on all GNOME desktops)

### Commands

```bash
npm ci                    # install deps
npm run typecheck         # tsc --noEmit
npm run lint              # oxlint
npm run lint:fix          # oxlint --fix
npm run format            # oxfmt --write .
npm run format:check      # oxfmt --check .
npm run test              # jasmine
npm run check             # typecheck + lint + format:check + test
npm run build             # tsc → dist/
npm run schema:compile    # glib-compile-schemas src/schemas
npm run pack              # build + compile schemas + gnome-extensions pack
npm run install:local     # pack + gnome-extensions install --force
```

### Code style

- **TypeScript** with `strict: true`. No `any` without justification.
- **oxfmt** formats code (Prettier-compatible, 100 char width, single
  quotes, trailing commas, semicolons). Run `npm run format` before
  committing.
- **oxlint** lints code (correctness errors, suspicious warnings, perf
  warnings). Run `npm run lint` before committing. Floating promises are
  errors.
- No comments unless necessary for clarity. Code should be self-documenting.
- One responsibility per file. Readers in `src/readers/`, UI in `src/ui/`,
  IO wrappers in `src/helpers/`, formatting in `src/formatters.ts`.

### Folder structure

```
src/
├── metadata.json          # GNOME extension metadata
├── extension.ts           # entry point (PanelMenu.Button + refresh loop)
├── prefs.ts               # Adw preferences window
├── constants.ts           # defaults, provider names, schema ID
├── formatters.ts          # field formatting by type (ADR-0018)
├── readers/
│   ├── base.ts            # BaseReader, ReaderResult, FieldDef interfaces
│   ├── codex.ts           # OAuth API + disk fallback
│   ├── claude.ts          # OAuth API + CLI PTY fallback
│   └── opencode.ts        # v1: disk only; v1.x: web cookies
├── helpers/
│   ├── http.ts            # Soup.Session wrapper (promisified)
│   ├── subprocess.ts      # Gio.Subprocess wrapper (timeout, pipes)
│   ├── sqlite.ts          # python3 + sqlite3 subprocess (cached)
│   └── log.ts             # redactForLog + logging helpers
├── ui/
│   ├── statusBar.ts       # compact St.BoxLayout
│   └── panel.ts           # PopupMenu detailed view
├── schemas/               # GSettings schema XML
├── po/                    # i18n (POTFILES.in, .pot, en.po, pt_BR.po)
├── icons/                 # symbolic SVG
└── stylesheet.css         # St styling + usage color thresholds
```

## Adding a new provider

1. Create `src/readers/<provider>.ts` extending `BaseReader`.
2. Implement `FIELDS` (readonly `FieldDef[]`) and `read()` (returns
   `Promise<ReaderResult>` with fallback chain).
3. Add GSettings keys to
   `src/schemas/org.gnome.shell.extensions.gnome-provider-limits.gschema.xml`:
   `<provider>-enabled` (b), `<provider>-cli-path` (s),
   `<provider>-status-fields` (as), `<provider>-panel-fields` (as).
4. Add provider name to `PROVIDER_NAMES` and `PROVIDER_LABELS` in
   `src/constants.ts`.
5. Wire up in `extension.ts` (`_createReader` switch).
6. Wire up in `prefs.ts` (provider page in preferences).
7. Update `CONTEXT.md` glossary if new domain terms emerge.
8. Write tests in `tests/readers/<provider>.test.ts` with payload fixtures.

## Adding a new field to an existing reader

1. Add `FieldDef` entry to the reader's `FIELDS` array.
2. Add the field to `_parsePayload` in the reader.
3. Update GSettings defaults in the schema XML if the field should appear by
   default.
4. The field appears automatically in the prefs UI "available fields"
   popover (ADR-0009). No prefs code changes needed.

## Testing

- **jasmine** running in GJS (via `jasmine-gjs` or `gjs-console` runner).
- One `*.test.ts` per module, in `tests/`.
- Mock `Soup.Session`, `Gio.Subprocess`, `Gio.File` — tests don't hit
  network/disk/CLI.
- Use real payload fixtures (JSON/SQLite) captured from provider disk for
  parser tests. Put fixtures in `tests/fixtures/`.
- UI is tested manually (install + enable + verify shell doesn't crash).

## Security checklist for contributions

- [ ] No tokens, cookies, or PII in logs. Use `redactForLog()` from
      `helpers/log.ts` when logging objects.
- [ ] No credentials cached beyond the `read()` call scope (ADR-0019).
- [ ] No files created outside GSettings (no cache/state files in v1).
- [ ] `reader.destroy()` clears local variables (tokens, cookies).
- [ ] No new dependencies that handle credentials (no keyring, no
      libsecret).
- [ ] No network calls to third-party endpoints (only provider APIs:
      chatgpt.com, api.anthropic.com, opencode.ai).

## i18n

- Strings in `extension.ts` and `prefs.ts` wrapped in `_()` (gettext).
- gettext domain: `gnome-provider-limits` (in `metadata.json`).
- Initial languages: `en` (base) + `pt_BR`. Add `.po` files in `src/po/`.
- `language` GSettings key (default `''` = follow system locale).
- Update `src/po/POTFILES.in` when adding new translatable source files.

## Commits and PRs

- Keep changes small, focused, and easy to review.
- Run `npm run check` before pushing (typecheck + lint + format + test).
- Explain **why** the change is needed, not only what changed.
- Update `CONTEXT.md` glossary when new domain terms emerge.
- Update or add ADRs when making hard-to-reverse decisions.
- Never commit tokens, cookies, `.env` files, or local CLI state.
