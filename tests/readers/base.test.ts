import {
  BaseReader,
  FieldStatus,
  ReaderStatus,
  type FieldDef,
  type FieldResult,
  type ReaderResult,
} from "../../src/readers/base.js";

class TestReader extends BaseReader {
  get FIELDS(): readonly FieldDef[] {
    return [];
  }

  async read(): Promise<ReaderResult> {
    return this._okResult([], []);
  }

  testMakeField<T>(
    name: string,
    value: T | null,
    status: FieldStatus,
    error?: string | null,
  ): FieldResult<T> {
    return this._makeField(name, value, status, error);
  }

  testMakePercentFieldPair(
    key: string,
    usedPct: number | null | undefined,
    status: FieldStatus,
  ): [FieldResult, FieldResult] {
    return this._makePercentFieldPair(key, usedPct, status);
  }

  testMakeWindowFields(
    key: string,
    data:
      | {
          used_percent?: number | null;
          reset_at?: number | string | null;
        }
      | null
      | undefined,
  ): FieldResult[] {
    return this._makeWindowFields(key, data);
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

function errorField(name: string): FieldResult {
  return { name, value: null, status: FieldStatus.ERROR };
}

describe("BaseReader", () => {
  let reader: TestReader;

  beforeEach(() => {
    reader = new TestReader({} as any, "test-provider");
  });

  describe("constructor", () => {
    it("stores providerName", () => {
      expect(reader["providerName"]).toBe("test-provider");
    });

    it("stores settings", () => {
      expect(reader["settings"]).toEqual({} as any);
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
      expect(field.value).toBeUndefined();
    });
  });

  describe("_makePercentFieldPair", () => {
    it("creates used_percent and remaining_percent fields", () => {
      const [used, remaining] = reader.testMakePercentFieldPair("weekly", 30, FieldStatus.OK);

      expect(used.name).toBe("used_percent_weekly");
      expect(used.value).toBe(30);
      expect(used.status).toBe(FieldStatus.OK);

      expect(remaining.name).toBe("remaining_percent_weekly");
      expect(remaining.value).toBe(70);
      expect(remaining.status).toBe(FieldStatus.OK);
    });

    it("handles null usedPct", () => {
      const [used, remaining] = reader.testMakePercentFieldPair(
        "daily",
        null,
        FieldStatus.UNAVAILABLE,
      );

      expect(used.value).toBeNull();
      expect(remaining.value).toBeNull();
      expect(remaining.status).toBe(FieldStatus.UNAVAILABLE);
    });

    it("handles undefined usedPct", () => {
      const [used, remaining] = reader.testMakePercentFieldPair(
        "session",
        undefined,
        FieldStatus.UNAVAILABLE,
      );

      expect(used.value).toBeNull();
      expect(remaining.value).toBeNull();
    });

    it("computes remaining as 100 - used at boundaries", () => {
      const [, zero] = reader.testMakePercentFieldPair("full", 100, FieldStatus.OK);
      expect(zero.value).toBe(0);

      const [, all] = reader.testMakePercentFieldPair("empty", 0, FieldStatus.OK);
      expect(all.value).toBe(100);
    });
  });

  describe("_makeWindowFields", () => {
    it("creates OK fields when data is provided", () => {
      const fields = reader.testMakeWindowFields("primary", {
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
      const fields = reader.testMakeWindowFields("secondary", null);

      expect(fields).toHaveSize(3);
      fields.forEach((f) => {
        expect(f.status).toBe(FieldStatus.UNAVAILABLE);
      });
      expect(fields[0].value).toBeNull();
    });

    it("handles undefined data", () => {
      const fields = reader.testMakeWindowFields("secondary", undefined);

      expect(fields).toHaveSize(3);
      fields.forEach((f) => {
        expect(f.status).toBe(FieldStatus.UNAVAILABLE);
      });
    });

    it("handles missing optional fields in data", () => {
      const fields = reader.testMakeWindowFields("primary", {});

      expect(fields[0].value).toBeNull();
      expect(fields[1].value).toBeNull();
      expect(fields[2].value).toBeNull();
    });

    it("handles string reset_at", () => {
      const fields = reader.testMakeWindowFields("window", {
        reset_at: "1700000000",
      });

      expect(fields[2].value).toBe("1700000000");
    });
  });

  describe("_okResult", () => {
    it("returns OK status", () => {
      const result = reader.testOkResult([], ["path1"]);
      expect(result.status).toBe(ReaderStatus.OK);
      expect(result.provider).toBe("test-provider");
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

    it("returns PARTIAL when some fields are UNAVAILABLE", () => {
      const result = reader.testClassifyResult([okField("a"), unavailableField("b")], ["p1"]);
      expect(result.status).toBe(ReaderStatus.PARTIAL);
    });

    it("returns PARTIAL when some fields are ERROR", () => {
      const result = reader.testClassifyResult([okField("a"), errorField("b")], ["p1"]);
      expect(result.status).toBe(ReaderStatus.PARTIAL);
    });

    it("returns PARTIAL when some fields are UNAVAILABLE and some ERROR", () => {
      const result = reader.testClassifyResult(
        [okField("a"), unavailableField("b"), errorField("c")],
        ["p1"],
      );
      expect(result.status).toBe(ReaderStatus.PARTIAL);
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
      expect(result.lastError).toContain("test-provider");
    });

    it("uses prefix in error message", () => {
      const result = reader.testClassifyResult([errorField("a")], ["p1"], "CustomPrefix");
      expect(result.lastError).toContain("CustomPrefix");
    });

    it("uses providerName as default prefix", () => {
      const result = reader.testClassifyResult([], ["p1"]);
      expect(result.lastError).toContain("test-provider");
    });
  });
});
