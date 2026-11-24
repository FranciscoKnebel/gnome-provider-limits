import { FieldStatus, ReaderStatus } from "../../src/readers/base.js";
import type { ReaderResult } from "../../src/readers/base.js";
import { CODEX_FIELDS } from "../../src/readers/fields.js";
import type { FieldTone } from "../../src/ui/fieldRows.js";
import type { FieldView } from "../../src/ui/fieldViews.js";
import { deriveFieldViews } from "../../src/ui/fieldViews.js";
import {
  deriveProviderHealth,
  deriveSeverity,
  HEALTH_BY_SEVERITY,
  isLastKnownGood,
  worstFieldTone,
} from "../../src/ui/providerHealth.js";

function viewFor(tone: FieldTone | undefined, hasValue: boolean): FieldView {
  return {
    name: "used_percent_primary",
    type: "percent",
    category: "limit",
    label: "test",
    labelText: "test",
    valueText: "",
    accessibleText: "",
    hasValue,
    status: hasValue ? FieldStatus.OK : FieldStatus.UNAVAILABLE,
    tone,
    ratio: null,
    usageRatio: null,
    resetName: null,
  };
}

/** Captured from the three lookup tables and pill mapping before they were collapsed. */
const EXPECTED = {
  idle: {
    state: "idle",
    tone: "idle",
    attention: "quiet",
    card: "live",
    overview: "ok",
    statusTag: "",
    pill: null,
    pillA11y: null,
    cardLabel: "Live",
    overviewLabel: "…",
  },
  ok: {
    state: "ok",
    tone: "ok",
    attention: "quiet",
    card: "live",
    overview: "ok",
    statusTag: "",
    pill: null,
    pillA11y: null,
    cardLabel: "Live",
    overviewLabel: "OK",
  },
  warning: {
    state: "ok",
    tone: "warning",
    attention: "warning",
    card: "live",
    overview: "ok",
    statusTag: "",
    pill: null,
    pillA11y: null,
    cardLabel: "Live",
    overviewLabel: "OK",
  },
  partial: {
    state: "partial",
    tone: "partial",
    attention: "partial",
    card: "cached",
    overview: "partial",
    statusTag: "(partial)",
    pill: "~",
    pillA11y: "Cached",
    cardLabel: "Cached",
    overviewLabel: "Partial",
  },
  "partial-warning": {
    state: "partial",
    tone: "partial",
    attention: "warning",
    card: "cached",
    overview: "partial",
    statusTag: "(partial)",
    pill: "~",
    pillA11y: "Cached",
    cardLabel: "Cached",
    overviewLabel: "Partial",
  },
  cached: {
    state: "cached",
    tone: "partial",
    attention: "partial",
    card: "cached",
    overview: "cached",
    statusTag: "(partial)",
    pill: "~",
    pillA11y: "Cached",
    cardLabel: "Cached",
    overviewLabel: "Cached",
  },
  "cached-warning": {
    state: "cached",
    tone: "partial",
    attention: "warning",
    card: "cached",
    overview: "cached",
    statusTag: "(partial)",
    pill: "~",
    pillA11y: "Cached",
    cardLabel: "Cached",
    overviewLabel: "Cached",
  },
  critical: {
    state: "ok",
    tone: "critical",
    attention: "critical",
    card: "live",
    overview: "ok",
    statusTag: "",
    pill: null,
    pillA11y: null,
    cardLabel: "Live",
    overviewLabel: "OK",
  },
  "critical-partial": {
    state: "ok",
    tone: "critical",
    attention: "critical",
    card: "cached",
    overview: "partial",
    statusTag: "(partial)",
    pill: "~",
    pillA11y: "Cached",
    cardLabel: "Cached",
    overviewLabel: "Partial",
  },
  error: {
    state: "error",
    tone: "error",
    attention: "error",
    card: "error",
    overview: "error",
    statusTag: "(error)",
    pill: "(error)",
    pillA11y: "(error)",
    cardLabel: "Error",
    overviewLabel: "Error",
  },
  unavailable: {
    state: "unavailable",
    tone: "error",
    attention: "error",
    card: "unavailable",
    overview: "error",
    statusTag: "(unavailable)",
    pill: "(unavailable)",
    pillA11y: "(unavailable)",
    cardLabel: "Unavailable",
    overviewLabel: "Error",
  },
} as const;

