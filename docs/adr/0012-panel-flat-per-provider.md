# Flat panel: one section per provider, fields as PopupBaseMenuItem

The panel (expanded window on clicking the status bar button) uses flat
layout: one section per provider, fields rendered as `PopupBaseMenuItem` with
`St.Label` on the left (field label, from `reader.FIELDS[].label`) and
`St.Label` on the right (value formatted by `type`). No submenus. All
providers visible in one click, scroll if needed.

Provider order = `providers-order` (as, ADR-0010). Field order within each
section = `<provider>-panel-fields` (as, ADR-0008).

Each section has a header with provider name + status (`ok` / `no limits` /
`error`). Provider unavailable/error = section with an "Unavailable" or
"Error: ..." line. Which fields appear in each zone (status bar / panel) is
configurable per provider in preferences (ADR-0002, ADR-0008).

At the end of the panel: separator + "Refresh now" row (with last updated
timestamp) + "Settings" (opens prefs).

Example (with defaults post-ADR-0011, all 3 with limits):

```
─── Codex ─────────────────────────
  Session (5h)  Used %        1%
                Reset in      4h 59m
  Weekly        Used %        17%
                Reset in      6d 12h
  Plan type                    plus
─── Claude ────────────────────────
  Session (5h)  Used %        42%
                Reset in      2h 15m
  Weekly        Used %        68%
                Reset in      3d 4h
─── OpenCode ──────────────────────
  Rolling (5h)  Used %        12%
                Reset in      3h 30m
  Weekly        Used %        45%
                Reset in      4d 8h
──────────────────────────────────
  Refresh now                  2m ago
  Settings
```

Rationale: with 3 providers and ~6 fields each, submenus add friction without
real space savings (the popup grows little). Flat is familiar (same mold as
the reference extension `codex-usage-indicator`). Per-provider headers group
fields visually without needing collapse.
