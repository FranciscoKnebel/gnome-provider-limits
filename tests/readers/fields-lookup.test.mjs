import { test } from "node:test";

import { assert, load } from "../helpers/node-harness.mjs";

const {
  CLAUDE_FIELDS,
  CODEX_FIELDS,
  CURSOR_FIELDS,
  GOOGLE_FIELDS,
  GROK_FIELDS,
  OPENCODE_FIELDS,
  PROVIDER_FIELDS,
} = load(
  "src/readers/fields.ts",
  "({ CLAUDE_FIELDS, CODEX_FIELDS, CURSOR_FIELDS, GOOGLE_FIELDS, GROK_FIELDS, OPENCODE_FIELDS, PROVIDER_FIELDS })",
);

test("provider field lookup returns the shared declarations with required metadata", () => {
  assert.strictEqual(PROVIDER_FIELDS.codex, CODEX_FIELDS);
  assert.strictEqual(PROVIDER_FIELDS.claude, CLAUDE_FIELDS);
  assert.strictEqual(PROVIDER_FIELDS.opencode, OPENCODE_FIELDS);
  assert.strictEqual(PROVIDER_FIELDS.grok, GROK_FIELDS);
  assert.strictEqual(PROVIDER_FIELDS.cursor, CURSOR_FIELDS);
  assert.strictEqual(PROVIDER_FIELDS.google, GOOGLE_FIELDS);

  for (const [provider, defs] of Object.entries(PROVIDER_FIELDS)) {
    assert.ok(defs.length > 0, `${provider} has fields`);
    for (const def of defs) {
      assert.ok(
        def.category === "limit" || def.category === "telemetry",
        `${provider}.${def.name} declares a category`,
      );
    }
  }
});

test("percent fields declare a reset name and other fields do not", () => {
  for (const [provider, defs] of Object.entries(PROVIDER_FIELDS)) {
    for (const def of defs) {
      if (def.type === "percent") {
        assert.ok(
          typeof def.resetField === "string" && def.resetField.length > 0,
          `${provider}.${def.name} declares a resetField`,
        );
      } else {
        assert.strictEqual(def.resetField, undefined, `${provider}.${def.name} has no resetField`);
      }
    }
  }
});

test("metadata is read from the declaration, never from the field name", () => {
  assert.strictEqual(
    { name: "used_percent_synthetic", type: "percent", category: "telemetry" }.category,
    "telemetry",
  );
  assert.strictEqual(
    { name: "used_percent_synthetic", type: "percent", resetField: "custom_reset" }.resetField,
    "custom_reset",
  );
  assert.strictEqual({ name: "used_percent_primary", type: "percent" }.resetField ?? null, null);
});
