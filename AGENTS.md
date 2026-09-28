# AGENTS.md: Provider Limits GNOME Extension

Guidelines for agents (and humans) contributing to this repository.

## Project

GNOME Shell extension that shows session limits of multiple AI coding
providers (Codex, Claude, OpenCode Go) in the top bar. Written in TypeScript,
transpiled to ESM JavaScript, runs in GJS (GNOME JavaScript).

## Language

All code, documentation, commits, issues, and PRs must be in **English**.

Read `CONTEXT.md` for the project glossary before making changes. Use the
terms defined there consistently. Don't introduce synonyms for terms that
already have a canonical name.

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
npm run test              # Node jasmine suite
npm run check             # typecheck + lint + format:check + check:i18n + test
npm run check:all         # check + GJS suite (skips without gjs)
npm run build             # tsc → dist/
npm run schema:compile    # glib-compile-schemas src/schemas
npm run pack              # build + compile schemas + gnome-extensions pack
npm run install:local     # pack + gnome-extensions install --force
```

### Landing page (GitHub Pages)

The site lives in `pages/` and is deployed by the `gh-pages` job in
`.github/workflows/ci.yml`. Preview locally:

```bash
cd pages
bundle install              # first run only
./bin/serve                # jekyll serve (preloads ruby_compat.rb)
```

`ruby_compat.rb` re-adds the no-op `Object#tainted?` that jekyll 3.9
(`github-pages`, liquid 4.0.3) calls at render time, removed in Ruby 3.2+.
Production runs Ruby 3.1 on GitHub Pages (where it is still a no-op), so the
shim is local-only and guarded.

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
├── formatters.ts          # field formatting by type
├── readers/
│   ├── base.ts            # BaseReader, ReaderResult, FieldDef interfaces
│   ├── codex.ts           # OAuth API + disk fallback
│   ├── claude.ts          # OAuth API + CLI PTY fallback
│   └── opencode.ts        # usage API + disk telemetry
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
pages/                     # GitHub Pages site (kept separate from app code)
├── index.md               # splash landing page
├── _config.yml            # Jekyll config (minimal-mistakes theme)
├── Gemfile                # github-pages gem + Ruby 4.0 stdlib shims
├── ruby_compat.rb         # re-adds Object#tainted? no-op for jekyll 3.9 on Ruby 3.2+
├── bin/                   # serve, build wrappers (preload ruby_compat.rb)
├── CNAME                  # custom domain
└── assets/images/         # demo screenshots / placeholders
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
   popover. No prefs code changes needed.

## Testing

The suite is split between two runners:

- **Node + Jasmine** (`npm run test`): pure modules (parsers, formatters,
  helpers, UI logic extraction). IO is mocked and no GNOME stack is required.
  `npm run check` runs this suite and is Node-only.
- **GJS** (`npm run test:gjs`): builds `dist/` and runs
  `tests/run-gjs-tests.mjs` against the specs in `tests/helpers`,
  `tests/readers`, and `tests/ui`. Covers gi-dependent modules; CI runs it
  with `gjs` and `gi://Soup`. The prefs UI test reports SKIP when the
  Gtk/Adw typelibs or a display are unavailable. `npm run check:all` runs
  `npm run check` followed by this suite, and `npm run test:gjs` skips
  gracefully when `gjs` is not installed.

- One `*.test.ts` per module, in `tests/`.
- Gio/Soup mocks live in the GJS tests (`tests/mocks/`); pure modules are
  tested in Node. No test makes live provider network calls.
- Use real payload fixtures (JSON/SQLite) captured from provider disk for
  parser tests. Put fixtures in `tests/fixtures/`.
- Shell-level rendering (panel, status bar, prefs window) still needs manual
  checking: install, enable, and verify the shell doesn't crash. The GJS
  prefs suite only constructs pages when a display is available.

## Security checklist for contributions

- [ ] No tokens, cookies, or PII in logs. Use `redactForLog()` from
      `helpers/log.ts` when logging objects.
- [ ] No credentials cached beyond the `read()` call scope.
- [ ] No files created outside GSettings (no cache/state files in v1).
- [ ] `reader.destroy()` clears local variables (tokens, cookies).
- [ ] No new dependencies that handle credentials (no keyring, no
      libsecret).
- [ ] No network calls to third-party endpoints (only provider APIs:
      chatgpt.com, api.anthropic.com, opencode.ai).

## i18n

- Strings in `extension.ts` and `prefs.ts` wrapped in `_()` (gettext).
- Any user-visible label or text added or changed by an implementation must be
  added to all existing language files in `src/po/` (`gnome-provider-limits.pot`,
  `en.po`, `pt_BR.po`, and any future languages). Do not leave new labels only
  in source code.
- gettext domain: `gnome-provider-limits` (in `metadata.json`).
- Initial languages: `en` (base) + `pt_BR`. Add `.po` files in `src/po/`.
- `language` GSettings key (default `''` = follow system locale).
- Update `src/po/POTFILES.in` when adding new translatable source files.

## Commits and PRs

- Keep changes small, focused, and easy to review.
- Run `npm run check` before pushing (typecheck + lint + format + test).
- Explain **why** the change is needed, not only what changed.
- Update `CONTEXT.md` glossary when new domain terms emerge.

- Never commit tokens, cookies, `.env` files, or local CLI state.
