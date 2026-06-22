import {
  normalizeOpenCodeDbRow,
  parseOpenCodeAuthText,
  parseOpenCodeTokenExpiry,
} from "../../src/readers/opencodeParser.js";

describe("opencodeParser", () => {
  describe("normalizeOpenCodeDbRow", () => {
    it("returns zeros when the row is null or undefined", () => {
      expect(normalizeOpenCodeDbRow(null)).toEqual({ totalCost: 0, sessionsCount: 0 });
      expect(normalizeOpenCodeDbRow(undefined)).toEqual({ totalCost: 0, sessionsCount: 0 });
    });

    it("coerces null fields to 0", () => {
      expect(normalizeOpenCodeDbRow({ total_cost: null, sessions_count: null })).toEqual({
        totalCost: 0,
        sessionsCount: 0,
      });
    });

    it("reads cost and count as numbers", () => {
      expect(normalizeOpenCodeDbRow({ total_cost: 3.14, sessions_count: 109 })).toEqual({
        totalCost: 3.14,
        sessionsCount: 109,
      });
    });
  });

  describe("parseOpenCodeTokenExpiry", () => {
    it("treats millisecond timestamps as ms and converts to seconds", () => {
      expect(parseOpenCodeTokenExpiry(1782526648069)).toBe(1782526648);
    });

    it("treats second timestamps as seconds directly", () => {
      expect(parseOpenCodeTokenExpiry(1782526648)).toBe(1782526648);
    });

    it("accepts a numeric string", () => {
      expect(parseOpenCodeTokenExpiry("1782526648069")).toBe(1782526648);
    });

    it("rejects non-positive, NaN, and non-numeric inputs", () => {
      expect(parseOpenCodeTokenExpiry(0)).toBeNull();
      expect(parseOpenCodeTokenExpiry(-1)).toBeNull();
      expect(parseOpenCodeTokenExpiry(Number.NaN)).toBeNull();
      expect(parseOpenCodeTokenExpiry(null)).toBeNull();
      expect(parseOpenCodeTokenExpiry("not a number")).toBeNull();
      expect(parseOpenCodeTokenExpiry({})).toBeNull();
    });
  });

  describe("parseOpenCodeAuthText", () => {
    it("extracts openai.expires from a real auth.json shape", () => {
      const text = JSON.stringify({
        openai: { expires: 1782526648069, type: "oauth" },
        "opencode-go": { type: "key" },
      });
      expect(parseOpenCodeAuthText(text)).toBe(1782526648);
    });

    it("returns null when openai is missing", () => {
      expect(parseOpenCodeAuthText(JSON.stringify({ "opencode-go": { type: "key" } }))).toBeNull();
    });

    it("returns null for non-JSON text", () => {
      expect(parseOpenCodeAuthText("<not json>")).toBeNull();
    });
  });
});
