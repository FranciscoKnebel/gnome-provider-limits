import { resolveLocale } from "../../src/helpers/locale.js";
import { FieldStatus, ReaderStatus } from "../../src/readers/base.js";
import type { BaseReader, ReaderResult } from "../../src/readers/base.js";
import type { FieldType } from "../../src/readers/base.js";
import { getFieldRows } from "../../src/ui/fieldRows.js";

describe("formatters", () => {
  describe("resolveLocale", () => {
    it("returns settings override when non-empty", () => {
      expect(resolveLocale("pt_BR", "en_US.utf8", "en_US.utf8")).toBe("pt_BR");
    });

    it("falls back to LC_MESSAGES when no override", () => {
      expect(resolveLocale("", "pt_BR.utf8", "en_US.utf8")).toBe("pt_BR");
    });

    it("falls back to LANG when no LC_MESSAGES", () => {
      expect(resolveLocale("", null, "pt_BR.utf8")).toBe("pt_BR");
    });

    it("falls back to en when nothing is set", () => {
      expect(resolveLocale("", null, null)).toBe("en");
    });

    it("strips charset suffix from env values", () => {
      expect(resolveLocale("", "en_US.UTF-8", null)).toBe("en_US");
    });
  });

  describe("getFieldRows", () => {
    const mockReader = {
      FIELDS: [
        { name: "used_percent", label: "Used %", type: "percent" as FieldType },
        { name: "reset_at", label: "Reset at", type: "timestamp" as FieldType },
        { name: "plan_type", label: "Plan", type: "text" as FieldType },
      ],
    } as unknown as BaseReader;

    const sampleResult: ReaderResult = {
      provider: "codex",
      status: ReaderStatus.OK,
      lastUpdated: 0,
      fields: [
        { name: "used_percent", value: 42, status: FieldStatus.OK },
        { name: "reset_at", value: Date.now() + 7200000, status: FieldStatus.OK },
        { name: "plan_type", value: "plus", status: FieldStatus.OK },
      ],
    };

    it("returns field rows for the given field names", () => {
      const rows = getFieldRows(
        mockReader,
        sampleResult,
        ["used_percent", "reset_at", "plan_type"],
        "panel",
        "en",
      );
      expect(rows).toHaveSize(3);
      expect(rows[0].label).toBe("Used %");
      expect(rows[1].label).toBe("Reset at");
      expect(rows[2].label).toBe("Plan");
    });

    it("returns rows only for explicitly requested field names", () => {
      const rows = getFieldRows(mockReader, sampleResult, ["used_percent"], "panel", "en");
      expect(rows).toHaveSize(1);
      expect(rows[0].label).toBe("Used %");
    });

    it("assigns correct zone to formatField", () => {
      const rows = getFieldRows(mockReader, sampleResult, ["plan_type"], "status", "en");
      expect(rows).toHaveSize(1);
      expect(rows[0].valueText).toBe("plus");
    });

    it("returns empty array when reader is undefined", () => {
      const rows = getFieldRows(undefined, sampleResult, ["used_percent"], "panel", "en");
      expect(rows).toEqual([]);
    });

    it("returns empty array when no field names match FIELDS", () => {
      const emptyReader = { FIELDS: [] } as unknown as BaseReader;
      const rows = getFieldRows(emptyReader, sampleResult, ["used_percent"], "panel", "en");
      expect(rows).toEqual([]);
    });

    it("skips field names not present in FIELDS", () => {
      const extraFieldResult: ReaderResult = {
        provider: "codex",
        status: ReaderStatus.OK,
        lastUpdated: 0,
        fields: [
          { name: "used_percent", value: 42, status: FieldStatus.OK },
          { name: "unknown_field", value: "test", status: FieldStatus.OK },
        ],
      };
      const rows = getFieldRows(
        mockReader,
        extraFieldResult,
        ["used_percent", "unknown_field"],
        "panel",
        "en",
      );
      expect(rows).toHaveSize(1);
      expect(rows[0].label).toBe("Used %");
    });
  });
});
