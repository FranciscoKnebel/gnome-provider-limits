import { test } from "node:test";

import { assert, gio, load } from "../helpers/node-harness.mjs";

for (const phase of ["auth", "billing", "settings"])
  test(`Grok destruction during ${phase} prevents further requests`, async () => {
    let release;
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    let requests = 0;
    let clients = 0;
    let destroyed = 0;
    const K = load("src/readers/grok.ts", "GrokReader", {
      GROK_FIELDS: [],
      Gio: {
        ...gio,
        File: {
          prototype: {},
          new_for_path: () => ({
            load_contents_async: async () => {
              if (phase === "auth") await waiting;
              return [new TextEncoder().encode("synthetic")];
            },
          }),
        },
      },
      GLib: { getenv: () => null, get_home_dir: () => "/synthetic" },
      BaseReader: class {
        destroy() {}
        _lastGoodOrError() {
          return {};
        }
      },
      HttpClient: class {
        constructor() {
          clients++;
        }
        destroy() {
          destroyed++;
        }
        async getJson(url) {
          requests++;
          if (
            (phase === "billing" && url.includes("billing")) ||
            (phase === "settings" && url.includes("settings"))
          )
            await waiting;
          return {};
        }
      },
      parseGrokAuth: () => ({ token: "synthetic" }),
      normalizeGrokUsagePayload: () => ({ usedPercent: 1 }),
      logWarn() {},
      _: (s) => s,
      TokenError: class {},
    });
    const reader = new K();
    reader.settings = { get_string: () => "" };
    const pending = reader.read();
    const settled = Promise.allSettled([pending]);
    await new Promise((resolve) => setImmediate(resolve));
    const before = requests;
    reader.destroy();
    release();
    await settled;
    assert.equal(requests, before);
    assert.equal(reader._http, null);
    assert.equal(clients, phase === "auth" ? 0 : 1);
    assert.equal(destroyed, clients);
    await assert.rejects(reader.read());
  });

for (const phase of ["auth", "exchange", "usage", "plan"])
  test(`Cursor destruction during ${phase} prevents further requests`, async () => {
    let release;
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    let requests = 0;
    let clients = 0;
    let destroyed = 0;
    const K = load("src/readers/cursor.ts", "CursorReader", {
      CURSOR_FIELDS: [],
      Gio: {
        ...gio,
        File: {
          prototype: {},
          new_for_path: () => ({
            load_contents_async: async () => {
              if (phase === "auth") await waiting;
              return [new TextEncoder().encode("synthetic")];
            },
          }),
        },
      },
      GLib: { getenv: () => null, get_home_dir: () => "/synthetic" },
      BaseReader: class {
        destroy() {}
        _lastGoodOrError() {
          return {};
        }
      },
      HttpClient: class {
        constructor() {
          clients++;
        }
        destroy() {
          destroyed++;
        }
        async postJson(url) {
          requests++;
          if (
            (phase === "exchange" && url.includes("exchange_user_api_key")) ||
            (phase === "usage" && url.includes("GetCurrentPeriodUsage")) ||
            (phase === "plan" && url.includes("GetPlanInfo"))
          )
            await waiting;
          return { accessToken: "synthetic-token" };
        }
      },
      CURSOR_BACKEND_URL: "https://api2.cursor.sh",
      expandHomePath: (p) => p,
      resolveCursorAuthPaths: () => ["/synthetic/auth.json"],
      parseCursorAuth: () => ({ accessToken: null, apiKey: "synthetic-key" }),
      parseCursorEnvAuth: () => null,
      parseCursorExchangeResponse: () => "synthetic-token",
      normalizeCursorUsagePayload: () => ({ usedPercentCredits: 10 }),
      parseCursorPlanInfo: () => ({ planName: "Pro", resetAt: null }),
      FieldStatus: { OK: "ok", UNAVAILABLE: "unavailable", NOT_APPLICABLE: "not_applicable" },
      logWarn() {},
      _: (s) => s,
      TokenError: class {},
    });
    const reader = new K();
    reader.settings = { get_string: () => "/synthetic/auth.json" };
    const pending = reader.read();
    const settled = Promise.allSettled([pending]);
    await new Promise((resolve) => setImmediate(resolve));
    const before = requests;
    reader.destroy();
    release();
    await settled;
    assert.equal(requests, before);
    assert.equal(reader._http, null);
    assert.equal(clients, phase === "auth" ? 0 : 1);
    assert.equal(destroyed, clients);
    await assert.rejects(reader.read());
  });

