# Disk-first, CLI-fallback — no own network

> **Status:** superseded by ADR-0011 (2026-06-21). The "CLI only" policy was
> relaxed to "HTTP direct using tokens/cookies already persisted on disk by
> the provider" because not every provider exposes limits via CLI (OpenCode
> has no CLI-only path; Claude PTY is heavy). ADR-0011 preserves the original
> spirit of ADR-0001 — no extra auth, no transmitting tokens to third
> parties.

Each reader tries first to read state persisted on disk by the provider
(`~/.claude/`, `~/.codex/`, `~/.local/share/opencode/`, etc.). If the desired
field doesn't exist on disk, the reader invokes the provider's own installed
CLI (e.g. `claude`, `codex`, `opencode`) to obtain it. The extension never
makes its own network calls, never reads/transmits auth tokens, and never
implements its own auth flow — any call leaving the machine happens through
the provider's CLI, with credentials the user already configured for it.

The CLI binary path is configurable per provider (e.g. `claude.path =
/usr/bin/claude`). If the CLI isn't configured or isn't in PATH, fields that
would depend on it show as "unavailable" — and fields that exist on disk keep
working.

Rationale: only Codex persists `rate_limits` on disk (in
`~/.codex/logs_2.sqlite`, `codex.rate_limits` payload); Claude Code and
OpenCode persist only usage telemetry (tokens/cost from last session) and
account/plan metadata, not limits. To support the three providers with real
limits, it's necessary to invoke CLIs where disk isn't enough. Keeping the
flow through the provider's CLI (rather than a direct API call) preserves the
"no extra auth, no transmitting tokens" principle: the user already trusted
the CLI, the extension just reuses that channel.

When disk has the data (e.g. Codex), the reader doesn't invoke the CLI —
invocation is fallback, never the default path. This minimizes unnecessary
executions and keeps the extension lightweight.
