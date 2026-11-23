export type FieldTone = "ok" | "warning" | "critical";

export function clampPercent(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(0, value));
}

export function clampFillRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function percentTone(value: unknown): FieldTone | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value >= 80) return "critical";
  if (value >= 50) return "warning";
  return "ok";
}

export function fieldTone(fieldName: string, value: unknown): FieldTone | undefined {
  if (fieldName.startsWith("remaining_percent")) {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const used = 100 - value;
    return percentTone(used);
  }
  return percentTone(value);
}
