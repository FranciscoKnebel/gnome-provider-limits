import { PROVIDER_NAMES, type ProviderName } from "../../src/constants.js";
import { FieldStatus, ReaderStatus } from "../../src/readers/base.js";
import type { FieldDef, ReaderResult } from "../../src/readers/base.js";
import { PROVIDER_FIELDS } from "../../src/readers/fields.js";
import { displayFacts } from "../../src/ui/displayModel.js";
import { clampFillRatio, type FieldTone } from "../../src/ui/fieldRows.js";
import {
  areAllProvidersExpanded,
  formatSegmentedBar,
  planPanelMatrix,
  resolveProviderExpanded,
  toggleAllProvidersExpanded,
} from "../../src/ui/matrixPlan.js";
import { deriveAttention, deriveState, worstFieldTone } from "../../src/ui/providerHealth.js";
import {
  applyQuietToneClass,
  applyStatusAttentionClass,
  applyToneClass,
} from "../../src/ui/tone.js";
import {
  resolveViewPhase,
  type ProviderViewContext,
  type ViewPhase,
} from "../../src/ui/viewContext.js";
import { viewContextFromFixture, type ViewFixtureInput } from "./contextFixture.js";

const SHORT_LABELS: Record<ProviderName, string> = {
  codex: "codex",
  claude: "claude",
  opencode: "opc",
  grok: "grok",
  cursor: "cursor",
  google: "google",
};

const DISPLAY_NAMES: Record<ProviderName, string> = {
  codex: "Codex",
  claude: "Claude",
  opencode: "OpenCode Go",
  grok: "Grok",
  cursor: "Cursor",
  google: "Google",
};

const STATUS_FIELDS: Record<ProviderName, readonly string[]> = {
  codex: ["used_percent_primary", "reset_at_primary"],
  claude: ["used_percent_session", "reset_at_session"],
  opencode: ["used_percent_rolling", "reset_at_rolling"],
  grok: ["used_percent_credits", "reset_at_credits"],
  cursor: ["used_percent_credits", "reset_at_credits"],
  google: ["used_percent_session", "reset_at_session"],
};

const PANEL_FIELDS: Record<ProviderName, readonly string[]> = {
  codex: ["used_percent_secondary", "reset_at_secondary", "limit_reached", "plan_type"],
  claude: ["used_percent_weekly", "has_extra_usage_enabled"],
  opencode: ["used_percent_weekly", "total_cost", "sessions_count"],
  grok: ["remaining_percent_credits", "prepaid_balance", "plan_type"],
  cursor: ["remaining_percent_credits", "used_percent_auto", "remaining_credits"],
  google: ["used_percent_weekly", "used_percent_3p_session", "plan_type"],
};

function segmentsContext(
  results: ReadonlyMap<ProviderName, ReaderResult>,
  statusFields: Readonly<Record<ProviderName, readonly string[]>>,
): ProviderViewContext {
  const input: ViewFixtureInput = {
    results,
    locale: "en",
    statusFields,
    panelFields: { codex: [], claude: [], opencode: [], grok: [], cursor: [], google: [] },
    displayNames: DISPLAY_NAMES,
    shortDisplayNames: SHORT_LABELS,
    fieldDefs: PROVIDER_FIELDS,
    activeProviders: PROVIDER_NAMES,
    t: (text) => text,
    phase: resolveViewPhase(PROVIDER_NAMES, results),
  };
  return viewContextFromFixture(input);
}

function matrixContext(options: {
  activeProviders: readonly ProviderName[];
  results: ReadonlyMap<ProviderName, ReaderResult>;
  statusFields?: Readonly<Record<ProviderName, readonly string[]>>;
  panelFields?: Readonly<Record<ProviderName, readonly string[]>>;
  fieldDefs?: Readonly<Record<ProviderName, readonly FieldDef[]>>;
  phase?: ViewPhase;
}): ProviderViewContext {
  const input: ViewFixtureInput = {
    results: options.results,
    fieldDefs: options.fieldDefs ?? PROVIDER_FIELDS,
    activeProviders: options.activeProviders,
    displayNames: DISPLAY_NAMES,
    shortDisplayNames: DISPLAY_NAMES,
    statusFields: options.statusFields ?? STATUS_FIELDS,
    panelFields: options.panelFields ?? PANEL_FIELDS,
    locale: "en",
    t: (text) => text,
    phase: options.phase ?? resolveViewPhase(options.activeProviders, options.results),
  };
  return viewContextFromFixture(input);
}

