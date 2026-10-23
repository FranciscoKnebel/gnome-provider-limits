export interface GrokUsage {
  usedPercent: number | null;
  resetAt: number | null;
  prepaidBalance: number | null;
  unifiedBilling: boolean | null;
}

export interface GrokAuth {
  token: string;
  userId: string | null;
}

const GROK_OIDC_SCOPE = "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828";

export function parseGrokAuth(text: string, now = Date.now()): GrokAuth | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const scopes = [
    GROK_OIDC_SCOPE,
    ...Object.keys(raw).filter(
      (key) => key.startsWith("https://auth.x.ai::") && key !== GROK_OIDC_SCOPE,
    ),
    "https://accounts.x.ai/sign-in",
  ];
  for (const scope of scopes) {
    const entry = raw[scope];
    if (!isRecord(entry) || typeof entry.key !== "string" || !entry.key.trim()) continue;
    const token = entry.key.trim();
    if (token.startsWith("xai-") || /\s/.test(token)) return null;
    if (entry.expires_at != null) {
      const expiresAt = timestamp(entry.expires_at);
      if (expiresAt === null || expiresAt * 1000 <= now) return null;
    } else if (entry.create_time != null) {
      const createdAt = timestamp(entry.create_time);
      if (createdAt === null || (createdAt + 30 * 86400) * 1000 <= now) return null;
    }
    if (typeof entry.principal_type === "string" && entry.principal_type.toLowerCase() === "team") {
      return null;
    }
    return {
      token,
      userId:
        typeof entry.user_id === "string" && entry.user_id.trim() ? entry.user_id.trim() : null,
    };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms / 1000 : null;
}

function prepaidDollars(value: unknown): number | null {
  if (!isRecord(value)) return null;
  if (Object.keys(value).length === 0) return 0;
  const raw = value.val;
  if (typeof raw !== "number" && (typeof raw !== "string" || !/^\d+$/.test(raw))) {
    return null;
  }
  const cents = Number(raw);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents / 100 : null;
}

export function normalizeGrokUsagePayload(raw: unknown): GrokUsage | null {
  if (!isRecord(raw) || !isRecord(raw.config)) return null;
  const config = raw.config;
  const percent = config.creditUsagePercent;
  let usedPercent =
    typeof percent === "number" && Number.isFinite(percent) && percent >= 0
      ? Math.min(100, percent)
      : null;
  const current = isRecord(config.currentPeriod) ? config.currentPeriod : null;
  if (config.creditUsagePercent == null && !current) {
    const used = prepaidDollars(config.used);
    const limit = prepaidDollars(config.monthlyLimit);
    if (used !== null && limit !== null && limit > 0) {
      usedPercent = Math.min(100, (used / limit) * 100);
    }
  }
  const resetAt = timestamp(current?.end) ?? timestamp(config.billingPeriodEnd);

  const prepaidBalance = prepaidDollars(config.prepaidBalance);
  const unifiedBilling =
    typeof config.isUnifiedBillingUser === "boolean" ? config.isUnifiedBillingUser : null;
  return { usedPercent, resetAt, prepaidBalance, unifiedBilling };
}
