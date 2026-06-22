import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  codexWindowMinutes,
  normalizeCodexOauthPayload,
  parseCodexLogBody,
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
});