describe("providerHealth pure helpers", () => {
  it("derives one ordered severity from status, worst tone, usable fields and last-known-good", () => {
    expect(deriveSeverity(ReaderStatus.ERROR, "critical", true, true)).toBe("error");
    expect(deriveSeverity(ReaderStatus.UNAVAILABLE, undefined, true, true)).toBe("unavailable");
    expect(deriveSeverity(ReaderStatus.DISABLED, undefined, true, true)).toBe("idle");
    expect(deriveSeverity(ReaderStatus.PARTIAL, "warning", true, false)).toBe("partial-warning");
    expect(deriveSeverity(ReaderStatus.PARTIAL, "warning", true, true)).toBe("cached-warning");
    expect(deriveSeverity(ReaderStatus.PARTIAL, "critical", true, true)).toBe("critical-partial");
    expect(deriveSeverity(ReaderStatus.OK, "warning", false, false)).toBe("warning");
    expect(deriveSeverity(ReaderStatus.OK, "critical", false, false)).toBe("critical");
    expect(deriveSeverity(ReaderStatus.OK, "ok", true, false)).toBe("ok");
    expect(deriveSeverity(ReaderStatus.OK, undefined, false, false)).toBe("idle");
  });

  it("carries state, tone, attention and presentation in the one severity table", () => {
    expect(HEALTH_BY_SEVERITY.error.state).toBe("error");
    expect(HEALTH_BY_SEVERITY.unavailable.state).toBe("unavailable");
    expect(HEALTH_BY_SEVERITY.idle.state).toBe("idle");
    expect(HEALTH_BY_SEVERITY["cached-warning"].state).toBe("cached");
    expect(HEALTH_BY_SEVERITY.critical.state).toBe("ok");
    expect(HEALTH_BY_SEVERITY.warning.state).toBe("ok");

    expect(HEALTH_BY_SEVERITY.error.tone).toBe("error");
    expect(HEALTH_BY_SEVERITY.unavailable.tone).toBe("error");
    expect(HEALTH_BY_SEVERITY.idle.tone).toBe("idle");
    expect(HEALTH_BY_SEVERITY.cached.tone).toBe("partial");
    expect(HEALTH_BY_SEVERITY.ok.tone).toBe("ok");
    expect(HEALTH_BY_SEVERITY.warning.tone).toBe("warning");
    expect(HEALTH_BY_SEVERITY.critical.tone).toBe("critical");

    expect(HEALTH_BY_SEVERITY.error.attention).toBe("error");
    expect(HEALTH_BY_SEVERITY.unavailable.attention).toBe("error");
    expect(HEALTH_BY_SEVERITY.idle.attention).toBe("quiet");
    expect(HEALTH_BY_SEVERITY.ok.attention).toBe("quiet");
    expect(HEALTH_BY_SEVERITY["partial-warning"].attention).toBe("warning");
    expect(HEALTH_BY_SEVERITY.cached.attention).toBe("partial");
    expect(HEALTH_BY_SEVERITY.critical.attention).toBe("critical");

    expect(HEALTH_BY_SEVERITY.partial.presentation.cardBadge).toBe("cached");
    expect(HEALTH_BY_SEVERITY.unavailable.presentation.overviewBadge).toBe("error");
    expect(HEALTH_BY_SEVERITY.error.presentation.statusTag).toBe("(error)");
    expect(HEALTH_BY_SEVERITY.cached.presentation.label.overview).toBe("Cached");
  });

  it("derives attention from tones through the single severity value", () => {
    const attentionForTones = (
      status: ReaderStatus,
      tones: readonly (FieldTone | undefined)[],
    ): string => {
      const worst = worstFieldTone(tones);
      return HEALTH_BY_SEVERITY[deriveSeverity(status, worst, false, false)].attention;
    };

    expect(attentionForTones(ReaderStatus.OK, ["ok", undefined])).toBe("quiet");
    expect(attentionForTones(ReaderStatus.PARTIAL, ["warning"])).toBe("warning");
    expect(attentionForTones(ReaderStatus.OK, ["warning", "critical"])).toBe("critical");
    expect(attentionForTones(ReaderStatus.ERROR, [])).toBe("error");
  });

  it("keeps all 80 status, tone, usable-field and last-known-good combinations identical", () => {
    const statuses = [
      ReaderStatus.OK,
      ReaderStatus.PARTIAL,
      ReaderStatus.ERROR,
      ReaderStatus.UNAVAILABLE,
      ReaderStatus.DISABLED,
    ];
    const tones: readonly (FieldTone | undefined)[] = [undefined, "ok", "warning", "critical"];
    let checked = 0;

    for (const status of statuses) {
      for (const tone of tones) {
        for (const hasUsableField of [false, true]) {
          for (const lastKnownGood of [false, true]) {
            const result: ReaderResult = {
              provider: "codex",
              status,
              fromCache: lastKnownGood,
              lastUpdated: 0,
              pathsTried: [],
              fields: [],
            };
            const health = deriveProviderHealth({
              fields: result.fields,
              fromCache: result.fromCache,
              displayStatus: status,
              views: [viewFor(tone, hasUsableField)],
              fieldDefs: [],
              t: (text) => text,
            });
            const expected = EXPECTED[deriveSeverity(status, tone, hasUsableField, lastKnownGood)];
            const label = `combination ${status}/${tone ?? "none"}/${hasUsableField}/${lastKnownGood}`;

            expect(health.state).withContext(label).toBe(expected.state);
            expect(health.tone).withContext(label).toBe(expected.tone);
            expect(health.attention).withContext(label).toBe(expected.attention);
            expect(health.presentation.cardBadge).withContext(label).toBe(expected.card);
            expect(health.presentation.overviewBadge).withContext(label).toBe(expected.overview);
            expect(health.presentation.statusTag).withContext(label).toBe(expected.statusTag);
            expect(health.presentation.label.card).withContext(label).toBe(expected.cardLabel);
            expect(health.presentation.label.overview)
              .withContext(label)
              .toBe(expected.overviewLabel);
            expect(health.stateTag).withContext(label).toBe(expected.pill);
            expect(health.stateAccessibleText).withContext(label).toBe(expected.pillA11y);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(80);
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
    const health = deriveProviderHealth({
      fields: result.fields,
      fromCache: result.fromCache,
      displayStatus: result.status,
      views,
      fieldDefs: CODEX_FIELDS,
      t: (text) => `T:${text}`,
    });

    expect(isLastKnownGood(result.status, result.fromCache)).toBeTrue();
    expect(health.severity).toBe("cached-warning");
    expect(health.state).toBe("cached");
    expect(health.tone).toBe("partial");
    expect(health.attention).toBe("warning");
    expect(health.worstTone).toBe("warning");
    expect(health.hasUsableField).toBeTrue();
    expect(health.stateTag).toBe("~");
    expect(health.stateAccessibleText).toBe("T:Cached");

    const errorResult: ReaderResult = { ...result, status: ReaderStatus.ERROR, pathsTried: [] };
    const errorHealth = deriveProviderHealth({
      fields: errorResult.fields,
      fromCache: errorResult.fromCache,
      displayStatus: errorResult.status,
      views,
      fieldDefs: CODEX_FIELDS,
      t: (text) => `T:${text}`,
    });
    expect(errorHealth.state).toBe("error");
    expect(errorHealth.stateTag).toBe("T:(error)");
    expect(errorHealth.stateAccessibleText).toBe("T:(error)");
  });
});
