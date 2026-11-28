export const CURSOR_BACKEND_URL = "https://api2.cursor.sh";

export interface CursorAuth {
  accessToken: string | null;
  apiKey: string | null;
}

export interface CursorAuthFile {
  readonly auth: CursorAuth | null;
  readonly storedInOsKeyring: boolean;
}

export interface CursorUsage {
  usedPercentCredits: number | null;
  usedPercentAuto: number | null;
  usedPercentApi: number | null;
  resetAtCredits: number | null;
  remainingCredits: number | null;
  spendLimitUsed: number | null;
  limitReached: boolean | null;
}

export interface CursorPlanInfo {
  planName: string | null;
  resetAt: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasWhitespaceOrControl(value: string): boolean {
  if (/\s/.test(value)) return true;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function sanitizeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || hasWhitespaceOrControl(trimmed)) return null;
  return trimmed;
}

export function normalizeCursorBackendUrl(value: unknown): string | null {
  if (value === undefined || value === null) return CURSOR_BACKEND_URL;
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return CURSOR_BACKEND_URL;
  return trimmed === CURSOR_BACKEND_URL ? CURSOR_BACKEND_URL : null;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64UrlUtf8(input: string): string | null {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!normalized || normalized.length % 4 === 1) return null;

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === undefined) return null;
    const idx = BASE64_ALPHABET.indexOf(char);
    if (idx < 0) return null;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

export function isJwtExpired(token: string, now = Date.now()): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  if (!parts[0] || !parts[1] || !parts[2]) return true;

  const decoded = decodeBase64UrlUtf8(parts[1]);
  if (!decoded) return true;

  let payload: unknown;
  try {
    payload = JSON.parse(decoded);
  } catch {
    return true;
  }
  if (!isRecord(payload)) return true;
  if (!("exp" in payload) || payload.exp === undefined || payload.exp === null) return false;
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= 0) {
    return true;
  }
  return payload.exp * 1000 <= now;
}

function isGrokAuthShape(raw: Record<string, unknown>): boolean {
  if ("xaiAccessToken" in raw) return true;
  return Object.keys(raw).some(
    (key) => key.startsWith("https://auth.x.ai::") || key.startsWith("https://accounts.x.ai/"),
  );
}

export function parseCursorAuth(text: string, now = Date.now()): CursorAuth | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || isGrokAuthShape(raw)) return null;
  if (raw.version !== undefined && raw.version !== 1) return null;
  if (normalizeCursorBackendUrl(raw.backendUrl) === null) return null;

  let apiKey = sanitizeToken(raw.apiKey);
  if (raw.apiKeyExpiresAtMs !== undefined) {
    if (
      typeof raw.apiKeyExpiresAtMs !== "number" ||
      !Number.isFinite(raw.apiKeyExpiresAtMs) ||
      raw.apiKeyExpiresAtMs <= now
    ) {
      apiKey = null;
    }
  }

  let accessToken = sanitizeToken(raw.accessToken);
  if (accessToken && isJwtExpired(accessToken, now)) {
    accessToken = null;
  }

  if (!accessToken && !apiKey) return null;
  return { accessToken, apiKey };
}

export function parseCursorAuthFile(text: string, now = Date.now()): CursorAuthFile {
  let storedInOsKeyring = false;
  try {
    const raw: unknown = JSON.parse(text);
    storedInOsKeyring = isRecord(raw) && raw.storedIn === "os-secret-store";
  } catch {
    storedInOsKeyring = false;
  }
  return { auth: parseCursorAuth(text, now), storedInOsKeyring };
}

export function parseCursorEnvAuth(
  env: Record<string, string | null | undefined>,
  now = Date.now(),
): CursorAuth | null {
  if (normalizeCursorBackendUrl(env.CURSOR_BACKEND_URL) === null) return null;
  if (normalizeCursorBackendUrl(env.CURSOR_API_ENDPOINT) === null) return null;
  if (normalizeCursorBackendUrl(env.CURSOR_AUTH_API_BASE_URL) === null) return null;

  let accessToken = sanitizeToken(env.CURSOR_AUTH_TOKEN);
  if (accessToken && isJwtExpired(accessToken, now)) {
    accessToken = null;
  }
  const apiKey = sanitizeToken(env.CURSOR_API_KEY);
  if (!accessToken && !apiKey) return null;
  return { accessToken, apiKey };
}

export function parseCursorExchangeResponse(raw: unknown, now = Date.now()): string | null {
  if (!isRecord(raw)) return null;
  const token = sanitizeToken(raw.accessToken);
  if (!token || isJwtExpired(token, now)) return null;
  return token;
}

function clampPercent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(100, value)
    : null;
}

function centsToDollars(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) {
    return null;
  }
  const cents = Number(value);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents / 100 : null;
}

function epochTimestampSeconds(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value >= 1e11 ? value / 1000 : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
      return numeric >= 1e11 ? numeric / 1000 : numeric;
    }
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) && ms > 0 ? ms / 1000 : null;
  }
  return null;
}

