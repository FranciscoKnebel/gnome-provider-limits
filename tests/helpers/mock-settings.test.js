import GObject from "gi://GObject";

import { MockSettings } from "../mocks/mock-settings.js";
import { assertDeepEqual, assertEqual } from "./assert.js";

const TestTarget = GObject.registerClass(
  {
    GTypeName: "ProviderLimitsMockSettingsTarget",
    Properties: {
      text: GObject.ParamSpec.string("text", "text", "text", GObject.ParamFlags.READWRITE, ""),
      active: GObject.ParamSpec.boolean(
        "active",
        "active",
        "active",
        GObject.ParamFlags.READWRITE,
        false,
      ),
      value: GObject.ParamSpec.double(
        "value",
        "value",
        "value",
        GObject.ParamFlags.READWRITE,
        0,
        100,
        0,
      ),
    },
  },
  class TestTarget extends GObject.Object {},
);

function caseResult(name, fn) {
  try {
    fn();
    return { name, passed: true };
  } catch (e) {
    return { name, passed: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) };
  }
}

export async function run() {
  return [
    caseResult("bind applies stored values to the target", () => {
      const settings = new MockSettings({
        "codex-display-name": "Codex",
        "codex-enabled": true,
        "refresh-short-interval-seconds": 42,
      });
      const target = new TestTarget();

      settings.bind("codex-display-name", target, "text");
      settings.bind("codex-enabled", target, "active");
      settings.bind("refresh-short-interval-seconds", target, "value");

      assertEqual(target.text, "Codex", "string value should be applied");
      assertEqual(target.active, true, "boolean value should be applied");
      assertEqual(target.value, 42, "int value should be applied");
    }),

    caseResult("bind applies typed defaults when the key is absent", () => {
      const settings = new MockSettings();
      const target = new TestTarget();
      const plainTarget = { fields: null };

      settings.bind("codex-enabled", target, "active");
      settings.bind("refresh-short-interval-seconds", target, "value");
      settings.bind("codex-display-name", target, "text");
      settings.bind("codex-status-fields", plainTarget, "fields");

      assertEqual(target.active, false, "boolean keys should default to false");
      assertEqual(target.value, 0, "int keys should default to 0");
      assertEqual(target.text, "", "string keys should default to an empty string");
      assertDeepEqual(plainTarget.fields, [], "string-array keys should default to []");
    }),

    caseResult("bind writes target edits back to the settings store", () => {
      const settings = new MockSettings({ "codex-display-name": "Codex" });
      const target = new TestTarget();
      settings.bind("codex-display-name", target, "text");

      let changes = 0;
      settings.connect("changed::codex-display-name", () => {
        changes++;
      });

      target.text = "Edited";

      assertEqual(settings.get_string("codex-display-name"), "Edited", "edit should be stored");
      assertEqual(changes, 1, "write-back should emit one changed:: signal");
    }),

    caseResult("bind does not echo settings pushes back as changes", () => {
      const settings = new MockSettings({ "codex-display-name": "Codex" });
      const target = new TestTarget();
      settings.bind("codex-display-name", target, "text");

      let changes = 0;
      settings.connect("changed::codex-display-name", () => {
        changes++;
      });

      settings.set_string("codex-display-name", "Pushed");

      assertEqual(target.text, "Pushed", "target should receive the pushed value");
      assertEqual(changes, 1, "push should not loop back as another change");
    }),

    caseResult("unbind removes the binding in both directions", () => {
      const settings = new MockSettings({ "codex-display-name": "Codex" });
      const target = new TestTarget();
      settings.bind("codex-display-name", target, "text");
      settings.unbind(target, "text");

      settings.set_string("codex-display-name", "Pushed");
      assertEqual(target.text, "Codex", "unbound target should not receive updates");

      target.text = "Direct";
      assertEqual(
        settings.get_string("codex-display-name"),
        "Pushed",
        "unbound target should not write back",
      );
    }),
  ];
}
