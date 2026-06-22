# Target GNOME 45+ in GJS/ESM with St + Adw (TypeScript sources)

The extension targets GNOME Shell 45+ (`shell-version:
["45","46","47","48","49","50"]`) and is written in **TypeScript** (transpiled
to ESM JavaScript by `tsc`, per ADR-0015), running in GJS. GNOME 45+ covers
recent LTS distros (Fedora 38+, Ubuntu 23.10+, etc.) and the dev environment
(Ubuntu 26.04 LTS with GNOME Shell 50.1). GNOME Shell / GJS / libs type
definitions via `@girs/*` npm packages.

UI toolkit:

- **St** (Shell Toolkit, synchronous, Clutter-based) for the status bar and
  panel — required by GNOME Shell. `PanelMenu.Button` with `St.BoxLayout` /
  `St.Icon` / `St.Label` / `Clutter.ActorAlign` for the status bar;
  `PopupMenu.PopupMenuSection` + `PopupMenu.PopupBaseMenuItem` + separators
  for the panel.
- **Adw** (libadwaita) for the preferences window — `Adw.PreferencesPage` →
  `Adw.PreferencesGroup` → `Adw.SpinRow` / `Adw.ComboRow` / `Adw.ActionRow`
  / `Adw.EntryRow`. Standard since GNOME 45+.

Build (updated by ADR-0015): `tsc -p tsconfig.json` → generates `.js` in
`dist/`. Then `glib-compile-schemas schemas/` and `gnome-extensions pack`. No
bundler — `tsc` alone transpiles TS to ESM that GJS runs directly. The
reference extension (`codex-usage-indicator@stone.dev`, installed in the
environment) confirms the ESM/GObject.registerClass/Adw mold in JS; we just
add TS on top.

Folder structure (sources in `src/`, output in `dist/`):

```
src/
├── metadata.json
├── extension.ts              # entry: registers PanelMenu.Button + orchestrates readers
├── prefs.ts                  # config UI (Adw)
├── constants.ts              # defaults (intervals, paths, fields per provider)
├── readers/
│   ├── base.ts               # common interface (read, normalize fields)
│   ├── codex.ts              # OAuth API + disk SQLite fallback
│   ├── claude.ts             # OAuth API + CLI PTY fallback
│   └── opencode.ts           # Web cookies + disk SQLite fallback
├── helpers/
│   ├── http.ts               # Soup.Session wrapper (promisified)
│   ├── subprocess.ts         # Gio.Subprocess wrapper (stdin/stdout/timeout)
│   └── sqlite.ts             # python3 + sqlite3 subprocess wrapper (with cache)
├── ui/
│   ├── statusBar.ts          # compact St.BoxLayout
│   └── panel.ts              # detailed PopupMenu
├── schemas/
│   └── org.gnome.shell.extensions.gnome-provider-limits.gschema.xml
├── po/                       # i18n (POTFILES.in, .pot, en.po, pt_BR.po)
├── icons/
│   └── provider-limits-symbolic.svg
└── stylesheet.css
```

Rationale: GJS is the only language that runs inside GNOME Shell (no real
alternative). ESM is the GNOME 45+ model. St+Adw is the standard toolkit since
GNOME 45. TypeScript adds type safety to GObject Introspection wrappers
(non-trivial APIs) and to contracts between readers/UI/settings (ADR-0015).
The folder structure separates readers (per-provider read logic) from ui
(rendering) from helpers (IO wrappers), keeping each file small with single
responsibility — aligned with the "lightweight" requirement.
