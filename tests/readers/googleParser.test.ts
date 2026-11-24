import { readFileSync } from "node:fs";

import {
  GOOGLE_CLOUDCODE_DAILY_URL,
  GOOGLE_CLOUDCODE_PROD_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  hasActiveGoogleUsage,
  hasPresentGoogleUsage,
  hasCompleteActiveGoogleUsage,
  isAntigravityAuthPath,
  mergeGoogleUsage,
  normalizeGoogleAvailableModels,
  normalizeGoogleQuotaSummary,
  parseGoogleAuth,
  parseGoogleTier,
  parseGoogleTokenResponse,
  resolveGoogleQuotaEndpoints,
  type GoogleUsage,
  type GoogleWindowReset,
} from "../../src/readers/googleParser.js";

const NOW = Date.parse("2026-04-20T03:00:00Z");

const presentReset = (at: number) => ({ state: "present" as const, at });
const idleReset = () => ({ state: "idle" as const });
const missingReset = () => ({ state: "missing" as const });
const presentWindow = (usedPercent: number, reset: GoogleWindowReset) => ({
  state: "present" as const,
  usage: { usedPercent, reset },
});
const unreportedWindow = () => ({ state: "unreported" as const });
const disabledWindow = () => ({ state: "disabled" as const });
const malformedWindow = () => ({ state: "malformed" as const });

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
      session: presentWindow(4, presentReset(Date.parse("2026-04-20T05:10:00Z") / 1000)),
      weekly: presentWindow(28, presentReset(Date.parse("2026-04-24T12:00:00Z") / 1000)),
      thirdPartySession: presentWindow(0, idleReset()),
      thirdPartyWeekly: presentWindow(15, presentReset(Date.parse("2026-04-25T00:00:00Z") / 1000)),
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
    const usage = normalizeGoogleQuotaSummary(raw, Date.parse("2026-01-25T00:00:00Z"));

    expect(usage).toEqual({
      session: unreportedWindow(),
      weekly: presentWindow(0, idleReset()),
      thirdPartySession: unreportedWindow(),
      thirdPartyWeekly: presentWindow(100, presentReset(Date.parse("2026-01-26T00:00:00Z") / 1000)),
      limitReached: true,
    });
  });

  it("distinguishes a missing reset timestamp from an idle window", () => {
    const usage = normalizeGoogleQuotaSummary(
      {
        buckets: [
          {
            bucketId: "gemini-5h",
            window: "5h",
            remainingFraction: 0.5,
          },
        ],
      },
      NOW,
    );

    expect(usage?.session).toEqual(presentWindow(50, missingReset()));
  });

  it("records an unusable window as unavailable without changing other windows", () => {
    const usage = normalizeGoogleQuotaSummary(
      {
        buckets: [
          {
            bucketId: "gemini-5h",
            window: "5h",
            remainingFraction: 1.5,
          },
          {
            bucketId: "gemini-weekly",
            window: "weekly",
            remainingFraction: 0.5,
            resetTime: "2026-04-24T12:00:00Z",
          },
        ],
      },
      NOW,
    );

    expect(usage?.session).toEqual(malformedWindow());
    expect(usage?.weekly).toEqual(
      presentWindow(50, presentReset(Date.parse("2026-04-24T12:00:00Z") / 1000)),
    );
  });

  it("treats a recognized disabled bucket as not applicable", () => {
    const usage = normalizeGoogleQuotaSummary(
      {
        buckets: [
          {
            bucketId: "gemini-5h",
            window: "5h",
            disabled: true,
          },
          {
            bucketId: "gemini-weekly",
            window: "weekly",
            remainingFraction: 0.5,
            resetTime: "2026-04-24T12:00:00Z",
          },
        ],
      },
      NOW,
    );

    expect(usage?.session).toEqual(disabledWindow());
    expect(usage?.weekly).toEqual(
      presentWindow(50, presentReset(Date.parse("2026-04-24T12:00:00Z") / 1000)),
    );
  });

  it("keeps an all-disabled window set instead of discarding it", () => {
    const usage = normalizeGoogleQuotaSummary(
      {
        buckets: [
          { bucketId: "gemini-5h", window: "5h", disabled: true },
          { bucketId: "gemini-weekly", window: "weekly", disabled: true },
          { bucketId: "3p-5h", window: "5h", disabled: true },
          { bucketId: "3p-weekly", window: "weekly", disabled: true },
        ],
      },
      NOW,
    );

    expect(usage).toEqual({
      session: disabledWindow(),
      weekly: disabledWindow(),
      thirdPartySession: disabledWindow(),
      thirdPartyWeekly: disabledWindow(),
      limitReached: null,
    });
  });

  it("uses the same priority for exact and fallback buckets", () => {
    const cases = [
      { exact: { disabled: true }, fallback: { remainingFraction: 1.5 } },
      { exact: { remainingFraction: 1.5 }, fallback: { disabled: true } },
    ];

    for (const { exact, fallback } of cases) {
      const usage = normalizeGoogleQuotaSummary(
        {
          buckets: [
            { bucketId: "gemini-5h", window: "5h", ...exact },
            { bucketId: "gemini-pro-5h", window: "5h", ...fallback },
            {
              bucketId: "gemini-weekly",
              window: "weekly",
              remainingFraction: 0.5,
              resetTime: "2026-04-24T12:00:00Z",
            },
          ],
        },
        NOW,
      );

      expect(usage?.session).toEqual(malformedWindow());
    }
  });

  it("keeps the exact aggregate when exact and fallback are both present", () => {
    const usage = normalizeGoogleQuotaSummary(
      {
        buckets: [
          {
            bucketId: "gemini-5h",
            window: "5h",
            remainingFraction: 0.9,
            resetTime: "2026-04-20T06:00:00Z",
            description: "10% used",
          },
          {
            bucketId: "gemini-pro-5h",
            window: "5h",
            remainingFraction: 0.5,
            resetTime: "2026-04-20T06:00:00Z",
          },
        ],
      },
      NOW,
    );

    expect(usage?.session).toEqual(
      presentWindow(10, presentReset(Date.parse("2026-04-20T06:00:00Z") / 1000)),
    );
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
      session: presentWindow(75, presentReset(Date.parse("2026-04-20T05:30:00Z") / 1000)),
      weekly: presentWindow(30, presentReset(Date.parse("2026-04-25T00:00:00Z") / 1000)),
      thirdPartySession: presentWindow(10, presentReset(Date.parse("2026-04-20T07:00:00Z") / 1000)),
      thirdPartyWeekly: presentWindow(100, presentReset(Date.parse("2026-04-25T00:00:00Z") / 1000)),
      limitReached: true,
    });
  });

  it("returns null for empty payloads and keeps invalid buckets as malformed", () => {
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
    ).toEqual({
      session: malformedWindow(),
      weekly: malformedWindow(),
      thirdPartySession: malformedWindow(),
      thirdPartyWeekly: unreportedWindow(),
      limitReached: null,
    });
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
      session: presentWindow(20, presentReset(Date.parse("2026-04-20T05:00:00Z") / 1000)),
      weekly: presentWindow(50, presentReset(Date.parse("2026-04-25T00:00:00Z") / 1000)),
      thirdPartySession: presentWindow(10, presentReset(Date.parse("2026-04-20T07:00:00Z") / 1000)),
      thirdPartyWeekly: presentWindow(0, idleReset()),
      limitReached: false,
    });
  });

  it("keeps valid model windows and marks unusable quotas", () => {
    const usage = normalizeGoogleAvailableModels(
      {
        models: {
          "gemini-bad": {
            modelProvider: "MODEL_PROVIDER_GOOGLE",
            quotaInfo: { remainingFraction: 1.5 },
          },
          "gemini-good": {
            modelProvider: "MODEL_PROVIDER_GOOGLE",
            quotaInfo: {
              remainingFraction: 0.6,
              resetTime: "2026-04-20T06:00:00Z",
            },
            weeklyQuotaInfo: {
              remainingFraction: 0.5,
              resetTime: "2026-04-25T00:00:00Z",
            },
          },
          "claude-bad": {
            modelProvider: "MODEL_PROVIDER_ANTHROPIC",
            quotaInfo: { remainingFraction: -0.1 },
          },
        },
      },
      NOW,
    );

    expect(usage?.session).toEqual(
      presentWindow(40, presentReset(Date.parse("2026-04-20T06:00:00Z") / 1000)),
    );
    expect(usage?.weekly).toEqual(
      presentWindow(50, presentReset(Date.parse("2026-04-25T00:00:00Z") / 1000)),
    );
    expect(usage?.thirdPartySession).toEqual(malformedWindow());
    expect(usage?.thirdPartyWeekly).toEqual(unreportedWindow());
  });

  it("returns null when models map is missing or empty", () => {
    expect(normalizeGoogleAvailableModels(null, NOW)).toBeNull();
    expect(normalizeGoogleAvailableModels({ models: {} }, NOW)).toBeNull();
  });
});

