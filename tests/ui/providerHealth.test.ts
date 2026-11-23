import { FieldStatus, ReaderStatus } from "../../src/readers/base.js";
import type { ReaderResult } from "../../src/readers/base.js";
import { CODEX_FIELDS } from "../../src/readers/fields.js";
import type { FieldTone } from "../../src/ui/fieldRows.js";
import { deriveFieldViews } from "../../src/ui/fieldViews.js";
import {
  ATTENTION_BY_SEVERITY,
  deriveProviderHealth,
  deriveSeverity,
  isLastKnownGood,
  STATE_BY_SEVERITY,
  TONE_BY_SEVERITY,
  worstFieldTone,
} from "../../src/ui/providerHealth.js";

describe("providerHealth pure helpers", () => {
  it("derives one ordered severity from status, worst tone, usable fields and last-known-good", () => {
    expect(deriveSeverity(ReaderStatus.ERROR, "critical", true, true)).toBe("error");
    expect(deriveSeverity(ReaderStatus.UNAVAILABLE, undefined, true, true)).toBe("unavailable");
    expect(deriveSeverity(ReaderStatus.DISABLED, undefined, true, true)).toBe("idle");
    expect(deriveSeverity(ReaderStatus.PARTIAL, "warning", true, false)).toBe("partial-warning");
    expect(deriveSeverity(ReaderStatus.PARTIAL, "warning", true, true)).toBe("cached-warning");
    expect(deriveSeverity(ReaderStatus.PARTIAL, "critical", true, true)).toBe("critical");
    expect(deriveSeverity(ReaderStatus.OK, "warning", false, false)).toBe("warning");
    expect(deriveSeverity(ReaderStatus.OK, "critical", false, false)).toBe("critical");
    expect(deriveSeverity(ReaderStatus.OK, "ok", true, false)).toBe("ok");
    expect(deriveSeverity(ReaderStatus.OK, undefined, false, false)).toBe("idle");
  });

  it("maps each severity to state, tone and attention through lookup tables", () => {
    expect(STATE_BY_SEVERITY.error).toBe("error");
    expect(STATE_BY_SEVERITY.unavailable).toBe("unavailable");
    expect(STATE_BY_SEVERITY.idle).toBe("idle");
    expect(STATE_BY_SEVERITY["cached-warning"]).toBe("cached");
    expect(STATE_BY_SEVERITY.critical).toBe("ok");
    expect(STATE_BY_SEVERITY.warning).toBe("ok");

    expect(TONE_BY_SEVERITY.error).toBe("error");
    expect(TONE_BY_SEVERITY.unavailable).toBe("error");
    expect(TONE_BY_SEVERITY.idle).toBe("idle");
    expect(TONE_BY_SEVERITY.cached).toBe("partial");
    expect(TONE_BY_SEVERITY.ok).toBe("ok");
    expect(TONE_BY_SEVERITY.warning).toBe("warning");
    expect(TONE_BY_SEVERITY.critical).toBe("critical");

    expect(ATTENTION_BY_SEVERITY.error).toBe("error");
    expect(ATTENTION_BY_SEVERITY.unavailable).toBe("error");
    expect(ATTENTION_BY_SEVERITY.idle).toBe("quiet");
    expect(ATTENTION_BY_SEVERITY.ok).toBe("quiet");
    expect(ATTENTION_BY_SEVERITY["partial-warning"]).toBe("warning");
    expect(ATTENTION_BY_SEVERITY.cached).toBe("partial");
    expect(ATTENTION_BY_SEVERITY.critical).toBe("critical");
  });

  it("derives attention from tones through the single severity value", () => {
    const attentionForTones = (
      status: ReaderStatus,
      tones: readonly (FieldTone | undefined)[],
    ): string => {
      const worst = worstFieldTone(tones);
      return ATTENTION_BY_SEVERITY[deriveSeverity(status, worst, false, false)];
    };

    expect(attentionForTones(ReaderStatus.OK, ["ok", undefined])).toBe("quiet");
    expect(attentionForTones(ReaderStatus.PARTIAL, ["warning"])).toBe("warning");
    expect(attentionForTones(ReaderStatus.OK, ["warning", "critical"])).toBe("critical");
    expect(attentionForTones(ReaderStatus.ERROR, [])).toBe("error");
  });

  it("uses the required data contract to compute health and localized state text", () => {
    const result: ReaderResult = {
      provider: "codex",
      status: ReaderStatus.PARTIAL,
      fromCache: true,
      lastUpdated: 1_700_000_000_000,
      pathsTried: ["oauth-api", "last-known-good"],
      fields: [{ name: "used_percent_primary", value: 72, status: FieldStatus.OK }],
    };
    const views = deriveFieldViews(CODEX_FIELDS, result, ["used_percent_primary"], {
      zone: "status",
      locale: "en",
      t: (text) => text,
    });
    const health = deriveProviderHealth(result.status, {
      result,
      views,
      fieldDefs: CODEX_FIELDS,
      t: (text) => `T:${text}`,
    });

    expect(isLastKnownGood(result)).toBeTrue();
    expect(health.severity).toBe("cached-warning");
    expect(health.state).toBe("cached");
    expect(health.tone).toBe("partial");
    expect(health.attention).toBe("warning");
    expect(health.worstTone).toBe("warning");
    expect(health.hasUsableField).toBeTrue();
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
