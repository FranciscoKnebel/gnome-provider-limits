import GLib from "gi://GLib";

import { SQLITE_CACHE_TTL_SECONDS } from "../constants.js";
import { logWarn, maskSecrets } from "./log.js";
import { runSubprocess, SubprocessError } from "./subprocess.js";

interface CacheEntry {
  promise: Promise<unknown>;
  expiresAt: number | null;
}

const cache = new Map<string, CacheEntry>();

const PYTHON_SCRIPT = [
  "import json, sqlite3, sys, urllib.parse",
  "",
  "db_path, query, mode = sys.argv[1], sys.argv[2], sys.argv[3]",
  'uri = "file:" + urllib.parse.quote(db_path) + "?" + mode',
  "conn = sqlite3.connect(uri, uri=True)",
  'conn.execute("PRAGMA query_only = ON")',
  'conn.execute("PRAGMA busy_timeout = 2000")',
  "conn.row_factory = sqlite3.Row",
  "try:",
  "    cur = conn.execute(query)",
  "    cols = [d[0] for d in cur.description] if cur.description else []",
  "    rows = [dict(zip(cols, row)) for row in cur.fetchall()]",
  "    print(json.dumps(rows, default=str))",
  "except Exception as exc:",
  '    print(json.dumps({"error": str(exc)}), file=sys.stderr)',
  "    sys.exit(1)",
  "finally:",
  "    conn.close()",
].join("\n");

const SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;

// The cache key drops the caller's timeoutSeconds: a timeout is a transport
// concern of the first overlapping caller, not part of the query result.
export async function querySqlite(
  dbPath: string,
  query: string,
  options?: { timeoutSeconds?: number },
): Promise<unknown> {
  if (!GLib.file_test(dbPath, GLib.FileTest.EXISTS)) return [];

  const cacheKey = `${dbPath}:${query}`;
  const cached = cache.get(cacheKey);
  if (cached && (cached.expiresAt === null || cached.expiresAt > Date.now())) {
    return cached.promise;
  }

  const timeoutSeconds = options?.timeoutSeconds ?? 10;
  const entry: CacheEntry = { promise: Promise.resolve(), expiresAt: null };
  entry.promise = trackEntry(cacheKey, entry, dbPath, query, timeoutSeconds);
  cache.set(cacheKey, entry);

  return entry.promise;
}

export function clearSqliteCache(): void {
  cache.clear();
}

async function trackEntry(
  cacheKey: string,
  entry: CacheEntry,
  dbPath: string,
  query: string,
  timeoutSeconds: number,
): Promise<unknown> {
  try {
    const result = await runQueryWithFallback(dbPath, query, timeoutSeconds);
    entry.expiresAt = Date.now() + SQLITE_CACHE_TTL_SECONDS * 1000;
    return result;
  } catch (error) {
    if (cache.get(cacheKey) === entry) cache.delete(cacheKey);
    throw error;
  }
}

async function runQueryWithFallback(
  dbPath: string,
  query: string,
  timeoutSeconds: number,
): Promise<unknown> {
  const preferred = pickPrimaryMode(dbPath);

  try {
    return await runQuery(dbPath, query, preferred, timeoutSeconds);
  } catch (preferredError) {
    if (preferred !== "mode=ro" || !canFallbackToImmutable(dbPath)) {
      logWarn(`sqlite query failed for ${dbPath}`, describeError(preferredError));
      return [];
    }

    try {
      return await runQuery(dbPath, query, "immutable=1", timeoutSeconds);
    } catch (error) {
      logWarn(`sqlite query failed for ${dbPath}`, describeError(error));
      return [];
    }
  }
}

// mode=ro makes SQLite create -wal/-shm sidecars for WAL databases that lack
// them, so it is only safe when a sidecar already exists (then it reads the
// live WAL). Without sidecars, immutable=1 reads the main file read-only and
// creates nothing. Providers own these files; the extension must not create them.
function pickPrimaryMode(dbPath: string): string {
  const hasSidecar = SIDECAR_SUFFIXES.some((suffix) =>
    GLib.file_test(`${dbPath}${suffix}`, GLib.FileTest.EXISTS),
  );
  return hasSidecar ? "mode=ro" : "immutable=1";
}

// A hot rollback journal must be replayed before the main file is consistent.
// immutable=1 skips that recovery, so it is only a fallback when no -journal
// sidecar exists; otherwise the main file may be read while the journal is
// pending and yield torn data.
function canFallbackToImmutable(dbPath: string): boolean {
  return !GLib.file_test(`${dbPath}-journal`, GLib.FileTest.EXISTS);
}

function describeError(error: unknown): unknown {
  if (error instanceof SubprocessError && error.stderr.trim()) {
    return error.stderr.trim();
  }
  return error;
}

async function runQuery(
  dbPath: string,
  query: string,
  mode: string,
  timeoutSeconds: number,
): Promise<unknown> {
  const result = await runSubprocess(["python3", "-c", PYTHON_SCRIPT, dbPath, query, mode], {
    timeoutSeconds,
  });

  try {
    return JSON.parse(result.stdout) as unknown;
  } catch (error) {
    const sample = result.stdout.slice(0, 200);
    throw new Error(`SQLite query returned invalid JSON: ${maskSecrets(sample)}`, { cause: error });
  }
}
