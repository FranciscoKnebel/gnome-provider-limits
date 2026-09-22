import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  codexWindowMinutes,
  normalizeCodexOauthPayload,
  normalizeCodexResetCredits,
  parseCodexLogBody,
  summarizeCodexResetCredits,
} from "../../src/readers/codexParser.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "..", "..", "tests", "fixtures");

function fixture(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

describe("codexParser", () => {
  describe("normalizeCodexOauthPayload", () => {
    it("converts rate_limit + primary_window / secondary_window into rate_limits shape", () => {
      const raw = JSON.parse(fixture("codex-oauth-usage.json"));
      const payload = normalizeCodexOauthPayload(raw);

      expect(payload).not.toBeNull();
      expect(payload?.plan_type).toBe("plus");
      expect(payload?.rate_limits?.allowed).toBe(true);
      expect(payload?.rate_limits?.limit_reached).toBe(false);
      expect(payload?.rate_limits?.primary?.used_percent).toBe(4);
      expect(payload?.rate_limits?.primary?.limit_window_seconds).toBe(18000);
      expect(payload?.rate_limits?.secondary?.used_percent).toBe(75);
      expect(payload?.rate_limits?.secondary?.reset_at).toBe(1782398328);
      expect(payload?.reset_credits?.available_count).toBe(0);
      expect(payload?.reset_credits?.credits).toBeUndefined();
    });

    it("returns null when rate_limit is missing", () => {
      expect(normalizeCodexOauthPayload({})).toBeNull();
    });
  });

  describe("parseCodexLogBody", () => {
    it("extracts the rate_limits event from a noisy log line", () => {
      const body = fixture("codex-log-body.txt");
      const payload = parseCodexLogBody(body);

      expect(payload).not.toBeNull();
      expect(payload?.plan_type).toBe("plus");
      expect(payload?.rate_limits?.allowed).toBe(true);
      expect(payload?.rate_limits?.limit_reached).toBe(false);
      expect(payload?.rate_limits?.primary?.used_percent).toBe(1);
      expect(payload?.rate_limits?.primary?.window_minutes).toBe(300);
      expect(payload?.rate_limits?.secondary?.used_percent).toBe(17);
      expect(payload?.rate_limits?.secondary?.reset_at).toBe(1782223474);
    });

    it("returns null for a log line without the rate_limits event", () => {
      const body = "boring line without the magic substring";
      expect(parseCodexLogBody(body)).toBeNull();
    });

    it("returns null when the matched JSON is malformed", () => {
      const body = 'prefix {"type":"codex.rate_limits","rate_limits": notjson} suffix';
      expect(parseCodexLogBody(body)).toBeNull();
    });
  });

  describe("codexWindowMinutes", () => {
    it("prefers window_minutes when present", () => {
      expect(codexWindowMinutes({ window_minutes: 300 })).toBe(300);
    });

    it("falls back to limit_window_seconds / 60 when window_minutes is absent", () => {
      expect(codexWindowMinutes({ limit_window_seconds: 18000 })).toBe(300);
      expect(codexWindowMinutes({ limit_window_seconds: 604800 })).toBe(10080);
    });

    it("returns null when neither is present", () => {
      expect(codexWindowMinutes({})).toBeNull();
      expect(codexWindowMinutes(null)).toBeNull();
    });
  });

  describe("normalizeCodexResetCredits", () => {
    it("normalizes the rate-limit-reset-credits details payload", () => {
      const raw = JSON.parse(fixture("codex-reset-credits.json"));
      const resetCredits = normalizeCodexResetCredits(raw);

      expect(resetCredits).not.toBeNull();
      expect(resetCredits?.available_count).toBe(2);
      expect(resetCredits?.credits?.length).toBe(2);
      expect(resetCredits?.credits?.[0]?.status).toBe("available");
      expect(resetCredits?.credits?.[0]?.expires_at).toBe("2026-10-04T00:46:13Z");
    });

    it("normalizes the usage summary block", () => {
      const resetCredits = normalizeCodexResetCredits({
        available_count: 2,
        applicable_available_count: 0,
      });

      expect(resetCredits?.available_count).toBe(2);
      expect(resetCredits?.applicable_available_count).toBe(0);
      expect(resetCredits?.credits).toBeUndefined();
    });

    it("returns null for non-object input", () => {
      expect(normalizeCodexResetCredits(null)).toBeNull();
      expect(normalizeCodexResetCredits("nope")).toBeNull();
    });
  });

  describe("summarizeCodexResetCredits", () => {
    it("returns null summary when reset credits are absent", () => {
      expect(summarizeCodexResetCredits(null)).toEqual({ available: null, expiresAt: null });
      expect(summarizeCodexResetCredits(undefined)).toEqual({
        available: null,
        expiresAt: null,
      });
    });

    it("prefers available_count and picks the earliest expiration", () => {
      const raw = JSON.parse(fixture("codex-reset-credits.json"));
      const summary = summarizeCodexResetCredits(normalizeCodexResetCredits(raw));

      expect(summary.available).toBe(2);
      expect(summary.expiresAt).toBe(Math.floor(Date.parse("2026-10-04T00:46:13Z") / 1000));
    });

    it("ignores expiration of credits not available", () => {
      const summary = summarizeCodexResetCredits({
        available_count: 1,
        credits: [
          { status: "redeemed", expires_at: "2026-01-01T00:00:00Z" },
          { status: "available", expires_at: "2026-11-30T12:00:00Z" },
        ],
      });

      expect(summary.available).toBe(1);
      expect(summary.expiresAt).toBe(Math.floor(Date.parse("2026-11-30T12:00:00Z") / 1000));
    });

    it("falls back to counting credits when available_count is missing", () => {
      const summary = summarizeCodexResetCredits({
        credits: [
          { status: "available", expires_at: "2026-12-01T00:00:00Z" },
          { status: "available", expires_at: null },
          { status: "redeemed", expires_at: "2026-12-02T00:00:00Z" },
        ],
      });

      expect(summary.available).toBe(2);
      expect(summary.expiresAt).toBe(Math.floor(Date.parse("2026-12-01T00:00:00Z") / 1000));
    });

    it("returns null expiration when no credit carries a valid expires_at", () => {
      const summary = summarizeCodexResetCredits({
        available_count: 2,
        credits: [{ status: "available", expires_at: null }],
      });

      expect(summary.available).toBe(2);
      expect(summary.expiresAt).toBeNull();
    });
  });
});
