# Reader local-only: no network calls, no extra auth

> **Status:** superseded by ADR-0003 (2026-06-21). The "disk only" policy was
> relaxed to disk-first / CLI-fallback because not every provider persists
> limits on disk. ADR-0003 preserves the spirit of this one (no own network,
> no extra auth, no transmitting tokens); it only allows invoking the
> provider's installed CLI when disk doesn't have the data.

The extension reads only state files already persisted on disk by each
provider's CLI (`~/.claude/`, `~/.codex/`, `~/.config/opencode/`, etc.). It
makes no network calls to provider APIs, requires no credentials beyond what
the user already configured for their own CLI, and never transmits tokens. If
a provider doesn't persist the limit data in a legible way locally, it shows
as "unavailable" instead of simulating the value.

Rationale: keeps the extension offline-first, avoids dealing with network auth
and reverse rate-limiting, and respects user token privacy. The cost is being
dependent on what each CLI decides to write — and not all of them write
"remaining limit" explicitly.
