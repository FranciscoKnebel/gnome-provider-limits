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

export function sectionKey(structure: SectionStructure): string {
  const rows = structure.rows.map((row) => [row.label, row.errorText === undefined ? 0 : 1]);

  return JSON.stringify([
    structure.provider,
    structure.displayName,
    structure.status,
    structure.locale,
    structure.hasDetail ? 1 : 0,
    structure.hasError ? 1 : 0,
    structure.hasTimestamp ? 1 : 0,
    rows,
  ]);
}

export function structureKey(parts: readonly string[]): string {
  return JSON.stringify(parts);
}
