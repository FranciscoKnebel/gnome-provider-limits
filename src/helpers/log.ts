const SENSITIVE_KEYS = [
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "cookie",
  "Authorization",
  "sessionKey",
  "accountId",
  "account_id",
  "email",
  "password",
  "apiKey",
  "api_key",
] as const;

export function redactForLog(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return "<redacted>";
  if (typeof value !== "object") return value;

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactForLog(item, seen));
  }

  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
      result[key] = "<redacted>";
    } else {
      result[key] = redactForLog(val, seen);
    }
  }

  return result;
}

export function logError(message: string, error: unknown): void {
  if (error instanceof Error) {
    console.error(`[provider-limits] ${message}: ${error.message}`, redactForLog(error));
  } else {
    console.error(`[provider-limits] ${message}:`, redactForLog(error));
  }
}

export function logWarn(message: string, ...args: unknown[]): void {
  console.warn(`[provider-limits] ${message}`, ...args.map((arg) => redactForLog(arg)));
}
