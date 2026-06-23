# GSettings-reactive UI with per-provider display names

The extension must react to GSettings changes immediately (not only on the next
polling cycle), and display names must be user-configurable per-provider.

## What changed

Previously the extension read GSettings once at `_init()` (`*-enabled`,
`providers-order`) and only re-read them inside `refresh()` during polling. No
`changed::` signal handlers existed in `extension.ts`. Display labels were
hardcoded in three separate maps (`constants.ts`, `statusBar.ts`, `panel.ts`).

Now:

1. **New GSettings keys per provider**: `*-display-name` (string, used in
   panel/prefs) and `*-display-name-short` (string, used in status bar).
   Defaults are the current hardcoded values. Missing key = fallback to
   `provider` literal.

2. **Signal reactivity**: `extension.ts` connects to `changed::` for:
   - `*-enabled` — destroy or create the reader immediately; remove/add its
     display from the UI.
   - `*-display-name` and `*-display-name-short` — update labels on the next
     render cycle (no reader restart needed).
   - `providers-order` — reorder the display immediately.

3. **Toggle semantics**: disabling a provider destroys its reader (stops HTTP
   calls, frees memory) and removes it from the UI. Re-enabling recreates the
   reader and reinserts the display.

## Considered options

- **Polling-only, no change**: current behavior — simpler but unresponsive.
  User changes settings and nothing happens for up to 10–120s.
- **Recreate the whole extension on any settings change**: works but causes
  visible UI flicker and loses render state.
- **dconf watch via subprocess**: avoids GSettings dependency but adds a
  long-running subprocess, complicates lifecycle, conflicts with ADR-0019
  (destroy everything in `disable()`).
- **Single `*-label` key instead of two**: saves one GSettings key per
  provider, but forces either verbose status bar or cryptic panel title. The
  two-key split keeps status bar compact without abbreviating the legible name.

## Consequences

- `extension.ts` grows non-trivial — `_onProviderEnabledChanged`,
  `_onProviderDisplayNameChanged`, `_onProvidersOrderChanged` handlers plus
  their signal IDs for cleanup in `destroy()`.
- GSettings schema gains 6 new keys (2 per provider × 3 providers); current
  users upgrading see the default values (matching previous hardcoded labels).
- No new schema migration needed — GSettings adds missing keys with defaults
  automatically.
- The three hardcoded label maps (`constants.ts`, `statusBar.ts`, `panel.ts`)
  can be collapsed into the defaults in the schema XML.