for (const phase of ["auth", "refresh", "quota", "tier"])
  test(`GoogleReader.destroy stops mid-flight ${phase} reads before later requests`, async () => {
    let release;
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    let requests = 0;
    let clients = 0;
    let destroyed = 0;
    const K = load("src/readers/google.ts", "GoogleReader", {
      GOOGLE_FIELDS: [],
      Gio: {
        _promisify() {},
        Cancellable: class {
          cancelled = false;
          cancel() {
            this.cancelled = true;
          }
          is_cancelled() {
            return this.cancelled;
          }
        },
        File: {
          new_for_path: () => ({
            load_contents_async: async () => {
              if (phase === "auth") await waiting;
              return [
                new TextEncoder().encode(
                  JSON.stringify({
                    refresh_token: "synthetic-refresh",
                    client_id: "synthetic-client",
                    client_secret: "synthetic-secret",
                  }),
                ),
              ];
            },
          }),
        },
      },
      GLib: {
        getenv: () => null,
        get_home_dir: () => "/home/tester",
        build_filenamev: (parts) => parts.join("/"),
      },
      BaseReader: class {
        destroy() {}
        _lastGoodOrError() {
          return {};
        }
        _errorResult() {
          return {};
        }
      },
      HttpClient: class {
        constructor() {
          clients++;
        }
        destroy() {
          destroyed++;
        }
        async postForm() {
          requests++;
          if (phase === "refresh") await waiting;
          return { access_token: "synthetic-access" };
        }
        async postJson(url) {
          requests++;
          if (
            (phase === "quota" && url.includes("retrieveUserQuotaSummary")) ||
            (phase === "tier" && url.includes("loadCodeAssist"))
          )
            await waiting;
          return {};
        }
      },
      GOOGLE_OAUTH_TOKEN_URL: "https://oauth2.googleapis.com/token",
      expandHomePath: (p) => p,
      resolveGoogleAuthPaths: () => ["/synthetic/oauth_creds.json"],
      parseGoogleAuth: () => ({
        accessToken: null,
        refreshToken: "synthetic-refresh",
        clientId: "synthetic-client",
        clientSecret: "synthetic-secret",
        projectId: "synthetic-proj",
      }),
      parseGoogleTokenResponse: () => "synthetic-access",
      resolveGoogleQuotaEndpoints: () => ["https://cloudcode-pa.googleapis.com"],
      normalizeGoogleQuotaSummary: () => ({
        session: { usedPercent: 15, resetAt: 1776000000 },
        weekly: null,
        thirdPartySession: null,
        thirdPartyWeekly: null,
        limitReached: false,
      }),
      normalizeGoogleAvailableModels: () => null,
      hasActiveGoogleUsage: () => true,
      mergeGoogleUsage: (_a, b) => b,
      parseGoogleTierName: () => "Google AI Ultra",
      FieldStatus: { OK: "ok", UNAVAILABLE: "unavailable", NOT_APPLICABLE: "not_applicable" },
      logWarn() {},
      _: (s) => s,
      TokenError: class {},
    });
    const reader = new K();
    reader.settings = { get_string: () => "/synthetic/oauth_creds.json" };
    const pending = reader.read();
    const settled = Promise.allSettled([pending]);
    await new Promise((resolve) => setImmediate(resolve));
    const before = requests;
    reader.destroy();
    release();
    await settled;
    assert.equal(requests, before);
    assert.equal(reader._http, null);
    assert.equal(clients, phase === "auth" ? 0 : 1);
    assert.equal(destroyed, clients);
    await assert.rejects(reader.read());
  });
