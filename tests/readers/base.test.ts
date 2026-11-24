import type Gio from "gi://Gio";

import {
  BaseReader,
  FieldStatus,
  ReaderStatus,
  type FieldResult,
  type PercentFieldNames,
  type ReaderResult,
  type WindowFieldNames,
  type WindowFieldStatus,
} from "../../src/readers/base.js";
import type { FieldName } from "../../src/readers/fields.js";

const PRIMARY_NAMES = {
  used: "used_percent_primary",
  remaining: "remaining_percent_primary",
  reset: "reset_at_primary",
} as const;

const SECONDARY_NAMES = {
  used: "used_percent_secondary",
  remaining: "remaining_percent_secondary",
  reset: "reset_at_secondary",
} as const;

class TestReader extends BaseReader {
  async read(): Promise<ReaderResult> {
    return this._okResult([], []);
  }

  testMakeField<T>(
    name: string,
    value: T | null,
    status: FieldStatus,
    error?: string | null,
  ): FieldResult<T> {
    return this._makeField(name as FieldName, value, status, error);
  }

  testMakePercentFieldPair(
    names: PercentFieldNames<"codex">,
    usedPct: number | null | undefined,
    status: FieldStatus,
  ): [FieldResult, FieldResult] {
    return this._makePercentFieldPair(names, usedPct, status);
  }

  testMakeWindowFields(
    names: WindowFieldNames<"codex">,
    data:
      | {
          used_percent?: number | null;
          reset_at?: number | string | null;
        }
      | null
      | undefined,
    status?: WindowFieldStatus,
  ): FieldResult[] {
    return this._makeWindowFields(names, data, status);
  }

  testOkResult(fields: readonly FieldResult[], pathsTried: readonly string[]): ReaderResult {
    return this._okResult(fields, pathsTried);
  }

  testPartialResult(
    fields: readonly FieldResult[],
    pathsTried: readonly string[],
    lastError?: string,
  ): ReaderResult {
    return this._partialResult(fields, pathsTried, lastError);
  }

  testErrorResult(message: string, pathsTried: readonly string[]): ReaderResult {
    return this._errorResult(message, pathsTried);
  }

  testClassifyResult(
    fields: FieldResult[],
    pathsTried: readonly string[],
    prefix?: string,
  ): ReaderResult {
    return this._classifyResult(fields, pathsTried, prefix);
  }
}

function okField(name: string): FieldResult {
  return { name, value: 1, status: FieldStatus.OK };
}

function unavailableField(name: string): FieldResult {
  return { name, value: null, status: FieldStatus.UNAVAILABLE };
}

function notApplicableField(name: string): FieldResult {
  return { name, value: null, status: FieldStatus.NOT_APPLICABLE };
}

function errorField(name: string): FieldResult {
  return { name, value: null, status: FieldStatus.ERROR };
}