function resolveRemainingCredits(
  planUsage: Record<string, unknown> | null,
  usedPercentCredits: number | null,
): number | null {
  if (!planUsage) return null;
  const explicit = centsToDollars(planUsage.remaining);
  if (explicit !== null || planUsage.remaining !== undefined) return explicit;

  const limit = centsToDollars(planUsage.limit);
  if (limit === null || limit <= 0) return null;

  const included = centsToDollars(planUsage.includedSpend);
  if (included !== null) {
    return Math.max(0, Math.round((limit - included) * 100) / 100);
  }
  if (
    planUsage.limitExceeded === true ||
    usedPercentCredits === null ||
    usedPercentCredits >= 100
  ) {
    return 0;
  }
  return null;
}

function resolveSpendLimitUsed(spendLimitUsage: Record<string, unknown> | null): number | null {
  if (!spendLimitUsage) return null;
  const explicit =
    centsToDollars(spendLimitUsage.individualUsed) ??
    centsToDollars(spendLimitUsage.totalSpend) ??
    centsToDollars(spendLimitUsage.pooledUsed);
  if (
    explicit !== null ||
    spendLimitUsage.individualUsed !== undefined ||
    spendLimitUsage.totalSpend !== undefined ||
    spendLimitUsage.pooledUsed !== undefined
  ) {
    return explicit;
  }

  const indLimit = centsToDollars(spendLimitUsage.individualLimit);
  const indRem = centsToDollars(spendLimitUsage.individualRemaining);
  if (indLimit !== null && indLimit > 0 && indRem !== null && indRem <= indLimit) {
    return Math.round((indLimit - indRem) * 100) / 100;
  }

  const poolLimit = centsToDollars(spendLimitUsage.pooledLimit);
  const poolRem = centsToDollars(spendLimitUsage.pooledRemaining);
  if (poolLimit !== null && poolLimit > 0 && poolRem !== null && poolRem <= poolLimit) {
    return Math.round((poolLimit - poolRem) * 100) / 100;
  }

  return null;
}

export function normalizeCursorUsagePayload(raw: unknown): CursorUsage | null {
  if (!isRecord(raw)) return null;
  const planUsage = isRecord(raw.planUsage) ? raw.planUsage : null;
  const spendLimitUsage = isRecord(raw.spendLimitUsage) ? raw.spendLimitUsage : null;
  if (raw.enabled === false && !planUsage && !spendLimitUsage) return null;

  let usedPercentCredits = clampPercent(planUsage?.totalPercentUsed);
  if (planUsage && planUsage.totalPercentUsed == null) {
    const included = centsToDollars(planUsage.includedSpend);
    const limit = centsToDollars(planUsage.limit);
    if (included !== null && limit !== null && limit > 0) {
      usedPercentCredits = Math.min(100, (included / limit) * 100);
    }
  }

  const planLimit = centsToDollars(planUsage?.limit);
  const remaining = centsToDollars(planUsage?.remaining);
  const unusedPlan =
    planLimit !== null &&
    planLimit > 0 &&
    remaining === planLimit &&
    planUsage?.includedSpend === undefined;
  if (usedPercentCredits === null && planUsage?.totalPercentUsed === undefined && unusedPlan) {
    usedPercentCredits = 0;
  }
  const hasUsagePool = usedPercentCredits !== null;
  const usedPercentAuto =
    planUsage?.autoPercentUsed === undefined && hasUsagePool
      ? 0
      : clampPercent(planUsage?.autoPercentUsed);
  const usedPercentApi =
    planUsage?.apiPercentUsed === undefined && hasUsagePool
      ? 0
      : clampPercent(planUsage?.apiPercentUsed);
  const remainingCredits = resolveRemainingCredits(planUsage, usedPercentCredits);
  const spendLimitUsed = resolveSpendLimitUsed(spendLimitUsage);
  const resetAtCredits = epochTimestampSeconds(raw.billingCycleEnd);

  if (
    usedPercentCredits === null &&
    usedPercentAuto === null &&
    usedPercentApi === null &&
    remainingCredits === null &&
    spendLimitUsed === null
  ) {
    return null;
  }

  let limitReached: boolean | null = null;
  if (typeof planUsage?.limitExceeded === "boolean") {
    limitReached = planUsage.limitExceeded;
  } else if (usedPercentCredits !== null) {
    limitReached = usedPercentCredits >= 100;
  } else if (remainingCredits !== null) {
    const limit = centsToDollars(planUsage?.limit);
    if (limit !== null && limit > 0) limitReached = remainingCredits <= 0;
  }

  return {
    usedPercentCredits,
    usedPercentAuto,
    usedPercentApi,
    resetAtCredits,
    remainingCredits,
    spendLimitUsed,
    limitReached,
  };
}

export function parseCursorPlanInfo(raw: unknown): CursorPlanInfo {
  if (!isRecord(raw)) return { planName: null, resetAt: null };
  const info = isRecord(raw.planInfo) ? raw.planInfo : raw;
  const planName =
    typeof info.planName === "string" && info.planName.trim() ? info.planName.trim() : null;
  const resetAt =
    epochTimestampSeconds(info.includedUsageResetsAt) ??
    epochTimestampSeconds(info.billingCycleEnd);
  return { planName, resetAt };
}
