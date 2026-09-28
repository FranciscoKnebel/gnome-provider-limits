import type Gio from "gi://Gio";

import {
  BaseReader,
  FieldStatus,
  LAST_GOOD_MAX_AGE_MS,
  ReaderStatus,
  type FieldDef,
  type FieldResult,
  type ReaderResult,
} from "../../src/readers/base.js";
import {
  CLI_PROBE_BACKOFF_MS,
  credentialExpiresAt,
  isCredentialExpired,
  nextCliFailureAt,
  shouldProbeCli,
} from "../../src/readers/claudeProbe.js";
import {
  type CodexRateLimitsPayload,
  mergeResetCredits,
  normalizeCodexResetCredits,
} from "../../src/readers/codexParser.js";
import { openCodePartialError } from "../../src/readers/opencodeParser.js";

class LastGoodTestReader extends BaseReader {
  get FIELDS(): readonly FieldDef[] {
    return [];
  }

  async read(): Promise<ReaderResult> {
    return this._errorResult("nope", []);
  }

  setLastGood(result: ReaderResult): void {
    this._lastGood = result;
  }

  lastGoodOrError(message: string, pathsTried: readonly string[]): ReaderResult {
    return this._lastGoodOrError(message, pathsTried);
  }

  finalize(
    result: ReaderResult,
    pathsTried: readonly string[],
    fallbackMessage: string,
  ): ReaderResult {
    return this._finalizeResult(result, pathsTried, fallbackMessage);
  }
}

describe("last-known-good", () => {
  const settings = {} as Gio.Settings;
  const field: FieldResult = {
    name: "used_percent_primary",
    value: 42,
    status: FieldStatus.OK,
  };
  const good: ReaderResult = {
    provider: "test-provider",
    status: ReaderStatus.OK,
    fields: [field],
    lastUpdated: Date.now(),
    pathsTried: ["oauth-api"],
  };

  it("returns an error when nothing was ever read", () => {
    const reader = new LastGoodTestReader(settings, "test-provider");
    const result = reader.lastGoodOrError("all paths failed", ["disk"]);

    expect(result.status).toBe(ReaderStatus.ERROR);
    expect(result.lastError).toBe("all paths failed");
    expect(result.fields).toEqual([]);
  });

  it("carries a recent result over as PARTIAL", () => {
    const reader = new LastGoodTestReader(settings, "test-provider");
    reader.setLastGood(good);

    const result = reader.lastGoodOrError("all paths failed", ["disk"]);

    expect(result.status).toBe(ReaderStatus.PARTIAL);
    expect(result.provider).toBe("test-provider");
    expect(result.fields).toBe(good.fields);
    expect(result.lastUpdated).toBe(good.lastUpdated);
    expect(result.lastError).toBe("all paths failed");
    expect(result.pathsTried).toEqual(["disk", "last-known-good"]);
  });

  it("rejects results older than the max age", () => {
    const reader = new LastGoodTestReader(settings, "test-provider");
    reader.setLastGood({ ...good, lastUpdated: Date.now() - LAST_GOOD_MAX_AGE_MS - 5_000 });

    expect(reader.lastGoodOrError("all paths failed", []).status).toBe(ReaderStatus.ERROR);
  });

  it("accepts results just inside the max age", () => {
    const reader = new LastGoodTestReader(settings, "test-provider");
    reader.setLastGood({ ...good, lastUpdated: Date.now() - LAST_GOOD_MAX_AGE_MS + 5_000 });

    expect(reader.lastGoodOrError("all paths failed", []).status).toBe(ReaderStatus.PARTIAL);
  });

  it("_finalizeResult remembers usable results", () => {
    const reader = new LastGoodTestReader(settings, "test-provider");
    const partial: ReaderResult = { ...good, status: ReaderStatus.PARTIAL };

    expect(reader.finalize(partial, ["disk"], "fallback")).toBe(partial);

    const error: ReaderResult = {
      provider: "test-provider",
      status: ReaderStatus.ERROR,
      fields: [],
      lastUpdated: Date.now(),
      lastError: "inner failure",
    };
    const result = reader.finalize(error, ["disk"], "fallback");

    expect(result.status).toBe(ReaderStatus.PARTIAL);
    expect(result.lastError).toBe("inner failure");
    expect(result.fields).toBe(partial.fields);
  });

  it("_finalizeResult does not remember error results", () => {
    const reader = new LastGoodTestReader(settings, "test-provider");
    const error: ReaderResult = {
      provider: "test-provider",
      status: ReaderStatus.ERROR,
      fields: [],
      lastUpdated: Date.now(),
      lastError: "inner failure",
    };

    const result = reader.finalize(error, ["disk"], "fallback");
    expect(result.status).toBe(ReaderStatus.ERROR);
    expect(result.lastError).toBe("inner failure");
    expect(result.pathsTried).toEqual(["disk"]);
    expect(reader.lastGoodOrError("later failure", []).status).toBe(ReaderStatus.ERROR);
  });
});

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

describe("nextCliFailureAt", () => {
  const now = 1_000_000;

  it("records the failure timestamp when the probe returns nothing", () => {
    expect(nextCliFailureAt({ payload: null, cancelled: false, now, previous: 500 })).toBe(now);
  });

  it("clears the backoff when the probe succeeds", () => {
    expect(
      nextCliFailureAt({ payload: { five_hour: {} }, cancelled: false, now, previous: 500 }),
    ).toBeNull();
  });

  it("does not poison the backoff when the read was cancelled", () => {
    expect(nextCliFailureAt({ payload: null, cancelled: true, now, previous: 500 })).toBe(500);
    expect(nextCliFailureAt({ payload: null, cancelled: true, now, previous: null })).toBeNull();
  });

  it("a success after a failure makes the next scheduled probe run again", () => {
    const failureAt = nextCliFailureAt({ payload: null, cancelled: false, now, previous: null });
    expect(shouldProbeCli({ now: now + 1000, lastFailureAt: failureAt, force: false })).toBeFalse();

    const cleared = nextCliFailureAt({
      payload: { five_hour: {} },
      cancelled: false,
      now: now + 1000,
      previous: failureAt,
    });
    expect(cleared).toBeNull();
    expect(shouldProbeCli({ now: now + 2000, lastFailureAt: cleared, force: false })).toBeTrue();
  });

  it("a cancelled probe leaves the previous backoff decision intact", () => {
    const failureAt = nextCliFailureAt({ payload: null, cancelled: false, now, previous: null });
    const afterCancel = nextCliFailureAt({
      payload: null,
      cancelled: true,
      now: now + 1000,
      previous: failureAt,
    });

    expect(afterCancel).toBe(failureAt);
    expect(
      shouldProbeCli({ now: now + 2000, lastFailureAt: afterCancel, force: false }),
    ).toBeFalse();
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
