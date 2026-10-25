import GLib from "gi://GLib";

import { SQLITE_CACHE_TTL_SECONDS } from "../constants.js";
import { logWarn } from "./log.js";
import { runSubprocess } from "./subprocess.js";

interface CacheEntry {
  promise: Promise<unknown>;
  expiresAt: number | null;
}

const cache = new Map<string, CacheEntry>();

// The helper installs a fail-closed, read-only syscall boundary before SQLite
// opens provider files. Unlike sidecar prechecks, it also covers cleanup races.
const PYTHON_SCRIPT = String.raw`
import ctypes, errno, json, os, platform, sqlite3, sys, urllib.parse

class Filter(ctypes.Structure):
    _fields_ = [("code", ctypes.c_ushort), ("jt", ctypes.c_ubyte),
                ("jf", ctypes.c_ubyte), ("k", ctypes.c_uint)]
class Program(ctypes.Structure):
    _fields_ = [("length", ctypes.c_ushort), ("filters", ctypes.POINTER(Filter))]

machine = platform.machine()
if machine == "x86_64":
    arch, open_nr, openat_nr = 0xc000003e, 2, 257
    mutations = [85, 76, 77, 82, 83, 84, 86, 87, 88, 90, 91, 92, 93, 94,
                 132, 133, 188, 189, 190, 197, 198, 199, 258, 259, 260, 263,
                 264, 265, 266, 268, 280, 285, 316, 437, 452]
elif machine in ("aarch64", "arm64"):
    arch, open_nr, openat_nr = 0xc00000b7, None, 56
    mutations = [5, 6, 7, 14, 15, 16, 33, 34, 35, 36, 37, 38, 45, 46,
                 47, 49, 53, 54, 55, 88, 276, 437, 452]
else:
    raise RuntimeError("Read-only SQLite sandbox unavailable on this architecture")

ALLOW, DENY = 0x7fff0000, 0x50000 | errno.EACCES
rules = [(0x20, 0, 0, 4), (0x15, 1, 0, arch), (0x06, 0, 0, DENY),
         (0x20, 0, 0, 0)]
# Reject x32 syscall numbers as well as unknown-architecture syscalls.
if machine == "x86_64":
    rules += [(0x45, 0, 1, 0x40000000), (0x06, 0, 0, DENY)]
for nr in mutations:
    rules += [(0x15, 0, 1, nr), (0x06, 0, 0, DENY)]
write_flags = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND
write_flags |= getattr(os, "O_TMPFILE", 0) & ~getattr(os, "O_DIRECTORY", 0)
for nr, offset in [(open_nr, 24), (openat_nr, 32)]:
    if nr is None:
        continue
    rules += [(0x15, 0, 4, nr), (0x20, 0, 0, offset),
              (0x45, 0, 1, write_flags), (0x06, 0, 0, DENY),
              (0x06, 0, 0, ALLOW)]
rules.append((0x06, 0, 0, ALLOW))
filters = (Filter * len(rules))(*(Filter(*r) for r in rules))
program = Program(len(rules), filters)
libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(38, 1, 0, 0, 0) or libc.prctl(22, 2, ctypes.byref(program), 0, 0):
    raise RuntimeError("Read-only SQLite sandbox unavailable")

uri = "file:" + urllib.parse.quote(sys.argv[1]) + "?mode=ro"
conn = sqlite3.connect(uri, uri=True)
try:
    conn.execute("PRAGMA query_only = ON")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA busy_timeout = 2000")
    conn.row_factory = sqlite3.Row
    cur = conn.execute(sys.argv[2])
    print(json.dumps([dict(row) for row in cur.fetchall()], default=str))
finally:
    conn.close()
`;

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
  try {
    return await runQuery(dbPath, query, timeoutSeconds);
  } catch (error) {
    logWarn("sqlite query unavailable", error);
    return [];
  }
}

async function runQuery(dbPath: string, query: string, timeoutSeconds: number): Promise<unknown> {
  const result = await runSubprocess(["python3", "-B", "-c", PYTHON_SCRIPT, dbPath, query], {
    timeoutSeconds,
  });

  try {
    return JSON.parse(result.stdout) as unknown;
  } catch (error) {
    throw new Error("SQLite query returned invalid JSON", { cause: error });
  }
}
