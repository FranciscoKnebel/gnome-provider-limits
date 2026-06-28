import { formatField } from "../formatters.js";
import { FieldStatus } from "../readers/base.js";
import type { BaseReader, ReaderResult } from "../readers/base.js";

export interface FieldRow {
  label: string;
  valueText: string;
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
    if (!field) continue;

    if (field.status === FieldStatus.UNAVAILABLE || field.status === FieldStatus.ERROR) {
      continue;
    }

    const valueText = formatField({
      type: fieldDef.type,
      value: field.value,
      zone,
      locale,
      t,
    });

    rows.push({ label: fieldDef.label, valueText });
  }

  return rows;
}
