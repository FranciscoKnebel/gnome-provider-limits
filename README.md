---
title: Provider Limits
layout: default
description: GNOME Shell extension that shows usage limits of AI coding providers (Codex, Claude, OpenCode) in the top bar.
---

[![CI](https://img.shields.io/github/actions/workflow/status/FranciscoKnebel/gnome-provider-limits/ci.yml?branch=main&label=CI&logo=github)](https://github.com/FranciscoKnebel/gnome-provider-limits/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/FranciscoKnebel/gnome-provider-limits/gh-pages/coverage.json)](https://github.com/FranciscoKnebel/gnome-provider-limits/actions/workflows/ci.yml)
[![GNOME Shell](https://img.shields.io/badge/GNOME_Shell-45–50-4a86cf)](https://extensions.gnome.org)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

A GNOME Shell extension that monitors session limits for **Codex**, **Claude**, and **OpenCode** directly from the top bar — no extra CLI commands, no dashboards, no breaking flow.

> Heads-up: the extension is in active development but usable day-to-day. If you rely on it, test a new version before updating.

---

## Motivation

AI coding CLIs enforce session-based and weekly rate limits that reset at unpredictable times. Checking your current usage means running a CLI command or opening a provider dashboard — both break your concentration.

This extension reads the local state each provider already persists on disk (auth tokens, SQLite databases, credentials files) and shows it in a compact status bar indicator, with an expanded panel on click. No extra auth flow, no token forwarding to third parties — it only reads what is already on your machine.

## Features

- **Multi-provider**: Codex, Claude, and OpenCode in a single indicator
- **Two display zones**: compact status bar for at-a-glance fields; expanded panel on click for full detail
- **Per-provider field configuration**: choose which fields appear in each zone and in what order, independently per provider
- **Adaptive polling**: refreshes every 10 seconds while readings change, slows to 120 seconds once stable (configurable thresholds)
- **Resilient readers**: each provider reader tries the best available source first (OAuth API), falls back to disk or CLI, and returns partial data rather than failing silently
- **No persistent tokens**: tokens and cookies are read fresh on every refresh and discarded immediately — nothing is stored beyond the `read()` call scope
- **Internationalization**: English and Brazilian Portuguese included; community translations via `.po` files

## Provider support

| Provider     | Limit fields                                                                   | Telemetry fields                         | Data source                                                                |
| ------------ | ------------------------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------- |
| **Codex**    | Used % (5h), Used % (weekly), Reset at, Limit reached                          | Plan type                                | OAuth API (`chatgpt.com`), SQLite disk fallback (`~/.codex/logs_2.sqlite`) |
| **Claude**   | Used % (session 5h), Used % (weekly), Used % (Sonnet), Used % (Opus), Reset at | Extra usage status                       | OAuth API (`api.anthropic.com`), CLI PTY fallback                          |
| **OpenCode** | _(coming in v1.x via web cookies)_                                             | Total cost, Sessions count, Token expiry | SQLite disk (`~/.local/share/opencode/opencode.db`)                        |

## Requirements

- **GNOME Shell** 45–50
- **Node.js** 22+ (build only)
- **glib-compile-schemas** (`libglib2.0-dev-bin` or equivalent)
- **gnome-extensions** CLI (bundled with GNOME Shell)
- **Python 3** at runtime (stdlib only, no extra packages) — used by the SQLite helper

## Installation

### From source

```bash
git clone https://github.com/FranciscoKnebel/gnome-provider-limits.git
cd gnome-provider-limits
npm ci
npm run build
npm run schema:compile
npm run install:local
gnome-extensions enable gnome-provider-limits@franciscoknebel.com
```

Restart the shell (`Alt+F2`, `r`, Enter) or log out and back in. Open preferences through the Extensions app or:

```bash
gnome-extensions prefs gnome-provider-limits@franciscoknebel.com
```

### From a release

Download the `.shell-extension.zip` from the [releases page](https://github.com/FranciscoKnebel/gnome-provider-limits/releases) and install:

```bash
gnome-extensions install --force gnome-provider-limits@franciscoknebel.com.shell-extension.zip
gnome-extensions enable gnome-provider-limits@franciscoknebel.com
```

## Configuration

Open the extension preferences through the Extensions app or via CLI:

```bash
gnome-extensions prefs gnome-provider-limits@franciscoknebel.com
```

From there you can:

- **Enable/disable** each provider independently
- **Reorder providers** in the indicator
- **Select fields** for the status bar and the panel per provider
- **Configure the CLI path** per provider
- **Override display names** (full and short labels)
- **Change the display language** (defaults to system locale)

## Development

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # oxlint
npm run test          # jasmine (GJS)
npm run check         # typecheck + lint + format:check + test
npm run build         # tsc → dist/
npm run pack          # build + schema compile + gnome-extensions pack
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed development workflow and best practices.

## Project structure

```
src/
├── extension.ts         # Entry point: PanelMenu.Button + refresh loop
├── prefs.ts             # Adw preferences window
├── constants.ts         # Defaults, provider names, schema ID
├── formatters.ts        # Field formatting by type
├── readers/             # One reader per provider (BaseReader interface)
│   ├── base.ts
│   ├── codex.ts
│   ├── claude.ts
│   └── opencode.ts
├── helpers/             # http.ts, subprocess.ts, sqlite.ts, log.ts
├── ui/                  # statusBar.ts, panel.ts, prefs/
├── schemas/             # GSettings schema XML
├── po/                  # i18n (POTFILES.in, .pot, en.po, pt_BR.po)
├── icons/               # Symbolic SVG
└── stylesheet.css       # St styling + usage-color thresholds
tests/                   # Jasmine tests + fixtures (mock all I/O)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes.

## License

GPL-3.0. See [LICENSE](LICENSE).
