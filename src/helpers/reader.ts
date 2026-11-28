import type { ReaderResult } from "../readers/base.js";

export function readerResultsEqual(a: ReaderResult, b: ReaderResult): boolean {
  if (a.status !== b.status) return false;
  if (a.lastError !== b.lastError) return false;
  if (a.fields.length !== b.fields.length) return false;
  return a.fields.every((f, i) => {
    const other = b.fields[i];
    return (
      other !== undefined &&
      f.name === other.name &&
      f.status === other.status &&
      f.value === other.value
    );
  });
}