describe("hasActiveGoogleUsage, mergeGoogleUsage & parseGoogleTier", () => {
  it("detects active usage and merges primary and secondary endpoint windows", () => {
    const idle: GoogleUsage = {
      session: presentWindow(0, idleReset()),
      weekly: presentWindow(0, idleReset()),
      thirdPartySession: unreportedWindow(),
      thirdPartyWeekly: unreportedWindow(),
      limitReached: false,
    };
    const active: GoogleUsage = {
      session: presentWindow(12, presentReset(1776660000)),
      weekly: presentWindow(0, presentReset(1777000000)),
      thirdPartySession: presentWindow(5, presentReset(1776663600)),
      thirdPartyWeekly: unreportedWindow(),
      limitReached: false,
    };

    expect(hasActiveGoogleUsage(null)).toBe(false);
    expect(hasActiveGoogleUsage(idle)).toBe(false);
    expect(hasActiveGoogleUsage(active)).toBe(true);
    expect(hasPresentGoogleUsage(null)).toBe(false);
    expect(hasPresentGoogleUsage(idle)).toBe(true);
    expect(hasCompleteActiveGoogleUsage(null)).toBe(false);
    expect(hasCompleteActiveGoogleUsage({ ...active, thirdPartySession: unreportedWindow() })).toBe(
      false,
    );
    expect(hasCompleteActiveGoogleUsage(active)).toBe(true);

    expect(mergeGoogleUsage(null, active)).toEqual(active);
    expect(mergeGoogleUsage(active, null)).toEqual(active);
    expect(mergeGoogleUsage(idle, active)).toEqual({
      session: presentWindow(12, presentReset(1776660000)),
      weekly: presentWindow(0, presentReset(1777000000)),
      thirdPartySession: presentWindow(5, presentReset(1776663600)),
      thirdPartyWeekly: unreportedWindow(),
      limitReached: false,
    });
  });

  it("prefers idle over missing reset provenance independently of merge order", () => {
    const idleUsage: GoogleUsage = {
      session: presentWindow(10, idleReset()),
      weekly: unreportedWindow(),
      thirdPartySession: unreportedWindow(),
      thirdPartyWeekly: unreportedWindow(),
      limitReached: false,
    };
    const missingUsage: GoogleUsage = {
      ...idleUsage,
      session: presentWindow(10, missingReset()),
    };

    expect(mergeGoogleUsage(idleUsage, missingUsage)?.session).toEqual(
      presentWindow(10, idleReset()),
    );
    expect(mergeGoogleUsage(missingUsage, idleUsage)?.session).toEqual(
      presentWindow(10, idleReset()),
    );
  });

  it("prefers a valid window over an unavailable one independently of merge order", () => {
    const valid: GoogleUsage = {
      session: presentWindow(10, presentReset(1776660000)),
      weekly: unreportedWindow(),
      thirdPartySession: unreportedWindow(),
      thirdPartyWeekly: unreportedWindow(),
      limitReached: false,
    };
    const malformed: GoogleUsage = { ...valid, session: malformedWindow() };

    expect(mergeGoogleUsage(valid, malformed)?.session).toEqual(
      presentWindow(10, presentReset(1776660000)),
    );
    expect(mergeGoogleUsage(malformed, valid)?.session).toEqual(
      presentWindow(10, presentReset(1776660000)),
    );
  });

  it("parses the captured Starter tier capability", () => {
    const raw = JSON.parse(
      readFileSync(
        new URL("../../../tests/fixtures/google-tier-starter.json", import.meta.url),
        "utf8",
      ),
    );
    expect(parseGoogleTier(raw)).toEqual({
      id: "free-tier",
      name: "Antigravity Starter Quota",
      supportsFiveHourWindows: false,
    });
  });

  it("parses paidTier and currentTier names or IDs from loadCodeAssist", () => {
    expect(
      parseGoogleTier({
        paidTier: { id: "g1-ultra-tier", name: "Google AI Ultra" },
        currentTier: { id: "standard-tier", name: "Gemini Code Assist" },
      }),
    ).toEqual({ id: "g1-ultra-tier", name: "Google AI Ultra", supportsFiveHourWindows: true });
    expect(
      parseGoogleTier({
        currentTier: { id: "standard-tier", name: "Google AI Pro" },
      }),
    ).toEqual({ id: "standard-tier", name: "Google AI Pro", supportsFiveHourWindows: true });
    expect(
      parseGoogleTier({
        paidTier: { id: "g1-pro-tier" },
      }),
    ).toEqual({ id: "g1-pro-tier", name: null, supportsFiveHourWindows: true });
    expect(parseGoogleTier({})).toBeNull();
    expect(parseGoogleTier(null)).toBeNull();
    expect(
      parseGoogleTier({
        paidTier: { id: "free-tier", name: "Antigravity Starter Quota" },
        currentTier: { id: "free-tier", name: "Antigravity" },
      }),
    ).toEqual({
      id: "free-tier",
      name: "Antigravity Starter Quota",
      supportsFiveHourWindows: false,
    });
    expect(parseGoogleTier({ currentTier: { name: "Google AI Pro" } })).toEqual({
      id: null,
      name: "Google AI Pro",
      supportsFiveHourWindows: true,
    });
    expect(
      parseGoogleTier({
        paidTier: { name: "Google AI Pro" },
        currentTier: { id: "free-tier", name: "Antigravity" },
      }),
    ).toEqual({
      id: "free-tier",
      name: "Google AI Pro",
      supportsFiveHourWindows: false,
    });
    expect(
      parseGoogleTier({
        paidTier: { id: "free-tier" },
        currentTier: { name: "Google AI Pro" },
      }),
    ).toEqual({
      id: "free-tier",
      name: "Google AI Pro",
      supportsFiveHourWindows: false,
    });
  });
});
