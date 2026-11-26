# gnome-provider-limits

[![CI](https://img.shields.io/github/actions/workflow/status/FranciscoKnebel/gnome-provider-limits/ci.yml?branch=main&label=CI&logo=github)](https://github.com/FranciscoKnebel/gnome-provider-limits/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/FranciscoKnebel/gnome-provider-limits/gh-pages/coverage.json)](https://github.com/FranciscoKnebel/gnome-provider-limits/actions/workflows/ci.yml)
[![GNOME Shell](https://img.shields.io/badge/GNOME_Shell-45-50-4a86cf)](https://extensions.gnome.org)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

GNOME Shell extension that displays usage limits for Codex, Claude, OpenCode Go, Grok/SuperGrok, Cursor, and Google (Gemini / Antigravity) in your top bar. It reads existing local credentials and usage state, querying only provider endpoints, so you do not need to open browser dashboards.

> Note: The extension is in active development. If you rely on it daily, test new versions before updating.

---

## Motivation

AI coding CLIs enforce session and weekly rate limits that reset at unpredictable times. Checking your usage usually requires running a CLI command or opening a provider dashboard, which interrupts your work.

This extension reads the local files and SQLite databases that providers already save on your machine, such as authentication tokens or credentials files. It shows this data in a compact top-bar indicator and an expandable dropdown panel. The extension does not perform external authentication or send tokens to third parties. It only reads what is already stored locally.

## Features

- Monitor Codex, Claude, OpenCode Go, Grok/SuperGrok, Cursor, and Google in a single status bar indicator.
- Use the compact top bar indicator for quick updates, or click to open the dropdown panel for full details.
- Choose which fields appear in each zone and arrange their order, customized per provider.
- Save resources with adaptive polling: updates run every 10 seconds during active usage and slow to 120 seconds once readings stabilize.
- Rely on fallback chains: readers try the best source first (like OAuth APIs) and fall back to local disk files or CLIs.
- Protect credentials: the extension reads tokens and cookies fresh on each update and discards them immediately.
- Translate easily: the interface supports multiple languages.

## Provider support

| Provider         | Limit fields                                                                                       | Telemetry fields                                                | Data source                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Codex            | Used % (5h), Used % (weekly), Reset at, Limit reached                                              | Plan type                                                       | OAuth API (`chatgpt.com`), SQLite disk fallback (`~/.codex/logs_2.sqlite`)                                                           |
| Claude           | Used % (session 5h), Used % (weekly), Used % (Sonnet), Used % (Opus), Reset at                     | Extra usage status                                              | OAuth API (`api.anthropic.com`), CLI PTY fallback                                                                                    |
| OpenCode Go      | Used % (rolling 5h), Used % (weekly), Used % (monthly), Reset at, Limit reached                    | Total cost, Sessions count                                      | Usage API (`opencode.ai/zen/go/v1/usage`), SQLite telemetry (`~/.local/share/opencode/opencode.db`)                                  |
| Grok / SuperGrok | Used % (credits), Remaining % (credits), Reset at (credits)                                        | Purchased credits (USD), Shared subscription credits, Plan type | Grok subscription credits API (`cli-chat-proxy.grok.com`), login from `~/.grok/auth.json`                                            |
| Cursor           | Used % (credits), Remaining % (credits), Reset at (credits), Used % (Auto + Composer / API), Limit | Remaining credits (USD), On-demand spend (USD), Plan type       | Cursor SDK `DashboardService` (`api2.cursor.sh`), login from `~/.cursor/sdk/auth.json`, `~/.cursor/auth.json`, or `~/.config/cursor` |
| Google           | Used % (session 5h), Used % (weekly), Used % (Claude & GPT 5h / weekly), Reset at, Limit reached   | Plan type                                                       | Google Cloud Code quota API (`cloudcode-pa.googleapis.com`), login from Gemini CLI or Antigravity                                    |

Each provider needs its own CLI login or local credential file. See
[Provider dependencies](#provider-dependencies) for the required dependency and
the files or environment variables the extension reads.

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
- Set the path to the Claude CLI or to an existing authentication file for Grok, Cursor, or Google.
- Customize the display names and short labels.
- Set the interface language (defaults to your system locale).

### Provider dependencies

The extension reads credentials and usage state that the official provider tools
already store locally. Install the provider tool and sign in once before enabling
the provider. The extension does not install provider tools and does not launch
them during refreshes, except for the Claude CLI fallback.

| Provider         | Required dependency                               | Sign-in                                       | What the extension reads                                                                                                                |
| ---------------- | ------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Codex            | Codex CLI (`codex`)                               | `codex login`                                 | `$CODEX_HOME/auth.json` or `~/.codex/auth.json`; `logs_2.sqlite` for disk fallback                                                      |
| Claude           | Claude Code CLI (`claude`)                        | Sign in by running `claude`                   | `$CLAUDE_CONFIG_DIR/.credentials.json` or `~/.claude/.credentials.json`; CLI fallback for `/usage`                                      |
| OpenCode Go      | OpenCode CLI (`opencode`) with OpenCode Go access | `opencode auth login`, then start OpenCode Go | `$XDG_DATA_HOME/opencode/opencode.db` or `~/.local/share/opencode/opencode.db`; `auth.json`; `OPENCODE_API_KEY`                         |
| Grok / SuperGrok | Grok Build CLI (`grok`)                           | `grok login`                                  | `$GROK_HOME/auth.json` or `~/.grok/auth.json`                                                                                           |
| Cursor           | Cursor CLI (`cursor-agent`)                       | `cursor-agent login`                          | `$CURSOR_HOME/sdk/auth.json`, `$XDG_CONFIG_HOME/cursor/auth.json`, or `$CURSOR_HOME/auth.json`; `CURSOR_AUTH_TOKEN` or `CURSOR_API_KEY` |
| Google           | Gemini CLI (`gemini`) or Antigravity              | Sign in with either tool                      | Gemini `oauth_creds.json`, Antigravity ACP token, or Google Application Default Credentials                                             |

The Codex and OpenCode Go disk sources use the Python 3 SQLite helper listed in
[Requirements](#requirements). `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `XDG_DATA_HOME`,
`GROK_HOME`, `CURSOR_HOME`, and `XDG_CONFIG_HOME` are read from the GNOME Shell
environment when set.

#### Codex

Install the Codex CLI and run `codex login`. The reader reads
`$CODEX_HOME/auth.json` or `~/.codex/auth.json` and queries the ChatGPT usage API.
When the API is unavailable, it reads the latest `codex.rate_limits` entry from
`$CODEX_HOME/logs_2.sqlite` or `~/.codex/logs_2.sqlite`, so run the CLI at least
once after signing in. The extension does not launch the Codex CLI.

#### Claude

Install the Claude Code CLI and sign in by running `claude`. The reader reads
`$CLAUDE_CONFIG_DIR/.credentials.json` or `~/.claude/.credentials.json` and
queries the Anthropic usage API. When OAuth credentials are unavailable or
expired, it launches `claude --allowed-tools ""` in a temporary directory, sends
`/usage` and `/exit`, and parses the output. Set **Claude CLI path** in preferences
if `claude` is not in `PATH`.

#### OpenCode Go

Install the OpenCode CLI, run `opencode auth login`, and start OpenCode Go at least
once. The reader reads the active OpenCode credential from
`$XDG_DATA_HOME/opencode/opencode.db` or `~/.local/share/opencode/opencode.db`
(v2), or from `auth.json` in the same directory (v1), and queries the Zen Go usage
API. `OPENCODE_API_KEY` is also accepted. Disk telemetry, including total cost and
session count, comes from `opencode.db`. The extension does not launch the
OpenCode CLI.

### Grok / SuperGrok

Grok is disabled by default. Install the official [Grok Build CLI](https://x.ai/cli),
run `grok login` with your personal SuperGrok or SuperGrok Heavy account, then enable
Grok in the extension preferences. No xAI API key or Management API key is needed.
The CLI is used only to sign in, not launched by the extension during refreshes.

The reader loads `~/.grok/auth.json` on every refresh. It also respects `GROK_HOME`
when set in the GNOME Shell environment. Use **Authentication file** in the Grok
preferences to select an existing `auth.json` in another location; `~/` is supported.
Only this path is saved in GSettings, never tokens. Expired or rejected credentials
require signing in again with `grok login`; the extension never refreshes tokens,
reads browser cookies, writes authentication files, or makes billable inference requests.
Grok Build logins with Team principals are supported. xAI API-key logins are not.

Subscription usage comes from
`https://cli-chat-proxy.grok.com/v1/billing?format=credits`, the endpoint used by
the official CLI. The plan name is optional enrichment from `/v1/settings`.
The current weekly or monthly reset comes from the response, not an assumed schedule.
**Shared subscription credits** reflects `isUnifiedBillingUser`: only accounts with
unified billing share this allowance across Grok products. Otherwise the endpoint
reports Grok Build credits, not every Grok chat model's message allowance.
Per-model message limits, image/video limits, xAI API billing, and reset coupons
are not monitored. Purchased credits are a separate USD balance, never a percentage
of subscription usage. An omitted percentage stays unavailable, even if the server
returns a reset or purchased balance.

These are first-party CLI endpoints, not a versioned public usage API, and can change.
The implementation was researched against the official
[billing contract](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/extensions/billing.rs),
[authentication guide](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-pager/docs/user-guide/02-authentication.md),
and the independent [CodexBar Grok investigation](https://github.com/steipete/CodexBar/blob/main/docs/grok.md).
A live authenticated Team-principal login was verified against the billing endpoint.
No live account payload or credential is stored in this repository.

### Cursor

Cursor is disabled by default. Install the Cursor CLI and sign in:

```bash
curl https://cursor.com/install -fsS | bash
cursor-agent login
```

The installer also creates an `agent` alias. Use `cursor-agent` if another tool
already provides `agent`. Installing the Cursor IDE alone is not enough. Cursor SDK
auth files are also accepted.

Then enable Cursor in the extension preferences. The reader checks
`$CURSOR_HOME/sdk/auth.json` (`~/.cursor/sdk/auth.json`), `~/.config/cursor/auth.json`,
and `~/.cursor/auth.json` on every refresh (falling back to `CURSOR_AUTH_TOKEN` or
`CURSOR_API_KEY` when no custom file is configured). You can also specify an explicit
authentication file in the Cursor preferences (`~/` is supported).

Recent `cursor-agent` versions keep the session token in the GNOME keyring and leave only
`{"storedIn": "os-secret-store"}` in `~/.config/cursor/auth.json`. For that marker the reader
runs a read-only `secret-tool search --all service cursor-credentials account cursor-user` on
every refresh with the same validation as a disk credential and without caching or storing
anything.
The search only returns already unlocked entries, so a locked keyring never triggers an unlock
prompt. The encrypted desktop IDE keyring state (`state.vscdb`) is intentionally not read.

When an SDK `apiKey` is present without a session token, the reader exchanges it for a
short-lived bearer token via `https://api2.cursor.sh/auth/exchange_user_api_key` and
queries `DashboardService/GetCurrentPeriodUsage` (plus optional `DashboardService/GetPlanInfo`
for the plan name) using the `@cursor/sdk` ConnectRPC JSON contract. Credentials with
custom `backendUrl` values are rejected so tokens are never sent outside `api2.cursor.sh`.
The implementation and test fixture (`tests/fixtures/cursor-period-usage.json`) are derived
from the official `@cursor/sdk` and `DashboardService` contracts; live authenticated account
behavior was not captured in this repository.

### Google (Gemini / Antigravity)

Google is disabled by default. Sign in with the official Gemini CLI (`gemini`) or
Antigravity, then enable Google in the extension preferences. The reader checks
`$ANTIGRAVITY_ACP_TOKEN_PATH`, `$GEMINI_HOME/oauth_creds.json` (or
`$GEMINI_CLI_HOME/.gemini/oauth_creds.json` / `~/.gemini/oauth_creds.json`),
`~/.gemini/antigravity-acp/acp_token.json`, `~/.gemini/antigravity/acp_token.json`,
`~/.config/antigravity/acp_token.json`, existing T3 Code Antigravity ACP logins, and
finally Application Default Credentials (`$GOOGLE_APPLICATION_CREDENTIALS` and
`~/.config/gcloud/application_default_credentials.json`) on every refresh (or an
explicit authentication file configured in Google preferences; `~/` is supported).
Service-account keys and credentials with non-Google `token_uri` values are rejected.

Unexpired `access_token` values (such as `@google/gemini-cli` `oauth_creds.json`) are
used directly. When `refresh_token`, `client_id`, and `client_secret` are all present
in the credential file (such as Antigravity `acp_token.json` or `authorized_user` ADC
files), expired OAuth tokens are refreshed in memory via
`https://oauth2.googleapis.com/token` and discarded immediately after the refresh
cycle (never written back to disk). Subscription quotas are queried via
`v1internal:retrieveUserQuotaSummary` (falling back to `v1internal:fetchAvailableModels`)
and optional plan-tier lookup (`v1internal:loadCodeAssist`) across
`https://daily-cloudcode-pa.googleapis.com` and `https://cloudcode-pa.googleapis.com`,
covering both Google AI Pro / Google AI Ultra / Gemini Code Assist 5-hour and weekly
Gemini windows as well as Antigravity's Claude & GPT 5-hour and weekly pools.

## Development

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # oxlint
npm test              # Node jasmine suite (builds tests first, runs c8 coverage)
npm run test:gjs      # GJS suite (builds dist/ first; skips when gjs is missing)
npm run check         # typecheck + lint + format:check + check:i18n + npm test
npm run check:all     # npm run check + npm run test:gjs
npm run build         # compile typescript to dist/
npm run pack          # compile, compile schemas, and pack the extension
```

`c8` instruments only modules that Node can load (the pure helpers and
parsers). The GJS suite covers the rest: the readers always run, while the
prefs UI checks run when a display and the Gtk/Adw typelibs are available
and report SKIP otherwise (CI is headless). `npm run check:all` adds the GJS
suite to `npm run check`; `npm run test:gjs` skips gracefully with a warning
when `gjs` is not installed.

## Releasing

Run one release command from a clean, up-to-date `main` checkout:

```bash
npm run release -- patch
```

Use `minor` or `major` for those version bumps. The script uses the latest
version tag on `origin` as the version source, updates `package.json`, the lock
file, `metadata.json`'s `version-name`, and translation headers, runs
`npm run check`, then commits and pushes the release commit and tag together.
The tag workflow verifies that the tag matches both `package.json` and
`metadata.json`, and points into `main`; it then runs the checks, builds the
extension ZIP once, and publishes that same ZIP to the GitHub release.

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
│   ├── opencode.ts
│   ├── grok.ts
│   ├── cursor.ts
│   └── google.ts
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

### Authenticated data flow and local SQLite access

Existing credentials are sent only to their respective first-party provider APIs
(chatgpt.com, api.anthropic.com, opencode.ai, cli-chat-proxy.grok.com,
api2.cursor.sh, oauth2.googleapis.com, cloudcode-pa.googleapis.com, and
daily-cloudcode-pa.googleapis.com) to read usage. There is no separate extension
account or third-party credential collection. The extension does not persist
credentials or raw provider error payloads in logs.

The SQLite Helper always opens databases with `mode=ro`, behind a Linux seccomp
filter that denies writable file opens and filesystem mutation before SQLite runs.
It never falls back to `immutable=1` for a live database. Complete, readable WAL
state is supported; incomplete WAL state or pending recovery can be unavailable.
If the sandbox cannot be installed (or the CPU is not x86_64 or aarch64), local
SQLite telemetry is unavailable rather than using an unsafe fallback. API reads
continue to work. Python's standard library is the only runtime dependency.

Building translation catalogs requires GNU `msgfmt` (the `gettext` package).
Language selection reads the extension's compiled catalogs without changing the
process `LANGUAGE` or gettext default domain.
