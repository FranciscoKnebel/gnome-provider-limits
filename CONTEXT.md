# gnome-provider-limits

GNOME extension that shows session limits of multiple AI coding providers,
reading existing local credentials and usage state and querying provider endpoints.

## Language

**Provider**:
An AI provider, i.e., a coding CLI that will share usage state locally.
_Avoid_: Service, API, vendor.

**Reader**:
Component of the extension that knows where and how to read a specific
provider's local state, and normalize it to the common shape displayed in the
UI. Tries disk first; if the field doesn't exist, invokes the provider's CLI
(configurable path) to obtain it. When every path fails but a recent
Last-Known-Good exists, returns it instead of an empty error.
_Avoid_: Parser, scraper, client.

**SQLite Helper**:
`python3` invocation via `Gio.Subprocess` with `sqlite3` from the stdlib, used
by readers that need to read provider SQLite databases (Codex, OpenCode Go).
Returns JSON on stdout. Not a daemon; spawned per refresh.
_Avoid_: Driver, connector, ORM.

**Field**:
A named piece of information that a reader can extract from a provider's local
state (e.g. `prompts_used`, `reset_at`, `percent_remaining`). Each provider
exposes a different set of fields.
_Avoid_: Metric, attribute, datum.

**Field Catalog**:
The authoritative field declarations in `src/readers/fields.ts`, one array per
Provider, assembled into `PROVIDER_FIELDS` and distilled at the type level into
`FieldName`. Each entry carries name, label, type, category (limit or
telemetry), an optional `valueKind` (`used` or `remaining`, for percent fields)
and an optional `resetField` pairing. The default zone is not part
of it: the GSettings schema `<default>` arrays (`<provider>-status-fields` and
`<provider>-panel-fields`) remain the single source of truth for where a Field
appears by default.
_Avoid_: Field registry, default zone metadata, duplicate field list.

**Field Status**:
The per-Field availability attached to a `FieldResult`: `OK`, `UNAVAILABLE`,
`NOT_APPLICABLE`, or `ERROR`. `UNAVAILABLE` and `ERROR` degrade provider health when
the Field is configured in the Status Bar or Panel. `NOT_APPLICABLE` means the
Provider does not expose the Field for the current plan or window, so it never
degrades health. Display status and diagnostics are computed from the configured
status and panel Fields. Health tone remains provider-wide: any returned percent
Field can raise urgency even when it is not selected. Missing usage stays
unavailable, not zero.
_Avoid_: Null field, missing value, absent metric.

**Display Status**:
The Reader Result status after excluding `DISABLED` and applying the configured
Field policy. A `PARTIAL` result becomes `OK` when no selected Field degrades
health and the result is not cached. `DisplayStatus` in `providerHealth.ts` is the
canonical type; health severity and diagnostics consume it.
_Avoid_: Raw status, effective status, visible status.

**FieldView**:
The one zone-aware formatted projection of a Field, derived by
`deriveFieldViews` in `fieldViews.ts`. Renderers consume its already computed
`labelText`, `valueText`, `accessibleText`, `status`, `tone`, `ratio`,
`fillPercent` and `errorText` without a second formatting stage or any
provider-specific state.
_Avoid_: Field widget, formatted row, renderer-local field copy.

**Status Bar**:
Compact zone of the extension, always visible in the GNOME panel. Shows few
fields per provider, in little space.
_Avoid_: Tray, icon, indicator.

**Panel**:
Expanded window when clicking the extension. Shows fields that don't fit in
the status bar, with more detail.
_Avoid_: Popup, dropdown, menu.

**Panel Style**:
A selectable Panel appearance: `gauges`, `cards` or `compact`. Persisted in
GSettings and resolved through the Style Registry to a `PanelStyleSpec` that
joins catalog metadata with the section factory, footer factory and CSS
placement.
_Avoid_: Panel theme, layout mode.

**Status Bar Style**:
A selectable Status Bar appearance: `pills`, `gauges` or `compact`. Persisted
in GSettings and resolved through the Style Registry to a `StatusBarStyleSpec`
with a renderer factory.
_Avoid_: Top-bar theme, indicator mode.

**Style Registry**:
`STYLE_REGISTRY` in `styles.ts`, the single shell-facing map from Panel Style
and Status Bar Style to their specs. It combines the pure metadata in
`styleCatalog.ts` with factories and CSS placement strings, so the shell
resolves a style once instead of branching on style names across the UI.
_Avoid_: Style switch, theme manager, catalog (when referring to the registry).

**Provider Configuration**:
Per-provider configuration that defines which fields to display, in which zone
(status bar or panel) and in which order.
_Avoid_: Profile, preset.

