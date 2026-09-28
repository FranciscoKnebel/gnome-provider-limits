import GLib from "gi://GLib";
import Soup from "gi://Soup";

import { assert, assertEqual } from "./assert.js";

const {
  HttpClient,
  TokenError,
  RateLimitError,
  ServerError,
  HttpError,
  NetworkError,
  ProtocolError,
} = await import("../../dist/helpers/http.js");

class MockHttpClient extends HttpClient {
  constructor(responseMap) {
    super();
    this._responseMap = responseMap;
    this._attempts = 0;
    this._delays = [];
  }

  async _delay(delayMs) {
    this._delays.push(delayMs);
  }

  async _sendAndParse(message, _cancellable) {
    this._attempts++;
    const url = message.get_uri().to_string();
    for (const [pattern, responses] of this._responseMap) {
      if (!url.includes(pattern)) continue;
      const list = Array.isArray(responses) ? responses : [responses];
      const resp = list[Math.min(this._attempts - 1, list.length - 1)];
      if (resp.error) throw resp.error;
      if (resp.status < 200 || resp.status >= 300) {
        let payload = resp.payload ?? null;
        if (payload === null && resp.body && resp.body.trim()) {
          try {
            payload = JSON.parse(resp.body);
          } catch {
            payload = null;
          }
        }
        throw this._errorForStatus(resp.status, payload, resp.retryAfterSeconds ?? null);
      }
      if (!resp.body || !resp.body.trim()) return null;
      try {
        return JSON.parse(resp.body);
      } catch {
        throw new ProtocolError("non-JSON body", resp.status);
      }
    }
    throw new HttpError("not found", 404);
  }
}

