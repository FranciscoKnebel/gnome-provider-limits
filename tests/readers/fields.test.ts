import { PROVIDER_NAMES } from "../../src/constants.js";
import { moveAdjacentValue, reorderValue } from "../../src/helpers/reorder.js";
import type { FieldDef } from "../../src/readers/base.js";
import {
  CLAUDE_FIELDS,
  CODEX_FIELDS,
  CURSOR_FIELDS,
  GOOGLE_FIELDS,
  GROK_FIELDS,
  OPENCODE_FIELDS,
  PROVIDER_FIELDS,
} from "../../src/readers/fields.js";

describe("readers/fields & helpers/reorder", () => {
  it("exports decoupled field metadata for every provider with Limit and Telemetry categories", () => {
    expect(PROVIDER_FIELDS.codex).toBe(CODEX_FIELDS);
    expect(PROVIDER_FIELDS.claude).toBe(CLAUDE_FIELDS);
    expect(PROVIDER_FIELDS.opencode).toBe(OPENCODE_FIELDS);
    expect(PROVIDER_FIELDS.grok).toBe(GROK_FIELDS);
    expect(PROVIDER_FIELDS.cursor).toBe(CURSOR_FIELDS);
    expect(PROVIDER_FIELDS.google).toBe(GOOGLE_FIELDS);

    for (const provider of PROVIDER_NAMES) {
      expect(PROVIDER_FIELDS[provider].length).toBeGreaterThan(0);
      for (const def of PROVIDER_FIELDS[provider]) {
        expect(["limit", "telemetry"]).toContain(def.category);
      }
    }

    expect({ name: "custom_cost", type: "cost", category: "telemetry" }.category).toBe("telemetry");
    expect({ name: "custom_pct", type: "percent", category: "limit" }.category).toBe("limit");
  });

  it("carries category and companion reset explicitly on every field definition", () => {
    const telemetryNames = new Set([
      "plan_type",
      "has_extra_usage_enabled",
      "extra_usage_disabled_reason",
      "total_cost",
      "sessions_count",
      "usage_source",
      "prepaid_balance",
      "unified_billing",
      "remaining_credits",
      "spend_limit_used",
    ]);

    for (const provider of PROVIDER_NAMES) {
      const defs: readonly FieldDef[] = PROVIDER_FIELDS[provider];
      for (const def of defs) {
        const expectedCategory = telemetryNames.has(def.name) ? "telemetry" : "limit";
        expect(def.category).toBe(expectedCategory);

        if (def.type === "percent") {
          const suffix = def.name.replace(/^(used|remaining)_percent_?/, "");
          const expectedReset = suffix ? `reset_at_${suffix}` : "reset_at";
          expect(def.resetField).toBe(expectedReset);
        } else {
          expect(def.resetField).toBeUndefined();
        }
      }
    }
  });

  it("reads category and reset metadata only from the declaration, never from the name", () => {
    expect(
      {
        name: "used_percent_synthetic",
        type: "percent",
        category: "telemetry",
      }.category,
    ).toBe("telemetry");
    expect(
      {
        name: "used_percent_primary",
        type: "percent",
        resetField: "custom_reset",
      }.resetField,
    ).toBe("custom_reset");
    const primary: { name: string; type: string; resetField?: string } = {
      name: "used_percent_primary",
      type: "percent",
    };
    const plain: { name: string; type: string; resetField?: string } = {
      name: "used_percent",
      type: "percent",
    };
    expect(primary.resetField ?? null).toBeNull();
    expect(plain.resetField ?? null).toBeNull();
  });

  it("reorders adjacent items with keyboard Move Up / Move Down while preserving unknown values", () => {
    expect(reorderValue(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(reorderValue(["a", "b"], "a", "a")).toBeNull();

    const stored = ["a", "obsolete_field", "b", "c"];
    const visible = ["a", "b", "c"];

    expect(moveAdjacentValue(stored, visible, "a", -1)).toBeNull();
    expect(moveAdjacentValue(stored, visible, "c", 1)).toBeNull();
    expect(moveAdjacentValue(stored, visible, "missing", 1)).toBeNull();

    const movedUp = moveAdjacentValue(stored, visible, "b", -1);
    expect(movedUp).toEqual(["b", "a", "obsolete_field", "c"]);

    const movedDown = moveAdjacentValue(stored, visible, "a", 1);
    expect(movedDown).toEqual(["obsolete_field", "b", "a", "c"]);
  });
});
