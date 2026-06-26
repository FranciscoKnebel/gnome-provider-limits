# gnome-provider-limits

[![CI](https://img.shields.io/github/actions/workflow/status/FranciscoKnebel/gnome-provider-limits/ci.yml?branch=main&label=CI&logo=github)](https://github.com/FranciscoKnebel/gnome-provider-limits/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/FranciscoKnebel/gnome-provider-limits/gh-pages/coverage.json)](https://github.com/FranciscoKnebel/gnome-provider-limits/actions/workflows/ci.yml)
[![GNOME Shell](https://img.shields.io/badge/GNOME_Shell-45–50-4a86cf)](https://extensions.gnome.org)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

A GNOME Shell extension that shows session limits for Codex, Claude, and OpenCode in the top bar.

Heads-up: the extension is in active development but usable day-to-day. If you rely on it, test a new version before updating.

## Motivation

AI coding CLIs enforce session-based and weekly rate limits that reset at unpredictable times. Checking your current usage means running a CLI command or opening a provider dashboard — both break your flow.

This extension reads the local state each provider already persists on disk (auth tokens, SQLite databases, credentials files) and shows it in a compact status bar indicator, with an expanded panel on click. No extra auth flow, no token forwarding to third parties — it only reads what is already on your machine.

## Features

- Codex, Claude, and OpenCode in a single indicator
- Compact status bar for at-a-glance fields; expanded panel for full detail on click
- Choose which fields appear in each zone and in what order, per provider
- Adaptive polling: fast refresh (10 s) while limits change, slowing to 120 s once readings stabilize
- Each reader tries the best available source first (OAuth API), falls back to disk or CLI, and returns partial data rather than failing silently
- Tokens and cookies are read fresh on every refresh and discarded immediately
- English and Brazilian Portuguese included; additional languages via `.po` files

### Provider details

| Provider     | Limit fields                                                                   | Telemetry fields                         | Data source                                                                |
| ------------ | ------------------------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------- |
| **Codex**    | Used % (5h), Used % (weekly), Reset at, Limit reached                          | Plan type                                | OAuth API (`chatgpt.com`), SQLite disk fallback (`~/.codex/logs_2.sqlite`) |
| **Claude**   | Used % (session 5h), Used % (weekly), Used % (Sonnet), Used % (Opus), Reset at | Extra usage status                       | OAuth API (`api.anthropic.com`), CLI PTY fallback                          |
| **OpenCode** | _(coming in v1.x via web cookies)_                                             | Total cost, Sessions count, Token expiry | SQLite disk (`~/.local/share/opencode/opencode.db`)                        |

## Requirements

- GNOME Shell 45–50
- Node.js 22+ (build only)
- `glib-compile-schemas` (`libglib2.0-dev-bin` or equivalent)
- `gnome-extensions` CLI (bundled with GNOME Shell)
- Python 3 at runtime for SQLite reads (stdlib, no extra packages)

## Quick start

```bash
npm ci
npm run build
npm run schema:compile
npm run install:local
gnome-extensions enable gnome-provider-limits@franciscoknebel.com
```

Restart the shell or log out and back in. Open preferences through the Extensions app or `gnome-extensions prefs gnome-provider-limits@franciscoknebel.com`.

All available `npm run` commands are listed in [`package.json`](package.json) under `scripts`.

## Project structure

```
src/
├── extension.ts         # Entry point (PanelMenu.Button + refresh loop)
├── prefs.ts             # Adw preferences window
├── constants.ts         # Defaults, provider names, schema ID
├── formatters.ts        # Field formatting by type
├── readers/             # One reader per provider (BaseReader interface)
│   ├── base.ts
│   ├── codex.ts         + codexParser.ts
│   ├── claude.ts        + claudeParser.ts
│   └── opencode.ts      + opencodeParser.ts
├── helpers/             # http.ts, subprocess.ts, sqlite.ts, log.ts
├── ui/                  # statusBar.ts, panel.ts
├── schemas/             # GSettings schema XML
├── po/                  # i18n (POTFILES.in, .pot, en.po, pt_BR.po)
├── icons/               # Symbolic SVG
└── stylesheet.css       # St styling
tests/                   # Jasmine tests + fixtures (mock all I/O)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing hard-to-reverse changes.

## License

GPL-3.0. See [LICENSE](LICENSE).