function makeRawMessage(status, headers = {}) {
  const message = Soup.Message.new("GET", "https://example.com/api/raw");
  return new Proxy(message, {
    get(target, prop) {
      if (prop === "get_status") return () => status;
      if (prop === "get_response_headers") {
        return () => ({ get_one: (name) => headers[name] ?? null });
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function makeSession(body) {
  return {
    send_and_read_async: async () => new GLib.Bytes(new TextEncoder().encode(body ?? "")),
    abort: () => {},
  };
}

export async function run() {
  const results = [];

  // Test 1: getJson returns parsed JSON on success
  try {
    const client = new MockHttpClient([
      ["/api/test", { status: 200, body: JSON.stringify({ message: "ok" }) }],
    ]);
    const result = await client.getJson("https://example.com/api/test");
    assertEqual(result.message, "ok", "should parse JSON response");
    assertEqual(client._attempts, 1, "should not retry a success");
    results.push({ name: "getJson returns parsed JSON", passed: true });
    client.destroy();
  } catch (e) {
    results.push({ name: "getJson returns parsed JSON", passed: false, error: String(e) });
  }

  // Test 2: getJson throws TokenError on 401 without retrying
  try {
    const client = new MockHttpClient([
      ["/api/unauth", { status: 401, body: "Unauthorized", payload: { error: "unauthorized" } }],
    ]);
    try {
      await client.getJson("https://example.com/api/unauth");
      results.push({
        name: "getJson throws TokenError on 401",
        passed: false,
        error: "should have thrown",
      });
    } catch (e) {
      assert(e instanceof TokenError, "should be TokenError");
      assertEqual(e.statusCode, 401, "status code should be 401");
      assertEqual(client._attempts, 1, "should not retry 401");
      results.push({ name: "getJson throws TokenError on 401", passed: true });
    }
    client.destroy();
  } catch (e) {
    results.push({ name: "getJson throws TokenError on 401", passed: false, error: String(e) });
  }

  // Test 3: getJson retries 429 honoring Retry-After, then succeeds
  try {
    const client = new MockHttpClient([
      [
        "/api/ratelimit",
        [
          { status: 429, body: "{}", retryAfterSeconds: 2 },
          { status: 200, body: JSON.stringify({ retried: true }) },
        ],
      ],
    ]);
    const result = await client.getJson("https://example.com/api/ratelimit");
    assertEqual(result.retried, true, "should succeed after retry");
    assertEqual(client._attempts, 2, "should retry once");
    assertEqual(client._delays.length, 1, "should delay once");
    assert(client._delays[0] >= 2000, "should honor Retry-After");
    results.push({ name: "getJson retries 429 with Retry-After", passed: true });
    client.destroy();
  } catch (e) {
    results.push({ name: "getJson retries 429 with Retry-After", passed: false, error: String(e) });
  }

  // Test 4: getJson retries 5xx up to maxAttempts then gives up
  try {
    const client = new MockHttpClient([
      [
        "/api/servererror",
        [
          { status: 500, body: "{}" },
          { status: 500, body: "{}" },
          { status: 500, body: "{}" },
        ],
      ],
    ]);
    try {
      await client.getJson("https://example.com/api/servererror");
      results.push({
        name: "getJson gives up after max retries",
        passed: false,
        error: "should have thrown",
      });
    } catch (e) {
      assert(e instanceof ServerError, "should be ServerError");
      assertEqual(e.statusCode, 500, "status code should be 500");
      assertEqual(client._attempts, 3, "should attempt three times");
      results.push({ name: "getJson gives up after max retries", passed: true });
    }
    client.destroy();
  } catch (e) {
    results.push({ name: "getJson gives up after max retries", passed: false, error: String(e) });
  }

  // Test 5: getJson recovers when a 500 is transient
  try {
    const client = new MockHttpClient([
      [
        "/api/flaky",
        [
          { status: 500, body: "{}" },
          { status: 200, body: JSON.stringify({ ok: true }) },
        ],
      ],
    ]);
    const result = await client.getJson("https://example.com/api/flaky");
    assertEqual(result.ok, true, "should recover after a 500");
    assertEqual(client._attempts, 2, "should retry once");
    results.push({ name: "getJson recovers from transient 5xx", passed: true });
    client.destroy();
  } catch (e) {
    results.push({ name: "getJson recovers from transient 5xx", passed: false, error: String(e) });
  }

  // Test 6: getJson does not retry 4xx
  try {
    const client = new MockHttpClient([["/api/badrequest", { status: 400, body: "{}" }]]);
    try {
      await client.getJson("https://example.com/api/badrequest");
      results.push({
        name: "getJson does not retry 4xx",
        passed: false,
        error: "should have thrown",
      });
    } catch (e) {
      assert(e instanceof HttpError, "should be HttpError");
      assertEqual(e.statusCode, 400, "status code should be 400");
      assertEqual(client._attempts, 1, "should not retry 400");
      results.push({ name: "getJson does not retry 4xx", passed: true });
    }
    client.destroy();
  } catch (e) {
    results.push({ name: "getJson does not retry 4xx", passed: false, error: String(e) });
  }

  // Test 7: getJson retries network errors
  try {
    const client = new MockHttpClient([
      [
        "/api/network",
        [
          { error: new NetworkError("connection reset") },
          { status: 200, body: JSON.stringify({ ok: true }) },
        ],
      ],
    ]);
    const result = await client.getJson("https://example.com/api/network");
    assertEqual(result.ok, true, "should recover from a network error");
    assertEqual(client._attempts, 2, "should retry a network error");
    results.push({ name: "getJson retries network errors", passed: true });
    client.destroy();
  } catch (e) {
    results.push({ name: "getJson retries network errors", passed: false, error: String(e) });
  }

  // Test 8: getJson does not retry protocol errors
  try {
    const client = new MockHttpClient([["/api/html", { status: 200, body: "<html>login</html>" }]]);
    try {
      await client.getJson("https://example.com/api/html");
      results.push({
        name: "getJson does not retry protocol errors",
        passed: false,
        error: "should have thrown",
      });
    } catch (e) {
      assert(e instanceof ProtocolError, "should be ProtocolError");
      assertEqual(client._attempts, 1, "should not retry a protocol error");
      results.push({ name: "getJson does not retry protocol errors", passed: true });
    }
    client.destroy();
  } catch (e) {
    results.push({
      name: "getJson does not retry protocol errors",
      passed: false,
      error: String(e),
    });
  }

  // Test 9: retries option disables retrying
  try {
    const client = new MockHttpClient([
      [
        "/api/noretry",
        [
          { status: 500, body: "{}" },
          { status: 200, body: JSON.stringify({ ok: true }) },
        ],
      ],
    ]);
    try {
      await client.getJson("https://example.com/api/noretry", { retries: 0 });
      results.push({
        name: "getJson respects retries: 0",
        passed: false,
        error: "should have thrown",
      });
    } catch (e) {
      assert(e instanceof ServerError, "should be ServerError");
      assertEqual(client._attempts, 1, "should not retry");
      results.push({ name: "getJson respects retries: 0", passed: true });
    }
    client.destroy();
  } catch (e) {
    results.push({ name: "getJson respects retries: 0", passed: false, error: String(e) });
  }

  // Test 10: protocol error on non-JSON 2xx body (real _sendAndParse)
  try {
    const client = new HttpClient(makeSession("<html>login page</html>"));
    try {
      await client._sendAndParse(makeRawMessage(200), null);
      results.push({
        name: "non-JSON 2xx body raises ProtocolError",
        passed: false,
        error: "should have thrown",
      });
    } catch (e) {
      assert(e instanceof ProtocolError, "should be ProtocolError");
      assertEqual(e.statusCode, 200, "should carry the status code");
      results.push({ name: "non-JSON 2xx body raises ProtocolError", passed: true });
    }
    client.destroy();
  } catch (e) {
    results.push({
      name: "non-JSON 2xx body raises ProtocolError",
      passed: false,
      error: String(e),
    });
  }

  // Test 11: empty 2xx body still returns null
  try {
    const client = new HttpClient(makeSession(""));
    const result = await client._sendAndParse(makeRawMessage(200), null);
    assertEqual(result, null, "should return null for empty body");
    results.push({ name: "empty 2xx body returns null", passed: true });
    client.destroy();
  } catch (e) {
    results.push({ name: "empty 2xx body returns null", passed: false, error: String(e) });
  }

  // Test 12: session failures are wrapped in NetworkError
  try {
    const client = new HttpClient({
      send_and_read_async: async () => {
        throw new Error("socket closed");
      },
      abort: () => {},
    });
    try {
      await client._sendAndParse(makeRawMessage(200), null);
      results.push({
        name: "session failures wrap in NetworkError",
        passed: false,
        error: "should have thrown",
      });
    } catch (e) {
      assert(e instanceof NetworkError, "should be NetworkError");
      results.push({ name: "session failures wrap in NetworkError", passed: true });
    }
    client.destroy();
  } catch (e) {
    results.push({
      name: "session failures wrap in NetworkError",
      passed: false,
      error: String(e),
    });
  }

  // Test 13: nested error.message is extracted
  try {
    const client = new HttpClient(makeSession(""));
    const error = client._errorForStatus(500, { error: { message: "upstream down" } });
    assertEqual(error.message, "upstream down", "should recurse into error.message");
    results.push({ name: "nested error.message is extracted", passed: true });
    client.destroy();
  } catch (e) {
    results.push({ name: "nested error.message is extracted", passed: false, error: String(e) });
  }

  // Test 14: RateLimitError carries Retry-After seconds
  try {
    const client = new HttpClient(makeSession(""));
    const retryAfter = client._parseRetryAfterSeconds(makeRawMessage(429, { "Retry-After": "3" }));
    assertEqual(retryAfter, 3, "should parse Retry-After seconds");
    const error = client._errorForStatus(429, {}, retryAfter);
    assert(error instanceof RateLimitError, "should be RateLimitError");
    assertEqual(error.retryAfterSeconds, 3, "should expose retryAfterSeconds");
    results.push({ name: "RateLimitError carries Retry-After", passed: true });
    client.destroy();
  } catch (e) {
    results.push({ name: "RateLimitError carries Retry-After", passed: false, error: String(e) });
  }

  // Test 15: postJson sends POST with body and does not retry
  try {
    const client = new MockHttpClient([
      ["/api/post", { status: 200, body: JSON.stringify({ received: true }) }],
    ]);
    const result = await client.postJson("https://example.com/api/post", { key: "value" });
    assertEqual(result.received, true, "should receive response");
    assertEqual(client._attempts, 1, "postJson should stay single-shot");
    results.push({ name: "postJson sends and receives", passed: true });
    client.destroy();
  } catch (e) {
    results.push({ name: "postJson sends and receives", passed: false, error: String(e) });
  }

  // Test 16: error message extraction from payload
  try {
    const client = new MockHttpClient([
      ["/api/errmsg", { status: 400, body: JSON.stringify({ message: "bad request" }) }],
    ]);
    try {
      await client.getJson("https://example.com/api/errmsg");
      results.push({
        name: "extracts error message from 400",
        passed: false,
        error: "should have thrown",
      });
    } catch (e) {
      assert(e instanceof HttpError, "should be HttpError");
      assertEqual(e.statusCode, 400, "status code should be 400");
      assertEqual(e.message, "bad request", "should extract message");
      results.push({ name: "extracts error message from 400", passed: true });
    }
    client.destroy();
  } catch (e) {
    results.push({ name: "extracts error message from 400", passed: false, error: String(e) });
  }

  return results;
}
