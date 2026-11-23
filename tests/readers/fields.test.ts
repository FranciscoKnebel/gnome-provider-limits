import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PROVIDER_NAMES } from "../../src/constants.js";
import { moveAdjacentValue, reorderValue } from "../../src/helpers/reorder.js";
import {
  CLAUDE_FIELDS,
  CODEX_FIELDS,
  CURSOR_FIELDS,
  DEFAULT_PROVIDER_PANEL_FIELDS,
  DEFAULT_PROVIDER_STATUS_FIELDS,
  GOOGLE_FIELDS,
  GROK_FIELDS,
  OPENCODE_FIELDS,
  PROVIDER_FIELDS,
  resolveFieldCategory,
} from "../../src/readers/fields.js";

const SCHEMA_PATH = fileURLToPath(
  new URL(
    "../../../src/schemas/org.gnome.shell.extensions.gnome-provider-limits.gschema.xml",
    import.meta.url,
  ),
);

function parseSchemaStrvDefault(xml: string, keyName: string): string[] {
  const escaped = keyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(
    new RegExp(`<key\\s+name="${escaped}"[^>]*>[\\s\\S]*?<default>\\[([^\\]]*)\\]</default>`),
  );
  if (!match) return [];
  return Array.from(match[1].matchAll(/'([^']+)'/g), (m) => m[1]);
}

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
        expect(["limit", "telemetry"]).toContain(resolveFieldCategory(def));
      }
    }

    expect(
      resolveFieldCategory({
        name: "custom_cost",
        label: "Cost",
        type: "cost",
        defaultZone: "panel",
      }),
    ).toBe("telemetry");
    expect(
      resolveFieldCategory({
        name: "custom_pct",
        label: "Pct",
        type: "percent",
        defaultZone: "status",
      }),
    ).toBe("limit");
  });

  it("matches GSettings schema defaults for status-fields and panel-fields", () => {
    const xml = readFileSync(SCHEMA_PATH, "utf-8");
    for (const provider of PROVIDER_NAMES) {
      expect([...DEFAULT_PROVIDER_STATUS_FIELDS[provider]]).toEqual(
        parseSchemaStrvDefault(xml, `${provider}-status-fields`),
      );
      expect([...DEFAULT_PROVIDER_PANEL_FIELDS[provider]]).toEqual(
        parseSchemaStrvDefault(xml, `${provider}-panel-fields`),
      );
    }
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
