import { readFileSync } from "node:fs";

import {
  CURSOR_BACKEND_URL,
  isJwtExpired,
  normalizeCursorBackendUrl,
  normalizeCursorUsagePayload,
  parseCursorAuth,
  parseCursorEnvAuth,
  parseCursorExchangeResponse,
  parseCursorPlanInfo,
} from "../../src/readers/cursorParser.js";

function makeJwt(payload: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

describe("Cursor usage normalization", () => {
  it("normalizes GetCurrentPeriodUsage response from contract fixture", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("../../../tests/fixtures/cursor-period-usage.json", import.meta.url),
        "utf8",
      ),
    );
    const usage = normalizeCursorUsagePayload(fixture);
    expect(usage).toEqual({
      usedPercentCredits: 42.5,
      usedPercentAuto: 30,
      usedPercentApi: 55,
      resetAtCredits: 1751328000,
      remainingCredits: 11.5,
      spendLimitUsed: 2.5,
      limitReached: false,
    });
  });

  it("computes includedSpend / limit percentage only when totalPercentUsed is omitted", () => {
    const usage = normalizeCursorUsagePayload({
      billingCycleEnd: 1751328000000,
      planUsage: {
        includedSpend: 500,
        limit: 2000,
        remaining: 1500,
      },
    });
    expect(usage?.usedPercentCredits).toBe(25);
    expect(usage?.resetAtCredits).toBe(1751328000);
    expect(usage?.remainingCredits).toBe(15);
    expect(usage?.limitReached).toBeFalse();
  });

  it("prefers server totalPercentUsed over includedSpend/limit when bonusSpend exists", () => {
    const usage = normalizeCursorUsagePayload({
      planUsage: {
        includedSpend: 2000,
        bonusSpend: 1000,
        limit: 2000,
        totalPercentUsed: 75,
        limitExceeded: false,
      },
    });
    expect(usage?.usedPercentCredits).toBe(75);
    expect(usage?.limitReached).toBeFalse();
  });

  it("derives limitReached and proto3 omitted zero remaining/spendLimitUsed fields", () => {
    const exhausted = normalizeCursorUsagePayload({
      planUsage: { remaining: 0, limit: 2000 },
    });
    expect(exhausted?.usedPercentCredits).toBeNull();
    expect(exhausted?.remainingCredits).toBe(0);
    expect(exhausted?.limitReached).toBeTrue();

    const proto3OmittedExhausted = normalizeCursorUsagePayload({
      planUsage: { limit: 2000 },
    });
    expect(proto3OmittedExhausted?.remainingCredits).toBe(0);
    expect(proto3OmittedExhausted?.limitReached).toBeTrue();

    const proto3BonusOmittedRemaining = normalizeCursorUsagePayload({
      planUsage: {
        totalSpend: 10734,
        includedSpend: 7000,
        bonusSpend: 3734,
        limit: 7000,
        totalPercentUsed: 8.37,
      },
      spendLimitUsage: {
        individualLimit: 10000,
        individualRemaining: 10000,
        limitType: "user",
      },
    });
    expect(proto3BonusOmittedRemaining?.remainingCredits).toBe(0);
    expect(proto3BonusOmittedRemaining?.spendLimitUsed).toBe(0);
    expect(proto3BonusOmittedRemaining?.limitReached).toBeFalse();

    const pooledCapZeroUsed = normalizeCursorUsagePayload({
      spendLimitUsage: {
        pooledLimit: "5000",
        pooledRemaining: "5000",
        limitType: "team",
      },
    });
    expect(pooledCapZeroUsed?.spendLimitUsed).toBe(0);

    expect(
      normalizeCursorUsagePayload({
        spendLimitUsage: { pooledLimit: "0", limitType: "user" },
      }),
    ).toBeNull();

    const available = normalizeCursorUsagePayload({
      planUsage: { remaining: "400", limit: "2000" },
    });
    expect(available?.remainingCredits).toBe(4);
    expect(available?.limitReached).toBeFalse();
  });

  it("clamps percentages above 100 and falls back across spendLimitUsage fields", () => {
    const usage = normalizeCursorUsagePayload({
      billingCycleEnd: "2026-07-01T00:00:00Z",
      planUsage: {
        totalPercentUsed: 125,
        autoPercentUsed: 110,
        apiPercentUsed: 0,
      },
      spendLimitUsage: {
        pooledUsed: "375",
      },
    });
    expect(usage?.usedPercentCredits).toBe(100);
    expect(usage?.usedPercentAuto).toBe(100);
    expect(usage?.usedPercentApi).toBe(0);
    expect(usage?.spendLimitUsed).toBe(3.75);
    expect(usage?.limitReached).toBeTrue();
    expect(usage?.resetAtCredits).toBe(Date.parse("2026-07-01T00:00:00Z") / 1000);
  });

  it("accepts Unix second timestamps as numbers or strings", () => {
    expect(
      normalizeCursorUsagePayload({
        billingCycleEnd: 1751328000,
        planUsage: { totalPercentUsed: 10 },
      })?.resetAtCredits,
    ).toBe(1751328000);
    expect(
      normalizeCursorUsagePayload({
        billingCycleEnd: "1751328000",
        planUsage: { totalPercentUsed: 10 },
      })?.resetAtCredits,
    ).toBe(1751328000);
  });

  it("rejects empty, disabled, or malformed usage payloads", () => {
    for (const raw of [
      null,
      undefined,
      [],
      "text",
      {},
      { enabled: false },
      { billingCycleEnd: "1751328000000" },
      {
        planUsage: {
          totalPercentUsed: -5,
          remaining: -10,
          includedSpend: "1.5",
        },
        spendLimitUsage: {
          individualUsed: "9007199254740992",
        },
      },
    ]) {
      expect(normalizeCursorUsagePayload(raw)).toBeNull();
    }

    for (const invalidCycle of ["", "invalid", 0, -1, NaN, "9007199254740992", {}]) {
      const usage = normalizeCursorUsagePayload({
        billingCycleEnd: invalidCycle,
        planUsage: { totalPercentUsed: 15 },
      });
      expect(usage?.usedPercentCredits).toBe(15);
      expect(usage?.resetAtCredits).toBeNull();
    }
  });
});

