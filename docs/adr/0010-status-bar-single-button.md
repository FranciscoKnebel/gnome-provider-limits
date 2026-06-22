# Status bar: single PanelMenu.Button with providers side-by-side

The status bar uses a single `PanelMenu.Button` (one slot in the GNOME panel,
aligned with "minimalist" and "small footprint"). All enabled providers are
rendered side-by-side in a horizontal `St.BoxLayout`, separated by `St.Label`
with text `" · "` or `•` between providers.

Each provider shows only its `*-status-fields` (ADR-0008), preceded by a short
label (`St.Label` with text `codex`, `claude`, `opc`) for disambiguation. The
button icon is a single symbolic icon of the extension (not one per provider),
saving space.

Provider order in the status bar is configurable via a new GSettings key:

- `providers-order` (as, default `['codex','claude','opencode']`) — order in
  which providers appear in the status bar and panel. Consistent with the
  GSettings-native format of ADR-0008.

The panel (expanded window on click) shows detail for all providers in
sections, grouped by provider — doesn't need to fit in the status bar.

Example default rendering:

```
[icon] codex 1% · 5h  |  claude plan  |  opc $3.71
```

Rationale: a single button keeps the GNOME panel footprint minimal.
Side-by-side with separators lets you see all providers at a glance (user
requirement). Configurable order via GSettings-native (as) is consistent with
ADR-0008. If the user enables many fields per provider, the bar grows — but
that's their choice, and the default stays lean (2 fields per provider).
