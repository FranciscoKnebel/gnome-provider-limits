import { PROVIDER_NAMES, type ProviderName } from "../../src/constants.js";
import { FieldStatus, ReaderStatus } from "../../src/readers/base.js";
import type { FieldDef, ReaderResult } from "../../src/readers/base.js";
import { PROVIDER_FIELDS } from "../../src/readers/fields.js";
import type { DisplayStatus } from "../../src/ui/displayStatus.js";
import { clampFillRatio, type FieldTone } from "../../src/ui/fieldRows.js";
import {
  areAllProvidersExpanded,
  formatSegmentedBar,
  resolveProviderExpanded,
  toggleAllProvidersExpanded,
} from "../../src/ui/matrixPlan.js";
import { deriveSeverity, HEALTH_BY_SEVERITY, worstFieldTone } from "../../src/ui/providerHealth.js";
import { applyStatusAttentionClass, applyToneClass } from "../../src/ui/tone.js";
import {
  resolveViewPhase,
  type ProviderViewContext,
  type ViewPhase,
} from "../../src/ui/viewContext.js";
import { matrixMessages, phaseResult } from "../../src/ui/viewMessages.js";
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
      status: DisplayStatus,
      tones: readonly (FieldTone | undefined)[],
    ): string => {
      const worst = worstFieldTone(tones);
      return HEALTH_BY_SEVERITY[deriveSeverity(status, worst, false, false)].attention;
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
          model.facts.health.displayStatus,
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
            fromCache: false,
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
            fromCache: false,
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
            fromCache: false,
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
            fromCache: false,
            lastUpdated: Date.now(),
            fields: [],
          },
        ],
      ]);

      const models = segmentsContext(results, STATUS_FIELDS).models;

      expect(models).toHaveSize(3);
      expect(models.map((model) => model.shortDisplayName)).toEqual(["codex", "claude", "opc"]);
      expect(models[0].statusViews.map((view) => view.valueText).join("·")).toContain("32%·");
      expect(models[0].facts.health.attention).toBe("quiet");
      expect(models[1].statusViews.map((view) => view.valueText).join("·")).toContain("82%·");
      expect(models[1].facts.health.attention).toBe("critical");
      expect(models[2].facts.health.displayStatus).toBe(ReaderStatus.ERROR);
      expect(models[2].facts.health.state).toBe("error");
      expect(models[2].facts.health.attention).toBe("error");
    });

    it("keeps model identity stable across value and attention changes", () => {
      const makeResults = (pct: number) =>
        new Map<ProviderName, ReaderResult>([
          [
            "codex",
            {
              provider: "codex",
              status: ReaderStatus.OK,
              fromCache: false,
              lastUpdated: Date.now(),
              fields: [{ name: "used_percent_primary", value: pct, status: FieldStatus.OK }],
            },
          ],
        ]);
      const statusFields = { ...STATUS_FIELDS, codex: ["used_percent_primary"] };

      const first = segmentsContext(makeResults(20), statusFields).models;
      const second = segmentsContext(makeResults(91), statusFields).models;

      expect(identity(second)).toEqual(identity(first));
      expect(first[0].facts.health.attention).toBe("quiet");
      expect(second[0].facts.health.attention).toBe("critical");
    });
  });

  describe("collapsible session helpers", () => {
    it("uses one defaultExpanded value from the canonical active provider count", () => {
      const emptyOverrides = new Map<ProviderName, boolean>();
      expect(resolveProviderExpanded("codex", true, emptyOverrides)).toBeTrue();
      expect(resolveProviderExpanded("codex", false, emptyOverrides)).toBeFalse();
    });

    it("respects explicit per-provider overrides and toggles all cleanly", () => {
      const providers: ProviderName[] = ["codex", "claude", "opencode"];
      const defaultExpanded = providers.length <= 2;
      let overrides = new Map<ProviderName, boolean>([["codex", true]]);

      expect(resolveProviderExpanded("codex", defaultExpanded, overrides)).toBeTrue();
      expect(resolveProviderExpanded("claude", defaultExpanded, overrides)).toBeFalse();
      expect(areAllProvidersExpanded(providers, defaultExpanded, overrides)).toBeFalse();
      expect(areAllProvidersExpanded([], defaultExpanded, overrides)).toBeFalse();

      overrides = toggleAllProvidersExpanded(providers, defaultExpanded, overrides);
      expect(areAllProvidersExpanded(providers, defaultExpanded, overrides)).toBeTrue();

      overrides = toggleAllProvidersExpanded(providers, defaultExpanded, overrides);
      expect(areAllProvidersExpanded(providers, defaultExpanded, overrides)).toBeFalse();
    });

    it("keeps the default stable when results contain fewer models than active providers", () => {
      const activeProviders: ProviderName[] = ["codex", "claude", "opencode"];
      const resultProviders: ProviderName[] = ["codex", "claude"];
      const defaultExpanded = activeProviders.length <= 2;
      let overrides = new Map<ProviderName, boolean>();

      expect(defaultExpanded).toBeFalse();
      expect(resultProviders.length <= 2).toBeTrue();
      expect(resolveProviderExpanded("codex", defaultExpanded, overrides)).toBeFalse();

      overrides = toggleAllProvidersExpanded(resultProviders, defaultExpanded, overrides);
      expect(resolveProviderExpanded("codex", defaultExpanded, overrides)).toBeTrue();

      overrides = toggleAllProvidersExpanded(resultProviders, defaultExpanded, overrides);
      expect(resolveProviderExpanded("codex", defaultExpanded, overrides)).toBeFalse();
    });
  });

  describe("matrix phase and provider details from models", () => {
    it("returns empty and loading messages from the phase copy", () => {
      const empty = phaseResult(
        matrixContext({ activeProviders: [], results: new Map(), phase: "empty" }),
        matrixMessages,
      );
      expect(empty.kind).toBe("placeholder");
      if (empty.kind === "placeholder") {
        expect(empty.phase).toBe("empty");
        expect(empty.message.kind).toBe("title");
        if (empty.message.kind === "title") {
          expect(empty.message.title).toContain("No providers enabled");
        }
      }

      const loadingContext = matrixContext({
        activeProviders: ["codex"],
        results: new Map(),
        phase: "loading",
      });
      const loading = phaseResult(loadingContext, matrixMessages);
      expect(loading.kind).toBe("placeholder");
      if (loading.kind === "placeholder") {
        expect(loading.phase).toBe("loading");
        expect(loading.message.kind).toBe("title");
        if (loading.message.kind === "title") {
          expect(loading.message.title).toContain("Reading provider limits");
        }
      }
      expect(loadingContext.models.length).toBe(0);
    });

    it("classifies expanded detail views into Limits and Telemetry with micro-bars only on Limit percentages", () => {
      const results = new Map<ProviderName, ReaderResult>([
        [
          "opencode",
          {
            provider: "opencode",
            status: ReaderStatus.PARTIAL,
            fromCache: false,
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

      const context = matrixContext({ activeProviders: ["opencode"], results });
      expect(phaseResult(context, matrixMessages).kind).toBe("ready");
      expect(context.models).toHaveSize(1);

      const model = context.models[0];
      const facts = model.facts;
      expect(
        resolveProviderExpanded(model.provider, context.activeProviders.length <= 2, new Map()),
      ).toBeTrue();
      expect(facts.badges.status).toBe("(partial)");
      expect(facts.usage.header.fillRatio).toBe(0.75);
      expect(formatSegmentedBar(facts.usage.header.fillRatio ?? 0, 5)).toBe("▰▰▰▰▱");
      expect(facts.usage.header.tone).toBe("warning");
      expect(facts.diagnostic).toEqual({
        kind: "warning",
        cardText: "Showing recent cached limits",
        badge: "Partial",
        calloutText: "Showing recent cached limits",
      });
      expect(facts.lastUpdatedText).toContain("Last updated:");

      const limits = model.panelViews.filter((view) => view.category !== "telemetry");
      const telemetry = model.panelViews.filter((view) => view.category === "telemetry");
      expect(limits.length).toBeGreaterThan(0);
      expect(telemetry.length).toBeGreaterThan(0);
      expect(limits[0].type).toBe("percent");
      expect(formatSegmentedBar(limits[0].ratio ?? 0, 8)).toBe("▰▰▰▰▱▱▱▱");
      expect(limits[0].tone).toBe("warning");
      expect(telemetry[0].type).toBe("cost");
      expect(telemetry[1].valueText).toBe("—");
      expect(telemetry[1].errorText).toBe("db locked");
    });

    it("normalizes remaining_percent, limit_reached, empty statusFields fallback, and collapsed groups", () => {
      const customDefs: readonly FieldDef[] = [
        {
          name: "remaining_percent_credits",
          label: "Remaining % (credits)",
          type: "percent",
          category: "limit",
          resetField: "reset_at_credits",
          valueKind: "remaining",
        },
        {
          name: "reset_at_credits",
          label: "Reset at (credits)",
          type: "timestamp",
          category: "limit",
        },
        {
          name: "limit_reached",
          label: "Limit reached",
          type: "bool",
          category: "limit",
        },
      ];

      const results = new Map<ProviderName, ReaderResult>([
        [
          "grok",
          {
            provider: "grok",
            status: ReaderStatus.OK,
            fromCache: false,
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
            fromCache: false,
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
            fromCache: false,
            lastUpdated: Date.now(),
            fields: [],
          },
        ],
      ]);

      const collapsedContext = matrixContext({
        activeProviders: ["codex", "claude", "grok"],
        results,
        statusFields: { ...STATUS_FIELDS, grok: [] },
        panelFields: { ...PANEL_FIELDS, grok: ["remaining_percent_credits", "limit_reached"] },
        fieldDefs: { ...PROVIDER_FIELDS, grok: customDefs },
      });
      const noOverrides = new Map<ProviderName, boolean>();
      const defaultExpanded = collapsedContext.activeProviders.length <= 2;
      expect(
        areAllProvidersExpanded(collapsedContext.activeProviders, defaultExpanded, noOverrides),
      ).toBeFalse();
      const grokCollapsed = collapsedContext.models.find((model) => model.provider === "grok");
      expect(resolveProviderExpanded("grok", defaultExpanded, noOverrides)).toBeFalse();
      expect(grokCollapsed?.facts.usage.header.fillRatio).toBe(1);
      expect(grokCollapsed?.facts.usage.header.tone).toBe("critical");
      expect(grokCollapsed?.facts.usage.header.summaryText).toContain("30%");

      const overrides = new Map<ProviderName, boolean>([
        ["grok", true],
        ["codex", true],
        ["claude", true],
      ]);
      const expandedContext = matrixContext({
        activeProviders: ["codex", "claude", "grok"],
        results,
        statusFields: { ...STATUS_FIELDS, grok: [] },
        panelFields: { ...PANEL_FIELDS, grok: ["remaining_percent_credits", "limit_reached"] },
        fieldDefs: { ...PROVIDER_FIELDS, grok: customDefs },
      });
      const grokExpanded = expandedContext.models.find((model) => model.provider === "grok");
      expect(resolveProviderExpanded("grok", defaultExpanded, overrides)).toBeTrue();
      expect(grokExpanded?.panelViews.filter((view) => view.category !== "telemetry")[1].tone).toBe(
        "critical",
      );

      const codexExpanded = expandedContext.models.find((model) => model.provider === "codex");
      expect(codexExpanded?.facts.diagnostic).toEqual({
        kind: "error",
        cardText: "Codex login required",
        badge: "Error",
        calloutText: "Codex login required",
      });

      const claudeExpanded = expandedContext.models.find((model) => model.provider === "claude");
      expect(claudeExpanded?.facts.usage.header.summaryText).toBe("(unavailable)");
      expect(claudeExpanded?.facts.diagnostic).toEqual({
        kind: "error",
        cardText: "Unavailable",
        badge: "Error",
        calloutText: "Error",
      });
    });
  });

  describe("tone style helpers", () => {
    it("applies standard, quiet-by-default, and status-bar attention classes cleanly", () => {
      const target = makeClassTracker();
      applyToneClass(target, "ok");
      expect(target.classes.has("usage-ok")).toBeTrue();
      applyToneClass(target, undefined);
      expect(target.classes.size).toBe(0);

      applyToneClass(target, "ok", { quiet: true });
      expect(target.classes.size).toBe(0);
      applyToneClass(target, "warning", { quiet: true });
      expect(target.classes.has("usage-warning")).toBeTrue();
      applyToneClass(target, "critical", { quiet: true });
      expect(target.classes.has("usage-critical")).toBeTrue();
      expect(target.classes.has("usage-warning")).toBeFalse();
      applyToneClass(target, "error", { quiet: true });
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
