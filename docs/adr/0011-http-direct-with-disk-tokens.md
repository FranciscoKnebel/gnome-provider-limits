# HTTP direct with disk tokens/cookies (relaxes ADR-0003)

> **Status:** supersedes ADR-0003. The "CLI only" policy was relaxed to "HTTP
> direct using tokens/cookies already persisted on disk by the provider".
> ADR-0001 was already superseded by ADR-0003.

Readers may make direct HTTP calls to provider APIs using tokens/cookies
already persisted on disk by the provider itself (`~/.codex/auth.json`,
`~/.claude/.credentials.json`, browser cookies for OpenCode). We don't ask for
new credentials, don't implement our own auth flow, don't transmit tokens to
third parties. Tokens go only to the provider's own API (chatgpt.com,
api.anthropic.com, opencode.ai).

This is what CodexBar (15.2k stars, 53 providers) and the installed reference
extension (`codex-usage-indicator@stone.dev`, uses `Soup.Session` with
`Authorization: Bearer <token>` read from `auth.json`) do. This is a validated
approach.

Per-provider path (v1):

- **Codex** - OAuth API: reads tokens from `~/.codex/auth.json`, calls
  `GET https://chatgpt.com/backend-api/wham/usage` with Bearer. Returns
  `rate_limit.primary_window` (5h: `used_percent`, `reset_at`) +
  `secondary_window` (weekly) + `additional_rate_limits[]` + `credits` +
  `plan_type`. Fallback: disk `~/.codex/logs_2.sqlite` `codex.rate_limits`
  payload (already validated).
- **Claude** - OAuth API: reads `~/.claude/.credentials.json`, calls
  `GET https://api.anthropic.com/api/oauth/usage` with Bearer + header
  `anthropic-beta: oauth-2025-04-20`. Maps `five_hour` to session,
  `seven_day` to weekly, `seven_day_sonnet`/`seven_day_opus` to model-specific.
  Fallback: CLI PTY (`claude` + parsed `/usage`).
- **OpenCode** - Web API (cookies): `POST https://opencode.ai/_server` with
  cookies from `opencode.ai`. Returns `rollingUsage.usagePercent` +
  `resetInSec` (5h) + `weeklyUsage.usagePercent` + `resetInSec` (weekly).
  Cookie import on Linux is more complex (read Chrome/Firefox cookies, with
  encryption). OpenCode may start in v1 with disk telemetry (`opencode.db`)
  and gain limits via cookies in v1.x when the cookie path is implemented.

GJS has `Soup` (libsoup) native. The reference extension proves it works.
Adaptive refresh (ADR-0006) still applies: HTTP is expensive, so the short
interval (10s) is only worth it when data changes; otherwise degrades to 120s.
In-memory cache avoids re-render without change.

Rationale: CLI-only (ADR-0003) left OpenCode without limits (no CLI-only path)
and made Claude dependent on PTY (heavy, fragile). HTTP direct with disk
tokens maintains the original spirit of ADR-0001: "no extra auth, no
transmitting tokens to third parties". It enables all 3 providers with real
limits (5h + weekly), aligned with the user requirement and validated by
CodexBar.
