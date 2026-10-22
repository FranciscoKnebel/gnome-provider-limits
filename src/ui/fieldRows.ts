import { formatField } from "../formatters.js";
import { FieldStatus, ReaderStatus } from "../readers/base.js";
import type { BaseReader, ReaderResult } from "../readers/base.js";

export type FieldTone = "ok" | "warning" | "critical";

export interface FieldRow {
  label: string;
  valueText: string;
  tone?: FieldTone;
  errorText?: string;
  accessibleText?: string;
}

export function percentTone(value: unknown): FieldTone | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value >= 80) return "critical";
  if (value >= 50) return "warning";
  return "ok";
}

export function fieldTone(fieldName: string, value: unknown): FieldTone | undefined {
  if (fieldName.startsWith("remaining_") && typeof value === "number" && Number.isFinite(value)) {
    return percentTone(100 - value);
  }
  return percentTone(value);
}

export function getFieldRows(
  reader: BaseReader | undefined,
  result: ReaderResult,
  fieldNames: string[],
  zone: "status" | "panel",
  locale: string,
  t?: (s: string) => string,
): FieldRow[] {
  const rows: FieldRow[] = [];

  for (const fieldName of fieldNames) {
    const fieldDef = reader?.FIELDS.find((f) => f.name === fieldName);
    if (!fieldDef) continue;

    const field = result.fields.find((f) => f.name === fieldName);
    const translatedLabel = t ? t(fieldDef.label) : fieldDef.label;
    const tone = fieldDef.type === "percent" ? fieldTone(fieldName, field?.value) : undefined;

    if (!field || field.status !== FieldStatus.OK) {
      const row: FieldRow = {
        label: fieldDef.label,
        valueText: "—",
        accessibleText: `${translatedLabel}: —`,
      };
      if (tone) row.tone = tone;

      const isError = field?.status === FieldStatus.ERROR || result.status === ReaderStatus.ERROR;
      const errorText = isError ? (field?.error ?? result.lastError) : null;
      if (errorText) row.errorText = errorText;

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
      label: fieldDef.label,
      valueText,
      accessibleText: `${translatedLabel}: ${valueText}`,
    };
    if (tone) row.tone = tone;

    rows.push(row);
  }

  return rows;
}
