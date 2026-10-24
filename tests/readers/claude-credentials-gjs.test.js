import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { assertEqual } from "../helpers/assert.js";
import { MockSettings } from "../mocks/mock-settings.js";

const { ClaudeReader } = await import("../../dist/readers/claude.js");
const fixture = (name) =>
  GLib.filename_from_uri(
    GLib.Uri.resolve_relative(import.meta.url, `../fixtures/${name}`, GLib.UriFlags.NONE),
  )[0];
const load = (name) => new TextDecoder().decode(GLib.file_get_contents(fixture(name))[1]);

function mockCredentials(raw) {
  Gio.File.prototype.load_contents_async = async () => [
    new TextEncoder().encode(JSON.stringify(raw)),
  ];
}

export async function run() {
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
  const readerWithHttp = (getJson) => {
    const reader = new ClaudeReader(new MockSettings(), "claude");
    reader._http = { getJson, destroy() {} };
    reader._readFromCli = async () => null;
    return reader;
  };
  await test("Claude nested credentials reach OAuth and raw usage reaches fields", async () => {
    mockCredentials(JSON.parse(load("claude-credentials.json")));
    let requests = 0;
    const reader = readerWithHttp(async (url, options) => {
      requests++;
      assertEqual(url, "https://api.anthropic.com/api/oauth/usage");
      assertEqual(options.headers.Authorization, "Bearer synthetic-not-a-real-token");
      return JSON.parse(load("claude-oauth-usage.json"));
    });
    try {
      const result = await reader.read();
      assertEqual(requests, 1);
      assertEqual(result.status, "ok");
      const value = (name) => result.fields.find((field) => field.name === name)?.value;
      assertEqual(value("used_percent_session"), 25);
      assertEqual(value("remaining_percent_weekly"), 40);
      assertEqual(value("used_percent_sonnet"), 10);
      assertEqual(value("used_percent_opus"), 5);
      assertEqual(value("reset_at_session"), Date.parse("2099-01-01T01:00:00Z") / 1000);
      assertEqual(value("has_extra_usage_enabled"), false);
    } finally {
      reader.destroy();
    }
  });
  await test("Claude rejects invalid credentials and keeps token and expiry paired", async () => {
    for (const creds of [
      null,
      [],
      {},
      { claudeAiOauth: { accessToken: " " } },
      { claudeAiOauth: { accessToken: 42 } },
      { claudeAiOauth: { accessToken: "fake", expiresAt: "invalid" } },
      { claudeAiOauth: { accessToken: "fake", expiresAt: 1 } },
      {
        token: "legacy",
        expiresAt: 4070908800000,
        claudeAiOauth: { accessToken: "nested", expiresAt: 1 },
      },
    ]) {
      mockCredentials(creds);
      let requests = 0;
      const reader = readerWithHttp(async () => {
        requests++;
        return {};
      });
      try {
        assertEqual((await reader.read()).status, "error");
        assertEqual(requests, 0);
      } finally {
        reader.destroy();
      }
    }
  });
  return results;
}