describe("BaseReader", () => {
  let reader: TestReader;
  const settings = {} as Gio.Settings;

  beforeEach(() => {
    reader = new TestReader(settings, "codex");
  });

  describe("constructor", () => {
    it("stores providerName", () => {
      expect(reader["providerName"]).toBe("codex");
    });

    it("stores settings", () => {
      expect(reader["settings"]).toBe(settings);
    });
  });

  describe("destroy", () => {
    it("does not throw", () => {
      expect(() => reader.destroy()).not.toThrow();
    });
  });

  describe("_makeField", () => {
    it("creates a FieldResult with value and status", () => {
      const field = reader.testMakeField("test_field", 42, FieldStatus.OK);
      expect(field).toEqual({
        name: "test_field",
        value: 42,
        status: FieldStatus.OK,
        error: null,
      });
    });

    it("sets error to null when omitted", () => {
      const field = reader.testMakeField("err_field", null, FieldStatus.ERROR);
      expect(field.error).toBeNull();
    });

    it("passes through the error string", () => {
      const field = reader.testMakeField("err_field", null, FieldStatus.ERROR, "fail");
      expect(field.error).toBe("fail");
    });

    it("accepts string values", () => {
      const field = reader.testMakeField("label", "plus", FieldStatus.OK);
      expect(field.value).toBe("plus");
    });

    it("accepts boolean values", () => {
      const field = reader.testMakeField("flag", true, FieldStatus.OK);
      expect(field.value).toBe(true);
    });

    it("uses null for undefined value", () => {
      const field = reader.testMakeField(
        "missing",
        undefined as unknown as null,
        FieldStatus.UNAVAILABLE,
      );
      expect(field.value).toBeNull();
    });
  });

  describe("_makePercentFieldPair", () => {
    it("creates used_percent and remaining_percent fields", () => {
      const [used, remaining] = reader.testMakePercentFieldPair(
        SECONDARY_NAMES,
        30,
        FieldStatus.OK,
      );

      expect(used.name).toBe("used_percent_secondary");
      expect(used.value).toBe(30);
      expect(used.status).toBe(FieldStatus.OK);

      expect(remaining.name).toBe("remaining_percent_secondary");
      expect(remaining.value).toBe(70);
      expect(remaining.status).toBe(FieldStatus.OK);
    });

    it("handles null usedPct", () => {
      const [used, remaining] = reader.testMakePercentFieldPair(
        PRIMARY_NAMES,
        null,
        FieldStatus.UNAVAILABLE,
      );

      expect(used.value).toBeNull();
      expect(remaining.value).toBeNull();
      expect(remaining.status).toBe(FieldStatus.UNAVAILABLE);
    });

    it("handles undefined usedPct", () => {
      const [used, remaining] = reader.testMakePercentFieldPair(
        PRIMARY_NAMES,
        undefined,
        FieldStatus.UNAVAILABLE,
      );

      expect(used.value).toBeNull();
      expect(remaining.value).toBeNull();
    });

    it("computes remaining as 100 - used at boundaries", () => {
      const [, zero] = reader.testMakePercentFieldPair(PRIMARY_NAMES, 100, FieldStatus.OK);
      expect(zero.value).toBe(0);

      const [, all] = reader.testMakePercentFieldPair(PRIMARY_NAMES, 0, FieldStatus.OK);
      expect(all.value).toBe(100);
    });
  });

  describe("_makeWindowFields", () => {
    it("creates OK fields when data is provided", () => {
      const fields = reader.testMakeWindowFields(PRIMARY_NAMES, {
        used_percent: 25,
        reset_at: 1700000000,
      });

      expect(fields).toHaveSize(3);
      expect(fields[0].name).toBe("used_percent_primary");
      expect(fields[0].value).toBe(25);
      expect(fields[0].status).toBe(FieldStatus.OK);
      expect(fields[1].name).toBe("remaining_percent_primary");
      expect(fields[1].value).toBe(75);
      expect(fields[2].name).toBe("reset_at_primary");
      expect(fields[2].value).toBe(1700000000);
    });

    it("handles null data with UNAVAILABLE status", () => {
      const fields = reader.testMakeWindowFields(SECONDARY_NAMES, null);

      expect(fields).toHaveSize(3);
      fields.forEach((f) => {
        expect(f.status).toBe(FieldStatus.UNAVAILABLE);
      });
      expect(fields[0].value).toBeNull();
    });

    it("handles undefined data", () => {
      const fields = reader.testMakeWindowFields(SECONDARY_NAMES, undefined);

      expect(fields).toHaveSize(3);
      fields.forEach((f) => {
        expect(f.status).toBe(FieldStatus.UNAVAILABLE);
      });
    });

    it("handles missing optional fields in data", () => {
      const fields = reader.testMakeWindowFields(PRIMARY_NAMES, {});

      expect(fields[0].value).toBeNull();
      expect(fields[1].value).toBeNull();
      expect(fields[2].value).toBeNull();
      fields.forEach((f) => {
        expect(f.status).toBe(FieldStatus.UNAVAILABLE);
      });
    });

    it("marks an absent window with the provided status", () => {
      const fields = reader.testMakeWindowFields(SECONDARY_NAMES, null, {
        absent: FieldStatus.NOT_APPLICABLE,
      });

      expect(fields).toHaveSize(3);
      fields.forEach((f) => {
        expect(f.status).toBe(FieldStatus.NOT_APPLICABLE);
      });
    });

    it("uses the supplied reset value and status", () => {
      const missingReset = reader.testMakeWindowFields(
        PRIMARY_NAMES,
        { used_percent: 25 },
        { reset: { at: null, status: FieldStatus.NOT_APPLICABLE } },
      );
      expect(missingReset[2].value).toBeNull();
      expect(missingReset[2].status).toBe(FieldStatus.NOT_APPLICABLE);

      const presentReset = reader.testMakeWindowFields(
        PRIMARY_NAMES,
        { used_percent: 25 },
        { reset: { at: 1700000000, status: FieldStatus.OK } },
      );
      expect(presentReset[2].value).toBe(1700000000);
      expect(presentReset[2].status).toBe(FieldStatus.OK);
    });

    it("handles string reset_at", () => {
      const fields = reader.testMakeWindowFields(PRIMARY_NAMES, {
        reset_at: "1700000000",
      });

      expect(fields[2].value).toBe("1700000000");
    });
  });

  describe("_okResult", () => {
    it("returns OK status", () => {
      const result = reader.testOkResult([], ["path1"]);
      expect(result.status).toBe(ReaderStatus.OK);
      expect(result.provider).toBe("codex");
      expect(result.pathsTried).toEqual(["path1"]);
    });

    it("includes fields and lastUpdated", () => {
      const field = reader.testMakeField("x", 1, FieldStatus.OK);
      const result = reader.testOkResult([field], ["path1"]);
      expect(result.fields).toEqual([field]);
      expect(result.lastUpdated).toBeGreaterThan(0);
      expect(result.lastError).toBeUndefined();
    });
  });

  describe("_partialResult", () => {
    it("returns PARTIAL status", () => {
      const result = reader.testPartialResult([], ["p1"], "some error");
      expect(result.status).toBe(ReaderStatus.PARTIAL);
      expect(result.lastError).toBe("some error");
    });

    it("sets lastError to null when omitted", () => {
      const result = reader.testPartialResult([], ["p1"]);
      expect(result.lastError).toBeNull();
    });
  });

  describe("_errorResult", () => {
    it("returns ERROR status with message", () => {
      const result = reader.testErrorResult("boom", ["p1"]);
      expect(result.status).toBe(ReaderStatus.ERROR);
      expect(result.lastError).toBe("boom");
      expect(result.fields).toEqual([]);
    });
  });

  describe("_classifyResult", () => {
    it("returns OK when all fields are OK", () => {
      const result = reader.testClassifyResult([okField("a"), okField("b")], ["p1"]);
      expect(result.status).toBe(ReaderStatus.OK);
      expect(result.lastError).toBeUndefined();
    });

    it("returns PARTIAL with lastError when some fields are UNAVAILABLE", () => {
      const result = reader.testClassifyResult([okField("a"), unavailableField("b")], ["p1"]);
      expect(result.status).toBe(ReaderStatus.PARTIAL);
      expect(result.lastError).toBe("codex: some fields unavailable.");
    });

    it("returns PARTIAL with lastError when some fields are ERROR", () => {
      const result = reader.testClassifyResult([okField("a"), errorField("b")], ["p1"]);
      expect(result.status).toBe(ReaderStatus.PARTIAL);
      expect(result.lastError).toBe("codex: some fields unavailable.");
    });

    it("returns PARTIAL when some fields are UNAVAILABLE and some ERROR", () => {
      const result = reader.testClassifyResult(
        [okField("a"), unavailableField("b"), errorField("c")],
        ["p1"],
      );
      expect(result.status).toBe(ReaderStatus.PARTIAL);
      expect(result.lastError).toBe("codex: some fields unavailable.");
    });

    it("returns OK when the only non-OK fields are NOT_APPLICABLE", () => {
      const result = reader.testClassifyResult([okField("a"), notApplicableField("b")], ["p1"]);
      expect(result.status).toBe(ReaderStatus.OK);
      expect(result.lastError).toBeUndefined();
    });

    it("returns ERROR when every field is NOT_APPLICABLE", () => {
      const result = reader.testClassifyResult(
        [notApplicableField("a"), notApplicableField("b")],
        ["p1"],
      );
      expect(result.status).toBe(ReaderStatus.ERROR);
      expect(result.lastError).toBe("codex: no usable fields.");
    });

    it("uses prefix in PARTIAL lastError", () => {
      const result = reader.testClassifyResult(
        [okField("a"), errorField("b")],
        ["p1"],
        "CustomPrefix",
      );
      expect(result.lastError).toBe("CustomPrefix: some fields unavailable.");
    });

    it("returns ERROR when all fields are UNAVAILABLE", () => {
      const result = reader.testClassifyResult(
        [unavailableField("a"), unavailableField("b")],
        ["p1"],
      );
      expect(result.status).toBe(ReaderStatus.ERROR);
    });

    it("returns ERROR when all fields are ERROR", () => {
      const result = reader.testClassifyResult([errorField("a")], ["p1"]);
      expect(result.status).toBe(ReaderStatus.ERROR);
    });

    it("returns ERROR when fields array is empty", () => {
      const result = reader.testClassifyResult([], ["p1"]);
      expect(result.status).toBe(ReaderStatus.ERROR);
      expect(result.lastError).toContain("codex");
    });

    it("uses prefix in error message", () => {
      const result = reader.testClassifyResult([errorField("a")], ["p1"], "CustomPrefix");
      expect(result.lastError).toContain("CustomPrefix");
    });

    it("uses providerName as default prefix", () => {
      const result = reader.testClassifyResult([], ["p1"]);
      expect(result.lastError).toContain("codex");
    });
  });

  describe("type-level field contract", () => {
    class CodexContractReader extends BaseReader<"codex"> {
      async read(): Promise<ReaderResult> {
        return this._okResult([], []);
      }

      declared(): FieldResult {
        return this._makeField("used_percent_primary", 1, FieldStatus.OK);
      }

      undeclared(): FieldResult {
        // @ts-expect-error undeclared names are rejected without runtime checks
        return this._makeField("not_declared_by_codex", 1, FieldStatus.OK);
      }
    }

    it("accepts only names declared in PROVIDER_FIELDS", () => {
      const contractReader = new CodexContractReader({} as Gio.Settings, "codex");
      expect(contractReader.declared().name).toBe("used_percent_primary");
    });
  });
});
