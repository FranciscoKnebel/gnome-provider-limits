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

**Reset Credit**:
A banked rate-limit reset granted by OpenAI for Codex, redeemable to reset the
weekly and 5-hour rate-limit windows. Reported by the Codex usage API as
`rate_limit_reset_credits` (summary) and the rate-limit-reset-credits endpoint
(details with per-credit `status` and `expires_at`), and exposed as the
`reset_credits_available` and `reset_credits_expire_at` fields. The extension
only reports Reset Credits; it never redeems one.
_Avoid_: Reset token, voucher.

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
system). A language is considered supported only when its `.po` file is fully
translated (every translatable string has a non-empty `msgstr`). On `enable()`,
`extension.ts` self-heals a stale `language` value: if the configured code has
no corresponding compiled `.mo` in the bundle, it resets `language` to `''`,
unsets `LANGUAGE`, and logs the fallback. This heals after a downgrade or a
language removal without the user opening prefs. The heal persists to GSettings
(matches the user's hidden intent — they chose the language when it was
supported, not to stay on it once removed).
_Avoid_: Locale, translation (when referring to the mechanism).

**LINGUAS**:
The authoritative manifest of supported languages: a plain text file at
`src/po/LINGUAS` with one locale code per line (e.g. `en`, `pt_BR`). `compile:mo`,
`check:i18n`, and the prefs language dropdown all derive their set of languages
from it. Adding a language = append its code to `LINGUAS` _and_ add a fully
translated `.po` file to `src/po/`. A `.po` file not listed in `LINGUAS` is a
draft and must not ship. `check:i18n` enforces completeness for every language
in `LINGUAS`: each `.po` must exist, contain every translatable string as a
`msgid`, and have a non-empty `msgstr` for every entry. Any `.po` file under
`src/po/` not listed in `LINGUAS` is auto-discovered as a draft and gets a
non-blocking advisory report of missing/empty strings, so translators get
progress feedback before promoting the file to `LINGUAS`.
_Avoid_: Language list, registry, catalog (when referring to the manifest).

**Draft `.po`**:
A `.po` file under `src/po/` not listed in `LINGUAS`. Visible to
`check:i18n` as an advisory report (missing and empty `msgstr` entries),
non-blocking. Promoting a draft to a supported language = append its code to
`LINGUAS` once fully translated; the same file then flips from advisory to
strict checking. No second manifest (e.g. a draft list) is maintained —
absence from `LINGUAS` is the draft marker.
_Avoid_: In-progress translation, staging `.po`, pending language.

**Translation Template**:
The `gnome-provider-limits.pot` file under `src/po/`, the human-readable
catalog of every translatable string extracted from source. Hand-maintained
(no `xgettext` call exists in the project; `check:i18n`'s regex extractor is
the de facto source of truth). `check:i18n` validates it against source-string
extraction on every `npm run check` to catch drift. Translators copy it to
`xx.po` to start a new language. It never contains the `Language Sentinel`
— the sentinel is metadata about a language, not a source-extracted string.
Language names (`"English"`, `"Português (Brasil)"`, etc.) are not in the
template either: they are sentinels carried per-`.po`, never wrapped in `_()`
in source.
_Avoid_: POT, catalog, string list (when referring to the template file).

**languages.json**:
The build-time artifact shipped inside the bundle at
`dist/locale/languages.json`, generated by the pack step from `LINGUAS` and
each listed `.po`'s `Language Sentinel`. A flat JSON array of
`{ "code": "en", "name": "English" }` pairs (one per listed language, in
`LINGUAS` order), used by `main-page.ts` to populate the prefs language
dropdown. `main-page.ts` never reads `LINGUAS` or `.po` files at runtime
(those are build-time inputs, not shipped). The dropdown trusts the manifest
and does not cross-check against compiled `.mo` files actually present in the
bundle. `main-page.ts` sorts the array at runtime alphabetically by native
name using plain JS `<` (UTF-16 code-unit comparison — deterministic and
locale-independent, so names sort identically regardless of the UI's current
language), then prepends the `_("System")` affordance at index 0 (e.g.
`[System, Deutsch, English, Español, Français, Português (Brasil)]`).
`languages.json` itself is emitted in `LINGUAS` order and is not pre-sorted.
Generated, not hand-maintained; never edited directly.
_Avoid_: Language manifest, locale list (when referring to the artifact).

**Language Sentinel**:
The `msgid "LANGUAGE_NAME"` entry that every `.po` listed in `LINGUAS` must
carry. Its `msgstr` is the native name of that language
(e.g. `Português (Brasil)` in `pt_BR.po`, `English` in `en.po`). It is metadata
about the language, not a runtime UI string — it is never called via `_()` in
source, never appears in `POTFILES.in` extraction, and is never shown to users
as a translatable label. Language names are not localized into the current UI
language; each language is shown by its native name so users can find it
regardless of the UI's current language. `check:i18n` special-cases it:
required in every listed `.po` with a non-empty `msgstr`, but not expected in
source-string extraction. `main-page.ts` reads it to populate the prefs
language dropdown. The lone exception is the "System" affordance ("follow the
OS"), which stays a runtime-translatable `_()` string since it is a UI label,
not a language identifier.
_Avoid_: Language label, display name (when referring to the sentinel msgid).

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
