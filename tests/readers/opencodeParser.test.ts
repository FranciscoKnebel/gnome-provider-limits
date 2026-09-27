import {
  normalizeOpenCodeDbRow,
  normalizeOpenCodeUsagePayload,
  parseOpenCodeAuthKey,
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

  describe("parseOpenCodeAuthKey", () => {
    it("reads the opencode-go API key from auth.json", () => {
      expect(
        parseOpenCodeAuthKey(
          JSON.stringify({ "opencode-go": { type: "api", key: "sk-opencode-abc123" } }),
        ),
      ).toBe("sk-opencode-abc123");
    });

    it("accepts an access token stored for the opencode-go integration", () => {
      expect(parseOpenCodeAuthKey(JSON.stringify({ "opencode-go": { access: "token-123" } }))).toBe(
        "token-123",
      );
    });

    it("ignores credentials for other providers", () => {
      expect(
        parseOpenCodeAuthKey(JSON.stringify({ openai: { access: "codex-token" } })),
      ).toBeNull();
    });

    it("returns null on malformed input", () => {
      expect(parseOpenCodeAuthKey("not json")).toBeNull();
      expect(parseOpenCodeAuthKey("{}")).toBeNull();
      expect(parseOpenCodeAuthKey(JSON.stringify({ "opencode-go": null }))).toBeNull();
      expect(parseOpenCodeAuthKey(JSON.stringify({ "opencode-go": { key: "   " } }))).toBeNull();
    });
  });

  describe("normalizeOpenCodeUsagePayload", () => {
    it("normalizes provider percent and ISO reset timestamps to epoch seconds", () => {
      const usage = normalizeOpenCodeUsagePayload({
        usage: {
          rolling: { status: "ok", percent: 0, resetsAt: "2026-09-27T20:35:00.105Z" },
          weekly: { status: "ok", percent: 11, resetsAt: "2026-09-28T00:00:00.000Z" },
          monthly: { status: "rate-limited", percent: 100, resetsAt: "2026-10-22T00:17:24.000Z" },
        },
      });

      expect(usage).toEqual({
        rolling: {
          status: "ok",
          percent: 0,
          reset_at: Math.floor(Date.parse("2026-09-27T20:35:00.105Z") / 1000),
        },
        weekly: {
          status: "ok",
          percent: 11,
          reset_at: Math.floor(Date.parse("2026-09-28T00:00:00.000Z") / 1000),
        },
        monthly: {
          status: "rate-limited",
          percent: 100,
          reset_at: Math.floor(Date.parse("2026-10-22T00:17:24.000Z") / 1000),
        },
      });
    });

    it("accepts a bare usage object without the wrapper", () => {
      const usage = normalizeOpenCodeUsagePayload({
        rolling: { status: "ok", percent: 42, resetsAt: "2026-09-27T20:35:00.000Z" },
      });

      expect(usage?.rolling?.percent).toBe(42);
      expect(usage?.weekly).toBeNull();
      expect(usage?.monthly).toBeNull();
    });

    it("keeps status-only windows and drops empty ones", () => {
      const usage = normalizeOpenCodeUsagePayload({
        usage: {
          rolling: { status: "ok", percent: null, resetsAt: null },
          weekly: {},
          monthly: { percent: "12", resetsAt: 1790523298 },
        },
      });

      expect(usage?.rolling).toEqual({ status: "ok", percent: null, reset_at: null });
      expect(usage?.weekly).toBeNull();
      expect(usage?.monthly).toEqual({ status: null, percent: 12, reset_at: 1790523298 });
    });

    it("returns null when no usage window is present", () => {
      expect(normalizeOpenCodeUsagePayload(null)).toBeNull();
      expect(normalizeOpenCodeUsagePayload("nope")).toBeNull();
      expect(normalizeOpenCodeUsagePayload({ usage: {} })).toBeNull();
      expect(normalizeOpenCodeUsagePayload({ usage: { rolling: {} } })).toBeNull();
    });
  });
});
