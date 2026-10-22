import { readerResultsEqual } from "../../src/helpers/reader.js";
import {
  FieldStatus,
  ReaderStatus,
  type FieldResult,
  type ReaderResult,
} from "../../src/readers/base.js";

function field(overrides: Partial<FieldResult> = {}): FieldResult {
  return {
    name: "used_percent_primary",
    value: 30,
    status: FieldStatus.OK,
    error: null,
    ...overrides,
  };
}

function result(overrides: Partial<ReaderResult> = {}): ReaderResult {
  return {
    provider: "codex",
    status: ReaderStatus.OK,
    fields: [field()],
    lastUpdated: 1000,
    ...overrides,
  };
}

describe("readerResultsEqual", () => {
  it("returns true for identical results", () => {
    expect(readerResultsEqual(result(), result())).toBe(true);
  });

  it("returns false when the status changes", () => {
    expect(readerResultsEqual(result(), result({ status: ReaderStatus.PARTIAL }))).toBe(false);
  });

  it("returns false when lastError changes", () => {
    expect(readerResultsEqual(result(), result({ lastError: "boom" }))).toBe(false);
  });

  it("returns false when the number of fields changes", () => {
    expect(readerResultsEqual(result(), result({ fields: [] }))).toBe(false);
  });

  it("returns false when a field value changes", () => {
    expect(readerResultsEqual(result(), result({ fields: [field({ value: 31 })] }))).toBe(false);
  });

  it("returns false when a field status changes", () => {
    expect(
      readerResultsEqual(
        result(),
        result({ fields: [field({ status: FieldStatus.UNAVAILABLE })] }),
      ),
    ).toBe(false);
  });

  it("ignores changes to field.error", () => {
    expect(readerResultsEqual(result(), result({ fields: [field({ error: "boom" })] }))).toBe(true);
  });

  it("ignores changes to lastUpdated", () => {
    expect(readerResultsEqual(result({ lastUpdated: 1000 }), result({ lastUpdated: 2000 }))).toBe(
      true,
    );
  });
});
