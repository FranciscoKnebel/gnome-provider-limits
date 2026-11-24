import { readFileSync } from "node:fs";

import {
  GOOGLE_CLOUDCODE_DAILY_URL,
  GOOGLE_CLOUDCODE_PROD_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  hasActiveGoogleUsage,
  hasCompleteActiveGoogleUsage,
  isAntigravityAuthPath,
  mergeGoogleUsage,
  normalizeGoogleAvailableModels,
  normalizeGoogleQuotaSummary,
  parseGoogleAuth,
  parseGoogleTierName,
  parseGoogleTokenResponse,
  resolveGoogleQuotaEndpoints,
} from "../../src/readers/googleParser.js";

const NOW = Date.parse("2026-04-20T03:00:00Z");

describe("parseGoogleAuth", () => {
  it("parses Gemini CLI oauth_creds.json with valid expiry_date", () => {
    const parsed = parseGoogleAuth(
      JSON.stringify({
        access_token: "ya29.valid",
        refresh_token: "1//refresh",
        client_id: "client-id.apps.googleusercontent.com",
        client_secret: "GOCSPX-secret",
        expiry_date: NOW + 3600_000,
        project_id: "companion-proj-1",
      }),
      NOW,
    );
    expect(parsed).toEqual({
      accessToken: "ya29.valid",
      refreshToken: "1//refresh",
      clientId: "client-id.apps.googleusercontent.com",
      clientSecret: "GOCSPX-secret",
      projectId: "companion-proj-1",
    });
  });

  it("drops expired access_token while keeping refresh credentials", () => {
    const parsed = parseGoogleAuth(
      JSON.stringify({
        type: "authorized_user",
        token_uri: "https://oauth2.googleapis.com/token/",
        access_token: "ya29.expired",
        expires_at: "2026-04-20T02:59:00Z",
        refresh_token: "1//refresh",
        client_id: "cid",
        client_secret: "csecret",
        quota_project_id: "quota-proj",
      }),
      NOW,
    );
    expect(parsed).toEqual({
      accessToken: null,
      refreshToken: "1//refresh",
      clientId: "cid",
      clientSecret: "csecret",
      projectId: "quota-proj",
    });
  });

  it("accepts accounts.google.com token_uri and numeric expires_at seconds or ms", () => {
    const secAuth = parseGoogleAuth(
      JSON.stringify({
        token_uri: "https://accounts.google.com/o/oauth2/token",
        access_token: "ya29.sec",
        expires_at: Math.floor((NOW + 120_000) / 1000),
      }),
      NOW,
    );
    expect(secAuth?.accessToken).toBe("ya29.sec");
    expect(secAuth?.refreshToken).toBeNull();

    const msAuth = parseGoogleAuth(
      JSON.stringify({
        access_token: "ya29.ms",
        expires_at: NOW + 120_000,
      }),
      NOW,
    );
    expect(msAuth?.accessToken).toBe("ya29.ms");
  });

  it("rejects malformed JSON, service-account keys, untrusted token_uri, and unusable credentials", () => {
    expect(parseGoogleAuth("not-json", NOW)).toBeNull();
    expect(parseGoogleAuth("[]", NOW)).toBeNull();
    expect(
      parseGoogleAuth(
        JSON.stringify({
          type: "service_account",
          access_token: "ya29.sa",
        }),
        NOW,
      ),
    ).toBeNull();
    expect(
      parseGoogleAuth(
        JSON.stringify({
          private_key: "-----BEGIN PRIVATE KEY-----",
          access_token: "ya29.pk",
        }),
        NOW,
      ),
    ).toBeNull();
    expect(
      parseGoogleAuth(
        JSON.stringify({
          token_uri: "https://evil.example.invalid/token",
          refresh_token: "1//r",
          client_id: "cid",
          client_secret: "cs",
        }),
        NOW,
      ),
    ).toBeNull();
    expect(
      parseGoogleAuth(
        JSON.stringify({
          token_uri: 123,
          access_token: "ya29.bad",
        }),
        NOW,
      ),
    ).toBeNull();
    expect(
      parseGoogleAuth(
        JSON.stringify({
          access_token: "ya29.null-expiry",
          expiry_date: null,
        }),
        NOW,
      ),
    ).toBeNull();
    expect(
      parseGoogleAuth(
        JSON.stringify({
          access_token: "ya29.bad-expires-at",
          expires_at: "not-a-date",
        }),
        NOW,
      ),
    ).toBeNull();
    expect(
      parseGoogleAuth(
        JSON.stringify({
          access_token: "has space",
          refresh_token: "only-refresh-without-client",
        }),
        NOW,
      ),
    ).toBeNull();
  });

  it("drops unsafe project_id strings", () => {
    const parsed = parseGoogleAuth(
      JSON.stringify({
        access_token: "ya29.ok",
        project_id: "../bad/path",
      }),
      NOW,
    );
    expect(parsed?.projectId).toBeNull();
  });
});

