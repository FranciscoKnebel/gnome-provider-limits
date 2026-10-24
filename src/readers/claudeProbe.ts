export const CLI_PROBE_BACKOFF_MS = 5 * 60 * 1000;

export interface ProbeDecisionOptions {
  now: number;
  lastFailureAt: number | null;
  force: boolean;
  backoffMs?: number;
}

export function shouldProbeCli(options: ProbeDecisionOptions): boolean {
  if (options.force) return true;
  if (options.lastFailureAt === null) return true;
  const backoffMs = options.backoffMs ?? CLI_PROBE_BACKOFF_MS;
  return options.now - options.lastFailureAt >= backoffMs;
}

export interface CliFailureUpdateOptions {
  payload: unknown;
  cancelled: boolean;
  now: number;
  previous: number | null;
}

export function nextCliFailureAt(options: CliFailureUpdateOptions): number | null {
  if (options.payload !== null && options.payload !== undefined) return null;
  if (options.cancelled) return options.previous;
  return options.now;
}

export function normalizeExpiresAt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 1e12 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function credentialObject(creds: unknown): Record<string, unknown> | null {
  if (!creds || typeof creds !== "object" || Array.isArray(creds)) return null;
  const record = creds as Record<string, unknown>;
  if (record.claudeAiOauth === undefined) return record;
  const nested = record.claudeAiOauth;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : null;
}

export function credentialExpiresAt(creds: unknown): number | null {
  const source = credentialObject(creds);
  return source ? normalizeExpiresAt(source.expiresAt ?? source.expires_at) : null;
}

export interface ClaudeAuth {
  token: string;
  expiresAtMs: number | null;
}

export function parseClaudeCredentials(creds: unknown): ClaudeAuth | null {
  const source = credentialObject(creds);
  if (!source) return null;
  const nested = source !== creds;
  const token = nested ? source.accessToken : (source.access_token ?? source.token);
  if (typeof token !== "string" || !token.trim()) return null;
  const rawExpiry = source.expiresAt ?? source.expires_at;
  const expiresAtMs = normalizeExpiresAt(rawExpiry);
  if (rawExpiry !== undefined && expiresAtMs === null) return null;
  return { token, expiresAtMs };
}

export function isCredentialExpired(expiresAtMs: number | null, now: number): boolean {
  return expiresAtMs !== null && expiresAtMs <= now;
}
