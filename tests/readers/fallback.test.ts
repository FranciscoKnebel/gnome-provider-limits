import {
  CLI_PROBE_BACKOFF_MS,
  credentialExpiresAt,
  isCredentialExpired,
  shouldProbeCli,
} from "../../src/readers/claudeProbe.js";
import {
  type CodexRateLimitsPayload,
  mergeResetCredits,
  normalizeCodexResetCredits,
} from "../../src/readers/codexParser.js";
import { openCodePartialError } from "../../src/readers/opencodeParser.js";

describe("shouldProbeCli", () => {
  const now = 1_000_000;

  it("probes when there is no recorded failure", () => {
    expect(shouldProbeCli({ now, lastFailureAt: null, force: false })).toBeTrue();
  });

  it("skips while the backoff window is open", () => {
    expect(shouldProbeCli({ now, lastFailureAt: now - 1000, force: false })).toBeFalse();
  });

  it("probes again once the backoff has elapsed", () => {
    expect(
      shouldProbeCli({
        now,
        lastFailureAt: now - CLI_PROBE_BACKOFF_MS,
        force: false,
      }),
    ).toBeTrue();
  });

  it("force bypasses the backoff", () => {
    expect(shouldProbeCli({ now, lastFailureAt: now - 1, force: true })).toBeTrue();
  });

  it("honors a custom backoff", () => {
    expect(
      shouldProbeCli({ now, lastFailureAt: now - 1000, force: false, backoffMs: 500 }),
    ).toBeTrue();
  });
});

describe("credentialExpiresAt", () => {
  it("reads top-level millisecond expiry", () => {
    expect(credentialExpiresAt({ expiresAt: 1_700_000_000_000 })).toBe(1_700_000_000_000);
  });

  it("converts top-level second expiry to milliseconds", () => {
    expect(credentialExpiresAt({ expires_at: 1_700_000_000 })).toBe(1_700_000_000_000);
  });

  it("reads nested claudeAiOauth expiry", () => {
    expect(credentialExpiresAt({ claudeAiOauth: { expiresAt: 1_700_000_000_000 } })).toBe(
      1_700_000_000_000,
    );
  });

  it("parses ISO strings", () => {
    expect(credentialExpiresAt({ expiresAt: "2023-11-14T22:13:20.000Z" })).toBe(1_700_000_000_000);
  });

  it("returns null when absent or malformed", () => {
    expect(credentialExpiresAt({})).toBeNull();
    expect(credentialExpiresAt(null)).toBeNull();
    expect(credentialExpiresAt({ expiresAt: "not-a-date" })).toBeNull();
    expect(credentialExpiresAt({ expiresAt: -5 })).toBeNull();
  });
});

describe("isCredentialExpired", () => {
  it("is false when no expiry is known", () => {
    expect(isCredentialExpired(null, 1000)).toBeFalse();
  });

  it("is false for a future expiry", () => {
    expect(isCredentialExpired(2000, 1000)).toBeFalse();
  });

  it("is true at and past the expiry instant", () => {
    expect(isCredentialExpired(1000, 1000)).toBeTrue();
    expect(isCredentialExpired(999, 1000)).toBeTrue();
  });
});

describe("mergeResetCredits", () => {
  const payload: CodexRateLimitsPayload = {
    rate_limits: { primary: { used_percent: 10 } },
    plan_type: "plus",
    reset_credits: { available_count: 1 },
  };

  it("returns the payload unchanged when details are missing", () => {
    expect(mergeResetCredits(payload, null)).toBe(payload);
  });

  it("merges details over the summary without touching other fields", () => {
    const details = normalizeCodexResetCredits({
      available_count: 2,
      credits: [{ status: "available", expires_at: "2026-01-01T00:00:00Z" }],
    });
    const merged = mergeResetCredits(payload, details);

    expect(merged.plan_type).toBe("plus");
    expect(merged.rate_limits).toBe(payload.rate_limits);
    expect(merged.reset_credits?.available_count).toBe(2);
    expect(merged.reset_credits?.credits).toHaveSize(1);
  });
});

describe("openCodePartialError", () => {
  it("returns null when both sources produced data", () => {
    expect(openCodePartialError(true, true, [])).toBeNull();
  });

  it("describes the failed disk source", () => {
    const error = openCodePartialError(true, false, [
      { source: "disk", reason: new Error("sqlite down") },
    ]);
    expect(error).toBe("disk: sqlite down");
  });

  it("describes the failed usage source", () => {
    const error = openCodePartialError(false, true, [
      { source: "usage-api", reason: new Error("HTTP 429") },
    ]);
    expect(error).toBe("usage-api: HTTP 429");
  });

  it("falls back to a generic description when no reason was captured", () => {
    expect(openCodePartialError(true, false, [])).toBe("disk: no data");
    expect(openCodePartialError(false, true, [])).toBe("usage-api: no data");
  });
});
