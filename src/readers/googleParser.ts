export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_CLOUDCODE_DAILY_URL = "https://daily-cloudcode-pa.googleapis.com";
export const GOOGLE_CLOUDCODE_PROD_URL = "https://cloudcode-pa.googleapis.com";

const ALLOWED_TOKEN_URIS = new Set([
  "https://oauth2.googleapis.com/token",
  "https://accounts.google.com/o/oauth2/token",
]);

const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 30_000;
const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;
const UNTOUCHED_WINDOW_TOLERANCE_MS = 120_000;

export interface GoogleAuth {
  accessToken: string | null;
  refreshToken: string | null;
  clientId: string | null;
  clientSecret: string | null;
  projectId: string | null;
}

export type GoogleWindowReset =
  | { readonly state: "present"; readonly at: number }
  | { readonly state: "idle" }
  | { readonly state: "missing" };

export interface GoogleWindowUsage {
  usedPercent: number | null;
  reset: GoogleWindowReset;
}

export interface GoogleUsage {
  session: GoogleWindowUsage | null;
  weekly: GoogleWindowUsage | null;
  thirdPartySession: GoogleWindowUsage | null;
  thirdPartyWeekly: GoogleWindowUsage | null;
  limitReached: boolean | null;
}

type QuotaFamily = "gemini" | "3p";
type QuotaWindow = "5h" | "weekly";

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

function sanitizeProjectId(value: unknown): string | null {
  const token = sanitizeToken(value);
  if (!token) return null;
  return /^[a-z0-9][a-z0-9.:-]{0,127}$/i.test(token) ? token : null;
}

function parseTimestampSeconds(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value >= 1e11 ? value / 1000 : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) && ms > 0 ? ms / 1000 : null;
  }
  return null;
}

export function parseGoogleAuth(text: string, now = Date.now()): GoogleAuth | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  if (raw.type !== undefined && raw.type !== "authorized_user") return null;
  if ("private_key" in raw) return null;

  if (raw.token_uri !== undefined) {
    if (typeof raw.token_uri !== "string") return null;
    const normalizedUri = raw.token_uri.trim().replace(/\/+$/, "");
    if (!ALLOWED_TOKEN_URIS.has(normalizedUri)) return null;
  }

  let accessToken = sanitizeToken(raw.access_token);
  if (raw.expiry_date !== undefined) {
    if (
      typeof raw.expiry_date !== "number" ||
      !Number.isFinite(raw.expiry_date) ||
      raw.expiry_date <= now + ACCESS_TOKEN_EXPIRY_BUFFER_MS
    ) {
      accessToken = null;
    }
  } else if (raw.expires_at !== undefined) {
    const expiresSec = parseTimestampSeconds(raw.expires_at);
    if (expiresSec === null || expiresSec * 1000 <= now + ACCESS_TOKEN_EXPIRY_BUFFER_MS) {
      accessToken = null;
    }
  }

  const rawRefresh = sanitizeToken(raw.refresh_token);
  const rawClientId = sanitizeToken(raw.client_id);
  const rawClientSecret = sanitizeToken(raw.client_secret);
  const hasRefreshTriplet = Boolean(rawRefresh && rawClientId && rawClientSecret);

  const refreshToken = hasRefreshTriplet ? rawRefresh : null;
  const clientId = hasRefreshTriplet ? rawClientId : null;
  const clientSecret = hasRefreshTriplet ? rawClientSecret : null;

  if (!accessToken && !refreshToken) return null;

  const projectId = sanitizeProjectId(raw.project_id) ?? sanitizeProjectId(raw.quota_project_id);
  return {
    accessToken,
    refreshToken,
    clientId,
    clientSecret,
    projectId,
  };
}

export function parseGoogleTokenResponse(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  return sanitizeToken(raw.access_token);
}

export function isAntigravityAuthPath(path: string): boolean {
  return /(?:^|[\\/])(?:antigravity[^\\/]*|acp_token\.json)(?:$|[\\/])/i.test(path);
}

export function resolveGoogleQuotaEndpoints(
  projectId: string | null,
  isAntigravitySource = false,
): readonly [string, string] {
  if (isAntigravitySource) {
    return [GOOGLE_CLOUDCODE_DAILY_URL, GOOGLE_CLOUDCODE_PROD_URL];
  }
  return projectId
    ? [GOOGLE_CLOUDCODE_PROD_URL, GOOGLE_CLOUDCODE_DAILY_URL]
    : [GOOGLE_CLOUDCODE_DAILY_URL, GOOGLE_CLOUDCODE_PROD_URL];
}

