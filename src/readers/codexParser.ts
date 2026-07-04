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

export interface CodexRateLimitsPayload {
  rate_limits?: CodexRateLimits;
  plan_type?: string;
  credits?: { balance?: string; has_credits?: boolean; unlimited?: boolean } | null;
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
  };
}

export function parseCodexLogBody(body: string): CodexRateLimitsPayload | null {
  const match = body.match(/\{[^{}]*"type"\s*:\s*"codex\.rate_limits".*\}/s);
  if (!match) return null;

  let event: { type?: string; plan_type?: string; rate_limits?: CodexRateLimits } | null = null;
  try {
    event = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!event || event.type !== "codex.rate_limits" || !event.rate_limits) return null;

  return {
    rate_limits: event.rate_limits,
    plan_type: event.plan_type,
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
