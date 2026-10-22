import { readFileSync } from "node:fs";

import { normalizeGrokUsagePayload, parseGrokAuth } from "../../src/readers/grokParser.js";

describe("Grok subscription credits", () => {
  it("reads the reported percentage and current credit period", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("../../../tests/fixtures/grok-subscription-credits.json", import.meta.url),
        "utf8",
      ),
    );
    const usage = normalizeGrokUsagePayload(fixture);

    expect(usage?.usedPercent).toBe(42.5);
    expect(usage?.resetAt).toBe(Date.parse("2026-06-08T00:00:00Z") / 1000);
    expect(usage?.prepaidBalance).toBe(12.5);
    expect(usage?.unifiedBilling).toBeTrue();
  });

  it("keeps unknown usage unavailable even when purchased credits exist", () => {
    const usage = normalizeGrokUsagePayload({
      config: {
        prepaidBalance: { val: "1446" },
        isUnifiedBillingUser: true,
        onDemandUsed: { val: 25 },
        onDemandCap: { val: 100 },
      },
    });

    expect(usage?.usedPercent).toBeNull();
    expect(usage?.prepaidBalance).toBe(14.46);
    expect(usage?.unifiedBilling).toBeTrue();
  });

  it("reads the legacy included allowance without mixing it with on-demand usage", () => {
    const usage = normalizeGrokUsagePayload({
      config: {
        monthlyLimit: { val: 2000 },
        used: { val: 500 },
        onDemandUsed: { val: 5000 },
        billingPeriodEnd: "2026-11-01T00:00:00Z",
      },
    });
    expect(usage?.usedPercent).toBe(25);
    expect(usage?.resetAt).toBe(Date.parse("2026-11-01T00:00:00Z") / 1000);
  });

  it("does not substitute legacy usage for an unknown current credit period", () => {
    const usage = normalizeGrokUsagePayload({
      config: { currentPeriod: {}, monthlyLimit: { val: 100 }, used: { val: 50 } },
    });
    expect(usage?.usedPercent).toBeNull();
  });

  it("preserves explicit zero percentages and proto3 zero balances", () => {
    const usage = normalizeGrokUsagePayload({
      config: { creditUsagePercent: 0, prepaidBalance: {} },
    });
    expect(usage?.usedPercent).toBe(0);
    expect(usage?.prepaidBalance).toBe(0);
  });

  it("does not invent usage from empty, malformed or non-finite values", () => {
    for (const value of [undefined, null, "", "25", true, -1, NaN, Infinity, {}, []]) {
      const usage = normalizeGrokUsagePayload({ config: { creditUsagePercent: value } });
      expect(usage?.usedPercent).toBeNull();
    }
    for (const raw of [null, [], {}, { config: null }, { config: [] }]) {
      expect(normalizeGrokUsagePayload(raw)).toBeNull();
    }
  });

  it("rejects invalid purchased credits without losing the reported usage", () => {
    for (const balance of [
      null,
      [],
      { val: "" },
      { val: true },
      { val: -1 },
      { val: 1.5 },
      { val: "1.5" },
      { val: "9007199254740992" },
      { other: 1 },
    ]) {
      const usage = normalizeGrokUsagePayload({
        config: { creditUsagePercent: 20, prepaidBalance: balance },
      });
      expect(usage?.usedPercent).toBe(20);
      expect(usage?.prepaidBalance).toBeNull();
    }
  });

  it("clamps over-limit percentages and prefers the current reset over the legacy reset", () => {
    const usage = normalizeGrokUsagePayload({
      config: {
        creditUsagePercent: 120,
        currentPeriod: { end: "2026-10-29T00:00:00Z" },
        billingPeriodEnd: "2026-11-01T00:00:00Z",
      },
    });
    expect(usage?.usedPercent).toBe(100);
    expect(usage?.resetAt).toBe(Date.parse("2026-10-29T00:00:00Z") / 1000);
    expect(
      normalizeGrokUsagePayload({ config: { currentPeriod: { end: "invalid" } } })?.resetAt,
    ).toBeNull();
  });
});

describe("Grok subscription authentication", () => {
  it("reads the SuperGrok login without retaining identity or refresh credentials", () => {
    const auth = parseGrokAuth(
      JSON.stringify({
        "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828": {
          key: "test-subscription-token",
          expires_at: "2026-10-23T00:00:00Z",
          user_id: "test-user",
          email: "not-returned@example.invalid",
          refresh_token: "never-returned",
        },
      }),
      Date.parse("2026-10-22T00:00:00Z"),
    );

    expect(auth).toEqual({ token: "test-subscription-token", userId: "test-user" });
  });

  it("rejects expired or malformed expiry without switching to another account", () => {
    for (const expires_at of ["2020-01-01T00:00:00Z", "invalid", 123, ""]) {
      expect(
        parseGrokAuth(
          JSON.stringify({
            "https://auth.x.ai::test": { key: "expired", expires_at },
            "https://accounts.x.ai/sign-in": { key: "other-account" },
          }),
        ),
      ).toBeNull();
    }
  });

  it("uses the CLI's 30-day fallback lifetime when only creation time is available", () => {
    const now = Date.parse("2026-10-22T00:00:00Z");
    expect(
      parseGrokAuth(
        JSON.stringify({
          "https://auth.x.ai::test": { key: "stale", create_time: "2026-09-01T00:00:00Z" },
        }),
        now,
      ),
    ).toBeNull();
    expect(
      parseGrokAuth(
        JSON.stringify({
          "https://auth.x.ai::test": { key: "recent", create_time: "2026-10-21T00:00:00Z" },
        }),
        now,
      )?.token,
    ).toBe("recent");
  });

  it("rejects API keys, team principals and unrelated identity providers", () => {
    for (const entry of [
      { key: "xai-management-key" },
      { key: "token", principal_type: "Team" },
      { key: "bad\r\nheader" },
    ]) {
      expect(parseGrokAuth(JSON.stringify({ "https://auth.x.ai::test": entry }))).toBeNull();
    }
    expect(
      parseGrokAuth(
        JSON.stringify({ "https://example.invalid::client": { key: "external-token" } }),
      ),
    ).toBeNull();
    for (const raw of ["invalid", "null", "[]", "{}", '{"https://auth.x.ai::test":{"key":" "}}']) {
      expect(parseGrokAuth(raw)).toBeNull();
    }
  });

  it("prefers the official CLI scope and supports legacy personal sessions", () => {
    expect(
      parseGrokAuth(
        JSON.stringify({
          "https://auth.x.ai::other": { key: "other" },
          "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828": { key: "official" },
        }),
      )?.token,
    ).toBe("official");
    expect(
      parseGrokAuth(
        JSON.stringify({
          "https://auth.x.ai::test": { key: "" },
          "https://accounts.x.ai/sign-in": { key: "legacy" },
        }),
      ),
    ).toEqual({ token: "legacy", userId: null });
  });
});
