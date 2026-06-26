import GObject from "gi://GObject";

import { assert, assertEqual, assertNotNull } from "../helpers/assert.js";

const ReaderMockSettings = GObject.registerClass(
  class ReaderMockSettings extends GObject.Object {
    _init(props = {}) {
      super._init();
      this._values = {};
      this._bindings = {};
      this._handlers = {};
      for (const [k, v] of Object.entries(props)) this._values[k] = v;
    }
    connect(signal, callback) {
      if (!this._handlers[signal]) this._handlers[signal] = [];
      this._handlers[signal].push(callback);
    }
    _emitChange(key) {
      (this._handlers[`changed::${key}`] || []).forEach((h) => h(this));
    }
    get_strv(key) {
      return [...(this._values[key] ?? [])];
    }
    get_string(key) {
      return this._values[key] ?? "";
    }
    get_boolean(key) {
      return this._values[key] ?? false;
    }
    get_int(key) {
      return this._values[key] ?? 0;
    }
    set_strv(key, val) {
      this._values[key] = [...val];
      this._emitChange(key);
    }
    set_string(key, val) {
      this._values[key] = val;
      this._emitChange(key);
    }
    set_int(key, val) {
      this._values[key] = val;
      this._emitChange(key);
    }
    set_boolean(key, val) {
      this._values[key] = val;
      this._emitChange(key);
    }
    bind(srcKey, target, prop) {
      this._bindings[srcKey] = { target, prop };
      target[prop] = this._values[srcKey] ?? "";
    }
  },
);

export async function run() {
  const results = [];

  const readersDir = "file:///home/francisco/gnome-provider-limits/dist/readers";
  const { BaseReader, ReaderStatus, FieldStatus } = await import(`${readersDir}/base.js`);
  const { CodexReader } = await import(`${readersDir}/codex.js`);
  const { ClaudeReader } = await import(`${readersDir}/claude.js`);
  const { OpenCodeReader } = await import(`${readersDir}/opencode.js`);

  // ---------- BaseReader ----------
  // Test via a concrete anonymous subclass
  try {
    const settings = new ReaderMockSettings();
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
    const settings = new ReaderMockSettings({ "codex-cli-path": "" });
    const codex = new CodexReader(settings, "codex");
    assert(codex.FIELDS.length > 5, "CodexReader has fields");
    results.push({ name: "CodexReader.FIELDS defined", passed: true });
  } catch (e) {
    results.push({ name: "CodexReader.FIELDS defined", passed: false, error: String(e) });
  }

  try {
    const settings = new ReaderMockSettings({ "claude-cli-path": "" });
    const claude = new ClaudeReader(settings, "claude");
    assert(claude.FIELDS.length > 5, "ClaudeReader has fields");
    results.push({ name: "ClaudeReader.FIELDS defined", passed: true });
  } catch (e) {
    results.push({ name: "ClaudeReader.FIELDS defined", passed: false, error: String(e) });
  }

  try {
    const settings = new ReaderMockSettings();
    const oc = new OpenCodeReader(settings, "opencode");
    assert(oc.FIELDS.length > 5, "OpenCodeReader has fields");
    results.push({ name: "OpenCodeReader.FIELDS defined", passed: true });
  } catch (e) {
    results.push({ name: "OpenCodeReader.FIELDS defined", passed: false, error: String(e) });
  }

  // ---------- CodexReader._parsePayload ----------
  try {
    const settings = new ReaderMockSettings({ "codex-cli-path": "" });
    const codex = new CodexReader(settings, "codex");
    const validPayload = {
      rate_limits: {
        primary: { used_percent: 30, reset_at: Date.now() / 1000 + 3600 },
        secondary: { used_percent: 50, reset_at: Date.now() / 1000 + 86400 },
      },
      plan_type: "plus",
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
    const settings = new ReaderMockSettings({ "codex-cli-path": "" });
    const codex = new CodexReader(settings, "codex");
    const emptyPayload = { rate_limits: {} };
    const result = codex._parsePayload(emptyPayload, ["test"]);
    // limit_reached field always gets FieldStatus.OK, so result is PARTIAL
    assertEqual(result.status, ReaderStatus.PARTIAL, "empty rate_limits returns PARTIAL");
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
    const settings = new ReaderMockSettings({ "claude-cli-path": "" });
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
    const settings = new ReaderMockSettings({ "claude-cli-path": "" });
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

  // ---------- OpenCodeReader._parseDiskResult ----------
  try {
    const settings = new ReaderMockSettings();
    const oc = new OpenCodeReader(settings, "opencode");
    const diskStats = {
      totalCost: 12.5,
      sessionsCount: 42,
      lastUsedAt: Date.now() / 1000 - 3600,
      tokenExpiresAt: Date.now() / 1000 + 86400,
    };
    const result = oc._parseDiskResult(diskStats, ["test-path"]);
    assertEqual(result.provider, "opencode", "provider set");
    // Always returns PARTIAL because limit fields are unavailable in v1
    assertEqual(result.status, ReaderStatus.PARTIAL, "valid stats returns PARTIAL");
    assert(result.fields.length >= 3, "has expected fields");
    assertEqual(result.fields[6].name, "total_cost", "field 6 is total_cost");
    assertEqual(result.fields[6].value, 12.5, "total_cost value");
    results.push({ name: "OpenCodeReader._parseDiskResult with full data", passed: true });
  } catch (e) {
    results.push({
      name: "OpenCodeReader._parseDiskResult with full data",
      passed: false,
      error: String(e),
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
    const settings = new ReaderMockSettings();
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
