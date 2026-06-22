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
