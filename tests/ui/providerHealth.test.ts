import { FieldStatus, ReaderStatus } from "../../src/readers/base.js";
import type { ReaderResult } from "../../src/readers/base.js";
import { CODEX_FIELDS } from "../../src/readers/fields.js";
import { deriveFieldViews } from "../../src/ui/fieldViews.js";
import {
  attentionFromTones,
  deriveAttention,
  deriveProviderHealth,
  deriveState,
  deriveTone,
  isLastKnownGood,
} from "../../src/ui/providerHealth.js";

describe("providerHealth pure helpers", () => {
  it("derives state from status, worst tone, usable fields and last-known-good", () => {
    expect(deriveState(ReaderStatus.ERROR, "critical", true, true)).toBe("error");
    expect(deriveState(ReaderStatus.UNAVAILABLE, undefined, true, true)).toBe("unavailable");
    expect(deriveState(ReaderStatus.DISABLED, undefined, true, true)).toBe("idle");
    expect(deriveState(ReaderStatus.PARTIAL, "warning", true, false)).toBe("partial");
    expect(deriveState(ReaderStatus.PARTIAL, "warning", true, true)).toBe("cached");
    expect(deriveState(ReaderStatus.PARTIAL, "critical", true, true)).toBe("ok");
    expect(deriveState(ReaderStatus.OK, "warning", false, false)).toBe("ok");
    expect(deriveState(ReaderStatus.OK, undefined, false, false)).toBe("idle");
  });

  it("derives tone and attention from state and worst tone", () => {
    expect(deriveTone("error", undefined)).toBe("error");
    expect(deriveTone("unavailable", undefined)).toBe("error");
    expect(deriveTone("idle", "critical")).toBe("idle");
    expect(deriveTone("cached", undefined)).toBe("partial");
    expect(deriveTone("ok", "warning")).toBe("warning");
    expect(deriveTone("ok", "critical")).toBe("critical");

    expect(deriveAttention("error", undefined)).toBe("error");
    expect(deriveAttention("idle", "critical")).toBe("quiet");
    expect(deriveAttention("partial", "warning")).toBe("warning");
    expect(deriveAttention("cached", undefined)).toBe("partial");
    expect(deriveAttention("ok", "critical")).toBe("critical");
  });

  it("derives attention from tones alone without a reader result", () => {
    expect(attentionFromTones(ReaderStatus.OK, ["ok", undefined])).toBe("quiet");
    expect(attentionFromTones(ReaderStatus.PARTIAL, ["warning"])).toBe("warning");
    expect(attentionFromTones(ReaderStatus.OK, ["warning", "critical"])).toBe("critical");
    expect(attentionFromTones(ReaderStatus.ERROR, [])).toBe("error");
  });

  it("uses the required data contract to compute health and localized state text", () => {
    const result: ReaderResult = {
      provider: "codex",
      status: ReaderStatus.PARTIAL,
      lastUpdated: 1_700_000_000_000,
      pathsTried: ["oauth-api", "last-known-good"],
      fields: [{ name: "used_percent_primary", value: 72, status: FieldStatus.OK }],
    };
    const views = deriveFieldViews(CODEX_FIELDS, result, ["used_percent_primary"], "status", "en");
    const health = deriveProviderHealth(result.status, {
      result,
      views,
      fieldDefs: CODEX_FIELDS,
      t: (text) => `T:${text}`,
    });

    expect(isLastKnownGood(result)).toBeTrue();
    expect(health.state).toBe("cached");
    expect(health.tone).toBe("partial");
    expect(health.attention).toBe("warning");
    expect(health.worstTone).toBe("warning");
    expect(health.hasUsableField).toBeTrue();
    expect(health.lastKnownGood).toBeTrue();
    expect(health.stateTag).toBe("~");
    expect(health.stateAccessibleText).toBe("T:Cached");

    const errorResult: ReaderResult = { ...result, status: ReaderStatus.ERROR, pathsTried: [] };
    const errorHealth = deriveProviderHealth(errorResult.status, {
      result: errorResult,
      views,
      fieldDefs: CODEX_FIELDS,
      t: (text) => `T:${text}`,
    });
    expect(errorHealth.state).toBe("error");
    expect(errorHealth.stateTag).toBe("T:(error)");
    expect(errorHealth.stateAccessibleText).toBe("T:(error)");
  });
});