function parseBucketWindowUsage(
  bucket: Record<string, unknown>,
  window: QuotaWindow,
  requestedAtMs: number,
): GoogleWindowUsage | null {
  if (bucket.disabled === true) return null;

  const rawResetSec = parseTimestampSeconds(bucket.resetTime);
  const rawFraction = bucket.remainingFraction;

  let usedPercent: number;
  let remainingFraction: number;
  if (rawFraction === undefined) {
    if (rawResetSec === null) return null;
    remainingFraction = 0;
    usedPercent = 100;
  } else {
    if (
      typeof rawFraction !== "number" ||
      !Number.isFinite(rawFraction) ||
      rawFraction < 0 ||
      rawFraction > 1
    ) {
      return null;
    }
    remainingFraction = rawFraction;
    usedPercent = Math.round((1 - remainingFraction) * 10_000) / 100;
  }

  let reset: GoogleWindowReset =
    rawResetSec === null ? { state: "missing" } : { state: "present", at: rawResetSec };
  const hasDescription =
    typeof bucket.description === "string" && bucket.description.trim().length > 0;
  if (remainingFraction === 1 && !hasDescription && rawResetSec !== null) {
    const windowMs = window === "5h" ? FIVE_HOUR_MS : WEEKLY_MS;
    const expectedResetMs = requestedAtMs + windowMs;
    if (Math.abs(rawResetSec * 1000 - expectedResetMs) <= UNTOUCHED_WINDOW_TOLERANCE_MS) {
      reset = { state: "idle" };
    }
  }

  return { usedPercent, reset };
}

function resetAtOf(reset: GoogleWindowReset): number | null {
  return reset.state === "present" ? reset.at : null;
}

function pickHigherUsage(
  current: GoogleWindowUsage | null,
  candidate: GoogleWindowUsage | null,
): GoogleWindowUsage | null {
  if (!candidate) return current;
  if (!current) return candidate;
  const curPct = current.usedPercent ?? -1;
  const candPct = candidate.usedPercent ?? -1;
  if (candPct > curPct) return candidate;
  if (candPct < curPct) return current;
  const currentResetAt = resetAtOf(current.reset);
  const candidateResetAt = resetAtOf(candidate.reset);
  if (currentResetAt === null && candidateResetAt !== null) return candidate;
  if (currentResetAt !== null && candidateResetAt !== null && candidateResetAt < currentResetAt) {
    return candidate;
  }
  return current;
}

function buildGoogleUsage(
  session: GoogleWindowUsage | null,
  weekly: GoogleWindowUsage | null,
  thirdPartySession: GoogleWindowUsage | null,
  thirdPartyWeekly: GoogleWindowUsage | null,
): GoogleUsage | null {
  const all = [session, weekly, thirdPartySession, thirdPartyWeekly];
  if (all.every((w) => w === null)) return null;

  const withPct = all.filter(
    (w): w is GoogleWindowUsage & { usedPercent: number } =>
      w !== null && typeof w.usedPercent === "number",
  );
  const limitReached = withPct.length > 0 ? withPct.some((w) => w.usedPercent >= 100) : null;

  return {
    session,
    weekly,
    thirdPartySession,
    thirdPartyWeekly,
    limitReached,
  };
}

function classifyBucket(
  bucket: Record<string, unknown>,
  groupId: string | null,
): { family: QuotaFamily; window: QuotaWindow; exactAggregate: boolean } | null {
  const bucketId = typeof bucket.bucketId === "string" ? bucket.bucketId.trim().toLowerCase() : "";
  if (bucketId === "gemini-5h") {
    return { family: "gemini", window: "5h", exactAggregate: true };
  }
  if (bucketId === "gemini-weekly") {
    return { family: "gemini", window: "weekly", exactAggregate: true };
  }
  if (bucketId === "3p-5h") {
    return { family: "3p", window: "5h", exactAggregate: true };
  }
  if (bucketId === "3p-weekly") {
    return { family: "3p", window: "weekly", exactAggregate: true };
  }

  let family: QuotaFamily | null = null;
  if (groupId === "gemini" || bucketId.startsWith("gemini")) {
    family = "gemini";
  } else if (
    groupId === "3p" ||
    bucketId.startsWith("3p") ||
    bucketId.startsWith("claude") ||
    bucketId.startsWith("gpt")
  ) {
    family = "3p";
  }
  if (!family) return null;

  const rawWindow = typeof bucket.window === "string" ? bucket.window.trim().toLowerCase() : "";
  let window: QuotaWindow | null = null;
  if (rawWindow === "5h" || bucketId.endsWith("-5h")) {
    window = "5h";
  } else if (rawWindow === "weekly" || bucketId.endsWith("-weekly")) {
    window = "weekly";
  }
  if (!window) return null;

  return { family, window, exactAggregate: false };
}

