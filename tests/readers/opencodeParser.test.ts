import {
  normalizeOpenCodeDbRow,
  normalizeOpenCodeOauthPayload,
  parseOpenCodeAccessToken,
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

  describe("parseOpenCodeAccessToken", () => {
    it("extracts openai.access from auth.json", () => {
      const text = JSON.stringify({ openai: { access: "token-value", type: "oauth" } });
      expect(parseOpenCodeAccessToken(text)).toBe("token-value");
    });

    it("returns null when the access token is missing or invalid", () => {
      expect(parseOpenCodeAccessToken(JSON.stringify({ openai: { access: "" } }))).toBeNull();
      expect(parseOpenCodeAccessToken(JSON.stringify({ openai: { access: 123 } }))).toBeNull();
      expect(parseOpenCodeAccessToken("<not json>")).toBeNull();
    });
  });

  describe("normalizeOpenCodeOauthPayload", () => {
    it("maps the OpenAI usage payload windows to OpenCode rolling and weekly limits", () => {
      const payload = normalizeOpenCodeOauthPayload({
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: { used_percent: 12, reset_at: 1782150837 },
          secondary_window: { used_percent: 34, reset_at: 1782398328 },
        },
      });

      expect(payload).not.toBeNull();
      expect(payload?.rate_limits?.allowed).toBe(true);
      expect(payload?.rate_limits?.limit_reached).toBe(false);
      expect(payload?.rate_limits?.rolling?.used_percent).toBe(12);
      expect(payload?.rate_limits?.rolling?.reset_at).toBe(1782150837);
      expect(payload?.rate_limits?.weekly?.used_percent).toBe(34);
      expect(payload?.rate_limits?.weekly?.reset_at).toBe(1782398328);
    });

    it("returns null when rate_limit is missing", () => {
      expect(normalizeOpenCodeOauthPayload({})).toBeNull();
    });
  });
});
