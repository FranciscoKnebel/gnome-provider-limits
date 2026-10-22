import GLib from "gi://GLib";

import { assert, assertEqual, assertNotNull } from "../helpers/assert.js";
import { MockSettings } from "../mocks/mock-settings.js";

export async function run() {
  const results = [];

  const readersDir = GLib.Uri.resolve_relative(
    import.meta.url,
    "../../dist/readers",
    GLib.UriFlags.NONE,
  );
  const { BaseReader, ReaderStatus, FieldStatus } = await import(`${readersDir}/base.js`);
  const { CodexReader } = await import(`${readersDir}/codex.js`);
  const { ClaudeReader } = await import(`${readersDir}/claude.js`);
  const { OpenCodeReader } = await import(`${readersDir}/opencode.js`);

  // ---------- BaseReader ----------
  // Test via a concrete anonymous subclass
  try {
    const settings = new MockSettings();
    const ConcreteReader = class extends BaseReader {
      get FIELDS() {
        return [];
      }
      async read() {
        return this._errorResult("not impl", ["test"]);
      }
    };
    const reader = new ConcreteReader(settings, "test-provider");
    assertNotNull(reader, "reader created");

    const field = reader._makeField("f1", 42, FieldStatus.OK);
    assertEqual(field.name, "f1", "field name");
    assertEqual(field.value, 42, "field value");
    assertEqual(field.status, FieldStatus.OK, "field status");

    const okResult = reader._okResult([field], ["path1"]);
    assertEqual(okResult.provider, "test-provider");
    assertEqual(okResult.status, ReaderStatus.OK);
    assertEqual(okResult.fields.length, 1);

    const partialResult = reader._partialResult([field], ["path1"], "some error");
    assertEqual(partialResult.status, ReaderStatus.PARTIAL);
    assertEqual(partialResult.lastError, "some error");

    const errResult = reader._errorResult("fail", ["path1"]);
    assertEqual(errResult.status, ReaderStatus.ERROR);
    assertEqual(errResult.fields.length, 0);
    assertEqual(errResult.lastError, "fail");

    results.push({ name: "BaseReader helpers work", passed: true });
  } catch (e) {
    results.push({
      name: "BaseReader helpers work",
      passed: false,
      error: String(e) + "\n" + e.stack,
    });
  }

  // ---------- FIELDS definitions ----------
  try {
    const settings = new MockSettings({ "codex-cli-path": "" });
    const codex = new CodexReader(settings, "codex");
    assert(codex.FIELDS.length > 5, "CodexReader has fields");
    results.push({ name: "CodexReader.FIELDS defined", passed: true });
  } catch (e) {
    results.push({ name: "CodexReader.FIELDS defined", passed: false, error: String(e) });
  }

  try {
    const settings = new MockSettings({ "claude-cli-path": "" });
    const claude = new ClaudeReader(settings, "claude");
    assert(claude.FIELDS.length > 5, "ClaudeReader has fields");
    results.push({ name: "ClaudeReader.FIELDS defined", passed: true });
  } catch (e) {
    results.push({ name: "ClaudeReader.FIELDS defined", passed: false, error: String(e) });
  }

  try {
    const settings = new MockSettings();
    const oc = new OpenCodeReader(settings, "opencode");
    assert(oc.FIELDS.length > 5, "OpenCodeReader has fields");
    results.push({ name: "OpenCodeReader.FIELDS defined", passed: true });
  } catch (e) {
    results.push({ name: "OpenCodeReader.FIELDS defined", passed: false, error: String(e) });
  }

  // ---------- CodexReader._parsePayload ----------
  try {
    const settings = new MockSettings({ "codex-cli-path": "" });
    const codex = new CodexReader(settings, "codex");
    const validPayload = {
      rate_limits: {
        limit_reached: false,
        primary: {
          used_percent: 30,
          reset_at: Date.now() / 1000 + 3600,
          window_minutes: 300,
        },
        secondary: {
          used_percent: 50,
          reset_at: Date.now() / 1000 + 86400,
          window_minutes: 10080,
        },
      },
      plan_type: "plus",
      reset_credits: { available_count: 0 },
    };
    const okResult = codex._parsePayload(validPayload, ["test-path"]);
    assertEqual(okResult.provider, "codex", "provider set");
    assertEqual(okResult.status, ReaderStatus.OK, "valid payload returns OK");
    assert(okResult.fields.length >= 8, "has expected fields");
    results.push({ name: "CodexReader._parsePayload with full data", passed: true });
  } catch (e) {
    results.push({
      name: "CodexReader._parsePayload with full data",
      passed: false,
      error: String(e),
    });
  }

  try {
    const settings = new MockSettings({ "codex-cli-path": "" });
    const codex = new CodexReader(settings, "codex");
    const emptyPayload = { rate_limits: {} };
    const result = codex._parsePayload(emptyPayload, ["test"]);
    // Every field is UNAVAILABLE without window data, so the result is ERROR.
    assertEqual(result.status, ReaderStatus.ERROR, "empty rate_limits returns ERROR");
    results.push({ name: "CodexReader._parsePayload with empty data", passed: true });
  } catch (e) {
    results.push({
      name: "CodexReader._parsePayload with empty data",
      passed: false,
      error: String(e),
    });
  }

  // ---------- ClaudeReader._parsePayload ----------
  try {
    const settings = new MockSettings({ "claude-cli-path": "" });
    const claude = new ClaudeReader(settings, "claude");
    const validPayload = {
      five_hour: { used_percent: 25, reset_at: Date.now() / 1000 + 3600 },
      seven_day: { used_percent: 60, reset_at: Date.now() / 1000 + 86400 },
      seven_day_sonnet: { used_percent: 10 },
      seven_day_opus: { used_percent: 5 },
      extra_usage: { enabled: true, disabled_reason: "not_entitled" },
    };
    const okResult = claude._parsePayload(validPayload, ["test-path"]);
    assertEqual(okResult.provider, "claude", "provider set");
    assertEqual(okResult.status, ReaderStatus.OK, "valid payload returns OK");
    assert(okResult.fields.length >= 12, "has 12 fields");
    results.push({ name: "ClaudeReader._parsePayload with full data", passed: true });
  } catch (e) {
    results.push({
      name: "ClaudeReader._parsePayload with full data",
      passed: false,
      error: String(e),
    });
  }

  try {
    const settings = new MockSettings({ "claude-cli-path": "" });
    const claude = new ClaudeReader(settings, "claude");
    const emptyPayload = {};
    const errResult = claude._parsePayload(emptyPayload, ["test"]);
    assertEqual(errResult.status, ReaderStatus.ERROR, "empty payload returns ERROR");
    results.push({ name: "ClaudeReader._parsePayload with empty data", passed: true });
  } catch (e) {
    results.push({
      name: "ClaudeReader._parsePayload with empty data",
      passed: false,
      error: String(e),
    });
  }

  // ---------- OpenCodeReader._parseResult ----------
  try {
    const settings = new MockSettings();
    const oc = new OpenCodeReader(settings, "opencode");
    const nowSec = Math.floor(Date.now() / 1000);
    const usage = {
      rolling: { status: "ok", percent: 0, reset_at: nowSec + 3600 },
      weekly: { status: "ok", percent: 11, reset_at: nowSec + 86400 },
      monthly: { status: "rate-limited", percent: 100, reset_at: nowSec + 2592000 },
    };
    const result = oc._parseResult(usage, { totalCost: 12.5, sessionsCount: 42 }, ["test-path"]);
    assertEqual(result.provider, "opencode", "provider set");
    assertEqual(result.status, ReaderStatus.OK, "valid usage returns OK");
    assert(result.fields.length >= 12, "has expected fields");
    const totalCost = result.fields.find((f) => f.name === "total_cost");
    assertEqual(totalCost.value, 12.5, "total_cost value");
    const limitReached = result.fields.find((f) => f.name === "limit_reached");
    assertEqual(limitReached.value, true, "limit_reached value");
    results.push({ name: "OpenCodeReader._parseResult with full data", passed: true });
  } catch (e) {
    results.push({
      name: "OpenCodeReader._parseResult with full data",
      passed: false,
      error: String(e) + "\n" + e.stack,
    });
  }

  // ---------- OpenCodeReader._parseResult without API data ----------
  try {
    const settings = new MockSettings();
    const oc = new OpenCodeReader(settings, "opencode");
    const result = oc._parseResult(null, { totalCost: 1.5, sessionsCount: 3 }, ["disk"]);
    assertEqual(result.status, ReaderStatus.PARTIAL, "missing usage returns PARTIAL");
    const used = result.fields.find((f) => f.name === "used_percent_rolling");
    assertEqual(used.status, FieldStatus.UNAVAILABLE, "limit field unavailable");
    results.push({ name: "OpenCodeReader._parseResult without usage API", passed: true });
  } catch (e) {
    results.push({
      name: "OpenCodeReader._parseResult without usage API",
      passed: false,
      error: String(e) + "\n" + e.stack,
    });
  }

  // ---------- ReaderStatus enum values ----------
  try {
    assertEqual(ReaderStatus.OK, "ok");
    assertEqual(ReaderStatus.PARTIAL, "partial");
    assertEqual(ReaderStatus.ERROR, "error");
    assertEqual(ReaderStatus.UNAVAILABLE, "unavailable");
    assertEqual(ReaderStatus.DISABLED, "disabled");
    results.push({ name: "ReaderStatus enum values correct", passed: true });
  } catch (e) {
    results.push({ name: "ReaderStatus enum values correct", passed: false, error: String(e) });
  }

  // ---------- FieldStatus enum values ----------
  try {
    assertEqual(FieldStatus.OK, "ok");
    assertEqual(FieldStatus.UNAVAILABLE, "unavailable");
    assertEqual(FieldStatus.ERROR, "error");
    results.push({ name: "FieldStatus enum values correct", passed: true });
  } catch (e) {
    results.push({ name: "FieldStatus enum values correct", passed: false, error: String(e) });
  }

  // ---------- BaseReader destroy() is callable ----------
  try {
    const settings = new MockSettings();
    const r = new (class extends BaseReader {
      get FIELDS() {
        return [];
      }
      async read() {
        return this._errorResult("", []);
      }
    })(settings, "x");
    r.destroy();
    results.push({ name: "BaseReader.destroy() is callable", passed: true });
  } catch (e) {
    results.push({ name: "BaseReader.destroy() is callable", passed: false, error: String(e) });
  }

  return results;
}
