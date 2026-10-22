import Gio from "gi://Gio";

import { assertEqual } from "../helpers/assert.js";

function mockAuth(token = "test-token", expires_at = "2099-01-01T00:00:00Z") {
  Gio.File.prototype.load_contents_async = async function () {
    assertEqual(this.get_path(), "/mock/auth.json");
    return [
      new TextEncoder().encode(
        JSON.stringify({ "https://auth.x.ai::test": { key: token, expires_at } }),
      ),
    ];
  };
}

export async function run() {
  const { GrokReader } = await import("../../dist/readers/grok.js");
  const { TokenError, RateLimitError, NetworkError } = await import("../../dist/helpers/http.js");
  const results = [];
  const originalLoad = Gio.File.prototype.load_contents_async;
  try {
    Gio.File.prototype.load_contents_async = async function () {
      return [
        new TextEncoder().encode(
          JSON.stringify({
            "https://auth.x.ai::test": {
              key: "test-session",
              expires_at: "2099-01-01T00:00:00Z",
              user_id: "test-user",
            },
          }),
        ),
      ];
    };
    const reader = new GrokReader({ get_string: () => "/mock/grok-auth.json" }, "grok");
    reader._http = {
      async getJson(url, options) {
        assertEqual(options.headers.Authorization, "Bearer test-session");
        assertEqual(options.headers["x-xai-token-auth"], "xai-grok-cli");
        assertEqual(options.headers["x-userid"], "test-user");
        if (url.endsWith("/settings")) return { subscription_tier_display: "SuperGrok Heavy" };
        assertEqual(url, "https://cli-chat-proxy.grok.com/v1/billing?format=credits");
        return {
          config: {
            creditUsagePercent: 25,
            currentPeriod: { end: "2099-01-01T00:00:00Z" },
            prepaidBalance: { val: 500 },
            isUnifiedBillingUser: true,
          },
        };
      },
      destroy() {},
    };
    const result = await reader.read();
    const value = (name) => result.fields.find((field) => field.name === name)?.value;
    assertEqual(result.status, "ok");
    assertEqual(value("used_percent_credits"), 25);
    assertEqual(value("remaining_percent_credits"), 75);
    assertEqual(value("prepaid_balance"), 5);
    assertEqual(value("plan_type"), "SuperGrok Heavy");
    reader.destroy();
    results.push({ name: "GrokReader reads subscription credits with local login", passed: true });
  } catch (error) {
    results.push({
      name: "GrokReader reads subscription credits with local login",
      passed: false,
      error: String(error),
    });
  } finally {
    Gio.File.prototype.load_contents_async = originalLoad;
  }

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
  const newReader = (getJson) => {
    const reader = new GrokReader({ get_string: () => "/mock/auth.json" }, "grok");
    reader._http = { getJson, destroy() {} };
    return reader;
  };

  await test("GrokReader never contacts the provider with expired credentials", async () => {
    mockAuth("expired", "2020-01-01T00:00:00Z");
    let requests = 0;
    const reader = newReader(async () => {
      requests++;
      return {};
    });
    assertEqual((await reader.read()).status, "error");
    assertEqual(requests, 0);
    reader.destroy();
  });

  await test("GrokReader handles missing auth files without exposing file errors", async () => {
    Gio.File.prototype.load_contents_async = async () => {
      throw new Error("private-path-and-token");
    };
    let requests = 0;
    const reader = newReader(async () => {
      requests++;
      return {};
    });
    const result = await reader.read();
    assertEqual(result.status, "error");
    assertEqual(result.lastError.includes("private-path"), false);
    assertEqual(requests, 0);
    reader.destroy();
  });

  await test("GrokReader keeps wallet-only usage unknown when optional settings fail", async () => {
    mockAuth();
    const reader = newReader(async (url) => {
      if (url.endsWith("/settings")) throw new Error("private upstream details");
      return { config: { prepaidBalance: { val: 500 } } };
    });
    const result = await reader.read();
    assertEqual(result.status, "partial");
    assertEqual(
      result.fields.find((field) => field.name === "used_percent_credits").status,
      "unavailable",
    );
    assertEqual(
      result.fields.find((field) => field.name === "remaining_percent_credits").value,
      null,
    );
    assertEqual(result.fields.find((field) => field.name === "prepaid_balance").value, 5);
    reader.destroy();
  });

  await test("GrokReader rejects empty usage instead of succeeding on source metadata", async () => {
    mockAuth();
    let requests = 0;
    const reader = newReader(async () => {
      requests++;
      return { config: {} };
    });
    assertEqual((await reader.read()).status, "error");
    assertEqual(requests, 1);
    reader.destroy();
  });

  await test("GrokReader sanitizes authentication, rate-limit and network failures", async () => {
    mockAuth();
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

  await test("GrokReader reads fresh login data each refresh and releases its HTTP client", async () => {
    const tokens = [];
    const reader = newReader(async (url, options) => {
      tokens.push(options.headers.Authorization);
      return url.endsWith("/settings") ? {} : { config: { creditUsagePercent: 0 } };
    });
    mockAuth("first");
    await reader.read();
    mockAuth("second");
    await reader.read();
    assertEqual(tokens.join(","), "Bearer first,Bearer first,Bearer second,Bearer second");
    let destroyed = false;
    reader._http.destroy = () => {
      destroyed = true;
    };
    reader.destroy();
    assertEqual(destroyed, true);
    assertEqual(reader._http, null);
  });
  return results;
}