**Limit Field**:
A field that expresses an active provider restriction on usage, e.g.
`used_percent`, `remaining_percent`, `reset_at`, `limit_reached`. Codex and
Claude expose limits via provider APIs using disk tokens/cookies; Codex also via
disk (`logs_2.sqlite`). OpenCode Go must not reuse Codex-compatible account limits
as OpenCode Go limits.
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
Local usage state written by OpenCode Go. In this project, OpenCode Go limit
fields must come from the OpenCode Go Usage API, and telemetry fields from the
local OpenCode Go state (`opencode.db`); never from Codex-compatible OpenAI
account limits, even when OpenCode Go uses an OpenAI account under the hood.
_Avoid_: Codex limits, OpenAI usage limits.

**OpenCode Go Usage API**:
The provider-reported usage endpoint at
`https://opencode.ai/zen/go/v1/usage`, authenticated with the `opencode-go` API
key stored in `~/.local/share/opencode/auth.json` (fallback: the
`OPENCODE_API_KEY` environment variable). Returns `rolling`, `weekly`, and
`monthly` windows with `status` (`ok` or `rate-limited`), `percent`, and
`resetsAt`. It is the authoritative source for OpenCode Go Limit Fields; local
spend observed in `opencode.db` is telemetry only and must not be presented as
usage against a limit.
_Avoid_: Console scraping, Codex usage API, local spend estimate.

**Grok Subscription Credits**:
The subscription credit usage for the authenticated Grok Build account, including
personal and Team principals, reported by
`https://cli-chat-proxy.grok.com/v1/billing?format=credits`, authenticated with
the existing Grok Build login in `~/.grok/auth.json` (or `GROK_HOME`).
`creditUsagePercent` and `currentPeriod.end` describe the provider's current
weekly or monthly credit pool. `isUnifiedBillingUser` indicates whether this
pool is shared across Grok products; otherwise it represents Grok Build credits.
Missing usage stays unavailable, not zero. This is not organization-wide Team
spending, xAI API billing, or a per-model chat message limit. Purchased credits
(`prepaidBalance`, USD cents) are a separate balance, never a subscription usage
percentage.
_Avoid_: xAI API balance, organization-wide Team spending limit, messages remaining.

**Cursor Subscription Credits**:
The subscription credit usage for the authenticated Cursor account in the current
billing cycle, reported by the ConnectRPC `DashboardService/GetCurrentPeriodUsage`
endpoint on `https://api2.cursor.sh` (as defined in `@cursor/sdk`), with optional
plan enrichment from `DashboardService/GetPlanInfo`. Authenticated with an existing
Cursor SDK credential (`~/.cursor/sdk/auth.json`, exchanged via
`/auth/exchange_user_api_key`) or Cursor CLI session (`~/.config/cursor/auth.json`
or `~/.cursor/auth.json`). Exposes combined credit usage (`used_percent_credits`,
`remaining_percent_credits`, `reset_at_credits`) alongside Cursor's separate
Auto + Composer (`used_percent_auto`) and API (`used_percent_api`) pools,
remaining included credits in USD (`remaining_credits`), and on-demand spend in
USD (`spend_limit_used`). Missing usage stays unavailable, not zero.
_Avoid_: Grok CLI limits, IDE keyring tokens, third-party API spend.

**Google Subscription Quota**:
The subscription quota usage for the authenticated Google AI / Antigravity / Gemini
CLI account, reported by `v1internal:retrieveUserQuotaSummary` (with fallback to
`v1internal:fetchAvailableModels`) and optional tier enrichment from
`v1internal:loadCodeAssist` on `https://daily-cloudcode-pa.googleapis.com` and
`https://cloudcode-pa.googleapis.com`. Authenticated with an existing Antigravity ACP
credential (`$ANTIGRAVITY_ACP_TOKEN_PATH`, `~/.gemini/antigravity-acp/acp_token.json`,
`~/.gemini/antigravity/acp_token.json`, `~/.config/antigravity/acp_token.json`, or T3
Code's Antigravity provider directory), Gemini CLI OAuth file (`~/.gemini/oauth_creds.json`),
or `authorized_user` Application Default Credentials fallback; when `refresh_token`,
`client_id`, and `client_secret` are present in the file, expired OAuth tokens are
refreshed in memory via `https://oauth2.googleapis.com/token` without writing back to
disk. Exposes Gemini 5-hour session and weekly windows (`used_percent_session`,
`reset_at_session`, `used_percent_weekly`, `reset_at_weekly`) plus optional third-party
Claude & GPT 5-hour and weekly pools on Antigravity (`used_percent_3p_session`,
`used_percent_3p_weekly`). Untouched 0% windows whose distant reset time matches
Google's idle placeholder horizon omit `reset_at` and report it as not applicable
until active usage starts. Windows the provider explicitly disables are not
applicable. Unreported 5-hour windows are not applicable when the plan is known not
to expose them, such as Antigravity Starter Quota; otherwise they stay unavailable,
so truncated quota data still degrades the provider when that window is configured.
_Avoid_: Google Cloud billing, Vertex AI pay-as-you-go spend, service-account keys.

**Telemetry Field**:
A field that expresses usage already performed, with no reference to a ceiling
, e.g. `totalCost`, `lastTotalInputTokens`, `sessionsCount`. Cannot be
presented as "remaining" or "percentage of limit".
_Avoid_: Usage metric, statistic.

**Provider Display Model**:
One Provider's canonical display snapshot for a frame, built by
`deriveDisplayModel` from a `ReaderResult` plus the configured status and panel
fields, display names, locale and Field Catalog slice. It holds the selected
FieldViews, reset pairings and the eager ProviderDisplayFacts. Renderers read
these models instead of the raw `ReaderResult` or `FieldDef` values.
_Avoid_: View model, renderer DTO, cached widget tree.

**Provider Display Facts**:
The surface-agnostic presentational facts computed once with a Provider Display
Model: health, badges, usage facts, meter spec, diagnostic, callout, classified
view groups and last-updated text. Every style derives its tone, badge and
banner from these facts, so styles cannot disagree about a Provider's status.
_Avoid_: Per-style badge, renderer-local diagnostic, presentation cache.

**Provider Severity**:
The one ordered health value for a Provider, `PROVIDER_SEVERITIES` in
`providerHealth.ts`. State, tone, status attention and presentation come from
one table keyed by it (`HEALTH_BY_SEVERITY`); the severity itself is derived
from the Provider's display status (the Reader Result status adjusted for the
configured fields and Last-Known-Good provenance), worst field tone, and
usable-field presence. No surface recombines those attributes through a second
table.
_Avoid_: Health level, status color, per-style state.

