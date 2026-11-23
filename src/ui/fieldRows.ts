import { formatField } from "../formatters.js";
import type { FieldDef, FieldType, ReaderResult } from "../readers/base.js";
import { FieldStatus, ReaderStatus } from "../readers/base.js";
import type { FieldCategory } from "../readers/fields.js";

export type FieldTone = "ok" | "warning" | "critical";

export interface FieldRow {
  name?: string;
  type?: FieldType;
  category?: FieldCategory;
  label: string;
  valueText: string;
  tone?: FieldTone;
  fillPercent?: number;
  companionResetName?: string;
  errorText?: string;
  accessibleText?: string;
}

export function clampPercent(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(0, value));
}

export function clampRatio(value: unknown): number | null {
  const percent = clampPercent(value);
  return percent === undefined ? null : percent / 100;
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

export function getFieldRows(
  fieldDefs: readonly FieldDef[],
  result: ReaderResult,
  fieldNames: readonly string[],
  zone: "status" | "panel",
  locale: string,
  t?: (s: string) => string,
): FieldRow[] {
  if (fieldDefs.length === 0) return [];

  const rows: FieldRow[] = [];

  for (const fieldName of fieldNames) {
    const fieldDef = fieldDefs.find((f) => f.name === fieldName);
    if (!fieldDef) continue;

    const field = result.fields.find((f) => f.name === fieldName);
    const translatedLabel = t ? t(fieldDef.label) : fieldDef.label;
    const tone = fieldDef.type === "percent" ? fieldTone(fieldName, field?.value) : undefined;
    const category = fieldDef.category;
    const resetName = fieldDef.resetField ?? null;

    if (!field || field.status !== FieldStatus.OK) {
      const row: FieldRow = {
        name: fieldDef.name,
        type: fieldDef.type,
        category,
        label: fieldDef.label,
        valueText: "—",
        accessibleText: `${translatedLabel}: —`,
      };
      if (resetName) row.companionResetName = resetName;
      if (tone) row.tone = tone;

      const isError = field?.status === FieldStatus.ERROR || result.status === ReaderStatus.ERROR;
      if (isError) {
        row.errorText = field?.error ?? result.lastError ?? "Provider error";
      }

      rows.push(row);
      continue;
    }

    const valueText = formatField({
      type: fieldDef.type,
      value: field.value,
      zone,
      locale,
      t,
    });

    const row: FieldRow = {
      name: fieldDef.name,
      type: fieldDef.type,
      category,
      label: fieldDef.label,
      valueText,
      accessibleText: `${translatedLabel}: ${valueText}`,
    };
    if (resetName) row.companionResetName = resetName;
    if (tone) row.tone = tone;
    if (fieldDef.type === "percent") {
      const clamped = clampPercent(field.value);
      if (clamped !== undefined) row.fillPercent = clamped;
    }

    rows.push(row);
  }

  return rows;
}