describe("parseGoogleTokenResponse & resolveGoogleQuotaEndpoints", () => {
  it("parses refreshed access_token and rejects malformed responses", () => {
    expect(GOOGLE_OAUTH_TOKEN_URL).toBe("https://oauth2.googleapis.com/token");
    expect(parseGoogleTokenResponse({ access_token: "ya29.refreshed" })).toBe("ya29.refreshed");
    expect(parseGoogleTokenResponse({ access_token: "ya29.bad\x00tok" })).toBeNull();
    expect(parseGoogleTokenResponse({ access_token: "  " })).toBeNull();
    expect(parseGoogleTokenResponse(null)).toBeNull();
  });

  it("prioritizes daily Cloud Code for Antigravity paths even with projectId and prod otherwise", () => {
    expect(isAntigravityAuthPath("/home/u/.gemini/antigravity-acp/acp_token.json")).toBe(true);
    expect(isAntigravityAuthPath("/home/u/.gemini/oauth_creds.json")).toBe(false);
    expect(resolveGoogleQuotaEndpoints("my-proj", false)).toEqual([
      GOOGLE_CLOUDCODE_PROD_URL,
      GOOGLE_CLOUDCODE_DAILY_URL,
    ]);
    expect(resolveGoogleQuotaEndpoints("my-proj", true)).toEqual([
      GOOGLE_CLOUDCODE_DAILY_URL,
      GOOGLE_CLOUDCODE_PROD_URL,
    ]);
    expect(resolveGoogleQuotaEndpoints(null)).toEqual([
      GOOGLE_CLOUDCODE_DAILY_URL,
      GOOGLE_CLOUDCODE_PROD_URL,
    ]);
  });
});

