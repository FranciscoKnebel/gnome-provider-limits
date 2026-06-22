# Prefs UI: multiple pages, provider pages only if enabled

The preferences window (`Adw.PreferencesWindow`) has **1 "General" page + 1
page per enabled provider** (up to 4 pages: General + Codex + Claude +
OpenCode). Pages for disabled providers (`<provider>-enabled=false`) are **not
shown** — the user only sees a provider's page when they enable it in General.
Re-enabling recreates the page.

## "General" page

- **"Refresh" group** — `Adw.SpinRow` for `refresh-short-interval-seconds`
  (10-3600), `refresh-long-interval-seconds` (60-3600),
  `refresh-stable-reads-threshold` (1-10). Direct bind to GSettings int keys.
- **"Language" group** — `Adw.ComboRow` for `language` (system / en / pt_BR).
  Bind to GSettings string key.
- **"Providers" group** — sortable list of providers for `providers-order`
  (as). Each row = `Adw.ActionRow` with provider name + `Adw.SwitchRow` as
  suffix for `<provider>-enabled`. DnD to reorder. Toggle enables/disables the
  provider and adds/removes its page to the window dynamically.

## Per-provider page (Codex / Claude / OpenCode)

- **"Settings" group** — `Adw.EntryRow` for `<provider>-cli-path` (bind
  string). (The `enabled` toggle is already in General; don't repeat here.)
- **"Status bar fields" group** — sortable list of fields in
  `<provider>-status-fields`. Each row = `Adw.ActionRow` with field label
  (from `reader.FIELDS[].label`) + formatted preview by `type` as suffix
  (e.g. percent → "42%", timestamp → "2h 30m", tokens → "1.0M", cost →
  "$3.71"). DnD to reorder. "+" button in the group header opens a popover
  with available fields (from `reader.FIELDS` minus those already in the list).
  "−" button as suffix of each row to remove.
- **"Panel fields" group** — same structure for `<provider>-panel-fields`.

## Widget strategy

- **Sortable lists:** `Gtk.ListBox` with `Gtk.DragSource`/`Gtk.DropTarget`
  per row (GTK4 standard for DnD reordering). Each row = `Gtk.ListBoxRow`
  containing `Adw.ActionRow`. `Adw.PreferencesGroup` hosts the ListBox, or we
  use raw `Gtk.ListBox` styled to match.
- **Add:** "+" in the group header → `Gtk.Popover` with list of `reader.FIELDS`
  not present in the current list. Click adds to the end (or drop position).
- **Remove:** "−" as `add_suffix` on the row's `Adw.ActionRow`.
- **Preview:** sample value formatted by the per-type formatting function
  (ADR-0018), updated when the user drags/reorders (for visual confirmation).

## GSettings binding

- **Globals and per-provider settings:** `settings.bind(key, row,
'value'|'selected'|'text', Gio.SettingsBindFlags.DEFAULT)` — direct, as in
  the reference extension.
- **Field lists:** no direct bind (GSettings `as` doesn't bind to ListBox).
  Reorder/add/remove triggers `settings.set_strv(key, newArray)`. List is
  rebuilt from GSettings in `fillPreferencesWindow` and kept in sync via
  `settings.connect('changed::<key>', ...)`.
- **Enabled toggle:** direct bind to `<provider>-enabled` (bool). Change
  triggers `add`/`remove` of the corresponding page in the
  `Adw.PreferencesWindow`.

## Dynamic page visibility

`fillPreferencesWindow(window)`:

1. Always creates the "General" page.
2. For each provider in `providers-order`, if `<provider>-enabled=true`,
   creates and adds the page.
3. Connects `changed::<provider>-enabled` to add/remove the page dynamically
   when the user toggles in General.
4. Connects `changed::providers-order` to reorder pages (rare, but supported).

Rationale: 4 pages keep each focused and short. Provider pages only if
enabled reduces clutter (user who only uses Codex sees only General + Codex).
1:1 mapping with GSettings keys (ADR-0008) — each widget corresponds to one
key. Formatted preview in the row educates the user about what the field
shows before they enable it. DnD via GTK4 is the standard for sortable lists.
The "+ popover" with available fields (from `reader.FIELDS`) ensures new
fields appear automatically when the reader evolves (ADR-0009).
