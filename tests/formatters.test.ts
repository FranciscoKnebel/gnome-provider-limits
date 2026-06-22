import { formatField } from "../src/formatters.js";

describe("formatters", () => {
  describe("percent", () => {
    it("formats integer with % suffix", () => {
      expect(formatField({ type: "percent", value: 42, zone: "status", locale: "en" })).toBe("42%");
    });

    it("rounds to nearest integer", () => {
      expect(formatField({ type: "percent", value: 42.7, zone: "status", locale: "en" })).toBe(
        "43%",
      );
    });

    it("returns dash for null", () => {
      expect(formatField({ type: "percent", value: null, zone: "status", locale: "en" })).toBe("—");
    });
  });

  describe("timestamp", () => {
    it('returns "now" for past timestamps', () => {
      const past = Date.now() - 10000;
      expect(formatField({ type: "timestamp", value: past, zone: "status", locale: "en" })).toBe(
        "now",
      );
    });

    it("formats minutes", () => {
      const future = Date.now() + 5 * 60 * 1000;
      expect(formatField({ type: "timestamp", value: future, zone: "status", locale: "en" })).toBe(
        "5m",
      );
    });

    it("formats hours and minutes in status bar without spaces", () => {
      const future = Date.now() + (4 * 3600 + 59 * 60) * 1000;
      expect(formatField({ type: "timestamp", value: future, zone: "status", locale: "en" })).toBe(
        "4h59m",
      );
    });
  });

  describe("tokens", () => {
    it("formats with K suffix", () => {
      expect(formatField({ type: "tokens", value: 461000, zone: "status", locale: "en" })).toBe(
        "461K",
      );
    });

    it("formats with M suffix", () => {
      expect(formatField({ type: "tokens", value: 1_000_000, zone: "status", locale: "en" })).toBe(
        "1.0M",
      );
    });

    it("shows full number in panel", () => {
      const result = formatField({ type: "tokens", value: 1_000_000, zone: "panel", locale: "en" });
      expect(result).toContain("1,000,000");
      expect(result).toContain("1.0M");
    });
  });

  describe("cost", () => {
    it("formats USD with 2 decimals", () => {
      expect(formatField({ type: "cost", value: 3.71, zone: "status", locale: "en" })).toBe(
        "$3.71",
      );
    });
  });

  describe("count", () => {
    it("formats with thousands separator", () => {
      expect(formatField({ type: "count", value: 1982, zone: "status", locale: "en" })).toBe(
        "1,982",
      );
    });
  });

  describe("bool", () => {
    it("shows checkmark in status bar", () => {
      expect(formatField({ type: "bool", value: true, zone: "status", locale: "en" })).toBe("✓");
      expect(formatField({ type: "bool", value: false, zone: "status", locale: "en" })).toBe("✗");
    });

    it("shows yes/no in panel", () => {
      expect(formatField({ type: "bool", value: true, zone: "panel", locale: "en" })).toBe("yes");
      expect(formatField({ type: "bool", value: false, zone: "panel", locale: "en" })).toBe("no");
    });
  });

  describe("text", () => {
    it("truncates long text in status bar", () => {
      expect(
        formatField({ type: "text", value: "org_level_disabled", zone: "status", locale: "en" }),
      ).toBe("org_leve…");
    });

    it("shows full text in panel", () => {
      expect(
        formatField({ type: "text", value: "org_level_disabled", zone: "panel", locale: "en" }),
      ).toBe("org_level_disabled");
    });
  });
});
