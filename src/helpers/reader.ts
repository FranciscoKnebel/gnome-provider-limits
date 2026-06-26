import type { ReaderResult } from "../readers/base.js";

export function readerResultsEqual(a: ReaderResult, b: ReaderResult): boolean {
  if (a.status !== b.status) return false;
  if (a.lastError !== b.lastError) return false;
  if (a.fields.length !== b.fields.length) return false;
  return a.fields.every(
    (f, i) =>
      f.name === b.fields[i].name &&
      f.status === b.fields[i].status &&
      f.value === b.fields[i].value,
  );
}
