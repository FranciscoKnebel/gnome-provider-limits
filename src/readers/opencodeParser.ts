export interface OpenCodeDiskStats {
  totalCost: number;
  sessionsCount: number;
  limits: OpenCodeObservedSpendLimit[];
}

export interface OpenCodeLimitWindow {
  used_percent?: number;
  reset_at?: number;
}

export interface OpenCodeDbRow {
  total_cost: number | null;
  sessions_count: number | null;
}

export interface OpenCodeCostEntryRow {
  cost: number | null;
  time_created: number | string | null;
}

export interface OpenCodeObservedSpendWindow {
  id: "rolling" | "weekly" | "monthly";
  durationMs: number;
  limitUsd: number;
}

export interface OpenCodeObservedSpendLimit {
  id: OpenCodeObservedSpendWindow["id"];
  usedUsd: number;
  remainingUsd: number;
  usedPercent: number;
  remainingPercent: number;
  resetAt: number | null;
}

function finiteNumber(value: unknown, fallback: number): number {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function timestampMs(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 1e12 ? numeric * 1000 : numeric;
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

export function buildOpenCodeObservedSpendLimits(
  rows: readonly OpenCodeCostEntryRow[],
  windows: readonly OpenCodeObservedSpendWindow[],
  nowMs: number,
): OpenCodeObservedSpendLimit[] {
  return windows.map((window) => {
    const sinceMs = nowMs - window.durationMs;
    let usedUsd = 0;
    let firstRecordedAt: number | null = null;

    for (const row of rows) {
      const recordedAt = timestampMs(row.time_created);
      if (recordedAt === null || recordedAt < sinceMs) continue;

      usedUsd += finiteNumber(row.cost, 0);
      if (firstRecordedAt === null || recordedAt < firstRecordedAt) firstRecordedAt = recordedAt;
    }

    const used = Number(usedUsd.toFixed(6));
    const usedPercent = window.limitUsd > 0 ? (used / window.limitUsd) * 100 : 0;

    return {
      id: window.id,
      usedUsd: used,
      remainingUsd: Math.max(0, window.limitUsd - used),
      usedPercent,
      remainingPercent: Math.max(0, 100 - usedPercent),
      resetAt:
        firstRecordedAt === null ? null : Math.floor((firstRecordedAt + window.durationMs) / 1000),
    };
  });
}