**View Phase**:
The coarse state of one rendered frame: `empty` (no Providers enabled),
`loading` (enabled Providers have no results yet) or `ready`. Derived by
`resolveViewPhase`, carried on `ProviderViewContext`, and mapped by
`phaseResult` with the surface's Phase Messages to either a placeholder or
normal content.
_Avoid_: Loading flag, render stage, spinner state.

**PlanRenderer (removed)**:
No longer part of the UI. Incremental rendering, structure keys, pooled widget
arrays and cache fingerprints were deleted; each renderer now clears and
rebuilds its body from one freshly derived view plan (the `ProviderViewContext`
and its Provider Display Models). Do not reintroduce renderer-local caches.
_Avoid_: Incremental renderer, widget pool, structure key, render diff.

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
preserves the process language environment, and logs the fallback. This heals after a downgrade or a
language removal without the user opening prefs. The heal persists to GSettings
(matches the user's hidden intent: they chose the language when it was
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
strict checking. No second manifest (e.g. a draft list) is maintained:
absence from `LINGUAS` is the draft marker.
_Avoid_: In-progress translation, staging `.po`, pending language.

**Translation Template**:
The `gnome-provider-limits.pot` file under `src/po/`, the human-readable
catalog of every translatable string extracted from source. Hand-maintained
(no `xgettext` call exists in the project; `check:i18n`'s regex extractor is
the de facto source of truth). The extractor recognizes `_(`, `tr(`, `t(` and
`label:` forms; new UI code keeps every translatable literal in a direct
`t("...")` call and passes already-translated strings to copy helpers, so
there is one extraction contract. `check:i18n` validates the template against
source-string extraction on every `npm run check` to catch drift. Translators
copy it to `xx.po` to start a new language. It never contains the `Language Sentinel`
because the sentinel is metadata about a language, not a source-extracted string.
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
name using plain JS `<` (UTF-16 code-unit comparison, deterministic and
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
about the language, not a runtime UI string: it is never called via `_()` in
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
section in the panel. Can differ from `Last Refresh At` if a stale result is
carried over from a previous cycle (see `Refresh` generation) or when a
failed cycle returns the Last-Known-Good.
_Avoid_: Last update, refresh time (ambiguous with global).

**Last-Known-Good**:
The most recent `ReaderResult` that contained at least one usable field,
kept in memory per `Reader` (never persisted). When every path of a
`Refresh` fails and the Last-Known-Good is younger than 30 minutes, the
reader returns it as a `PARTIAL` result with the original `lastUpdated` and
the failure in `lastError`, so a transient outage shows stale-but-usable
data instead of emptying the provider. Older results are discarded and the
read reports `ERROR`.
_Avoid_: Cache, snapshot, stale copy.

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
`Running Refresh Indicator`, and the `Last Refresh At` label. Built by one of
the three style-specific factories in `panelFooter.ts` (`buildGaugesFooter`,
`buildCardsFooter`, `buildHudFooter`), selected through the Style Registry and
owned by `PanelShell`. Updated by `setRunning()` without a full rebuild. The
"Force refresh" button is blocked while a `Running Refresh` is in progress.
_Avoid_: Status row, action bar.
