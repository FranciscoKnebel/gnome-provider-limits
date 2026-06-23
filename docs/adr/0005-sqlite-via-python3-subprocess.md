# SQLite reading via python3 subprocess

Codex persists `codex.rate_limits` in `~/.codex/logs_2.sqlite` (table `logs`,
column `feedback_log_body`, JSON payload with `used_percent`, `reset_at`,
`limit_reached`, `plan_type`). OpenCode persists telemetry in
`~/.local/share/opencode/opencode.db` (table `session` with `cost`,
`tokens_*`, `model`, `agent`). GJS has no native SQLite bindings; `sqlite3`
CLI isn't installed by default on GNOME distros; `libgda` via GObject
Introspection exists but isn't installed by default either.

Decision: read SQLite by invoking `python3` via `Gio.Subprocess`, with the
needed query serialized as an argument and the result returned as JSON on
stdout. Python3 is stdlib on every Linux desktop with GNOME, and `sqlite3` is
in its stdlib, so zero extra dependencies beyond python3 which is already
there.

Usage rules:

- Each reader that needs SQLite defines its own minimal query (only the
  necessary columns, `ORDER BY ... LIMIT 1` for the most recent case).
- The subprocess is spawned per refresh, not kept as a daemon. Expected cost
  < 50ms per query; spaced refresh (seconds/minutes, see refresh ADR) makes
  overhead negligible.
- `JSON.parse` of stdout in GJS. Subprocess errors (python3 missing, DB
locked, schema changed) become "unavailable" for the affected fields. They
don't crash the extension.
- For the Claude reader, GJS reads `~/.claude.json` directly with `JSON.parse`
  (no subprocess, no SQLite). The data is plain JSON.
- `opencode stats` as optional fallback for window aggregation, if disk data
  isn't enough; never as the default path.

Rationale: keeps the extension self-contained (only GJS + python3, both
present on any GNOME desktop), avoids extra dependencies (`sqlite3` CLI,
`libgda`), and preserves the "no network, no extra auth" principle. The
process spawn cost is mitigated by spaced refresh and minimal query.
