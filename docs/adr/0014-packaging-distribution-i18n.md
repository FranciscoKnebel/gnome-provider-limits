# Packaging, distribution, and i18n

## Identity

- **UUID:** `gnome-provider-limits@franciscoknebel.com`
- **settings-schema:** `org.gnome.shell.extensions.gnome-provider-limits`
- **Visible name:** "Provider Limits"
- **Description:** "Show usage limits of multiple AI coding providers (Codex,
  Claude, OpenCode) in the GNOME top bar."

## metadata.json

```json
{
  "name": "Provider Limits",
  "description": "Show usage limits of multiple AI coding providers (Codex, Claude, OpenCode) in the GNOME top bar.",
  "uuid": "gnome-provider-limits@franciscoknebel.com",
  "settings-schema": "org.gnome.shell.extensions.gnome-provider-limits",
  "gettext-domain": "gnome-provider-limits",
  "shell-version": ["45", "46", "47", "48", "49", "50"],
  "url": "https://github.com/FranciscoKnebel/gnome-provider-limits",
  "version": 1
}
```

## File structure (with packaging)

```
gnome-provider-limits/                  # repo root
├── src/                                # TypeScript sources
│   ├── metadata.json
│   ├── extension.ts
│   ├── prefs.ts
│   ├── constants.ts
│   ├── readers/
│   │   ├── base.ts
│   │   ├── codex.ts
│   │   ├── claude.ts
│   │   └── opencode.ts
│   ├── helpers/
│   │   ├── http.ts                     # Soup.Session wrapper
│   │   ├── subprocess.ts               # Gio.Subprocess wrapper
│   │   └── sqlite.ts                   # python3 + sqlite3 wrapper
│   ├── ui/
│   │   ├── statusBar.ts
│   │   └── panel.ts
│   ├── formatters.ts                   # field formatting by type
│   ├── schemas/
│   │   └── org.gnome.shell.extensions.gnome-provider-limits.gschema.xml
│   ├── po/
│   │   ├── POTFILES.in
│   │   ├── gnome-provider-limits.pot
│   │   ├── en.po
│   │   └── pt_BR.po
│   ├── icons/
│   │   └── provider-limits-symbolic.svg
│   └── stylesheet.css
├── tests/                              # jasmine-gjs tests
│   ├── readers/
│   ├── helpers/
│   └── helpers/
│       └── mocks.ts                    # mocks for Gio/Soup/Gio.File
├── dist/                               # tsc output (.js), gitignored
├── tsconfig.json
├── package.json
├── package-lock.json
└── .github/workflows/ci.yml
```

## Distribution

- **v1:** GitHub Releases with `.zip` created via `gnome-extensions pack . -o
dist/` + `glib-compile-schemas src/schemas`. User installs with
  `gnome-extensions install --force <zip>`. Simple, no third-party review.
- **AUR:** `gnome-shell-extension-provider-limits-git` for Arch users, in
  parallel with GitHub Releases.
- **extensions.gnome.org (official store):** only post-v1 when mature. Requires
  review, but it's the channel GNOME users expect.

## i18n from the start

- **gettext** via `import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js'`
  (GNOME 45+). Strings wrapped in `_()` in `extension.ts` and `prefs.ts`.
- **gettext-domain:** `gnome-provider-limits` (defined in metadata.json).
- **Initial languages:** `en` (base, source strings) + `pt_BR` (first
  translation). Expandable to others by adding `.po` files in `po/`.
- **Default:** follows system locale (`LANG` / `LC_MESSAGES`). gettext resolves
  automatically based on environment.
- **Configurable:** GSettings key `language` (s, default `''` = follows
  system). Manual override to a specific language when the user wants
  different from system. When non-empty, the extension calls
  `setlocale(LC_MESSAGES, <value>)` or equivalent before rendering.

## Build

`tsc -p tsconfig.json` transpiles TypeScript in `src/` to ESM JavaScript in
`dist/` (ADR-0015). Then `glib-compile-schemas src/schemas` and
`gnome-extensions pack dist/ -o dist/ --schema
src/schemas/org.gnome.shell.extensions.gnome-provider-limits.gschema.xml
--podir src/po --gettext-domain gnome-provider-limits` generates the `.zip`
with compiled schemas and translations included. No bundler, just `tsc` alone.

## CI

GitHub Actions on tag push:

1. `npm ci`
2. `npm test` (jasmine in GJS, per ADR-0015)
3. `npm run build` (`tsc`)
4. `glib-compile-schemas src/schemas`
5. `gnome-extensions pack dist/ -o dist/` (with schemas + po + gettext-domain)
6. Upload `.zip` as release artifact

Rationale: UUID with own domain (`@franciscoknebel.com`) is the GNOME
standard. GitHub Releases is the simplest channel for v1, no third-party
review. extensions.gnome.org requires maturity v1 doesn't have yet. i18n from
the start avoids painful refactor later and meets the requirement to support
en + pt-BR with expansibility. Default follows system (expected GNOME
behavior), manual override via GSettings for users who want different.
TypeScript + `tsc` + jasmine (ADR-0015) adds type safety and automated tests
from v1.