describe("normalizeGoogleQuotaSummary", () => {
  it("normalizes the sanitized retrieveUserQuotaSummary fixture and suppresses idle 5h placeholder reset", () => {
    const raw = JSON.parse(
      readFileSync(
        new URL("../../../tests/fixtures/google-quota-summary.json", import.meta.url),
        "utf8",
      ),
    );
    const usage = normalizeGoogleQuotaSummary(raw, NOW);

    expect(usage).toEqual({
      session: {
        usedPercent: 4,
        resetAt: Date.parse("2026-04-20T05:10:00Z") / 1000,
      },
      weekly: {
        usedPercent: 28,
        resetAt: Date.parse("2026-04-24T12:00:00Z") / 1000,
      },
      thirdPartySession: {
        usedPercent: 0,
        resetAt: null,
      },
      thirdPartyWeekly: {
        usedPercent: 15,
        resetAt: Date.parse("2026-04-25T00:00:00Z") / 1000,
      },
      limitReached: false,
    });
  });

  it("normalizes a weekly-only plan without inventing 5h windows", () => {
    const raw = JSON.parse(
      readFileSync(
        new URL("../../../tests/fixtures/google-quota-summary-weekly-only.json", import.meta.url),
        "utf8",
      ),
    );
    const usage = normalizeGoogleQuotaSummary(raw, Date.parse("2026-11-24T14:02:05Z"));

    expect(usage).toEqual({
      session: null,
      weekly: {
        usedPercent: 0,
        resetAt: null,
      },
      thirdPartySession: null,
      thirdPartyWeekly: {
        usedPercent: 100,
        resetAt: Date.parse("2026-11-25T12:21:53Z") / 1000,
      },
      limitReached: true,
    });
  });

  it("handles top-level buckets, proto3 omitted zero remainingFraction, and fallback non-exact bucket aggregation", () => {
    const usage = normalizeGoogleQuotaSummary(
      {
        buckets: [
          {
            bucketId: "gemini-pro-5h",
            window: "5h",
            remainingFraction: 0.6,
            resetTime: "2026-04-20T06:00:00Z",
          },
          {
            bucketId: "gemini-flash-5h",
            window: "5h",
            remainingFraction: 0.25,
            resetTime: "2026-04-20T05:30:00Z",
          },
          {
            bucketId: "gemini-pro-weekly",
            window: "weekly",
            remainingFraction: 0.7,
            resetTime: "2026-04-25T00:00:00Z",
          },
          {
            bucketId: "gpt-4o-5h",
            window: "5h",
            remainingFraction: 0.9,
            resetTime: "2026-04-20T07:00:00Z",
          },
          {
            bucketId: "claude-sonnet-weekly",
            window: "weekly",
            resetTime: "2026-04-25T00:00:00Z",
          },
          {
            bucketId: "disabled-bucket-5h",
            window: "5h",
            disabled: true,
            remainingFraction: 0.1,
          },
          {
            bucketId: "unknown-family",
            window: "5h",
            remainingFraction: 0.5,
          },
          {
            bucketId: "gemini-unknown-window",
            window: "monthly",
            remainingFraction: 0.5,
          },
        ],
      },
      NOW,
    );

    expect(usage).toEqual({
      session: {
        usedPercent: 75,
        resetAt: Date.parse("2026-04-20T05:30:00Z") / 1000,
      },
      weekly: {
        usedPercent: 30,
        resetAt: Date.parse("2026-04-25T00:00:00Z") / 1000,
      },
      thirdPartySession: {
        usedPercent: 10,
        resetAt: Date.parse("2026-04-20T07:00:00Z") / 1000,
      },
      thirdPartyWeekly: {
        usedPercent: 100,
        resetAt: Date.parse("2026-04-25T00:00:00Z") / 1000,
      },
      limitReached: true,
    });
  });

  it("rejects empty or invalid quota summary payloads", () => {
    expect(normalizeGoogleQuotaSummary(null, NOW)).toBeNull();
    expect(normalizeGoogleQuotaSummary({}, NOW)).toBeNull();
    expect(
      normalizeGoogleQuotaSummary(
        {
          buckets: [
            { bucketId: "gemini-5h" },
            { bucketId: "gemini-weekly", remainingFraction: 1.5 },
            { bucketId: "3p-5h", remainingFraction: -0.1 },
          ],
        },
        NOW,
      ),
    ).toBeNull();
  });
});

