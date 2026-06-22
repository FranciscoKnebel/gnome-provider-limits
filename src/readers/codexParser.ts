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

export function normalizeCodexOauthPayload(
  raw: CodexOauthUsagePayload,
): CodexRateLimitsPayload | null {
  const rl = raw.rate_limit;
  if (!rl) return null;
  return {
    rate_limits: {
      allowed: rl.allowed,
      limit_reached: rl.limit_reached,
      primary: rl.primary_window ?? null,
      secondary: rl.secondary_window ?? null,
    },
    plan_type: raw.plan_type,
    credits: raw.credits ?? null,
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
