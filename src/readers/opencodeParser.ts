export interface OpenCodeDiskStats {
  totalCost: number;
  sessionsCount: number;
  tokenExpiresAt: number | null;
}

export interface OpenCodeDbRow {
  total_cost: number | null;
  sessions_count: number | null;
}

export interface OpenCodeAuthFile {
  openai?: { expires?: number | string | null } | null;
}

export function normalizeOpenCodeDbRow(row: OpenCodeDbRow | null | undefined): {
  totalCost: number;
  sessionsCount: number;
} {
  if (!row) return { totalCost: 0, sessionsCount: 0 };
  return {
    totalCost: Number(row.total_cost ?? 0),
    sessionsCount: Number(row.sessions_count ?? 0),
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
  let auth: OpenCodeAuthFile;
  try {
    auth = JSON.parse(text) as OpenCodeAuthFile;
  } catch {
    return null;
  }
  return parseOpenCodeTokenExpiry(auth?.openai?.expires ?? null);
}
