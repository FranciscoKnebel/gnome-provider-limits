import Gio from "gi://Gio";

import { assertEqual } from "../helpers/assert.js";

function encodeJson(value) {
  return [new TextEncoder().encode(JSON.stringify(value))];
}

export async function run() {
  const { GoogleReader } = await import("../../dist/readers/google.js");
  const { HttpError, TokenError, RateLimitError, NetworkError } =
    await import("../../dist/helpers/http.js");
  const results = [];
  const originalLoad = Gio.File.prototype.load_contents_async;

  const test = async (name, body) => {
    try {
      await body();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: String(error) });
    } finally {
      Gio.File.prototype.load_contents_async = originalLoad;
    }
  };

  const newReader = (http, path = "/mock/google-oauth.json") => {
    const reader = new GoogleReader({ get_string: () => path }, "google");
    reader._http = {
      postForm: async () => ({}),
      postJson: async () => ({}),
      destroy() {},
      ...http,
    };
    return reader;
  };

  await test("GoogleReader refreshes expired OAuth token and reads quota summary + plan tier", async () => {
    Gio.File.prototype.load_contents_async = async function () {
      assertEqual(this.get_path(), "/mock/google-oauth.json");
      return encodeJson({
        access_token: "ya29.expired",
        expiry_date: 1000,
        refresh_token: "1//refresh-token",
        client_id: "cid.apps.googleusercontent.com",
        client_secret: "GOCSPX-secret",
      });
    };

    const urls = [];
    const reader = newReader({
      postForm: async (url, form, options) => {
        urls.push(url);
        assertEqual(url, "https://oauth2.googleapis.com/token");
        assertEqual(options.noRedirect, true);
        assertEqual(form.grant_type, "refresh_token");
        assertEqual(form.refresh_token, "1//refresh-token");
        return { access_token: "ya29.fresh-token" };
      },
      postJson: async (url, body, options) => {
        urls.push(url);
        assertEqual(options.noRedirect, true);
        assertEqual(options.headers.Authorization, "Bearer ya29.fresh-token");
        if (url.endsWith("/v1internal:retrieveUserQuotaSummary")) {
          assertEqual(JSON.stringify(body), "{}");
          return {
            groups: [
              {
                groupId: "gemini",
                buckets: [
                  {
                    bucketId: "gemini-5h",
                    window: "5h",
                    remainingFraction: 0.9,
                    resetTime: "2026-04-20T08:00:00Z",
                    description: "10% used",
                  },
                  {
                    bucketId: "gemini-weekly",
                    window: "weekly",
                    remainingFraction: 0.75,
                    resetTime: "2026-04-25T00:00:00Z",
                    description: "25% used",
                  },
                ],
              },
              {
                groupId: "3p",
                buckets: [
                  {
                    bucketId: "3p-5h",
                    window: "5h",
                    remainingFraction: 0.8,
                    resetTime: "2026-04-20T08:00:00Z",
                    description: "20% used",
                  },
                  {
                    bucketId: "3p-weekly",
                    window: "weekly",
                    remainingFraction: 0.6,
                    resetTime: "2026-04-25T00:00:00Z",
                    description: "40% used",
                  },
                ],
              },
            ],
          };
        }
        assertEqual(url.endsWith("/v1internal:loadCodeAssist"), true);
        return {
          paidTier: { id: "g1-ultra-tier", name: "Google AI Ultra" },
        };
      },
    });

    const result = await reader.read();
    const value = (name) => result.fields.find((f) => f.name === name)?.value;
    assertEqual(result.status, "ok");
    assertEqual(urls.length, 3);
    assertEqual(value("used_percent_session"), 10);
    assertEqual(value("remaining_percent_session"), 90);
    assertEqual(value("used_percent_weekly"), 25);
    assertEqual(value("used_percent_3p_session"), 20);
    assertEqual(value("used_percent_3p_weekly"), 40);
    assertEqual(value("limit_reached"), false);
    assertEqual(value("plan_type"), "Google AI Ultra");
    assertEqual(value("usage_source"), "daily-cloudcode-pa.googleapis.com");
    reader.destroy();
  });

  await test("GoogleReader reports weekly-only plans with not-applicable 5h fields", async () => {
    const weeklyReset = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    Gio.File.prototype.load_contents_async = async () =>
      encodeJson({
        access_token: "ya29.live",
        expiry_date: Date.now() + 3600_000,
      });

    const urls = [];
    const reader = newReader({
      postJson: async (url) => {
        urls.push(url);
        if (url.endsWith("/v1internal:retrieveUserQuotaSummary")) {
          return {
            groups: [
              {
                buckets: [
                  {
                    bucketId: "gemini-weekly",
                    window: "weekly",
                    remainingFraction: 1,
                    resetTime: weeklyReset,
                  },
                  {
                    bucketId: "3p-weekly",
                    window: "weekly",
                    remainingFraction: 0,
                    resetTime: "2026-01-26T00:00:00Z",
                    description: "You have hit your weekly limit.",
                  },
                ],
              },
            ],
          };
        }
        if (url.endsWith("/v1internal:loadCodeAssist")) {
          return {
            paidTier: { id: "free-tier", name: "Antigravity Starter Quota" },
          };
        }
        throw new Error(`unexpected URL ${url}`);
      },
    });

    const result = await reader.read();
    const value = (name) => result.fields.find((f) => f.name === name)?.value;
    const status = (name) => result.fields.find((f) => f.name === name)?.status;
    assertEqual(result.status, "ok");
    assertEqual(result.lastError, undefined);
    assertEqual(urls.length, 2);
    assertEqual(value("used_percent_weekly"), 0);
    assertEqual(value("remaining_percent_weekly"), 100);
    assertEqual(value("used_percent_3p_weekly"), 100);
    assertEqual(value("limit_reached"), true);
    assertEqual(value("plan_type"), "Antigravity Starter Quota");
    assertEqual(status("used_percent_session"), "not_applicable");
    assertEqual(status("reset_at_session"), "not_applicable");
    assertEqual(status("used_percent_3p_session"), "not_applicable");
    assertEqual(status("reset_at_3p_session"), "not_applicable");
    assertEqual(status("reset_at_weekly"), "not_applicable");
    reader.destroy();
  });

  await test("GoogleReader keeps an active window with a missing reset timestamp partial", async () => {
    Gio.File.prototype.load_contents_async = async () =>
      encodeJson({
        access_token: "ya29.live",
        expiry_date: Date.now() + 3600_000,
      });

    const reader = newReader({
      postJson: async (url) => {
        if (url.endsWith("/v1internal:retrieveUserQuotaSummary")) {
          return {
            buckets: [
              {
                bucketId: "gemini-5h",
                window: "5h",
                remainingFraction: 0.5,
              },
            ],
          };
        }
        if (url.endsWith("/v1internal:loadCodeAssist")) {
          return { paidTier: { name: "Google AI Pro" } };
        }
        throw new Error(`unexpected URL ${url}`);
      },
    });

    const result = await reader.read();
    const field = (name) => result.fields.find((f) => f.name === name);
    assertEqual(result.status, "partial");
    assertEqual(field("used_percent_session")?.value, 50);
    assertEqual(field("reset_at_session")?.status, "unavailable");
    reader.destroy();
  });

  await test("GoogleReader reports a malformed window as unavailable without hiding valid data", async () => {
    Gio.File.prototype.load_contents_async = async () =>
      encodeJson({
        access_token: "ya29.live",
        expiry_date: Date.now() + 3600_000,
      });

    const reader = newReader({
      postJson: async (url) => {
        if (url.endsWith("/v1internal:retrieveUserQuotaSummary")) {
          return {
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
          };
        }
        if (url.endsWith("/v1internal:loadCodeAssist")) {
          return { paidTier: { name: "Google AI Pro" } };
        }
        throw new Error(`unexpected URL ${url}`);
      },
    });

    const result = await reader.read();
    const field = (name) => result.fields.find((f) => f.name === name);
    assertEqual(result.status, "partial");
    assertEqual(field("used_percent_session")?.status, "unavailable");
    assertEqual(field("used_percent_weekly")?.value, 50);
    reader.destroy();
  });

  await test("GoogleReader treats a disabled window as not applicable", async () => {
    Gio.File.prototype.load_contents_async = async () =>
      encodeJson({
        access_token: "ya29.live",
        expiry_date: Date.now() + 3600_000,
      });

    const reader = newReader({
      postJson: async (url) => {
        if (url.endsWith("/v1internal:retrieveUserQuotaSummary")) {
          return {
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
          };
        }
        if (url.endsWith("/v1internal:loadCodeAssist")) {
          return { paidTier: { name: "Google AI Pro" } };
        }
        throw new Error(`unexpected URL ${url}`);
      },
    });

    const result = await reader.read();
    const field = (name) => result.fields.find((f) => f.name === name);
    assertEqual(result.status, "partial");
    assertEqual(field("used_percent_session")?.status, "not_applicable");
    assertEqual(field("used_percent_weekly")?.value, 50);
    reader.destroy();
  });

  await test("GoogleReader reports an all-disabled window set as not applicable", async () => {
    Gio.File.prototype.load_contents_async = async () =>
      encodeJson({
        access_token: "ya29.live",
        expiry_date: Date.now() + 3600_000,
      });

    const reader = newReader({
      postJson: async (url) => {
        if (url.endsWith("/v1internal:retrieveUserQuotaSummary")) {
          return {
            buckets: [
              { bucketId: "gemini-5h", window: "5h", disabled: true },
              { bucketId: "gemini-weekly", window: "weekly", disabled: true },
              { bucketId: "3p-5h", window: "5h", disabled: true },
              { bucketId: "3p-weekly", window: "weekly", disabled: true },
            ],
          };
        }
        if (url.endsWith("/v1internal:loadCodeAssist")) {
          return { paidTier: { id: "standard-tier", name: "Google AI Pro" } };
        }
        throw new Error(`unexpected URL ${url}`);
      },
    });

    const result = await reader.read();
    const field = (name) => result.fields.find((f) => f.name === name);
    assertEqual(result.status, "ok");
    for (const name of [
      "used_percent_session",
      "used_percent_weekly",
      "used_percent_3p_session",
      "used_percent_3p_weekly",
    ]) {
      assertEqual(field(name)?.status, "not_applicable");
    }
    reader.destroy();
  });

  await test("GoogleReader falls back to fetchAvailableModels and merges secondary endpoint when primary is idle", async () => {
    Gio.File.prototype.load_contents_async = async () =>
      encodeJson({
        access_token: "ya29.live",
        expiry_date: Date.now() + 3600_000,
        project_id: "my-companion-proj",
      });

    const reader = newReader({
      postJson: async (url) => {
        if (url === "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary") {
          throw new NetworkError("summary unavailable");
        }
        if (url === "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels") {
          return {
            models: {
              "gemini-2.5-pro": {
                modelProvider: "MODEL_PROVIDER_GOOGLE",
                quotaInfo: { remainingFraction: 1, resetTime: "2026-04-20T08:00:00Z" },
              },
            },
          };
        }
        if (
          url === "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary"
        ) {
          return {
            buckets: [
              {
                bucketId: "gemini-5h",
                window: "5h",
                remainingFraction: 0.65,
                resetTime: "2026-04-20T06:00:00Z",
                description: "35% used",
              },
            ],
          };
        }
        return { currentTier: { id: "standard-tier", name: "Google AI Pro" } };
      },
    });

    const result = await reader.read();
    const value = (name) => result.fields.find((f) => f.name === name)?.value;
    assertEqual(result.status, "partial");
    assertEqual(value("used_percent_session"), 35);
    assertEqual(value("plan_type"), "Google AI Pro");
    assertEqual(value("usage_source"), "daily-cloudcode-pa.googleapis.com");
    reader.destroy();
  });

  await test("GoogleReader retries with OAuth refresh when direct access_token is rejected", async () => {
    Gio.File.prototype.load_contents_async = async () =>
      encodeJson({
        access_token: "ya29.revoked",
        expiry_date: Date.now() + 3600_000,
        refresh_token: "1//backup-refresh",
        client_id: "cid",
        client_secret: "csecret",
      });

    let quotaCalls = 0;
    const reader = newReader({
      postForm: async () => ({ access_token: "ya29.recovered" }),
      postJson: async (url, _body, options) => {
        if (url.endsWith("/v1internal:retrieveUserQuotaSummary")) {
          quotaCalls++;
          if (quotaCalls === 1) {
            assertEqual(options.headers.Authorization, "Bearer ya29.revoked");
            throw new TokenError("HTTP 401", 401);
          }
          assertEqual(options.headers.Authorization, "Bearer ya29.recovered");
          return {
            buckets: [
              {
                bucketId: "gemini-5h",
                window: "5h",
                remainingFraction: 0.5,
                resetTime: "2026-04-20T06:00:00Z",
                description: "50% used",
              },
            ],
          };
        }
        return { paidTier: { name: "Google AI Ultra" } };
      },
    });

    const result = await reader.read();
    assertEqual(result.status, "partial");
    assertEqual(quotaCalls, 2);
    assertEqual(result.fields.find((f) => f.name === "used_percent_session")?.value, 50);
    reader.destroy();
  });

  await test("GoogleReader rejects untrusted token_uri and service-account files without network calls", async () => {
    for (const badAuth of [
      {
        token_uri: "https://attacker.example.invalid/token",
        refresh_token: "1//r",
        client_id: "cid",
        client_secret: "cs",
      },
      {
        type: "service_account",
        private_key: "secret",
        access_token: "ya29.sa",
      },
    ]) {
      Gio.File.prototype.load_contents_async = async () => encodeJson(badAuth);
      let calls = 0;
      const reader = newReader({
        postForm: async () => {
          calls++;
          return {};
        },
        postJson: async () => {
          calls++;
          return {};
        },
      });
      const result = await reader.read();
      assertEqual(result.status, "error");
      assertEqual(calls, 0);
      reader.destroy();
    }
  });

  await test("GoogleReader sanitizes failures, serves last-known-good, and cleans up on destroy", async () => {
    Gio.File.prototype.load_contents_async = async () =>
      encodeJson({
        access_token: "ya29.ok",
        expiry_date: Date.now() + 3600_000,
      });

    let failAll = false;
    const reader = newReader({
      postJson: async (url) => {
        if (url.endsWith("/v1internal:loadCodeAssist")) throw new Error("tier down");
        if (!failAll) {
          return {
            buckets: [
              {
                bucketId: "gemini-5h",
                window: "5h",
                remainingFraction: 0.78,
                resetTime: "2026-04-20T06:00:00Z",
                description: "22% used",
              },
              {
                bucketId: "3p-5h",
                window: "5h",
                remainingFraction: 0.9,
                resetTime: "2026-04-20T06:00:00Z",
                description: "10% used",
              },
            ],
          };
        }
        throw new RateLimitError("secret-google-error");
      },
    });

    const first = await reader.read();
    assertEqual(first.status, "partial");
    assertEqual(first.fields.find((f) => f.name === "used_percent_session")?.value, 22);

    failAll = true;
    const second = await reader.read();
    assertEqual(second.status, "partial");
    assertEqual(second.pathsTried.includes("last-known-good"), true);
    assertEqual(second.lastError.includes("secret-google-error"), false);

    let destroyed = false;
    reader._http.destroy = () => {
      destroyed = true;
    };
    reader.destroy();
    assertEqual(destroyed, true);
    assertEqual(reader._http, null);
  });

  await test("GoogleReader skips invalid refresh grants before and after a 401", async () => {
    for (const initialAccess of [false, true]) {
      Gio.File.prototype.load_contents_async = async function () {
        const path = this.get_path();
        if (path.endsWith("/oauth_creds.json")) {
          return encodeJson({
            ...(initialAccess ? { access_token: "stale", expiry_date: Date.now() + 3600000 } : {}),
            refresh_token: "revoked",
            client_id: "client",
            client_secret: "secret",
          });
        }
        if (path.endsWith("/antigravity-acp/acp_token.json")) {
          return encodeJson({ access_token: "valid", expiry_date: Date.now() + 3600000 });
        }
        throw new Error("missing candidate");
      };
      let refreshes = 0;
      const reader = newReader(
        {
          postForm: async () => {
            refreshes++;
            throw new HttpError("HTTP 400", 400, { error: "invalid_grant" });
          },
          postJson: async (url, _body, options) => {
            if (options.headers.Authorization === "Bearer stale")
              throw new TokenError("HTTP 401", 401);
            if (url.endsWith("/v1internal:loadCodeAssist")) return {};
            return {
              models: {
                "gemini-2.5-pro": {
                  modelProvider: "MODEL_PROVIDER_GOOGLE",
                  quotaInfo: { remainingFraction: 0.6 },
                },
              },
            };
          },
        },
        "",
      );
      const result = await reader.read();
      assertEqual(refreshes, 1);
      assertEqual(result.fields.find((field) => field.name === "used_percent_session")?.value, 40);
      reader.destroy();
    }
  });

  await test("GoogleReader falls back across 403 RPC/hosts, multi-candidate auth files, and cancels superseded reads", async () => {
    // 1. Multi-candidate fallback + HTTP 403 fallback across RPCs and hosts
    Gio.File.prototype.load_contents_async = async function () {
      const p = this.get_path();
      if (p.endsWith("/oauth_creds.json")) {
        // Stale Gemini CLI token without client_secret -> gets 401 and falls through to Antigravity token!
        return encodeJson({
          access_token: "ya29.stale-gemini-cli",
          expiry_date: Date.now() + 3600_000,
        });
      }
      if (p.endsWith("/antigravity-acp/acp_token.json")) {
        return encodeJson({
          access_token: "ya29.antigravity-valid",
          expiry_date: Date.now() + 3600_000,
          project_id: "companion-proj",
        });
      }
      throw new Error("missing candidate");
    };

    const fallbackReader = newReader(
      {
        postJson: async (url, _body, options) => {
          if (options.headers.Authorization === "Bearer ya29.stale-gemini-cli") {
            throw new TokenError("HTTP 401", 401);
          }
          if (url.startsWith("https://daily-cloudcode-pa.googleapis.com")) {
            throw new TokenError("HTTP 403 host-scoped", 403);
          }
          if (url === "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary") {
            throw new TokenError("HTTP 403 rpc-scoped", 403);
          }
          if (url === "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels") {
            return {
              models: {
                "gemini-2.5-pro": {
                  modelProvider: "MODEL_PROVIDER_GOOGLE",
                  quotaInfo: {
                    remainingFraction: 0.6,
                    resetTime: "2026-04-20T08:00:00Z",
                    description: "40% used",
                  },
                },
              },
            };
          }
          return { paidTier: { name: "Google AI Pro" } };
        },
      },
      "",
    );

    const recovered = await fallbackReader.read();
    assertEqual(recovered.status, "partial");
    assertEqual(recovered.fields.find((f) => f.name === "used_percent_session")?.value, 40);
    assertEqual(
      recovered.fields.find((f) => f.name === "usage_source")?.value,
      "cloudcode-pa.googleapis.com",
    );
    fallbackReader.destroy();

    // 2. Concurrent read cancellation
    Gio.File.prototype.load_contents_async = async () =>
      encodeJson({
        access_token: "ya29.concurrent",
        expiry_date: Date.now() + 3600_000,
      });

    let markFirstInFlight;
    const firstInFlight = new Promise((resolve) => {
      markFirstInFlight = resolve;
    });
    let releaseFirst;
    const firstBlocked = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let summaryCalls = 0;
    const concurrentReader = newReader({
      postJson: async (url, _body, options) => {
        if (url.endsWith("/v1internal:loadCodeAssist")) {
          return { paidTier: { name: "Google AI Ultra" } };
        }
        summaryCalls++;
        if (summaryCalls === 1) {
          options.cancellable.connect(() => releaseFirst());
          markFirstInFlight();
          await firstBlocked;
          return {
            buckets: [
              {
                bucketId: "gemini-5h",
                window: "5h",
                remainingFraction: 0.01,
                resetTime: "2026-04-20T08:00:00Z",
                description: "99%",
              },
              {
                bucketId: "3p-5h",
                window: "5h",
                remainingFraction: 0.5,
                resetTime: "2026-04-20T08:00:00Z",
                description: "50%",
              },
            ],
          };
        }
        return {
          buckets: [
            {
              bucketId: "gemini-5h",
              window: "5h",
              remainingFraction: 0.85,
              resetTime: "2026-04-20T08:00:00Z",
              description: "15%",
            },
            {
              bucketId: "3p-5h",
              window: "5h",
              remainingFraction: 0.9,
              resetTime: "2026-04-20T08:00:00Z",
              description: "10%",
            },
          ],
        };
      },
    });

    const p1 = concurrentReader.read();
    await firstInFlight;
    const p2 = concurrentReader.read();
    const [r1, r2] = await Promise.all([p1, p2]);
    assertEqual(r1.status, "error");
    assertEqual(r2.fields.find((f) => f.name === "used_percent_session")?.value, 15);
    concurrentReader.destroy();
  });

  return results;
}
