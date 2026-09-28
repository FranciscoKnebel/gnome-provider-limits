import { resolveLocale } from "../../src/helpers/locale.js";
import { FieldStatus, ReaderStatus } from "../../src/readers/base.js";
import type { BaseReader, ReaderResult } from "../../src/readers/base.js";
import type { FieldType } from "../../src/readers/base.js";
import { getFieldRows, percentTone } from "../../src/ui/fieldRows.js";
import type { FieldRow } from "../../src/ui/fieldRows.js";
import { sectionKey } from "../../src/ui/renderStructure.js";

const bracketT = (s: string) => `[${s}]`;

describe("formatters", () => {
  describe("resolveLocale", () => {
    it("returns settings override with normalized hyphens", () => {
      expect(resolveLocale("pt_BR", "en_US.utf8", "en_US.utf8")).toBe("pt-BR");
    });

    it("falls back to LC_MESSAGES with normalized hyphens", () => {
      expect(resolveLocale("", "pt_BR.utf8", "en_US.utf8")).toBe("pt-BR");
    });

    it("falls back to LANG with normalized hyphens", () => {
      expect(resolveLocale("", null, "pt_BR.utf8")).toBe("pt-BR");
    });

    it("falls back to en when nothing is set", () => {
      expect(resolveLocale("", null, null)).toBe("en");
    });

    it("strips charset suffix from env values", () => {
      expect(resolveLocale("", "en_US.UTF-8", null)).toBe("en-US");
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

    it("emits a dash row for a field missing from the result", () => {
      const missingResult: ReaderResult = {
        provider: "codex",
        status: ReaderStatus.OK,
        lastUpdated: 0,
        fields: [{ name: "used_percent", value: 42, status: FieldStatus.OK }],
      };
      const rows = getFieldRows(
        mockReader,
        missingResult,
        ["used_percent", "plan_type"],
        "panel",
        "en",
      );
      expect(rows).toHaveSize(2);
      expect(rows[1].label).toBe("Plan");
      expect(rows[1].valueText).toBe("—");
      expect(rows[1].errorText).toBeUndefined();
    });

    it("emits a dash row for an UNAVAILABLE field without error text", () => {
      const unavailableResult: ReaderResult = {
        provider: "codex",
        status: ReaderStatus.PARTIAL,
        lastUpdated: 0,
        fields: [{ name: "used_percent", value: null, status: FieldStatus.UNAVAILABLE }],
      };
      const rows = getFieldRows(mockReader, unavailableResult, ["used_percent"], "panel", "en");
      expect(rows).toHaveSize(1);
      expect(rows[0].valueText).toBe("—");
      expect(rows[0].errorText).toBeUndefined();
    });

    it("emits a dash row with error text for an ERROR field", () => {
      const errorResult: ReaderResult = {
        provider: "codex",
        status: ReaderStatus.PARTIAL,
        lastUpdated: 0,
        fields: [
          {
            name: "used_percent",
            value: null,
            status: FieldStatus.ERROR,
            error: "token expired",
          },
        ],
      };
      const rows = getFieldRows(mockReader, errorResult, ["used_percent"], "panel", "en");
      expect(rows).toHaveSize(1);
      expect(rows[0].valueText).toBe("—");
      expect(rows[0].errorText).toBe("token expired");
    });

    it("falls back to lastError for an ERROR field without its own error", () => {
      const errorResult: ReaderResult = {
        provider: "codex",
        status: ReaderStatus.PARTIAL,
        lastUpdated: 0,
        lastError: "HTTP 401",
        fields: [{ name: "used_percent", value: null, status: FieldStatus.ERROR }],
      };
      const rows = getFieldRows(mockReader, errorResult, ["used_percent"], "panel", "en");
      expect(rows[0].errorText).toBe("HTTP 401");
    });

    it("propagates lastError to missing fields when the reader is in error", () => {
      const errorResult: ReaderResult = {
        provider: "codex",
        status: ReaderStatus.ERROR,
        lastUpdated: 0,
        lastError: "codex login required",
        fields: [],
      };
      const rows = getFieldRows(mockReader, errorResult, ["used_percent"], "panel", "en");
      expect(rows).toHaveSize(1);
      expect(rows[0].valueText).toBe("—");
      expect(rows[0].errorText).toBe("codex login required");
    });

    it("does not attach error text to an UNAVAILABLE field on a PARTIAL reader", () => {
      const partialResult: ReaderResult = {
        provider: "codex",
        status: ReaderStatus.PARTIAL,
        lastUpdated: 0,
        lastError: "secondary path failed",
        fields: [{ name: "plan_type", value: null, status: FieldStatus.UNAVAILABLE }],
      };
      const rows = getFieldRows(mockReader, partialResult, ["plan_type"], "panel", "en");
      expect(rows[0].errorText).toBeUndefined();
    });

    it("keeps the configured field order even with missing fields", () => {
      const result: ReaderResult = {
        provider: "codex",
        status: ReaderStatus.OK,
        lastUpdated: 0,
        fields: [{ name: "plan_type", value: "plus", status: FieldStatus.OK }],
      };
      const rows = getFieldRows(
        mockReader,
        result,
        ["plan_type", "used_percent", "reset_at"],
        "panel",
        "en",
      );
      expect(rows.map((r) => r.label)).toEqual(["Plan", "Used %", "Reset at"]);
    });

    it("builds accessible text from the translated label and value", () => {
      const rows = getFieldRows(
        mockReader,
        sampleResult,
        ["used_percent"],
        "panel",
        "en",
        bracketT,
      );
      expect(rows[0].accessibleText).toBe("[Used %]: 42%");
    });

    it("builds accessible text with a dash for missing fields", () => {
      const rows = getFieldRows(mockReader, sampleResult, ["plan_type"], "status", "en");
      expect(rows[0].accessibleText).toBe("Plan: plus");
    });
  });

  describe("percentTone", () => {
    it("returns ok below the warning threshold", () => {
      expect(percentTone(49)).toBe("ok");
      expect(percentTone(0)).toBe("ok");
    });

    it("returns warning at the warning threshold", () => {
      expect(percentTone(50)).toBe("warning");
      expect(percentTone(79)).toBe("warning");
    });

    it("returns critical at the critical threshold", () => {
      expect(percentTone(80)).toBe("critical");
      expect(percentTone(100)).toBe("critical");
    });

    it("returns ok for negative values", () => {
      expect(percentTone(-5)).toBe("ok");
    });

    it("returns undefined for missing or non-numeric values", () => {
      expect(percentTone(null)).toBeUndefined();
      expect(percentTone(undefined)).toBeUndefined();
      expect(percentTone(Number.NaN)).toBeUndefined();
      expect(percentTone("42")).toBeUndefined();
    });
  });

  describe("sectionKey", () => {
    const rows: FieldRow[] = [
      { label: "Used %", valueText: "42%", tone: "ok", accessibleText: "Used %: 42%" },
      { label: "Plan", valueText: "plus", accessibleText: "Plan: plus" },
    ];

    const base = {
      provider: "codex",
      displayName: "Codex",
      status: ReaderStatus.OK,
      locale: "en",
      rows,
      hasDetail: false,
      hasError: false,
      hasTimestamp: true,
    };

    it("is stable when only values, tones, or accessible text change", () => {
      const changedRows: FieldRow[] = [
        { label: "Used %", valueText: "91%", tone: "critical", accessibleText: "Used %: 91%" },
        { label: "Plan", valueText: "pro", accessibleText: "Plan: pro" },
      ];
      expect(sectionKey({ ...base, rows: changedRows })).toBe(sectionKey(base));
    });

    it("is stable when only the error text content changes", () => {
      const withError: FieldRow[] = [
        { label: "Used %", valueText: "—", errorText: "first failure" },
      ];
      const withOtherError: FieldRow[] = [
        { label: "Used %", valueText: "—", errorText: "second failure" },
      ];
      expect(sectionKey({ ...base, rows: withError })).toBe(
        sectionKey({ ...base, rows: withOtherError }),
      );
    });

    it("changes when the error presence changes", () => {
      const withError: FieldRow[] = [{ label: "Used %", valueText: "—", errorText: "boom" }];
      expect(sectionKey({ ...base, rows: withError })).not.toBe(sectionKey(base));
    });

    it("changes when row order or labels change", () => {
      const reordered: FieldRow[] = [rows[1], rows[0]];
      expect(sectionKey({ ...base, rows: reordered })).not.toBe(sectionKey(base));
      const renamed: FieldRow[] = [{ ...rows[0], label: "Other" }, rows[1]];
      expect(sectionKey({ ...base, rows: renamed })).not.toBe(sectionKey(base));
    });

    it("changes when provider, display name, status, locale, or flags change", () => {
      expect(sectionKey({ ...base, provider: "claude" })).not.toBe(sectionKey(base));
      expect(sectionKey({ ...base, displayName: "Codex Pro" })).not.toBe(sectionKey(base));
      expect(sectionKey({ ...base, status: ReaderStatus.ERROR })).not.toBe(sectionKey(base));
      expect(sectionKey({ ...base, locale: "pt-BR" })).not.toBe(sectionKey(base));
      expect(sectionKey({ ...base, hasDetail: true })).not.toBe(sectionKey(base));
      expect(sectionKey({ ...base, hasError: true })).not.toBe(sectionKey(base));
      expect(sectionKey({ ...base, hasTimestamp: false })).not.toBe(sectionKey(base));
    });
  });
});
