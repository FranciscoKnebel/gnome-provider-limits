# Error handling: per-field granularity, fallback chain, visible per-provider state

Error handling operates at 3 levels: per field, per reader, per provider. No
error crashes the extension — errors are caught, logged, and become visible
state in the UI.

## 1. Per field (fine granularity)

Each field from `reader.read()` returns `{value, status}` where
`status ∈ {ok, unavailable, error}`:

- `ok` — value read successfully.
- `unavailable` — "no such data for this provider" (e.g. OpenCode v1 without
  cookies, limit field is unavailable). Silent in UI: becomes "—".
- `error` — "tried to read and failed" (e.g. HTTP 401, token expired, disk
  locked). Visible in UI: "—" with tooltip explaining the cause + suggested
  action.

## 2. Per reader (fallback chain)

Each reader tries paths in order (HTTP → disk → CLI, per ADR-0011). If a path
fails, it tries the next. If all fail, the reader returns `status: error`
global + friendly message (e.g. "Codex: token expired, run `codex login`").
The last error from each path is kept for diagnostics, shown in the provider
header tooltip in the panel.

## 3. Per provider (visible state in header)

The header of each section in the panel shows aggregated state:

- `ok` — at least one path worked, fields have values.
- `partial` — some fields ok, some unavailable/error (e.g. OpenCode v1 without
  cookies: telemetry ok from disk, limits unavailable).
- `error` — all paths failed, no field has a value.
- `disabled` — provider disabled in config (`<provider>-enabled=false`).

## 4. Interaction with adaptive refresh (ADR-0006)

- If the reader returns `error` global (e.g. token expired), adaptive polling
  does **not** degrade to the long interval — stays short, because the user
  can fix it (run `codex login`) and the reader should resume working soon.
- If it returns `unavailable` (structural, e.g. OpenCode v1 without cookies),
  degrades to long immediately (no point trying every 10s something that only
  changes when the user configures cookies).

## 5. No crash

Errors are caught by try/catch in the reader, logged via `console.log` (or
`Gio.File` debug to file), and become `error` state. The UI always renders
something, even if it's "Codex: error".

## 6. Educational tooltips

Each `error` field has a tooltip with the cause + suggested action:

- "Token expired, run `codex login`"
- "Run `claude` to refresh credentials"
- "Configure OpenCode cookies in preferences"

Rationale: per-field granularity preserves useful information (not every field
fails when one path fails). Fallback chain maximizes resilience. Visible
per-provider state educates the user about what's happening. Tooltips guide
action. A global error only ("Failed to fetch") hides information and
frustrates the user who wants to know what to do.
