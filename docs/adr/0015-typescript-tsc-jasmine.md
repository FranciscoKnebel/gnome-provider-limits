# TypeScript + tsc + jasmine-gjs

The extension is written in TypeScript (`.ts`), transpiled to ESM JavaScript
(`.js`) by `tsc` in the build step. GNOME Shell / GJS / libs types via
`@girs/gnome-shell` (v50.0.2, 79 stars, used by real projects like gTile,
Pano, Rounded Window Corners Reborn) + `@girs/gjs` + `@girs/adw-1` +
`@girs/clutter-18` + `@girs/gtk-4.0` + `@girs/soup-3` (types generated via
`ts-for-gir`).

## Toolchain

- **Language:** TypeScript (target ES2022, module ES2022, moduleResolution
  `bundler`).
- **Transpiler:** `tsc` alone (no bundler). GJS runs ESM directly; we just need
  `tsc` to strip types and generate `.js`.
- **Types:** `@girs/*` npm packages (devDependencies). `tsconfig.json` maps
  `gi://*` and `resource:///org/gnome/shell/*` to types via `paths`.
- **Build step:** `tsc -p tsconfig.json` → generates `.js` in `dist/` (or in
  the extension folder itself). Then `glib-compile-schemas schemas/` and
  `gnome-extensions pack` as in ADR-0014.

## package.json (sketch)

```json
{
  "name": "gnome-provider-limits",
  "private": true,
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "jasmine --config=jasmine.json",
    "pack": "npm run build && glib-compile-schemas src/schemas && gnome-extensions pack dist/ -o dist/ --schema src/schemas/org.gnome.shell.extensions.gnome-provider-limits.gschema.xml --podir src/po --gettext-domain gnome-provider-limits",
    "install:local": "npm run pack && gnome-extensions install --force dist/*.zip"
  },
  "devDependencies": {
    "typescript": "^5.4",
    "@girs/gnome-shell": "^50.0.0",
    "@girs/gjs": "^4.0.0",
    "@girs/adw-1": "^1.10.0",
    "@girs/clutter-18": "^18.0.0",
    "@girs/gtk-4.0": "^4.23.0",
    "@girs/soup-3": "^3.6.0",
    "jasmine": "^5.0"
  }
}
```

## Tests: jasmine-gjs

- **Framework:** jasmine (core) running in GJS via `jasmine-gjs` (v2.6.7) or
  pure jasmine-core with a custom runner that invokes `gjs-console`.
- **Structure:** one `*.test.ts` file per module, alongside or in `tests/`.
  Specs run in real GJS to validate `gi://` imports and async with
  `Gio._promisify`. Mocks for `Soup.Session`/`Gio.Subprocess`/`Gio.File` to
  not depend on network/disk/CLI in tests.
- **CI:** GitHub Actions runs `npm ci && npm test` in Node + GJS (`apt install
gjs gnome-shell`), then `npm run pack` and upload `.zip` on tag push.
- **v1 coverage:** readers (parsing each provider's payload with real JSON/SQLite
  fixtures captured from disk) + helpers (http with Soup mocks, subprocess
  with Gio mocks, sqlite with test DB) + formatting by `type`. UI is tested
  manually (install smoke test).

## tsconfig.json (sketch)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "paths": {
      "gi://*": ["./node_modules/@girs/*"],
      "resource:///org/gnome/shell/*": ["./node_modules/@girs/gnome-shell/*"]
    }
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

Rationale: TypeScript gives type safety in GObject Introspection wrappers
(which have non-trivial APIs) and in contracts between readers/UI/settings.
`tsc` alone (no bundler) keeps the build simple and the ESM output compatible
with GJS 45+. `@girs/*` is the validated ecosystem (gjsify/gnome-shell, 79
stars, real projects using it). jasmine-gjs validates GJS-specifics (`gi://`
imports, promisification) that Node + mocks wouldn't catch. Setup cost is
amortized by confidence in readers (which parse payloads from 3 different
providers).
