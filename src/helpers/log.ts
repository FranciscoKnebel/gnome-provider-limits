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

const SECRET_PATTERNS: readonly RegExp[] = [
  /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b[A-Fa-f0-9]{32,}\b/g,
  /[A-Za-z0-9+/]{40,}={0,2}/g,
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => lower.includes(s.toLowerCase()));
}

export function maskSecrets(text: string): string {
  let masked = text;
  for (const pattern of SECRET_PATTERNS) {
    masked = masked.replace(pattern, "<redacted>");
  }
  return masked;
}

function redactError(error: Error): Record<string, unknown> {
  return {
    name: maskSecrets(error.name),
    message: maskSecrets(error.message),
    stack: maskSecrets(error.stack ?? ""),
  };
}

export function redactForLog(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Error) return redactError(value);
  if (typeof value === "string") return maskSecrets(value);
  if (typeof value !== "object") return value;

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactForLog(item, seen));
  }

  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    result[key] = isSensitiveKey(key) ? "<redacted>" : redactForLog(val, seen);
  }

  return result;
}

export function logError(message: string, error: unknown): void {
  if (error instanceof Error) {
    console.error(
      `[provider-limits] ${message}: ${maskSecrets(error.message)}`,
      redactForLog(error),
    );
    return;
  }

  console.error(`[provider-limits] ${message}:`, redactForLog(error));
}

export function logWarn(message: string, ...args: unknown[]): void {
  console.warn(`[provider-limits] ${message}`, ...args.map((arg) => redactForLog(arg)));
}
