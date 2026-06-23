# Field formatting by type

Each `FieldDef.type` (ADR-0016) defines how the value renders in the status bar
(compact zone) and the panel (verbose zone). The centralized function
`src/formatters.ts` exports `formatField({type, value, zone, locale}): string`,
with dispatch by `type` and adjustment by `zone`. Used in the status bar, the
panel (ADR-0012), and the prefs preview (ADR-0017) with a sample `value`.

## Per type

### `percent` (Codex `used_percent_*`, Claude `used_percent_*`, OpenCode `usagePercent`)

- Status bar: integer + `%` → `42%`, `1%`, `100%`. No decimals.
- Panel: same → `42%`.
- Color by threshold (defined in `stylesheet.css`, not inline):
  - `≥80%` → red
  - `≥50%` → yellow
  - `<50%` → theme default color
- Cases: `null`/UNAVAILABLE → `—`; ERROR → `—` with tooltip (ADR-0013).

### `timestamp` (Codex `reset_at_*`, OpenCode `resetInSec`, `tokenExpiresAt`)

- Status bar: short relative, no spaces → `4h59m`, `6d12h`, `3d4h`.
- Panel: relative + absolute → `4h 59m (22:30)`, `6d 12h (Mon 09:00)`.
- Calculation: `reset_at - now` in seconds. Thresholds:
  - `<60s` → `now` (i18n via gettext)
  - `<1h` → `Xm`
  - `<1d` → `XhYm`
  - `<1w` → `XdYh`
  - `>1w` → `XwYd`
- Suffixes `h`/`m`/`d`/`w` not translated (ISO-ish standard, short).

### `tokens` (Claude `lastTotal*Tokens`, OpenCode `tokens_*`)

- Status bar: short suffix → `1.0M`, `461K`, `28K`, `87.3M`. 1-4 chars + suffix.
- Panel: full number + suffix → `1,048,576 (1.0M)`.
- Suffixes: `K` (≥1e3), `M` (≥1e6), `G` (≥1e9). 1 decimal if ≥10 of the suffix,
  else integer (`1.0M`, `12K`, `461K`, `87.3M`).
- Suffixes not translated (technical standard, avoids `1,0M` vs `1.0M`
  confusion).

### `cost` (OpenCode `totalCost`)

- Status bar: `$3.71` (2 decimals, `$` prefix).
- Panel: same.
- i18n: currency symbol by locale via
  `Intl.NumberFormat(locale, {style: 'currency', currency: 'USD'})`. GJS
  supports `Intl`.

### `count` (OpenCode `sessionsCount`, Codex `credits`)

- Status bar: integer with thousands separator → `1,982`, `91`.
- Panel: same.
- i18n: separator by locale via `Intl.NumberFormat` (`1,982` en, `1.982`
  pt_BR).

### `bool` (Codex `limit_reached`, Claude `hasExtraUsageEnabled`)

- Status bar: not recommended (takes space without compact informative value).
  If enabled, symbolic icon (`✓`/`✗`) instead of text.
- Panel: `yes`/`no` translated via gettext, or icon + label.

### `text` (Codex `plan_type`, Claude `extraUsageDisabledReason`)

- Status bar: raw value, truncated if long → `plus`, `org_lev…`.
- Panel: full raw value → `plus`, `org_level_disabled`.
- i18n: some values are enums (`plan_type: plus/pro/team`) that may have
  specific translations in the future; for now, raw value.

## Centralized function

```ts
export function formatField({
  type,
  value,
  zone,
  locale,
}: {
  type: FieldDef["type"];
  value: unknown;
  zone: "status" | "panel";
  locale: string;
}): string {
  // dispatch by type
}
```

- i18n via `Intl.NumberFormat` / `Intl.DateTimeFormat` (GJS supports) and
  `gettext` for fixed strings ("now", "yes", "no").
- Color by threshold (`≥80%` red) in `stylesheet.css` via CSS class
  (`.usage-critical`, `.usage-warning`), not inline. This keeps consistency with GNOME
  theme (dark/light) and remains easy to adjust.

Rationale: status bar is compact (few chars per field), panel is verbose (more
context). The same function with `zone` adjusts. i18n via `Intl` + `gettext`
uses what GJS already has. Token suffixes (`K`/`M`/`G`) are technical standard,
not translated. Bool in status bar as icon saves space. Color in stylesheet
maintains consistency with GNOME theme.
