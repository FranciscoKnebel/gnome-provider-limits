import { SQLITE_CACHE_TTL_SECONDS } from "../constants.js";
import { runSubprocess } from "./subprocess.js";

interface CacheEntry {
  result: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function querySqlite<T>(
  dbPath: string,
  query: string,
  options?: { timeoutSeconds?: number },
): Promise<T> {
  const cacheKey = `${dbPath}:${query}`;
  const now = Date.now();

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.result as T;
  }

  const script = buildPythonScript(dbPath, query);
  const result = await runSubprocess(["python3", "-c", script], {
    timeoutSeconds: options?.timeoutSeconds ?? 10,
  });

  let parsed: T;
  try {
    parsed = JSON.parse(result.stdout) as T;
  } catch (error) {
    throw new Error(`SQLite query returned invalid JSON: ${result.stdout}`, { cause: error });
  }

  cache.set(cacheKey, {
    result: parsed,
    expiresAt: now + SQLITE_CACHE_TTL_SECONDS * 1000,
  });

  return parsed;
}

export function clearSqliteCache(): void {
  cache.clear();
}

function buildPythonScript(dbPath: string, query: string): string {
  return [
    "import sqlite3, json, sys",
    "conn = sqlite3.connect(" + JSON.stringify(dbPath) + ")",
    "conn.row_factory = sqlite3.Row",
    "cur = conn.cursor()",
    "try:",
    "    cur.execute(" + JSON.stringify(query) + ")",
    "    rows = cur.fetchall()",
    "    cols = [d[0] for d in cur.description] if cur.description else []",
    "    result = [dict(zip(cols, row)) for row in rows]",
    "    print(json.dumps(result, default=str))",
    "except Exception as e:",
    '    print(json.dumps({"error": str(e)}), file=sys.stderr)',
    "    sys.exit(1)",
    "finally:",
    "    conn.close()",
  ].join("\n");
}
