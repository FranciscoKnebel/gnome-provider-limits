import { test } from "node:test";

import { assert, gio, load, timers } from "./node-harness.mjs";

function httpHarness() {
  const glib = timers();
  glib.get_monotonic_time = () => 0;
  const errors = load(
    "src/helpers/http.ts",
    "({ HttpClient, HttpError, TokenError, RateLimitError, NetworkError })",
    {
      Gio: gio,
      GLib: glib,
      Soup: { Session: class {}, Message: { new: () => ({}) } },
      RETRY_MAX_ATTEMPTS: 3,
      RETRY_DEADLINE_MS: 15000,
      nextRetry: load("src/helpers/retry.ts", "nextRetry", {
        Math: { ...Math, floor: Math.floor, min: Math.min, random: () => 0 },
      }),
    },
  );
  return { glib, ...errors };
}

test("HTTP destroy is terminal during active IO and backoff, and cancels overlapping reads", async () => {
  for (const phase of ["IO", "backoff"]) {
    const { glib, HttpClient, NetworkError } = httpHarness();
    const client = new HttpClient({ abort() {} });
    let sends = 0;
    client._sendAndParse = (_m, cancellable) => {
      sends++;
      if (phase === "backoff") return Promise.reject(new NetworkError("offline"));
      return new Promise((_resolve, reject) =>
        cancellable.connect(() => reject(new NetworkError("cancelled"))),
      );
    };
    const first = client.getJson("https://example.invalid");
    const second = client.getJson("https://example.invalid");
    // Attach rejection observers before cancellation.
    const settled = Promise.allSettled([first, second]);
    await new Promise((resolve) => setImmediate(resolve));
    client.destroy();
    const outcomes = await settled;
    assert.ok(outcomes.every((r) => r.status === "rejected"));
    assert.equal(sends, 2);
    assert.equal(glib.sources.size, 0);
    assert.equal(client._lifetime.handlers.size, 0);
    await assert.rejects(client.getJson("https://example.invalid"));
    assert.equal(sends, 2);
    client.destroy();
  }
});

test("HTTP refuses an expired initial budget, long Retry-After, and late backoff wake-up", async () => {
  for (const mode of ["initial", "retry-after", "late-wake"]) {
    const { HttpClient, RateLimitError } = httpHarness();
    const client = new HttpClient({ abort() {} });
    let sends = 0;
    let clock = 0;
    client._monotonicMs = () => clock;
    client._sendAndParse = async () => {
      sends++;
      throw new RateLimitError("limited", null, mode === "retry-after" ? 60 : 0.05);
    };
    client._delay = async () => {
      clock = 100;
    };
    await assert.rejects(
      client.getJson("https://example.invalid", { deadlineMs: mode === "initial" ? 0 : 100 }),
    );
    assert.equal(sends, mode === "initial" ? 0 : 1);
    client.destroy();
  }
});

test("HTTP error construction through actual Codex Reader logging excludes provider prose and payload", async () => {
  const { HttpClient, HttpError, TokenError } = httpHarness();
  const output = [];
  const logs = load("src/helpers/log.ts", "({logWarn})", {
    console: { warn: (...args) => output.push(args) },
    Error,
  });
  const K = load("src/readers/codex.ts", "CodexReader", {
    CODEX_FIELDS: [],
    Gio: gio,
    BaseReader: class {},
    HttpError,
    TokenError,
    ...logs,
  });
  const reader = new K();
  const client = new HttpClient({ abort() {} });
  reader._http = {
    getJson: async () => {
      throw client._errorForStatus(403, {
        message: "No account for reviewer@example.invalid",
        error: { accountId: "private-account-123" },
      });
    },
  };
  assert.equal(await reader._fetchUsage("synthetic-not-a-real-token", null), null);
  const captured = JSON.stringify(output);
  assert.match(captured, /TokenError/);
  assert.match(captured, /403/);
  assert.doesNotMatch(captured, /reviewer|private-account|synthetic|No account/);
  client.destroy();
});
