# gnome-provider-limits

GNOME extension that shows session limits of multiple AI coding providers,
reading only state already persisted on disk by each provider's CLI.

## Language

**Provider**:
An AI provider, i.e., a coding CLI that will share usage state locally.
_Avoid_: Service, API, vendor.

**Reader**:
Component of the extension that knows where and how to read a specific
provider's local state, and normalize it to the common shape displayed in the
UI. Tries disk first; if the field doesn't exist, invokes the provider's CLI
(configurable path) to obtain it.
_Avoid_: Parser, scraper, client.

**SQLite Helper**:
`python3` invocation via `Gio.Subprocess` with `sqlite3` from the stdlib, used
by readers that need to read provider SQLite databases (Codex, OpenCode).
Returns JSON on stdout. Not a daemon; spawned per refresh.
_Avoid_: Driver, connector, ORM.

**Field**:
A named piece of information that a reader can extract from a provider's local
state (e.g. `prompts_used`, `reset_at`, `percent_remaining`). Each provider
exposes a different set of fields.
_Avoid_: Metric, attribute, datum.

**Status Bar**:
Compact zone of the extension, always visible in the GNOME panel. Shows few
fields per provider, in little space.
_Avoid_: Tray, icon, indicator.

**Panel**:
Expanded window when clicking the extension. Shows fields that don't fit in
the status bar, with more detail.
_Avoid_: Popup, dropdown, menu.

**Provider Configuration**:
Per-provider configuration that defines which fields to display, in which zone
(status bar or panel) and in which order.
_Avoid_: Profile, preset.

**Limit Field**:
A field that expresses an active provider restriction on usage, e.g.
`used_percent`, `remaining_percent`, `reset_at`, `limit_reached`. Codex and
Claude expose limits via provider APIs using disk tokens/cookies; Codex also via
disk (`logs_2.sqlite`). OpenCode must not reuse Codex-compatible account limits
as OpenCode limits.
_Avoid_: Quota (when referring to telemetry).

**OpenCode Go State**:
Local usage state written by OpenCode Go. In this project, OpenCode fields must
come from OpenCode Go state, not from Codex-compatible OpenAI account limits,
even when OpenCode uses an OpenAI account under the hood.
_Avoid_: Codex limits, OpenAI usage limits.

**OpenCode Observed Spend Limit**:
Limit field calculated from OpenCode Go local spend observed in
`opencode.db`, using fixed OpenCode Go windows and USD ceilings. It is not an
official provider-reported account limit, and it does not include OpenCode usage
outside the local OpenCode Go state.
_Avoid_: Official OpenCode limit, OpenAI limit, Codex limit.

**Telemetry Field**:
A field that expresses usage already performed, with no reference to a ceiling
, e.g. `totalCost`, `lastTotalInputTokens`, `sessionsCount`. Cannot be
presented as "remaining" or "percentage of limit".
_Avoid_: Usage metric, statistic.

**Provider Display Name**:
User-configurable label for a provider in the UI.
`*-display-name` (full, used in panel and prefs) and `*-display-name-short`
(compact, used in status bar). Defaults match the previous hardcoded labels.
_Avoid_: Label, title (when referring to the configuration key).

**Language**:
Display language of the extension. Default follows the system locale (`LANG` /
`LC_MESSAGES`); manual override via GSettings `language` (s, default `''` =
system). Initially `en` and `pt_BR`, expandable via `.po` files.
_Avoid_: Locale, translation (when referring to the mechanism).

**Refresh**:
A read cycle of all enabled readers, manual or scheduled. Started by
`refresh()` in `extension.ts`, runs all readers in parallel (`Promise.allSettled`).
Has a generation counter (`_refreshGeneration`) to discard stale cycles.
_Avoid_: Update, sync, poll.

**Force Refresh**:
A manual `Refresh` triggered by the "Force refresh" button in the panel.
Semantically identical to any other Refresh; only the trigger differs.
_Avoid_: Manual update, re-fetch.

**Last Refresh At**:
Timestamp of when the most recent `Refresh` cycle completed, global across all
providers. Shown in the panel footer next to the "Force refresh" button. One
per extension instance, not per provider. Captured in `refresh()` after the
generation guard, only by the winning run.
_Avoid_: Last update, refresh time (ambiguous with per-provider).

**Last Updated**:
Per-provider timestamp of when that provider's state was actually read,
already carried by `ReaderResult.lastUpdated`. Shown inside each provider
section in the panel. Can differ from `Last Refresh At` only if a stale
result is carried over from a previous cycle (see `Refresh` generation).
_Avoid_: Last update, refresh time (ambiguous with global).

**Running Refresh**:
State in which at least one `Refresh` cycle is in progress. Tracked by a
counter of concurrent cycles (`_pendingRefreshes`) on the extension; the
`Running Refresh Indicator` is on while the counter is greater than zero.
The "Force refresh" button is blocked while a `Running Refresh` is in
progress, but scheduled refreshes can still overlap with a manual one.
Only the winning run (the one whose generation matches `_refreshGeneration`
at completion) updates `Last Refresh At`; discarded runs still decrement
the counter.
_Avoid_: Busy, loading, in-flight.

**Running Refresh Indicator**:
Visual cue for `Running Refresh` in the panel footer: an `St.Spinner` shown
while at least one `Refresh` is in progress. Toggled by `setRunning()` on the
`PanelWidget`; independent of `render()` so it does not trigger a full panel
rebuild. Does not appear in the status bar.
_Avoid_: Spinner (when referring to the concept), loading icon, busy cursor.

**Panel Footer**:
Bottom region of the `Panel` containing the "Force refresh" button, the
`Running Refresh Indicator`, and the `Last Refresh At` label. Rendered by
`_addRefreshRow()` in `panel.ts`; updated by `setRunning()` without a full
rebuild. The "Force refresh" button is blocked while a `Running Refresh` is
in progress.
_Avoid_: Status row, action bar.
