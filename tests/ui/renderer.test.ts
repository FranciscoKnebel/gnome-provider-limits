import { resolveLocale } from "../../src/helpers/locale.js";
import { currentRefreshInterval, shouldRender } from "../../src/helpers/refresh.js";
import { clampFillRatio, clampPercent, fieldTone, percentTone } from "../../src/ui/fieldRows.js";

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

  describe("clampPercent", () => {
    it("clamps numeric values into 0..100", () => {
      expect(clampPercent(-12)).toBe(0);
      expect(clampPercent(0)).toBe(0);
      expect(clampPercent(42.5)).toBe(42.5);
      expect(clampPercent(100)).toBe(100);
      expect(clampPercent(135)).toBe(100);
    });

    it("rejects non-numeric and non-finite values", () => {
      expect(clampPercent(Number.NaN)).toBeUndefined();
      expect(clampPercent(Number.POSITIVE_INFINITY)).toBeUndefined();
      expect(clampPercent(null)).toBeUndefined();
      expect(clampPercent("50")).toBeUndefined();
    });
  });

  describe("clampFillRatio", () => {
    it("clamps numeric values into 0..1", () => {
      expect(clampFillRatio(-0.4)).toBe(0);
      expect(clampFillRatio(0)).toBe(0);
      expect(clampFillRatio(0.42)).toBe(0.42);
      expect(clampFillRatio(1)).toBe(1);
      expect(clampFillRatio(1.5)).toBe(1);
    });

    it("falls back to zero for non-numeric and non-finite values", () => {
      expect(clampFillRatio(Number.NaN)).toBe(0);
      expect(clampFillRatio(Number.POSITIVE_INFINITY)).toBe(0);
      expect(clampFillRatio(null)).toBe(0);
      expect(clampFillRatio("0.5")).toBe(0);
    });
  });

  describe("fieldTone", () => {
    it("applies used-percent boundaries to used fields", () => {
      expect(fieldTone("used_percent_primary", 49)).toBe("ok");
      expect(fieldTone("used_percent_primary", 50)).toBe("warning");
      expect(fieldTone("used_percent_primary", 79)).toBe("warning");
      expect(fieldTone("used_percent_primary", 80)).toBe("critical");
    });

    it("inverts remaining fields before applying thresholds", () => {
      expect(fieldTone("remaining_percent_primary", 51)).toBe("ok");
      expect(fieldTone("remaining_percent_primary", 50)).toBe("warning");
      expect(fieldTone("remaining_percent_primary", 21)).toBe("warning");
      expect(fieldTone("remaining_percent_primary", 20)).toBe("critical");
      expect(fieldTone("remaining_percent_primary", 10)).toBe("critical");
      expect(fieldTone("remaining_percent_primary", 90)).toBe("ok");
    });

    it("returns undefined for missing values", () => {
      expect(fieldTone("used_percent_primary", null)).toBeUndefined();
      expect(fieldTone("remaining_percent_primary", null)).toBeUndefined();
      expect(fieldTone("remaining_percent_primary", Number.NaN)).toBeUndefined();
    });
  });

  describe("currentRefreshInterval", () => {
    it("uses the short interval below the stable reads threshold", () => {
      expect(currentRefreshInterval(2, 3, 10, 120)).toBe(10);
    });

    it("uses the long interval at the threshold", () => {
      expect(currentRefreshInterval(3, 3, 10, 120)).toBe(120);
    });

    it("uses the long interval above the threshold", () => {
      expect(currentRefreshInterval(4, 3, 10, 120)).toBe(120);
    });
  });

  describe("shouldRender", () => {
    it("renders on the first cycle even without changes", () => {
      expect(shouldRender(false, false)).toBe(true);
    });

    it("skips the render when nothing changed after the first render", () => {
      expect(shouldRender(true, false)).toBe(false);
    });

    it("renders when results changed", () => {
      expect(shouldRender(true, true)).toBe(true);
      expect(shouldRender(false, true)).toBe(true);
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
});
