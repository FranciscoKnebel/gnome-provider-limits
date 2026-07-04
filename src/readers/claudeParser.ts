export interface ClaudeUsageWindow {
  used_percent?: number;
  reset_at?: number;
}

export interface ClaudeUsagePayload {
  five_hour?: ClaudeUsageWindow | null;
  seven_day?: ClaudeUsageWindow | null;
  seven_day_sonnet?: ClaudeUsageWindow | null;
  seven_day_opus?: ClaudeUsageWindow | null;
  extra_usage?: { enabled?: boolean; disabled_reason?: string } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeWindow(value: unknown): ClaudeUsageWindow | null {
  if (!isRecord(value)) return null;
  return {
    used_percent:
      typeof value.used_percent === "number" && Number.isFinite(value.used_percent)
        ? value.used_percent
        : undefined,
    reset_at:
      typeof value.reset_at === "number" && Number.isFinite(value.reset_at)
        ? value.reset_at
        : undefined,
  };
}

export function normalizeClaudeUsagePayload(raw: unknown): ClaudeUsagePayload | null {
  if (!isRecord(raw)) return null;
  const extraUsage = isRecord(raw.extra_usage) ? raw.extra_usage : null;

  return {
    five_hour: normalizeWindow(raw.five_hour),
    seven_day: normalizeWindow(raw.seven_day),
    seven_day_sonnet: normalizeWindow(raw.seven_day_sonnet),
    seven_day_opus: normalizeWindow(raw.seven_day_opus),
    extra_usage: extraUsage
      ? {
          enabled: typeof extraUsage.enabled === "boolean" ? extraUsage.enabled : undefined,
          disabled_reason:
            typeof extraUsage.disabled_reason === "string" ? extraUsage.disabled_reason : undefined,
        }
      : null,
  };
}

export function stripAnsi(text: string): string {
  // Built via RegExp constructor so the ESC byte stays out of the source literal
  // (oxlint's no-control-regex flags literal control-char escapes).
  const esc = String.fromCharCode(27);
  return text.replace(new RegExp(`${esc}\\[[0-9;?]*[A-Za-z]`, "g"), "");
}

export function findPercent(text: string, header: string): number | null {
  const idx = text.indexOf(header);
  if (idx < 0) return null;
  const window = text.slice(idx, idx + 240);
  const usedMatch = window.match(/(\d+(?:\.\d+)?)\s*%\s*used/i);
  const leftMatch = window.match(/(\d+(?:\.\d+)?)\s*%\s*left/i);
  if (usedMatch) return Number(usedMatch[1]);
  if (leftMatch) return 100 - Number(leftMatch[1]);
  const percentMatch = window.match(/(\d+(?:\.\d+)?)\s*%/);
  return percentMatch ? Number(percentMatch[1]) : null;
}

export function findResetAt(_text: string, _header: string): number | null {
  // Best-effort: return null until absolute timestamp parsing is wired in v1.x.
  return null;
}

export function parseClaudeCliOutput(stdout: string): ClaudeUsagePayload | null {
  const clean = stripAnsi(stdout);
  const sessionPercent = findPercent(clean, "Current session");
  const weekPercent = findPercent(clean, "Current week");

  if (sessionPercent === null && weekPercent === null) return null;

  return {
    five_hour:
      sessionPercent !== null
        ? {
            used_percent: sessionPercent,
            reset_at: findResetAt(clean, "Current session") ?? undefined,
          }
        : null,
    seven_day:
      weekPercent !== null
        ? {
            used_percent: weekPercent,
            reset_at: findResetAt(clean, "Current week") ?? undefined,
          }
        : null,
  };
}
