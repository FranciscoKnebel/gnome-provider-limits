export interface OpenCodeDbRow {
  total_cost: number | null;
  sessions_count: number | null;
}

export interface OpenCodeUsageWindow {
  status: string | null;
  percent: number | null;
  reset_at: number | null;
}

export interface OpenCodeUsage {
  rolling: OpenCodeUsageWindow | null;
  weekly: OpenCodeUsageWindow | null;
  monthly: OpenCodeUsageWindow | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function timestampSeconds(value: unknown): number | null {
  let ms: number;
  if (typeof value === "number") {
    ms = value < 1e12 ? value * 1000 : value;
  } else if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    ms = Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : Date.parse(value);
  } else {
    return null;
  }

  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor(ms / 1000);
}

export function normalizeOpenCodeDbRow(row: OpenCodeDbRow | null | undefined): {
  totalCost: number;
  sessionsCount: number;
} {
  if (!row) return { totalCost: 0, sessionsCount: 0 };
  return {
    totalCost: finiteNumber(row.total_cost) ?? 0,
    sessionsCount: finiteNumber(row.sessions_count) ?? 0,
  };
}

export interface OpenCodeSourceFailure {
  source: string;
  reason: unknown;
}

export function openCodePartialError(
  hasUsage: boolean,
  hasTelemetry: boolean,
  failures: readonly OpenCodeSourceFailure[],
): string | null {
  if (hasUsage && hasTelemetry) return null;
  if (failures.length > 0) {
    return failures
      .map(
        (failure) =>
          `${failure.source}: ${
            failure.reason instanceof Error ? failure.reason.message : String(failure.reason)
          }`,
      )
      .join("; ");
  }
  return hasUsage ? "disk: no data" : "usage-api: no data";
}

export function parseOpenCodeAuthKey(text: string): string | null {
  let auth: unknown;
  try {
    auth = JSON.parse(text) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(auth) || !isRecord(auth["opencode-go"])) return null;

  const provider = auth["opencode-go"];
  const key = provider.key ?? provider.access;
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

function normalizeWindow(value: unknown): OpenCodeUsageWindow | null {
  if (!isRecord(value)) return null;

  const status =
    typeof value.status === "string" && value.status.trim() ? value.status.trim() : null;
  const percent = finiteNumber(value.percent);
  const resetAt = timestampSeconds(value.resetsAt);

  if (status === null && percent === null && resetAt === null) return null;

  return { status, percent, reset_at: resetAt };
}

export function normalizeOpenCodeUsagePayload(raw: unknown): OpenCodeUsage | null {
  if (!isRecord(raw)) return null;

  const usage = isRecord(raw.usage) ? raw.usage : raw;
  const rolling = normalizeWindow(usage.rolling);
  const weekly = normalizeWindow(usage.weekly);
  const monthly = normalizeWindow(usage.monthly);

  if (!rolling && !weekly && !monthly) return null;

  return { rolling, weekly, monthly };
}