describe("normalizeGoogleAvailableModels", () => {
  it("aggregates Gemini and Claude/GPT model quotas across 5h and weekly windows", () => {
    const usage = normalizeGoogleAvailableModels(
      {
        models: {
          "gemini-2.5-pro": {
            modelProvider: "MODEL_PROVIDER_GOOGLE",
            quotaInfo: {
              remainingFraction: 0.8,
              resetTime: "2026-04-20T06:00:00Z",
            },
            weeklyQuotaInfo: {
              remainingFraction: 0.5,
              resetTime: "2026-04-25T00:00:00Z",
            },
          },
          "gemini-2.5-flash": {
            quotaInfo: {
              remainingFraction: 0.8,
              resetTime: "2026-04-20T05:00:00Z",
            },
          },
          "claude-sonnet-4-5": {
            modelProvider: "MODEL_PROVIDER_ANTHROPIC",
            quotaInfo: {
              remainingFraction: 0.9,
              resetTime: "2026-04-20T07:00:00Z",
            },
            weeklyQuotaInfo: {
              remainingFraction: 1,
              resetTime: "2026-04-27T03:00:00Z",
            },
          },
          "disabled-model": {
            disabled: true,
            modelProvider: "MODEL_PROVIDER_GOOGLE",
            quotaInfo: { remainingFraction: 0 },
          },
          "other-embedding": {
            modelProvider: "MODEL_PROVIDER_OTHER",
            quotaInfo: { remainingFraction: 0.5 },
          },
        },
      },
      NOW,
    );

    expect(usage).toEqual({
      session: {
        usedPercent: 20,
        resetAt: Date.parse("2026-04-20T05:00:00Z") / 1000,
      },
      weekly: {
        usedPercent: 50,
        resetAt: Date.parse("2026-04-25T00:00:00Z") / 1000,
      },
      thirdPartySession: {
        usedPercent: 10,
        resetAt: Date.parse("2026-04-20T07:00:00Z") / 1000,
      },
      thirdPartyWeekly: {
        usedPercent: 0,
        resetAt: null,
      },
      limitReached: false,
    });
  });

  it("returns null when models map is missing or empty", () => {
    expect(normalizeGoogleAvailableModels(null, NOW)).toBeNull();
    expect(normalizeGoogleAvailableModels({ models: {} }, NOW)).toBeNull();
  });
});

describe("hasActiveGoogleUsage, mergeGoogleUsage & parseGoogleTierName", () => {
  it("detects active usage and merges primary and secondary endpoint windows", () => {
    const idle = {
      session: { usedPercent: 0, resetAt: null },
      weekly: { usedPercent: 0, resetAt: null },
      thirdPartySession: null,
      thirdPartyWeekly: null,
      limitReached: false,
    };
    const active = {
      session: { usedPercent: 12, resetAt: 1776660000 },
      weekly: { usedPercent: 0, resetAt: 1777000000 },
      thirdPartySession: { usedPercent: 5, resetAt: 1776663600 },
      thirdPartyWeekly: null,
      limitReached: false,
    };

    expect(hasActiveGoogleUsage(null)).toBe(false);
    expect(hasActiveGoogleUsage(idle)).toBe(false);
    expect(hasActiveGoogleUsage(active)).toBe(true);
    expect(hasCompleteActiveGoogleUsage(null)).toBe(false);
    expect(hasCompleteActiveGoogleUsage({ ...active, thirdPartySession: null })).toBe(false);
    expect(hasCompleteActiveGoogleUsage(active)).toBe(true);

    expect(mergeGoogleUsage(null, active)).toEqual(active);
    expect(mergeGoogleUsage(active, null)).toEqual(active);
    expect(mergeGoogleUsage(idle, active)).toEqual({
      session: { usedPercent: 12, resetAt: 1776660000 },
      weekly: { usedPercent: 0, resetAt: 1777000000 },
      thirdPartySession: { usedPercent: 5, resetAt: 1776663600 },
      thirdPartyWeekly: null,
      limitReached: false,
    });
  });

  it("parses paidTier and currentTier names or IDs from loadCodeAssist", () => {
    expect(
      parseGoogleTierName({
        paidTier: { id: "g1-ultra-tier", name: "Google AI Ultra" },
        currentTier: { id: "standard-tier", name: "Gemini Code Assist" },
      }),
    ).toBe("Google AI Ultra");
    expect(
      parseGoogleTierName({
        currentTier: { id: "standard-tier", name: "Google AI Pro" },
      }),
    ).toBe("Google AI Pro");
    expect(
      parseGoogleTierName({
        paidTier: { id: "g1-pro-tier" },
      }),
    ).toBe("g1-pro-tier");
    expect(parseGoogleTierName({})).toBeNull();
    expect(parseGoogleTierName(null)).toBeNull();
  });
});
