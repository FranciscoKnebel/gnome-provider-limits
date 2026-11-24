import { clampPercent } from "./fieldRows.js";

export function clampRatio(value: unknown): number | null {
  const percent = clampPercent(value);
  return percent === undefined ? null : percent / 100;
}

export function clampFillRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function extractWindowSuffix(fieldName: string): string | null {
  const match = /^(?:used|remaining)_percent_(.+)$/.exec(fieldName);
  return match ? match[1] : null;
}
