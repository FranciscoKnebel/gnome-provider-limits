import Gio from "gi://Gio";

import { assertEqual } from "../helpers/assert.js";

function encodeJson(value) {
  return [new TextEncoder().encode(JSON.stringify(value))];
}

export async function run() {
  const { CursorReader } = await import("../../dist/readers/cursor.js");
  const { TokenError, RateLimitError, NetworkError } = await import("../../dist/helpers/http.js");
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

  const newReader = (postJson, path = "/mock/cursor-auth.json") => {
    const reader = new CursorReader({ get_string: () => path }, "cursor");
    reader._http = { postJson, destroy() {} };
    return reader;
  };

  await test("CursorReader exchanges SDK apiKey and reads subscription credits", async () => {
    Gio.File.prototype.load_contents_async = async function () {
      assertEqual(this.get_path(), "/mock/cursor-auth.json");
      return encodeJson({
        version: 1,
        backendUrl: "https://api2.cursor.sh",
        apiKey: "key_sdk_test",
        createdAtMs: 1700000000000,
      });
    };

    const calls = [];
    const reader = newReader(async (url, body, options) => {
      calls.push(url);
      assertEqual(options.noRedirect, true);
      assertEqual(JSON.stringify(body), "{}");
      if (url.endsWith("/auth/exchange_user_api_key")) {
        assertEqual(options.headers.Authorization, "Bearer key_sdk_test");
        return { accessToken: "exchanged-session-token" };
      }
      assertEqual(options.headers.Authorization, "Bearer exchanged-session-token");
      assertEqual(options.headers["connect-protocol-version"], "1");
      assertEqual(options.headers["x-cursor-client-type"], "cli");
      if (url.endsWith("/GetPlanInfo")) {
        return { planInfo: { planName: "Pro" } };
      }
      assertEqual(url, "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage");
      return {
        billingCycleEnd: "1751328000000",
        planUsage: {
          totalPercentUsed: 40,
          autoPercentUsed: 25,
          apiPercentUsed: 50,
          remaining: 1200,
          limit: 2000,
        },
        spendLimitUsage: {
          individualUsed: 350,
        },
      };
    });

    const result = await reader.read();
    const value = (name) => result.fields.find((field) => field.name === name)?.value;
    assertEqual(result.status, "ok");
    assertEqual(calls.length, 3);
    assertEqual(value("used_percent_credits"), 40);
    assertEqual(value("remaining_percent_credits"), 60);
    assertEqual(value("reset_at_credits"), 1751328000);
    assertEqual(value("used_percent_auto"), 25);
    assertEqual(value("used_percent_api"), 50);
    assertEqual(value("remaining_credits"), 12);
    assertEqual(value("spend_limit_used"), 3.5);
    assertEqual(value("limit_reached"), false);
    assertEqual(value("plan_type"), "Pro");
    assertEqual(value("usage_source"), "api2.cursor.sh");
    reader.destroy();
  });

  await test("CursorReader reads CLI credentials from the OS keyring when auth.json only stores a marker", async () => {
    Gio.File.prototype.load_contents_async = async () =>
      encodeJson({ storedIn: "os-secret-store" });

    let keyringCalls = 0;
    const reader = newReader(async (url, _body, options) => {
      if (url.endsWith("/GetPlanInfo")) return { planInfo: { planName: "Pro" } };
      assertEqual(options.headers.Authorization, "Bearer keyring-session-token");
      return {
        billingCycleEnd: "1751328000000",
        planUsage: {
          totalPercentUsed: 22,
          autoPercentUsed: 10,
          apiPercentUsed: 12,
          remaining: 1200,
          limit: 2000,
        },
        spendLimitUsage: { individualUsed: 350 },
      };
    });
    reader._readKeyringCredential = async () => {
      keyringCalls++;
      return JSON.stringify({ accessToken: "keyring-session-token", refreshToken: "never-used" });
    };

    const result = await reader.read();
    assertEqual(keyringCalls, 1);
    assertEqual(result.status, "ok");
    assertEqual(result.pathsTried.includes("auth-keyring"), true);
    assertEqual(result.fields.find((field) => field.name === "used_percent_credits")?.value, 22);
    assertEqual(
      result.fields.find((field) => field.name === "reset_at_credits")?.value,
      1751328000,
    );
    reader.destroy();
  });

  await test("CursorReader fails closed when the OS keyring has no usable credential", async () => {
    Gio.File.prototype.load_contents_async = async () =>
      encodeJson({ storedIn: "os-secret-store" });

    for (const secret of [null, JSON.stringify({ accessToken: "has space" }), "not-json"]) {
      let requests = 0;
      const reader = newReader(async () => {
        requests++;
        return {};
      });
      reader._readKeyringCredential = async () => secret;
      const result = await reader.read();
      assertEqual(result.status, "error");
      assertEqual(requests, 0);
      assertEqual(result.lastError.includes("cursor-agent login"), true);
      reader.destroy();
    }
  });

  await test("CursorReader falls back to apiKey exchange when direct accessToken is rejected", async () => {
    Gio.File.prototype.load_contents_async = async () =>
      encodeJson({
        accessToken: "stale-opaque-token",
        apiKey: "key_backup",
      });

    let usageCalls = 0;
    const reader = newReader(async (url, _body, options) => {
      if (url.endsWith("/auth/exchange_user_api_key")) {
        assertEqual(options.headers.Authorization, "Bearer key_backup");
        return { accessToken: "fresh-exchanged-token" };
      }
      if (url.endsWith("/GetCurrentPeriodUsage")) {
        usageCalls++;
        if (usageCalls === 1) {
          assertEqual(options.headers.Authorization, "Bearer stale-opaque-token");
          throw new TokenError("HTTP 401", 401);
        }
        assertEqual(options.headers.Authorization, "Bearer fresh-exchanged-token");
        return {
          billingCycleEnd: "1751328000000",
          planUsage: { totalPercentUsed: 15 },
        };
      }
      return { planInfo: { planName: "Pro" } };
    });

    const result = await reader.read();
    assertEqual(result.status, "partial");
    assertEqual(usageCalls, 2);
    assertEqual(result.fields.find((field) => field.name === "used_percent_credits")?.value, 15);
    reader.destroy();
  });

  await test("CursorReader never contacts the provider with expired or untrusted-backend credentials", async () => {
    for (const authPayload of [
      { apiKey: "expired", apiKeyExpiresAtMs: 1000 },
      { version: 1, backendUrl: "https://untrusted.example.invalid", apiKey: "key_bad" },
    ]) {
      Gio.File.prototype.load_contents_async = async () => encodeJson(authPayload);
      let requests = 0;
      let keyringCalls = 0;
      const reader = newReader(async () => {
        requests++;
        return {};
      });
      reader._readKeyringCredential = async () => {
        keyringCalls++;
        return null;
      };
      const result = await reader.read();
      assertEqual(result.status, "error");
      assertEqual(requests, 0);
      assertEqual(keyringCalls, 0);
      reader.destroy();
    }
  });

  await test("CursorReader sanitizes missing auth file, token, rate-limit, and network failures", async () => {
    Gio.File.prototype.load_contents_async = async () => {
      throw new Error("private-path-and-secret");
    };
    const missingReader = newReader(async () => ({}));
    const missing = await missingReader.read();
    assertEqual(missing.status, "error");
    assertEqual(missing.lastError.includes("private-path"), false);
    missingReader.destroy();

    Gio.File.prototype.load_contents_async = async () => encodeJson({ accessToken: "session-tok" });
    for (const error of [
      new TokenError("private-token"),
      new RateLimitError("private-token"),
      new NetworkError("private-token"),
    ]) {
      const reader = newReader(async () => {
        throw error;
      });
      const result = await reader.read();
      assertEqual(result.status, "error");
      assertEqual(result.lastError.includes("private-token"), false);
      reader.destroy();
    }
  });

  await test("CursorReader serves recent last-known-good across transient failures and releases HTTP client", async () => {
    Gio.File.prototype.load_contents_async = async () => encodeJson({ accessToken: "session-tok" });
    let call = 0;
    const reader = newReader(async (url) => {
      if (url.endsWith("/GetPlanInfo")) throw new Error("plan optional failure");
      call++;
      if (call === 1) {
        return {
          billingCycleEnd: "1751328000000",
          planUsage: { totalPercentUsed: 33 },
        };
      }
      throw new NetworkError("offline");
    });

    const first = await reader.read();
    assertEqual(first.status, "partial");
    assertEqual(first.fields.find((field) => field.name === "used_percent_credits")?.value, 33);

    const second = await reader.read();
    assertEqual(second.status, "partial");
    assertEqual(second.pathsTried.includes("last-known-good"), true);
    assertEqual(second.fields.find((field) => field.name === "used_percent_credits")?.value, 33);

    let destroyed = false;
    reader._http.destroy = () => {
      destroyed = true;
    };
    reader.destroy();
    assertEqual(destroyed, true);
    assertEqual(reader._http, null);
  });

  await test("CursorReader fails closed on custom cursor-cli-path and cancels superseded concurrent reads", async () => {
    const GLib = (await import("gi://GLib")).default;
    const prevKey = GLib.getenv("CURSOR_API_KEY");
    GLib.setenv("CURSOR_API_KEY", "env-should-not-be-used", true);
    try {
      Gio.File.prototype.load_contents_async = async function () {
        if (this.get_path() === "/explicit/missing-auth.json") {
          throw new Error("missing explicit auth");
        }
        return encodeJson({ accessToken: "default-path-should-not-be-used" });
      };
      let requests = 0;
      const customReader = newReader(async () => {
        requests++;
        return {};
      }, "/explicit/missing-auth.json");
      const failed = await customReader.read();
      assertEqual(failed.status, "error");
      assertEqual(requests, 0);
      customReader.destroy();
    } finally {
      if (prevKey === null) GLib.unsetenv("CURSOR_API_KEY");
      else GLib.setenv("CURSOR_API_KEY", prevKey, true);
    }

    Gio.File.prototype.load_contents_async = async () => encodeJson({ accessToken: "session-tok" });
    let markFirstInFlight;
    const firstInFlight = new Promise((resolve) => {
      markFirstInFlight = resolve;
    });
    let releaseFirst;
    const firstBlocked = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let callNum = 0;
    const concurrentReader = newReader(async (url, _body, options) => {
      if (url.endsWith("/GetPlanInfo")) return { planInfo: { planName: "Pro" } };
      callNum++;
      if (callNum === 1) {
        options.cancellable.connect(() => releaseFirst());
        markFirstInFlight();
        await firstBlocked;
        return { planUsage: { totalPercentUsed: 99 } };
      }
      return { planUsage: { totalPercentUsed: 20 } };
    });

    const p1 = concurrentReader.read();
    await firstInFlight;
    const p2 = concurrentReader.read();
    const [r1, r2] = await Promise.all([p1, p2]);
    assertEqual(r1.status, "error");
    assertEqual(r2.fields.find((field) => field.name === "used_percent_credits")?.value, 20);
    concurrentReader.destroy();
  });

  return results;
}
