# Contributing

Changes and improvements are welcome!

## How to contribute

1. Open an issue or clearly describe the proposed change in the pull request.
2. Keep changes small, focused, and easy to review.
3. Preserve and expand the project terminology defined in `CONTEXT.md`.
4. Include tests or verification instructions when the change affects behavior.
5. Update the documentation when adding, removing, or changing functionality.

## Best practices

- Prefer incremental changes over broad rewrites.
- Explain why the change is needed, not only what changed.
- Avoid including personal data, tokens, cookies, environment files, or local CLI state.
- For UI changes, consider the impact on both the status bar and the panel.

## License

By contributing, you agree that your contribution will be distributed under the terms of the project's license. See `LICENSE` for details.

## Local development

### 1. Install dependencies

```bash
npm ci
```

### 2. Available commands

```bash
npm run typecheck       # Type-check with tsc (no output)
npm run lint            # Lint with oxlint
npm run lint:fix        # Auto-fix lint issues
npm run format          # Format with oxfmt
npm run format:check    # Check formatting without writing
npm run test            # Build test bundle and run jasmine
npm run check           # Run all of the above together
npm run build           # Compile TypeScript -> dist/
npm run schema:compile  # Compile GSettings schema
npm run pack            # Full build + schema + zip the extension
npm run install:local   # pack + install into the current user session
```

Run `npm run check` before pushing to catch type errors, lint violations, and formatting issues in one step.

### 3. Install and enable locally

```bash
npm run install:local
gnome-extensions enable gnome-provider-limits@franciscoknebel.com
```

After enabling, restart GNOME Shell (`Alt+F2`, type `r`, press Enter on X11; log out and back in on Wayland) or use Looking Glass (`Alt+F2`, `lg`) to confirm the extension loaded without errors.

### 4. Preferences

Open extension preferences through the Extensions app or:

```bash
gnome-extensions prefs gnome-provider-limits@franciscoknebel.com
```

From there you can enable or disable providers, choose which fields appear in the status bar and panel, set the CLI path for each provider, and override the display language.

### 5. Running tests

```bash
npm run test
```

Each reader has a corresponding `tests/readers/<provider>.test.ts` file backed by payload fixtures in `tests/fixtures/`. Tests mock all network and disk I/O, so no real credentials or connections are used.

### 6. Logs

Look for `[codex]`, `[claude]`, or `[opencode]` prefixed lines in the GNOME Shell journal:

```bash
journalctl -f /usr/bin/gnome-shell
```

## Project structure

```
src/
├── extension.ts          # Entry point: PanelMenu.Button + refresh loop
├── prefs.ts              # Adw preferences window
├── constants.ts          # Defaults, provider names, schema ID
├── formatters.ts         # Field formatting by type
├── readers/              # One reader per provider (BaseReader interface)
├── helpers/              # http.ts, subprocess.ts, sqlite.ts, log.ts
├── ui/                   # statusBar.ts, panel.ts
├── schemas/              # GSettings schema XML
├── po/                   # i18n: POTFILES.in, .pot, en.po, pt_BR.po
├── icons/                # Symbolic SVGs
└── stylesheet.css        # St styling + usage-color thresholds
docs/adr/                 # 19 Architecture Decision Records
tests/                    # Jasmine tests + fixtures
```
