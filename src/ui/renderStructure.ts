import type { FieldRow } from "./fieldRows.js";

export interface SectionStructure {
  provider: string;
  displayName: string;
  status: string;
  locale: string;
  rows: readonly FieldRow[];
  hasDetail: boolean;
  hasError: boolean;
  hasTimestamp: boolean;
}

const FIELD_SEPARATOR = "\u0001";
const ROW_SEPARATOR = "\u0002";
const PART_SEPARATOR = "\u0003";

export function sectionKey(structure: SectionStructure): string {
  const rows = structure.rows
    .map((row) => `${row.label}${FIELD_SEPARATOR}${row.errorText === undefined ? "0" : "1"}`)
    .join(ROW_SEPARATOR);

  return [
    structure.provider,
    structure.displayName,
    structure.status,
    structure.locale,
    structure.hasDetail ? "1" : "0",
    structure.hasError ? "1" : "0",
    structure.hasTimestamp ? "1" : "0",
    rows,
  ].join(PART_SEPARATOR);
}
