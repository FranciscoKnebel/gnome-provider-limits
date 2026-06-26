import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";

import { assertEqual, assertNotNull } from "../helpers/assert.js";

Gtk.init();

const MockSettings = GObject.registerClass(
  class MockSettings extends GObject.Object {
    _init(props = {}) {
      super._init();
      this._values = {};
      this._bindings = {};
      this._handlers = {};
      for (const [k, v] of Object.entries(props)) {
        this._values[k] = v;
      }
    }

    connect(signal, callback) {
      if (!this._handlers[signal]) this._handlers[signal] = [];
      this._handlers[signal].push(callback);
    }

    emit(signal, ...args) {
      const handlers = this._handlers[signal] || [];
      for (const h of handlers) {
        h(this, ...args);
      }
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

    bind(srcKey, target, prop, flags) {
      this._bindings[srcKey] = { target, prop, flags };
      target[prop] = this._values[srcKey] ?? "";
    }

    _emitChange(key) {
      this.emit(`changed::${key}`);
      const b = this._bindings[key];
      if (b && b.prop in b.target) {
        b.target[b.prop] = this._values[key];
      }
    }
  },
);

export async function run() {
  const results = [];

  const { ProviderLimitsPreferencesPage, ProviderPage } =
    await import("../../dist/ui/prefs-common.js");

  // Test 1: ProviderLimitsPreferencesPage can be constructed
  try {
    const settings = new MockSettings({
      "providers-order": ["codex", "claude", "opencode"],
      "codex-enabled": true,
      "claude-enabled": false,
      "opencode-enabled": true,
      "refresh-short-interval-seconds": 10,
      "refresh-long-interval-seconds": 120,
      "refresh-stable-reads-threshold": 3,
      language: "",
    });
    const page = new ProviderLimitsPreferencesPage(settings);
    assertNotNull(page, "page should be created");
    results.push({ name: "ProviderLimitsPreferencesPage is constructable", passed: true });
  } catch (e) {
    results.push({
      name: "ProviderLimitsPreferencesPage is constructable",
      passed: false,
      error: String(e),
    });
  }

  // Test 2: ProviderPage can be constructed for each provider
  try {
    const settings = new MockSettings({
      "codex-enabled": true,
      "codex-display-name": "Codex Pro",
      "codex-display-name-short": "CX",
      "codex-cli-path": "/usr/bin/codex",
      "codex-status-fields": ["used_percent_primary", "reset_at_primary"],
      "codex-panel-fields": ["used_percent_primary", "used_percent_secondary", "plan_type"],
      "claude-enabled": true,
      "claude-display-name": "Claude",
      "claude-status-fields": ["used_percent_session"],
      "claude-panel-fields": [],
      "opencode-enabled": true,
      "opencode-display-name": "OpenCode",
      "opencode-status-fields": [],
      "opencode-panel-fields": ["total_cost", "sessions_count"],
      language: "en",
    });
    const page = new ProviderPage(settings, "codex");
    assertNotNull(page, "ProviderPage should be created");
    assertEqual(page.title, "Codex Pro", "page title should match display name");
    results.push({ name: "ProviderPage is constructable with correct title", passed: true });
  } catch (e) {
    results.push({
      name: "ProviderPage is constructable with correct title",
      passed: false,
      error: String(e),
    });
  }

  // Test 3: Settings bindings work (changing settings updates bound widgets)
  try {
    const settings = new MockSettings({
      "codex-enabled": true,
      "codex-display-name": "Codex",
      "codex-display-name-short": "CX",
      "codex-cli-path": "",
      "codex-status-fields": ["used_percent_primary"],
      "codex-panel-fields": [],
      language: "",
    });

    const page = new ProviderPage(settings, "codex");
    assertNotNull(page, "page should exist");

    let titleChanged = false;
    page.connect("notify::title", () => {
      titleChanged = true;
    });

    settings.set_string("codex-display-name", "New Name");

    results.push({ name: "Settings binding triggers title change", passed: titleChanged });
  } catch (e) {
    results.push({
      name: "Settings binding triggers title change",
      passed: false,
      error: String(e),
    });
  }

  // Test 4: MockSettings bind works
  try {
    const settings = new MockSettings({
      "codex-enabled": true,
      "codex-display-name": "Codex",
    });

    const entry = new Gtk.Entry({ text: "" });
    settings.bind("codex-display-name", entry, "text", Gio.SettingsBindFlags.DEFAULT);
    assertEqual(entry.text, "Codex", "bound widget should get initial value");
    results.push({ name: "MockSettings.bind sets initial value", passed: true });
  } catch (e) {
    results.push({ name: "MockSettings.bind sets initial value", passed: false, error: String(e) });
  }

  // Test 5: MockSettings.set_strv emits changed:: signal
  try {
    const settings = new MockSettings({
      "codex-status-fields": ["used_percent_primary"],
    });

    let signalFired = false;
    settings.connect("changed::codex-status-fields", () => {
      signalFired = true;
    });

    settings.set_strv("codex-status-fields", ["used_percent_primary", "reset_at_primary"]);
    assertEqual(signalFired, true, "signal should fire on set_strv");
    assertEqual(settings.get_strv("codex-status-fields").length, 2, "should have 2 fields");
    results.push({ name: "MockSettings.set_strv emits signal", passed: true });
  } catch (e) {
    results.push({ name: "MockSettings.set_strv emits signal", passed: false, error: String(e) });
  }

  return results;
}