function makeClassTracker(): {
  classes: Set<string>;
  add_style_class_name(c: string): void;
  remove_style_class_name(c: string): void;
} {
  const classes = new Set<string>();
  return {
    classes,
    add_style_class_name(c: string) {
      classes.add(c);
    },
    remove_style_class_name(c: string) {
      classes.delete(c);
    },
  };
}

describe("matrixPlan", () => {
  describe("clampFillRatio & formatSegmentedBar", () => {
    it("clamps non-finite and out-of-range ratios safely", () => {
      expect(clampFillRatio(Number.NaN)).toBe(0);
      expect(clampFillRatio(-0.4)).toBe(0);
      expect(clampFillRatio(0.42)).toBe(0.42);
      expect(clampFillRatio(1.5)).toBe(1);
    });

    it("renders 5-segment and 8-segment bars accurately", () => {
      expect(formatSegmentedBar(0, 5)).toBe("▱▱▱▱▱");
      expect(formatSegmentedBar(0.4, 5)).toBe("▰▰▱▱▱");
      expect(formatSegmentedBar(0.8, 5)).toBe("▰▰▰▰▱");
      expect(formatSegmentedBar(1, 5)).toBe("▰▰▰▰▰");
      expect(formatSegmentedBar(0.5)).toBe("▰▰▰▰▱▱▱▱");
    });
  });

  describe("attention derivation from tones", () => {
    const attentionForTones = (
      status: ReaderStatus,
      tones: readonly (FieldTone | undefined)[],
    ): string => {
      const worst = worstFieldTone(tones);
      return deriveAttention(deriveState(status, worst, false, false), worst);
    };

    it("stays quiet by default for ok or missing tones on OK status", () => {
      expect(attentionForTones(ReaderStatus.OK, ["ok", undefined])).toBe("quiet");
      expect(attentionForTones(ReaderStatus.OK, [])).toBe("quiet");
    });

    it("escalates to partial, warning, critical, and error", () => {
      expect(attentionForTones(ReaderStatus.PARTIAL, ["ok"])).toBe("partial");
      expect(attentionForTones(ReaderStatus.PARTIAL, ["warning"])).toBe("warning");
      expect(attentionForTones(ReaderStatus.OK, ["ok", "warning"])).toBe("warning");
      expect(attentionForTones(ReaderStatus.OK, ["warning", "critical"])).toBe("critical");
      expect(attentionForTones(ReaderStatus.ERROR, ["ok"])).toBe("error");
      expect(attentionForTones(ReaderStatus.UNAVAILABLE, [])).toBe("error");
    });
  });

  describe("status bar model derivation", () => {
    const identity = (models: ProviderViewContext["models"]): string[] =>
      models.map((model) =>
        JSON.stringify([
          model.provider,
          model.shortDisplayName,
          model.result.status,
          model.statusViews.map((view) => view.name),
        ]),
      );

    it("returns no models when results are empty", () => {
      expect(segmentsContext(new Map(), STATUS_FIELDS).models).toEqual([]);
    });

    it("skips disabled results and derives short labels, metrics, and attention", () => {
      const futureReset = Date.now() + 2 * 3600 * 1000 + 15 * 60 * 1000;
      const results = new Map<ProviderName, ReaderResult>([
        [
          "codex",
          {
            provider: "codex",
            status: ReaderStatus.OK,
            lastUpdated: Date.now(),
            fields: [
              { name: "used_percent_primary", value: 32, status: FieldStatus.OK },
              { name: "reset_at_primary", value: futureReset, status: FieldStatus.OK },
            ],
          },
        ],
        [
          "claude",
          {
            provider: "claude",
            status: ReaderStatus.PARTIAL,
            lastUpdated: Date.now(),
            fields: [
              { name: "used_percent_session", value: 82, status: FieldStatus.OK },
              { name: "reset_at_session", value: futureReset, status: FieldStatus.OK },
            ],
          },
        ],
        [
          "opencode",
          {
            provider: "opencode",
            status: ReaderStatus.ERROR,
            lastUpdated: Date.now(),
            lastError: "auth failed",
            fields: [],
          },
        ],
        [
          "grok",
          {
            provider: "grok",
            status: ReaderStatus.DISABLED,
            lastUpdated: Date.now(),
            fields: [],
          },
        ],
      ]);

      const models = segmentsContext(results, STATUS_FIELDS).models;

      expect(models).toHaveSize(3);
      expect(models.map((model) => model.shortDisplayName)).toEqual(["codex", "claude", "opc"]);
      expect(models[0].statusViews.map((view) => view.valueText).join("·")).toContain("32%·");
      expect(displayFacts(models[0]).health.attention).toBe("quiet");
      expect(models[1].statusViews.map((view) => view.valueText).join("·")).toContain("82%·");
      expect(displayFacts(models[1]).health.attention).toBe("critical");
      expect(models[2].result.status).toBe(ReaderStatus.ERROR);
      expect(displayFacts(models[2]).health.state).toBe("error");
      expect(displayFacts(models[2]).health.attention).toBe("error");
    });

    it("keeps model identity stable across value and attention changes", () => {
      const makeResults = (pct: number) =>
        new Map<ProviderName, ReaderResult>([
          [
            "codex",
            {
              provider: "codex",
              status: ReaderStatus.OK,
              lastUpdated: Date.now(),
              fields: [{ name: "used_percent_primary", value: pct, status: FieldStatus.OK }],
            },
          ],
        ]);
      const statusFields = { ...STATUS_FIELDS, codex: ["used_percent_primary"] };

      const first = segmentsContext(makeResults(20), statusFields).models;
      const second = segmentsContext(makeResults(91), statusFields).models;

      expect(identity(second)).toEqual(identity(first));
      expect(displayFacts(first[0]).health.attention).toBe("quiet");
      expect(displayFacts(second[0]).health.attention).toBe("critical");
    });
  });

  describe("collapsible session helpers", () => {
    it("defaults to expanded when <= 2 providers are active and collapsed when > 2", () => {
      const emptyOverrides = new Map<ProviderName, boolean>();
      expect(resolveProviderExpanded("codex", 1, emptyOverrides)).toBeTrue();
      expect(resolveProviderExpanded("codex", 2, emptyOverrides)).toBeTrue();
      expect(resolveProviderExpanded("codex", 3, emptyOverrides)).toBeFalse();
      expect(resolveProviderExpanded("codex", 4, emptyOverrides)).toBeFalse();
    });

    it("respects explicit per-provider overrides and toggles all cleanly", () => {
      const providers: ProviderName[] = ["codex", "claude", "opencode"];
      let overrides = new Map<ProviderName, boolean>([["codex", true]]);

      expect(resolveProviderExpanded("codex", 3, overrides)).toBeTrue();
      expect(resolveProviderExpanded("claude", 3, overrides)).toBeFalse();
      expect(areAllProvidersExpanded(providers, 3, overrides)).toBeFalse();
      expect(areAllProvidersExpanded([], 0, overrides)).toBeFalse();

      overrides = toggleAllProvidersExpanded(providers, 3, overrides);
      expect(areAllProvidersExpanded(providers, 3, overrides)).toBeTrue();

      overrides = toggleAllProvidersExpanded(providers, 3, overrides);
      expect(areAllProvidersExpanded(providers, 3, overrides)).toBeFalse();
    });
  });

  describe("planPanelMatrix", () => {
    it("returns empty and loading messages appropriately", () => {
      const emptyPlan = planPanelMatrix(
        matrixContext({ activeProviders: [], results: new Map(), phase: "empty" }),
        new Map(),
      );
      expect(emptyPlan.phase).toBe("empty");
      expect(emptyPlan.messageText).toContain("No providers enabled");
      expect(emptyPlan.canToggleAll).toBeFalse();

      const loadingPlan = planPanelMatrix(
        matrixContext({ activeProviders: ["codex"], results: new Map(), phase: "loading" }),
        new Map(),
      );
      expect(loadingPlan.phase).toBe("loading");
      expect(loadingPlan.messageText).toContain("Reading provider limits");
      expect(loadingPlan.canToggleAll).toBeFalse();
    });

    it("splits expanded detail rows into Limits and Telemetry with micro-bars only on Limit percentages", () => {
      const results = new Map<ProviderName, ReaderResult>([
        [
          "opencode",
          {
            provider: "opencode",
            status: ReaderStatus.PARTIAL,
            lastUpdated: 1_700_000_000_000,
            lastError: "Showing recent cached limits",
            fields: [
              { name: "used_percent_rolling", value: 75, status: FieldStatus.OK },
              {
                name: "reset_at_rolling",
                value: Date.now() + 3600_000,
                status: FieldStatus.OK,
              },
              { name: "used_percent_weekly", value: 50, status: FieldStatus.OK },
              { name: "total_cost", value: 4.25, status: FieldStatus.OK },
              {
                name: "sessions_count",
                value: null,
                status: FieldStatus.ERROR,
                error: "db locked",
              },
            ],
          },
        ],
      ]);

      const plan = planPanelMatrix(
        matrixContext({ activeProviders: ["opencode"], results }),
        new Map(),
      );

      expect(plan.phase).toBe("ready");
      expect(plan.allExpanded).toBeTrue();
      expect(plan.providers).toHaveSize(1);

      const oc = plan.providers[0];
      expect(oc.expanded).toBeTrue();
      expect(oc.chevron).toBe("▾");
      expect(oc.statusBadge).toBe("(partial)");
      expect(oc.fillRatio).toBe(0.75);
      expect(oc.fiveSegmentBar).toBe("▰▰▰▰▱");
      expect(oc.headerTone).toBe("warning");
      expect(oc.detailText).toBe("Showing recent cached limits");
      expect(oc.lastUpdatedText).toContain("Last updated:");

      expect(oc.groups).toHaveSize(2);
      expect(oc.groups[0].category).toBe("limit");
      expect(oc.groups[0].title).toBe("Limits");
      expect(oc.groups[0].rows[0].microBar).toBe("▰▰▰▰▱▱▱▱");
      expect(oc.groups[0].rows[0].tone).toBe("warning");

      expect(oc.groups[1].category).toBe("telemetry");
      expect(oc.groups[1].title).toBe("Telemetry");
      expect(oc.groups[1].rows[0].microBar).toBeNull();
      expect(oc.groups[1].rows[1].valueText).toBe("—");
      expect(oc.groups[1].rows[1].errorText).toBe("db locked");
    });

    it("normalizes remaining_percent, limit_reached, empty statusFields fallback, and collapsed groups", () => {
      const customDefs: readonly FieldDef[] = [
        {
          name: "remaining_percent_credits",
          label: "Remaining % (credits)",
          type: "percent",
          defaultZone: "status",
          category: "limit",
          resetField: "reset_at_credits",
        },
        {
          name: "reset_at_credits",
          label: "Reset at (credits)",
          type: "timestamp",
          defaultZone: "status",
          category: "limit",
        },
        {
          name: "limit_reached",
          label: "Limit reached",
          type: "bool",
          defaultZone: "panel",
          category: "limit",
        },
      ];

      const results = new Map<ProviderName, ReaderResult>([
        [
          "grok",
          {
            provider: "grok",
            status: ReaderStatus.OK,
            lastUpdated: Date.now(),
            fields: [
              { name: "remaining_percent_credits", value: 30, status: FieldStatus.OK },
              {
                name: "reset_at_credits",
                value: Date.now() + 1800_000,
                status: FieldStatus.OK,
              },
              { name: "limit_reached", value: true, status: FieldStatus.OK },
            ],
          },
        ],
        [
          "codex",
          {
            provider: "codex",
            status: ReaderStatus.ERROR,
            lastUpdated: Date.now(),
            lastError: "Codex login required",
            fields: [],
          },
        ],
        [
          "claude",
          {
            provider: "claude",
            status: ReaderStatus.UNAVAILABLE,
            lastUpdated: Date.now(),
            fields: [],
          },
        ],
      ]);

      const collapsedPlan = planPanelMatrix(
        matrixContext({
          activeProviders: ["codex", "claude", "grok"],
          results,
          statusFields: { ...STATUS_FIELDS, grok: [] },
          panelFields: { ...PANEL_FIELDS, grok: ["remaining_percent_credits", "limit_reached"] },
          fieldDefs: { ...PROVIDER_FIELDS, grok: customDefs },
        }),
        new Map(),
      );

      expect(collapsedPlan.allExpanded).toBeFalse();
      const grokCollapsed = collapsedPlan.providers.find((p) => p.provider === "grok");
      expect(grokCollapsed?.expanded).toBeFalse();
      expect(grokCollapsed?.chevron).toBe("▸");
      expect(grokCollapsed?.groups).toEqual([]);
      expect(grokCollapsed?.fillRatio).toBe(1);
      expect(grokCollapsed?.headerTone).toBe("critical");
      expect(grokCollapsed?.primarySummary).toContain("30%");

      const expandedPlan = planPanelMatrix(
        matrixContext({
          activeProviders: ["codex", "claude", "grok"],
          results,
          statusFields: { ...STATUS_FIELDS, grok: [] },
          panelFields: { ...PANEL_FIELDS, grok: ["remaining_percent_credits", "limit_reached"] },
          fieldDefs: { ...PROVIDER_FIELDS, grok: customDefs },
        }),
        new Map<ProviderName, boolean>([
          ["grok", true],
          ["codex", true],
          ["claude", true],
        ]),
      );

      const grokExpanded = expandedPlan.providers.find((p) => p.provider === "grok");
      expect(grokExpanded?.groups[0].rows[1].tone).toBe("critical");

      const codexExpanded = expandedPlan.providers.find((p) => p.provider === "codex");
      expect(codexExpanded?.errorText).toBe("Codex login required");
      expect(codexExpanded?.groups).toEqual([]);

      const claudeExpanded = expandedPlan.providers.find((p) => p.provider === "claude");
      expect(claudeExpanded?.primarySummary).toBe("(unavailable)");
      expect(claudeExpanded?.errorText).toBe("Error");
    });
  });

  describe("tone style helpers", () => {
    it("applies standard, quiet-by-default, and status-bar attention classes cleanly", () => {
      const target = makeClassTracker();
      applyToneClass(target, "ok");
      expect(target.classes.has("usage-ok")).toBeTrue();
      applyToneClass(target, undefined);
      expect(target.classes.size).toBe(0);

      applyQuietToneClass(target, "ok");
      expect(target.classes.size).toBe(0);
      applyQuietToneClass(target, "warning");
      expect(target.classes.has("usage-warning")).toBeTrue();
      applyQuietToneClass(target, "critical");
      expect(target.classes.has("usage-critical")).toBeTrue();
      expect(target.classes.has("usage-warning")).toBeFalse();
      applyQuietToneClass(target, "error");
      expect(target.classes.has("provider-limits-error")).toBeTrue();

      const seg = makeClassTracker();
      const val = makeClassTracker();
      applyStatusAttentionClass(seg, val, "quiet");
      expect(seg.classes.size).toBe(0);
      expect(val.classes.size).toBe(0);

      applyStatusAttentionClass(seg, val, "warning");
      expect(val.classes.has("usage-warning")).toBeTrue();

      applyStatusAttentionClass(seg, val, "critical");
      expect(seg.classes.has("status-critical-accent")).toBeTrue();
      expect(val.classes.has("usage-critical")).toBeTrue();

      applyStatusAttentionClass(seg, val, "partial");
      expect(seg.classes.has("status-partial")).toBeTrue();

      applyStatusAttentionClass(seg, val, "error");
      expect(seg.classes.has("status-critical-accent")).toBeTrue();
      expect(val.classes.has("provider-limits-error")).toBeTrue();
    });
  });
});
