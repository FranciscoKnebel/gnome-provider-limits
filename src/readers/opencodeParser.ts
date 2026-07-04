export interface OpenCodeDiskStats {
  totalCost: number;
  sessionsCount: number;
  tokenExpiresAt: number | null;
}

export interface OpenCodeLimitWindow {
  used_percent?: number;
  reset_at?: number;
}

export interface OpenCodeRateLimitsPayload {
  rate_limits?: {
    allowed?: boolean;
    limit_reached?: boolean;
    rolling?: OpenCodeLimitWindow | null;
    weekly?: OpenCodeLimitWindow | null;
  };
}

export interface OpenCodeOauthUsagePayload {
  rate_limit?: {
    allowed?: boolean;
    limit_reached?: boolean;
    primary_window?: OpenCodeLimitWindow | null;
    secondary_window?: OpenCodeLimitWindow | null;
  };
}

export interface OpenCodeDbRow {
  total_cost: number | null;
  sessions_count: number | null;
}

export interface OpenCodeAuthFile {
  openai?: { expires?: number | string | null } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function normalizeOpenCodeDbRow(row: OpenCodeDbRow | null | undefined): {
  totalCost: number;
  sessionsCount: number;
} {
  if (!row) return { totalCost: 0, sessionsCount: 0 };
  return {
    totalCost: finiteNumber(row.total_cost, 0),
    sessionsCount: finiteNumber(row.sessions_count, 0),
  };
}

export function parseOpenCodeTokenExpiry(raw: unknown): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;

  const numeric = typeof raw === "string" ? Number(raw) : raw;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  // OpenCode stores ms since epoch; normalize to seconds for FieldType "timestamp".
  return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

export function parseOpenCodeAuthText(text: string): number | null {
  let auth: unknown;
  try {
    auth = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  const openai = isRecord(auth) && isRecord(auth.openai) ? auth.openai : null;
  return parseOpenCodeTokenExpiry(openai?.expires ?? null);
}

export function parseOpenCodeAccessToken(text: string): string | null {
  let auth: unknown;
  try {
    auth = JSON.parse(text) as unknown;
  } catch {
    return null;
  }

  const openai = isRecord(auth) && isRecord(auth.openai) ? auth.openai : null;
  const token = openai?.access;
  return typeof token === "string" && token.trim() ? token : null;
}

function asWindow(value: unknown): OpenCodeLimitWindow | null {
  return isRecord(value) ? (value as OpenCodeLimitWindow) : null;
}

export function normalizeOpenCodeOauthPayload(raw: unknown): OpenCodeRateLimitsPayload | null {
  if (!isRecord(raw) || !isRecord(raw.rate_limit)) return null;
  const rl = raw.rate_limit;

  return {
    rate_limits: {
      allowed: typeof rl.allowed === "boolean" ? rl.allowed : undefined,
      limit_reached: typeof rl.limit_reached === "boolean" ? rl.limit_reached : undefined,
      rolling: asWindow(rl.primary_window),
      weekly: asWindow(rl.secondary_window),
    },
  };
}