describe("Cursor plan info parsing", () => {
  it("extracts planName and reset timestamp from nested or flat payload", () => {
    expect(
      parseCursorPlanInfo({
        planInfo: {
          planName: "Pro",
          includedUsageResetsAt: "1751328000000",
        },
      }),
    ).toEqual({ planName: "Pro", resetAt: 1751328000 });

    expect(
      parseCursorPlanInfo({
        planName: "  Ultra  ",
        billingCycleEnd: "2026-07-01T00:00:00Z",
      }),
    ).toEqual({ planName: "Ultra", resetAt: Date.parse("2026-07-01T00:00:00Z") / 1000 });

    expect(parseCursorPlanInfo(null)).toEqual({ planName: null, resetAt: null });
    expect(parseCursorPlanInfo({ planInfo: { planName: "   " } })).toEqual({
      planName: null,
      resetAt: null,
    });
  });
});

describe("Cursor authentication parsing", () => {
  const now = Date.parse("2026-10-22T00:00:00Z");

  it("parses Cursor SDK StoredCredential without retaining identity fields", () => {
    const auth = parseCursorAuth(
      JSON.stringify({
        version: 1,
        backendUrl: "https://api2.cursor.sh/",
        apiKey: "key_test_sdk_credential",
        createdAtMs: now - 60_000,
        apiKeyExpiresAtMs: now + 3_600_000,
        email: "private@example.invalid",
      }),
      now,
    );
    expect(auth).toEqual({ accessToken: null, apiKey: "key_test_sdk_credential" });
  });

  it("parses Cursor CLI auth.json session JWT and rejects expired JWTs", () => {
    const validJwt = makeJwt({ sub: "user_1", exp: Math.floor(now / 1000) + 3600 });
    const expiredJwt = makeJwt({ sub: "user_1", exp: Math.floor(now / 1000) - 60 });

    expect(
      parseCursorAuth(
        JSON.stringify({
          accessToken: validJwt,
          refreshToken: "never-returned",
        }),
        now,
      ),
    ).toEqual({ accessToken: validJwt, apiKey: null });

    expect(parseCursorAuth(JSON.stringify({ accessToken: expiredJwt }), now)).toBeNull();

    expect(
      parseCursorAuth(
        JSON.stringify({
          accessToken: expiredJwt,
          apiKey: "key_fallback",
        }),
        now,
      ),
    ).toEqual({ accessToken: null, apiKey: "key_fallback" });
  });

  it("validates JWT edge cases", () => {
    expect(isJwtExpired("opaque-token", now)).toBeFalse();
    expect(isJwtExpired(makeJwt({ sub: "no-exp" }), now)).toBeFalse();
    expect(isJwtExpired(".eyJzdWIiOiJ4In0.", now)).toBeTrue();
    expect(isJwtExpired("a.eyJzdWIiOiJ4In0.", now)).toBeTrue();
    expect(isJwtExpired("a.b.c", now)).toBeTrue();
    expect(isJwtExpired("a.!.c", now)).toBeTrue();
    expect(isJwtExpired("a.bm90LWpzb24.c", now)).toBeTrue();
    expect(isJwtExpired(makeJwt(["not-an-object"]), now)).toBeTrue();
    expect(isJwtExpired(makeJwt({ exp: "bad" }), now)).toBeTrue();
    expect(isJwtExpired(makeJwt({ exp: -10 }), now)).toBeTrue();
  });

  it("rejects custom backendUrl, unsupported versions, expired apiKey, and Grok auth files", () => {
    expect(normalizeCursorBackendUrl(undefined)).toBe(CURSOR_BACKEND_URL);
    expect(normalizeCursorBackendUrl("  ")).toBe(CURSOR_BACKEND_URL);
    expect(normalizeCursorBackendUrl("https://api2.cursor.sh///")).toBe(CURSOR_BACKEND_URL);
    expect(normalizeCursorBackendUrl("https://attacker.example.invalid")).toBeNull();
    expect(normalizeCursorBackendUrl(123)).toBeNull();

    expect(
      parseCursorAuth(
        JSON.stringify({
          version: 1,
          backendUrl: "https://evil.example.invalid",
          apiKey: "key_test",
        }),
        now,
      ),
    ).toBeNull();

    expect(parseCursorAuth(JSON.stringify({ version: 2, apiKey: "key_test" }), now)).toBeNull();

    for (const apiKeyExpiresAtMs of [now - 1, now, "bad", NaN]) {
      expect(
        parseCursorAuth(JSON.stringify({ apiKey: "key_test", apiKeyExpiresAtMs }), now),
      ).toBeNull();
    }

    expect(
      parseCursorAuth(JSON.stringify({ "https://auth.x.ai::scope": { key: "tok" } }), now),
    ).toBeNull();
    expect(parseCursorAuth(JSON.stringify({ xaiAccessToken: "tok" }), now)).toBeNull();
    expect(parseCursorAuth("not-json", now)).toBeNull();
    expect(parseCursorAuth("[]", now)).toBeNull();
    expect(parseCursorAuth(JSON.stringify({ accessToken: "has space" }), now)).toBeNull();
    expect(parseCursorAuth(JSON.stringify({ accessToken: "nul\u0000byte" }), now)).toBeNull();
  });

  it("parses environment variables and rejects custom endpoints", () => {
    const validJwt = makeJwt({ exp: Math.floor(now / 1000) + 3600 });
    const expiredJwt = makeJwt({ exp: Math.floor(now / 1000) - 10 });

    expect(
      parseCursorEnvAuth({ CURSOR_AUTH_TOKEN: validJwt, CURSOR_API_KEY: "key_env" }, now),
    ).toEqual({ accessToken: validJwt, apiKey: "key_env" });

    expect(
      parseCursorEnvAuth({ CURSOR_AUTH_TOKEN: expiredJwt, CURSOR_API_KEY: "key_env" }, now),
    ).toEqual({ accessToken: null, apiKey: "key_env" });

    expect(parseCursorEnvAuth({}, now)).toBeNull();
    expect(
      parseCursorEnvAuth(
        { CURSOR_API_KEY: "key_env", CURSOR_BACKEND_URL: "https://custom.example.invalid" },
        now,
      ),
    ).toBeNull();
    expect(
      parseCursorEnvAuth(
        { CURSOR_API_KEY: "key_env", CURSOR_API_ENDPOINT: "https://custom.example.invalid" },
        now,
      ),
    ).toBeNull();
    expect(
      parseCursorEnvAuth(
        {
          CURSOR_API_KEY: "key_env",
          CURSOR_AUTH_API_BASE_URL: "https://custom.example.invalid",
        },
        now,
      ),
    ).toBeNull();
  });

  it("parses exchange_user_api_key responses", () => {
    const validJwt = makeJwt({ exp: Math.floor(now / 1000) + 3600 });
    const expiredJwt = makeJwt({ exp: Math.floor(now / 1000) - 10 });

    expect(parseCursorExchangeResponse({ accessToken: validJwt }, now)).toBe(validJwt);
    expect(parseCursorExchangeResponse({ accessToken: expiredJwt }, now)).toBeNull();
    expect(parseCursorExchangeResponse(null, now)).toBeNull();
    expect(parseCursorExchangeResponse({}, now)).toBeNull();
  });
});
