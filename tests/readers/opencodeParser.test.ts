import {
  buildOpenCodeObservedSpendLimits,
  normalizeOpenCodeDbRow,
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

  describe("buildOpenCodeObservedSpendLimits", () => {
    it("calculates spend limits from local OpenCode Go session costs", () => {
      const nowMs = 1_800_000_000_000;
      const limits = buildOpenCodeObservedSpendLimits(
        [
          { cost: 3, time_created: nowMs - 2 * 60 * 60 * 1000 },
          { cost: 4, time_created: nowMs - 6 * 60 * 60 * 1000 },
          { cost: 100, time_created: nowMs - 40 * 24 * 60 * 60 * 1000 },
        ],
        [
          { id: "rolling", durationMs: 5 * 60 * 60 * 1000, limitUsd: 12 },
          { id: "weekly", durationMs: 7 * 24 * 60 * 60 * 1000, limitUsd: 30 },
        ],
        nowMs,
      );

      expect(limits).toEqual([
        {
          id: "rolling",
          usedUsd: 3,
          remainingUsd: 9,
          usedPercent: 25,
          remainingPercent: 75,
          resetAt: Math.floor((nowMs - 2 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000) / 1000),
        },
        {
          id: "weekly",
          usedUsd: 7,
          remainingUsd: 23,
          usedPercent: 23.333333333333332,
          remainingPercent: 76.66666666666667,
          resetAt: Math.floor((nowMs - 6 * 60 * 60 * 1000 + 7 * 24 * 60 * 60 * 1000) / 1000),
        },
      ]);
    });

    it("clamps remaining values when observed spend exceeds the ceiling", () => {
      const [limit] = buildOpenCodeObservedSpendLimits(
        [{ cost: 15, time_created: 1_800_000_000_000 }],
        [{ id: "rolling", durationMs: 5 * 60 * 60 * 1000, limitUsd: 12 }],
        1_800_000_000_001,
      );

      expect(limit?.usedUsd).toBe(15);
      expect(limit?.remainingUsd).toBe(0);
      expect(limit?.remainingPercent).toBe(0);
    });
  });
});
