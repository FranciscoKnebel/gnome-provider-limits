# Publish honestly what each provider exposes

> **Status:** partially superseded by ADR-0011. With HTTP direct using disk
> tokens, now all 3 providers expose real limits (5h + weekly), not just
> Codex. The limits/telemetry distinction still holds, but the per-provider
> mapping below has been expanded to include HTTP paths.

Each reader publishes only the fields it can actually obtain from disk or the
provider's CLI/API. The extension doesn't invent limits the provider doesn't
expose, doesn't extrapolate telemetry to "percentage remaining", and doesn't
treat "usage" as "limit". The UI shows what exists, labeled by what it is.

Per-provider mapping (v1, post-ADR-0011):

- **Codex** - **limit** fields: `used_percent` (primary 5h / secondary weekly),
  `reset_at`, `window_minutes`, `limit_reached`, `plan_type`, `credits`.
  Preferred source: OAuth API (`~/.codex/auth.json` →
  `chatgpt.com/backend-api/wham/usage`). Fallback: disk
  (`~/.codex/logs_2.sqlite` `codex.rate_limits` payload).
- **Claude** - **limit** fields: `used_percent` (session 5h / weekly / sonnet /
  opus), `reset_at`. Preferred source: OAuth API
  (`~/.claude/.credentials.json` → `api.anthropic.com/api/oauth/usage`).
  Fallback: CLI PTY (`claude` + parsed `/usage`). Cost telemetry fields from
  disk (`~/.claude.json` last session tokens) remain available as extras.
- **OpenCode** - **limit** fields: `used_percent` (rolling 5h / weekly),
  `reset_at`. Source: Web API cookies (`opencode.ai/_server`). Cookie import
  on Linux is complex. v1 may start with disk telemetry (`opencode.db`:
  `cost`, `tokens_*`, `sessionsCount`, `tokenExpiresAt`) and gain limits via
  cookies in v1.x.

Rationale: only Codex persists real limits on disk. Claude and OpenCode
persist usage telemetry (tokens/cost) and account/plan metadata, not limits.
Even with CLI fallback (ADR-0003), Claude and OpenCode don't expose limits.
they only aggregate the same telemetry. Inventing "remaining limit" from
telemetry would be dishonest and produce meaningless numbers. Showing honestly
what each provider has keeps the extension useful (usage state of all CLIs in
one panel) and doesn't mislead the user.
