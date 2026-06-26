import { assert, assertEqual } from "./assert.js";

const { HttpClient, TokenError, RateLimitError, ServerError, HttpError } =
  await import("../../dist/helpers/http.js");

class MockHttpClient extends HttpClient {
  constructor(responseMap) {
    super();
    this._responseMap = responseMap;
  }

  async _sendAndParse(message, _options) {
    const url = message.get_uri().to_string();
    for (const [pattern, resp] of this._responseMap) {
      if (url.includes(pattern)) {
        if (resp.status < 200 || resp.status >= 300) {
          throw this._errorForStatus(resp.status, resp.payload ?? null, resp.body);
        }
        let payload = null;
        if (resp.body && resp.body.trim()) {
          try {
            payload = JSON.parse(resp.body);
          } catch {
            // non-JSON body, payload stays null
          }
        }
        return payload;
      }
    }
    throw new HttpError("not found", 404);
  }
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
    results.push({ name: "getJson returns parsed JSON", passed: true });
    client.destroy();
  } catch (e) {
    results.push({ name: "getJson returns parsed JSON", passed: false, error: String(e) });
  }

  // Test 2: getJson throws TokenError on 401
  try {
    const client = new MockHttpClient([
      [
        "/api/unauth",
        {
          status: 401,
          body: "Unauthorized",
          payload: { error: "unauthorized" },
        },
      ],
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
      results.push({ name: "getJson throws TokenError on 401", passed: true });
    }
    client.destroy();
  } catch (e) {
    results.push({ name: "getJson throws TokenError on 401", passed: false, error: String(e) });
  }

  // Test 3: getJson throws RateLimitError on 429
  try {
    const client = new MockHttpClient([["/api/ratelimit", { status: 429, body: "{}" }]]);
    try {
      await client.getJson("https://example.com/api/ratelimit");
      results.push({
        name: "getJson throws RateLimitError on 429",
        passed: false,
        error: "should have thrown",
      });
    } catch (e) {
      assert(e instanceof RateLimitError, "should be RateLimitError");
      assertEqual(e.statusCode, 429, "status code should be 429");
      results.push({ name: "getJson throws RateLimitError on 429", passed: true });
    }
    client.destroy();
  } catch (e) {
    results.push({ name: "getJson throws RateLimitError on 429", passed: false, error: String(e) });
  }

  // Test 4: getJson throws ServerError on 500
  try {
    const client = new MockHttpClient([["/api/servererror", { status: 500, body: "{}" }]]);
    try {
      await client.getJson("https://example.com/api/servererror");
      results.push({
        name: "getJson throws ServerError on 500",
        passed: false,
        error: "should have thrown",
      });
    } catch (e) {
      assert(e instanceof ServerError, "should be ServerError");
      assertEqual(e.statusCode, 500, "status code should be 500");
      results.push({ name: "getJson throws ServerError on 500", passed: true });
    }
    client.destroy();
  } catch (e) {
    results.push({ name: "getJson throws ServerError on 500", passed: false, error: String(e) });
  }

  // Test 5: postJson sends POST with body
  try {
    const client = new MockHttpClient([
      ["/api/post", { status: 200, body: JSON.stringify({ received: true }) }],
    ]);
    const result = await client.postJson("https://example.com/api/post", { key: "value" });
    assertEqual(result.received, true, "should receive response");
    results.push({ name: "postJson sends and receives", passed: true });
    client.destroy();
  } catch (e) {
    results.push({ name: "postJson sends and receives", passed: false, error: String(e) });
  }

  // Test 6: error message extraction from payload
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
      results.push({ name: "extracts error message from 400", passed: true });
    }
    client.destroy();
  } catch (e) {
    results.push({ name: "extracts error message from 400", passed: false, error: String(e) });
  }

  // Test 7: handles empty response body
  try {
    const client = new MockHttpClient([["/api/empty", { status: 200, body: "" }]]);
    const result = await client.getJson("https://example.com/api/empty");
    assertEqual(result, null, "should return null for empty body");
    results.push({ name: "handles empty response body", passed: true });
    client.destroy();
  } catch (e) {
    results.push({ name: "handles empty response body", passed: false, error: String(e) });
  }

  return results;
}
