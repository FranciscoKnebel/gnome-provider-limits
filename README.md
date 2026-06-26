# gnome-provider-limits

A GNOME Shell extension that shows session limits for Codex, Claude, and OpenCode in the top bar.

**Notice:** work in progress, very alpha at the moment.

## Motivation

AI coding CLIs enforce session-based and weekly rate limits that reset at unpredictable times. Checking your current usage means running a CLI command or opening a provider dashboard, both of which break your flow.

This extension reads the state each provider already persists on disk (auth tokens, SQLite databases, credentials files) and shows it in a compact status bar indicator, with an expanded panel on click. No extra auth flow, no token forwarding to third parties. It only reads what is already on your machine.

## Features

- Codex, Claude, and OpenCode in a single indicator
- Compact status bar for at-a-glance fields; expanded panel for full detail on click
- Choose which fields appear in each zone and in what order, per provider
- Adaptive polling: fast refresh (10 s) while limits are changing, slowing to 120 s once readings stabilize
- Each reader tries the best available source first (OAuth API), falls back to disk or CLI, and returns partial data rather than failing silently
- Tokens and cookies are read fresh on every refresh and discarded immediately after
- English and Brazilian Portuguese included; additional languages can be added via `.po` files
  - See [CONTRIBUTING.md](CONTRIBUTING.md) for more information on how to contribute.

### Provider details

| Provider     | Limit fields                                                                   | Telemetry fields                         | Data source                                                                |
| ------------ | ------------------------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------- |
| **Codex**    | Used % (5h window), Used % (weekly), Reset at, Limit reached                   | Plan type                                | OAuth API (`chatgpt.com`), SQLite disk fallback (`~/.codex/logs_2.sqlite`) |
| **Claude**   | Used % (session 5h), Used % (weekly), Used % (Sonnet), Used % (Opus), Reset at | Extra usage status                       | OAuth API (`api.anthropic.com`), CLI PTY fallback                          |
| **OpenCode** | _(coming in v1.x via web cookies)_                                             | Total cost, Sessions count, Token expiry | SQLite disk (`~/.local/share/opencode/opencode.db`)                        |

## Requirements

- GNOME Shell 45-50
- Node.js 22+ (build only)
- `glib-compile-schemas` (from `libglib2.0-dev-bin` or equivalent)
- `gnome-extensions` CLI (bundled with GNOME Shell)
- `python3` at runtime for SQLite reads (stdlib, no extra packages)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). For architectural decisions, read the ADRs (kept locally in `docs/adr/`) before proposing hard-to-reverse changes.

## License

GPL-3.0. See [LICENSE](LICENSE).