export function normalizeGoogleQuotaSummary(
  raw: unknown,
  requestedAtMs = Date.now(),
): GoogleUsage | null {
  if (!isRecord(raw)) return null;

  const collected: { groupId: string | null; bucket: Record<string, unknown> }[] = [];
  if (Array.isArray(raw.groups)) {
    for (const group of raw.groups) {
      if (!isRecord(group) || !Array.isArray(group.buckets)) continue;
      const groupId = typeof group.groupId === "string" ? group.groupId.trim().toLowerCase() : null;
      for (const bucket of group.buckets) {
        if (isRecord(bucket)) collected.push({ groupId, bucket });
      }
    }
  }
  if (Array.isArray(raw.buckets)) {
    for (const bucket of raw.buckets) {
      if (isRecord(bucket)) collected.push({ groupId: null, bucket });
    }
  }

  let exactSession: GoogleWindowUsage | null = null;
  let exactWeekly: GoogleWindowUsage | null = null;
  let exact3pSession: GoogleWindowUsage | null = null;
  let exact3pWeekly: GoogleWindowUsage | null = null;

  let maxSession: GoogleWindowUsage | null = null;
  let maxWeekly: GoogleWindowUsage | null = null;
  let max3pSession: GoogleWindowUsage | null = null;
  let max3pWeekly: GoogleWindowUsage | null = null;

  for (const { groupId, bucket } of collected) {
    const meta = classifyBucket(bucket, groupId);
    if (!meta) continue;
    const usage = parseBucketWindowUsage(bucket, meta.window, requestedAtMs);
    if (!usage) continue;

    if (meta.family === "gemini" && meta.window === "5h") {
      if (meta.exactAggregate) exactSession = usage;
      else maxSession = pickHigherUsage(maxSession, usage);
    } else if (meta.family === "gemini" && meta.window === "weekly") {
      if (meta.exactAggregate) exactWeekly = usage;
      else maxWeekly = pickHigherUsage(maxWeekly, usage);
    } else if (meta.family === "3p" && meta.window === "5h") {
      if (meta.exactAggregate) exact3pSession = usage;
      else max3pSession = pickHigherUsage(max3pSession, usage);
    } else {
      if (meta.exactAggregate) exact3pWeekly = usage;
      else max3pWeekly = pickHigherUsage(max3pWeekly, usage);
    }
  }

  return buildGoogleUsage(
    exactSession ?? maxSession,
    exactWeekly ?? maxWeekly,
    exact3pSession ?? max3pSession,
    exact3pWeekly ?? max3pWeekly,
  );
}

export function normalizeGoogleAvailableModels(
  raw: unknown,
  requestedAtMs = Date.now(),
): GoogleUsage | null {
  if (!isRecord(raw) || !isRecord(raw.models)) return null;

  let session: GoogleWindowUsage | null = null;
  let weekly: GoogleWindowUsage | null = null;
  let thirdPartySession: GoogleWindowUsage | null = null;
  let thirdPartyWeekly: GoogleWindowUsage | null = null;

  for (const [modelId, model] of Object.entries(raw.models)) {
    if (!isRecord(model) || model.disabled === true) continue;

    const provider = typeof model.modelProvider === "string" ? model.modelProvider : "";
    const lowerId = modelId.toLowerCase();
    let family: QuotaFamily | null = null;
    if (provider === "MODEL_PROVIDER_GOOGLE" || lowerId.includes("gemini")) {
      family = "gemini";
    } else if (
      provider === "MODEL_PROVIDER_ANTHROPIC" ||
      provider === "MODEL_PROVIDER_OPENAI" ||
      lowerId.includes("claude") ||
      lowerId.includes("gpt")
    ) {
      family = "3p";
    }
    if (!family) continue;

    if (isRecord(model.quotaInfo)) {
      const usage = parseBucketWindowUsage(model.quotaInfo, "5h", requestedAtMs);
      if (family === "gemini") session = pickHigherUsage(session, usage);
      else thirdPartySession = pickHigherUsage(thirdPartySession, usage);
    }
    if (isRecord(model.weeklyQuotaInfo)) {
      const usage = parseBucketWindowUsage(model.weeklyQuotaInfo, "weekly", requestedAtMs);
      if (family === "gemini") weekly = pickHigherUsage(weekly, usage);
      else thirdPartyWeekly = pickHigherUsage(thirdPartyWeekly, usage);
    }
  }

  return buildGoogleUsage(session, weekly, thirdPartySession, thirdPartyWeekly);
}

export function hasActiveGoogleUsage(usage: GoogleUsage | null): boolean {
  if (!usage) return false;
  return [usage.session, usage.weekly, usage.thirdPartySession, usage.thirdPartyWeekly].some(
    (w) => (w?.usedPercent ?? 0) > 0,
  );
}

export function hasCompleteActiveGoogleUsage(usage: GoogleUsage | null): boolean {
  if (!usage || !hasActiveGoogleUsage(usage)) return false;
  return usage.thirdPartySession !== null || usage.thirdPartyWeekly !== null;
}

export function mergeGoogleUsage(
  primary: GoogleUsage | null,
  secondary: GoogleUsage | null,
): GoogleUsage | null {
  if (!primary) return secondary;
  if (!secondary) return primary;
  return buildGoogleUsage(
    pickHigherUsage(primary.session, secondary.session),
    pickHigherUsage(primary.weekly, secondary.weekly),
    pickHigherUsage(primary.thirdPartySession, secondary.thirdPartySession),
    pickHigherUsage(primary.thirdPartyWeekly, secondary.thirdPartyWeekly),
  );
}

export function parseGoogleTierName(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const paid = isRecord(raw.paidTier) ? raw.paidTier : null;
  const current = isRecord(raw.currentTier) ? raw.currentTier : null;
  for (const candidate of [paid?.name, current?.name, paid?.id, current?.id]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}
