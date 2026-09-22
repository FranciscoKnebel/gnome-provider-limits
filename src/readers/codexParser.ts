import type { FieldDef } from "./base.js";

export const CODEX_PARSER_FIELDS: readonly FieldDef[] = [];

export interface CodexRateLimitWindow {
  used_percent?: number;
  window_minutes?: number;
  limit_window_seconds?: number;
  reset_after_seconds?: number;
  reset_at?: number;
}

export interface CodexRateLimits {
  allowed?: boolean;
  limit_reached?: boolean;
  primary?: CodexRateLimitWindow | null;
  secondary?: CodexRateLimitWindow | null;
}

export interface CodexResetCreditDetail {
  status?: string;
  expires_at?: string | null;
}

export interface CodexResetCredits {
  available_count?: number;
  applicable_available_count?: number;
  credits?: CodexResetCreditDetail[];
}

export interface CodexResetCreditsSummary {
  available: number | null;
  expiresAt: number | null;
}

export interface CodexRateLimitsPayload {
  rate_limits?: CodexRateLimits;
  plan_type?: string;
  credits?: { balance?: string; has_credits?: boolean; unlimited?: boolean } | null;
  reset_credits?: CodexResetCredits | null;
}

export interface CodexOauthUsagePayload {
  plan_type?: string;
  rate_limit?: {
    allowed?: boolean;
    limit_reached?: boolean;
    primary_window?: CodexRateLimitWindow | null;
    secondary_window?: CodexRateLimitWindow | null;
  };
  credits?: { balance?: string; has_credits?: boolean; unlimited?: boolean } | null;
}

export interface CodexLogRow {
  feedback_log_body?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asWindow(value: unknown): CodexRateLimitWindow | null {
  return isRecord(value) ? (value as CodexRateLimitWindow) : null;
}

export function normalizeCodexResetCredits(value: unknown): CodexResetCredits | null {
  if (!isRecord(value)) return null;
  const credits = Array.isArray(value.credits)
    ? value.credits.filter(isRecord).map((credit) => credit as CodexResetCreditDetail)
    : undefined;
  return {
    available_count: typeof value.available_count === "number" ? value.available_count : undefined,
    applicable_available_count:
      typeof value.applicable_available_count === "number"
        ? value.applicable_available_count
        : undefined,
    credits,
  };
}

export function summarizeCodexResetCredits(
  resetCredits: CodexResetCredits | null | undefined,
): CodexResetCreditsSummary {
  const credits = Array.isArray(resetCredits?.credits) ? resetCredits.credits : [];

  let available: number | null = null;
  const count = resetCredits?.available_count;
  if (typeof count === "number" && Number.isFinite(count)) {
    available = Math.max(0, Math.round(count));
  } else if (credits.length > 0) {
    available = credits.filter((credit) => (credit.status ?? "available") === "available").length;
  }

  let expiresAt: number | null = null;
  for (const credit of credits) {
    if (credit.status && credit.status !== "available") continue;
    if (typeof credit.expires_at !== "string") continue;
    const parsedMs = Date.parse(credit.expires_at);
    if (!Number.isFinite(parsedMs)) continue;
    const parsedSec = Math.floor(parsedMs / 1000);
    if (expiresAt === null || parsedSec < expiresAt) expiresAt = parsedSec;
  }

  return { available, expiresAt };
}

export function normalizeCodexOauthPayload(raw: unknown): CodexRateLimitsPayload | null {
  if (!isRecord(raw) || !isRecord(raw.rate_limit)) return null;
  const rl = raw.rate_limit;
  return {
    rate_limits: {
      allowed: typeof rl.allowed === "boolean" ? rl.allowed : undefined,
      limit_reached: typeof rl.limit_reached === "boolean" ? rl.limit_reached : undefined,
      primary: asWindow(rl.primary_window),
      secondary: asWindow(rl.secondary_window),
    },
    plan_type: typeof raw.plan_type === "string" ? raw.plan_type : undefined,
    credits: isRecord(raw.credits) ? raw.credits : null,
    reset_credits: normalizeCodexResetCredits(raw.rate_limit_reset_credits),
  };
}

export function parseCodexLogBody(body: string): CodexRateLimitsPayload | null {
  const match = body.match(/\{[^{}]*"type"\s*:\s*"codex\.rate_limits".*\}/s);
  if (!match) return null;

  let event: {
    type?: string;
    plan_type?: string;
    rate_limits?: CodexRateLimits;
    rate_limit_reset_credits?: unknown;
    reset_credits?: unknown;
  } | null = null;
  try {
    event = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!event || event.type !== "codex.rate_limits" || !event.rate_limits) return null;

  return {
    rate_limits: event.rate_limits,
    plan_type: event.plan_type,
    reset_credits: normalizeCodexResetCredits(
      event.rate_limit_reset_credits ?? event.reset_credits,
    ),
  };
}

export function codexWindowMinutes(window: CodexRateLimitWindow | null | undefined): number | null {
  if (!window) return null;
  if (typeof window.window_minutes === "number") return window.window_minutes;
  if (typeof window.limit_window_seconds === "number") {
    return Math.round(window.limit_window_seconds / 60);
  }
  return null;
}
