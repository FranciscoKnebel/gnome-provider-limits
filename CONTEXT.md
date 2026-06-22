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
Returns JSON on stdout. Not a daemon — spawned per refresh.
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
A field that expresses an active provider restriction on usage — e.g.
`used_percent`, `reset_at`, `limit_reached`. All three providers expose limits
via HTTP using disk tokens/cookies (Codex OAuth, Claude OAuth, OpenCode web
cookies); Codex also via disk (`logs_2.sqlite`).
_Avoid_: Quota (when referring to telemetry).

**Telemetry Field**:
A field that expresses usage already performed, with no reference to a ceiling
— e.g. `totalCost`, `lastTotalInputTokens`, `sessionsCount`. Cannot be
presented as "remaining" or "percentage of limit".
_Avoid_: Usage metric, statistic.

**Language**:
Display language of the extension. Default follows the system locale (`LANG` /
`LC_MESSAGES`); manual override via GSettings `language` (s, default `''` =
system). Initially `en` and `pt_BR`, expandable via `.po` files.
_Avoid_: Locale, translation (when referring to the mechanism).
