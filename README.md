# gnome-provider-limits

[![CI](https://img.shields.io/github/actions/workflow/status/FranciscoKnebel/gnome-provider-limits/ci.yml?branch=main&label=CI&logo=github)](https://github.com/FranciscoKnebel/gnome-provider-limits/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/FranciscoKnebel/gnome-provider-limits/gh-pages/coverage.json)](https://github.com/FranciscoKnebel/gnome-provider-limits/actions/workflows/ci.yml)
[![GNOME Shell](https://img.shields.io/badge/GNOME_Shell-45-50-4a86cf)](https://extensions.gnome.org)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

GNOME Shell extension that displays session limits for Codex, Claude, and OpenCode in your top bar. It reads local status files directly, so you do not need to run CLI commands or open browser dashboards.

> Note: The extension is in active development. If you rely on it daily, test new versions before updating.

---

## Motivation

AI coding CLIs enforce session and weekly rate limits that reset at unpredictable times. Checking your usage usually requires running a CLI command or opening a provider dashboard, which interrupts your work.

This extension reads the local files and SQLite databases that providers already save on your machine, such as authentication tokens or credentials files. It shows this data in a compact top-bar indicator and an expandable dropdown panel. The extension does not perform external authentication or send tokens to third parties. It only reads what is already stored locally.

## Features

- Monitor Codex, Claude, and OpenCode in a single status bar indicator.
- Use the compact top bar indicator for quick updates, or click to open the dropdown panel for full details.
- Choose which fields appear in each zone and arrange their order, customized per provider.
- Save resources with adaptive polling: updates run every 10 seconds during active usage and slow to 120 seconds once readings stabilize.
- Rely on fallback chains: readers try the best source first (like OAuth APIs) and fall back to local disk files or CLIs.
- Protect credentials: the extension reads tokens and cookies fresh on each update and discards them immediately.
- Translate easily: the interface supports multiple languages.

## Provider support

| Provider | Limit fields                                                                   | Telemetry fields                         | Data source                                                                |
| -------- | ------------------------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------- |
| Codex    | Used % (5h), Used % (weekly), Reset at, Limit reached                          | Plan type                                | OAuth API (`chatgpt.com`), SQLite disk fallback (`~/.codex/logs_2.sqlite`) |
| Claude   | Used % (session 5h), Used % (weekly), Used % (Sonnet), Used % (Opus), Reset at | Extra usage status                       | OAuth API (`api.anthropic.com`), CLI PTY fallback                          |
| OpenCode | _(coming in v1.x via web cookies)_                                             | Total cost, Sessions count, Token expiry | SQLite disk (`~/.local/share/opencode/opencode.db`)                        |

## Requirements

- GNOME Shell versions 45 to 50
- Node.js 22 or newer (required only for building)
- glib-compile-schemas (from libglib2.0-dev-bin or equivalent package)
- gnome-extensions CLI (included with GNOME Shell)
- Python 3 at runtime (uses the standard library to execute the SQLite helper)

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

After installing, restart your GNOME Shell (press `Alt+F2`, type `r`, and hit Enter) or log out and log back in. Configure the settings using the Extensions app or by running:

```bash
gnome-extensions prefs gnome-provider-limits@franciscoknebel.com
```

### From a release

Download the `.shell-extension.zip` file from the [releases page](https://github.com/FranciscoKnebel/gnome-provider-limits/releases), then install and enable it:

```bash
gnome-extensions install --force gnome-provider-limits@franciscoknebel.com.shell-extension.zip
gnome-extensions enable gnome-provider-limits@franciscoknebel.com
```

## Configuration

Open the extension preferences using the Extensions app or the command line:

```bash
gnome-extensions prefs gnome-provider-limits@franciscoknebel.com
```

From there you can:

- Toggle each provider on or off.
- Reorder the providers as they appear in the top bar.
- Choose which fields show up in the status bar and the dropdown panel.
- Set the path to the CLI executable for each provider.
- Customize the display names and short labels.
- Set the interface language (defaults to your system locale).

## Development

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # oxlint
npm run test          # jasmine (GJS)
npm run check         # typecheck + lint + format:check + test
npm run build         # compile typescript to dist/
npm run pack          # compile, compile schemas, and pack the extension
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and guidelines.

### Landing page

The GitHub Pages site lives in `pages/` and is deployed by the `gh-pages` job
in `.github/workflows/ci.yml`. Preview it locally:

```bash
cd pages
bundle install              # first run only
./bin/serve                # http://127.0.0.1:4000
```

`bin/serve` preloads `ruby_compat.rb`, a no-op shim that lets jekyll 3.9
(`github-pages`) render on Ruby 3.2+ (production runs Ruby 3.1, where it is a
no-op).

## Project structure

```
src/
├── extension.ts         # Entry point: PanelMenu.Button and the refresh loop
├── prefs.ts             # Preferences window (libadwaita)
├── constants.ts         # Defaults, provider names, and the GSettings schema ID
├── formatters.ts        # Helper functions to format limit fields
├── readers/             # Provider-specific readers implementing BaseReader
│   ├── base.ts
│   ├── codex.ts
│   ├── claude.ts
│   └── opencode.ts
├── helpers/             # Subprocess wrappers, SQLite helpers, and HTTP requests
├── ui/                  # Status bar indicator and dropdown panel components
├── schemas/             # GSettings XML schemas
├── po/                  # Translation files (POTFILES.in, en.po, pt_BR.po)
├── icons/               # Symbolic icons
└── stylesheet.css       # Custom styles and status coloring
tests/                   # Jasmine tests and mock fixtures
pages/                   # GitHub Pages website files
```

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting pull requests.

## License

This project is licensed under the GPL-3.0 license. See [LICENSE](LICENSE) for the full text.
