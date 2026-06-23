# GSettings-native config, keys prefixed per provider

All configuration is persisted in native GSettings keys (typed, validatable,
dconf-editor-friendly). No JSON embedded in a string. Each value stays in the
most common format expected by GSettings/GNOME.

Globals (adaptive refresh, ADR-0006):

- `refresh-short-interval-seconds` (i, default 10)
- `refresh-long-interval-seconds` (i, default 120)
- `refresh-stable-reads-threshold` (i, default 3)

Per provider (prefix `<provider>-`), repeated for each of the 3 providers
(codex, claude, opencode):

- `<provider>-enabled` (b, default true): whether the provider appears in UI
- `<provider>-cli-path` (s, default `''` = auto-detect in PATH): path to the
  CLI binary for fallback (ADR-0003)
- `<provider>-status-fields` (as, ordered array of field names): which
  fields appear in the status bar and in which order
- `<provider>-panel-fields` (as, ordered array of field names): which
  fields appear in the panel and in which order

Total: 3 globals + 3 providers × 4 keys = 15 keys. Verbose in the schema, but
each key is simple, typed, validatable, and binds directly with Adw widgets
(`Adw.SpinRow` for ints, `Adw.SwitchRow` for bools, `Adw.EntryRow` for
strings, toggle list + drag-order for `as` arrays).

Default `as` arrays per provider (reasonable selection: status bar with
essentials, panel with the rest):

- `codex-status-fields`: `['used_percent_primary','reset_at_primary']`
- `codex-panel-fields`: `['used_percent_secondary','reset_at_secondary','window_minutes_primary','window_minutes_secondary','limit_reached','plan_type']`
- `claude-status-fields`: `['used_percent_session','reset_at_session']`
- `claude-panel-fields`: `['used_percent_weekly','reset_at_weekly','used_percent_sonnet','used_percent_opus','hasExtraUsageEnabled','extraUsageDisabledReason']`
- `opencode-status-fields`: `['used_percent_rolling','reset_at_rolling']`
- `opencode-panel-fields`: `['used_percent_weekly','reset_at_weekly','totalCost','sessionsCount','tokenExpiresAt']`

Rationale: the user rejected JSON embedded in a string, so keep values in the
most common format expected by GSettings. Per-provider prefixed keys are
verbose in the XML schema, but each is simple and native. Adding a new
provider = adding 4 keys (mechanical, explicit). Default `as` arrays come with
a reasonable selection; the user adjusts in the prefs UI.
