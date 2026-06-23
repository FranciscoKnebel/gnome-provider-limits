# Reader and helper interface in TypeScript

Readers are the layer that knows where and how to read each provider's state
(ADR-0002, ADR-0011, ADR-0013). The interface is typed in TypeScript
(ADR-0015) and separates readers (per-provider read logic) from helpers
(reusable IO wrappers).

## `src/readers/base.ts`: common interface

```ts
export enum ReaderStatus {
  OK = "ok",
  PARTIAL = "partial",
  ERROR = "error",
  UNAVAILABLE = "unavailable",
  DISABLED = "disabled",
}
export enum FieldStatus {
  OK = "ok",
  UNAVAILABLE = "unavailable",
  ERROR = "error",
}

export interface FieldResult<T = unknown> {
  name: string;
  value: T | null;
  status: FieldStatus;
  error?: string | null;
}

export interface ReaderResult {
  provider: string;
  status: ReaderStatus;
  fields: FieldResult[];
  lastUpdated: number; // ms epoch
  lastError?: string | null;
  pathsTried?: string[];
}

export interface FieldDef {
  name: string;
  label: string; // i18n key or string literal
  type: "percent" | "count" | "tokens" | "cost" | "timestamp" | "bool" | "text";
  description?: string;
  defaultZone: "status" | "panel";
}

export abstract class BaseReader {
  constructor(
    protected settings: Gio.Settings,
    protected providerName: string,
  ) {}
  abstract get FIELDS(): readonly FieldDef[];
  abstract read(): Promise<ReaderResult>;
  destroy(): void {}
}
```

## `src/helpers/http.ts`: Soup.Session wrapper

Wrapper for `Soup.Session` with `Gio._promisify(send_and_read_async)`, common
headers, JSON parse, HTTP error normalization into typed classes:

- `TokenError` (401/403): invalid/expired/revoked token.
- `RateLimitError` (429): reverse rate limit on the usage API itself.
- `ServerError` (5xx): transient provider error.
- `NetworkError` (timeout/no network): no connectivity.

## `src/helpers/subprocess.ts`: Gio.Subprocess wrapper

`Gio.Subprocess` with stdin/stdout/stderr pipes, await via
`Gio._promisify(wait_check_async)`, parse stdout as string/JSON, timeout via
`GLib.Timeout` that forces `subprocess.force_exit()`. Used by `sqlite.ts`
(python3) and Claude CLI PTY (fallback).

## `src/helpers/sqlite.ts`: python3 + sqlite3 wrapper

Invokes `python3 -c "import sqlite3, json; ..."` via `subprocess.ts`, returns
parsed JSON. In-memory cache by `(dbPath, queryKey)` for N seconds (default
5s) to avoid re-spawn within the same refresh.

## Concrete readers

Each reader extends `BaseReader` and implements `read()` trying paths in order
(fallback chain, ADR-0011), populating `fields` with per-field `FieldStatus`
(ADR-0013). Each reader stays small (~100-200 LOC).

- `src/readers/codex.ts`: OAuth API (`http.ts` + token from `~/.codex/auth.json`
  read via `Gio.File`) → disk fallback (`sqlite.ts` reading `logs_2.sqlite`
  `codex.rate_limits` payload). `FIELDS` with 8 fields (5h + weekly + meta:
  `used_percent_primary`, `reset_at_primary`, `used_percent_secondary`,
  `reset_at_secondary`, `window_minutes_primary`, `window_minutes_secondary`,
  `limit_reached`, `plan_type`).
- `src/readers/claude.ts`: OAuth API (`http.ts` + token from
  `~/.claude/.credentials.json`) → CLI PTY fallback (`subprocess.ts`
  invoking `claude --allowed-tools ""` and parsing `/usage`). `FIELDS` with
  8 fields (session 5h + weekly + sonnet/opus).
- `src/readers/opencode.ts`: v1 disk only (`sqlite.ts` on `opencode.db` + JSON
  from `auth.json`): telemetry + `tokenExpiresAt`. v1.x adds Web cookies
  (`http.ts` + cookies from `opencode.ai`) for real limits. `FIELDS` with 7
  fields.

Rationale: `FieldResult` with per-field `status` enables the granular error
handling of ADR-0013. `ReaderResult` with aggregated `status` + `pathsTried` +
`lastError` enables the visible per-provider state in the panel (ADR-0012) and
the adaptive polling intelligence (ADR-0006: `error` doesn't degrade,
`unavailable` degrades). Reusable helpers (`http.ts`, `subprocess.ts`,
`sqlite.ts`) avoid duplication between readers. TypeScript ensures
readers/UI agree on the data shape.
