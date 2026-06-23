# Readers auto-declare their fields

Each reader exports a `FIELDS` constant (array of declarative objects) and
implements `read()` (which returns only the fields it could read, with value
or `null`/unavailable for those that failed). The prefs UI discovers the
catalog by calling `reader.FIELDS` and builds the list per provider: each
field becomes a row with label + toggle status-bar/panel + draggable position.

`FIELDS` shape per reader:

```ts
export const FIELDS: readonly FieldDef[] = [
  {name: 'used_percent_primary', label: 'Used % (5h window)',
   type: 'percent', description: '...', defaultZone: 'status'},
  ...
];
```

Supported types (`type`), which guide UI formatting:

- `percent` → "1%"
- `count` → "1,982"
- `tokens` → "1.0M"
- `cost` → "$3.71"
- `timestamp` → "2h 30m" (relative) or absolute date
- `bool` → yes/no or icon
- `text` → raw string

Separation of concerns:

- **Available:** from `reader.FIELDS` (static, declarative).
- **Displayed:** from GSettings `*-status-fields` / `*-panel-fields`
  (ADR-0008). The user chooses a subset of available and orders them.

If a field fails at runtime, the reader returns `null` for it; the UI shows
"—" or hides it, but the field remains configured and reappears when it has a
value again. Schema defaults (ADR-0008) already include a reasonable
selection.

Rationale: co-locates field metadata with the logic that reads it, making it easy to
keep in sync. If the reader gains a new field, it appears in the prefs list
automatically; the user decides whether to display it. A central catalog in
`constants.ts` would decouple metadata from logic and be easy to get out of
sync. Runtime discovery would be fragile (a field that failed would disappear
from options).
