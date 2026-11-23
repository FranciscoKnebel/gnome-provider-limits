import type { ProviderName } from "../../src/constants.js";
import { FieldStatus, ReaderStatus } from "../../src/readers/base.js";
import type { FieldDef, ReaderResult } from "../../src/readers/base.js";
import {
  CLAUDE_FIELDS,
  CODEX_FIELDS,
  GROK_FIELDS,
  OPENCODE_FIELDS,
  PROVIDER_FIELDS,
  companionResetFieldName,
  getProviderFields,
  resolveFieldCategory,
} from "../../src/readers/fields.js";
import {
  computeBarWidthPx,
  computeProviderHealthTone,
  planPanel,
  planProviderCard,
} from "../../src/ui/cardPlan.js";
import { clampPercent, getFieldRows } from "../../src/ui/fieldRows.js";
import type {
  StatusBarProviderSegment,
  StatusBarSegmentsContext,
} from "../../src/ui/fieldViews.js";
import { deriveStatusBarSegments } from "../../src/ui/fieldViews.js";
import { applyHealthToneClass, applyToneClass } from "../../src/ui/tone.js";

function segmentsContext(
  results: ReadonlyMap<ProviderName, ReaderResult>,
  statusFields: (provider: ProviderName) => readonly string[],
): StatusBarSegmentsContext {
  return {
    order: ["codex", "claude", "opencode", "grok"],
    results,
    locale: "en",
    statusFields,
    shortDisplayName: (provider) => provider.toUpperCase(),
    fieldDefs: (provider) => getProviderFields(provider),
    t: (text) => text,
  };
}

describe("Fork 1 Quick Settings cards & progress bars view-model", () => {
  describe("fields metadata module", () => {
    it("exposes field definitions for every provider without GI dependencies", () => {
      expect(getProviderFields("codex")).toBe(CODEX_FIELDS);
      expect(getProviderFields("claude")).toBe(CLAUDE_FIELDS);
      expect(getProviderFields("opencode")).toBe(OPENCODE_FIELDS);
      expect(getProviderFields("grok")).toBe(GROK_FIELDS);
      expect(Object.keys(PROVIDER_FIELDS)).toEqual([
        "codex",
        "claude",
        "opencode",
        "grok",
        "cursor",
        "google",
      ]);
    });

    it("resolves field categories from name and type", () => {
      expect(resolveFieldCategory({ name: "plan_type", type: "text" })).toBe("telemetry");
      expect(resolveFieldCategory({ name: "used_percent_primary", type: "percent" })).toBe("limit");
      expect(resolveFieldCategory({ name: "limit_reached", type: "bool" })).toBe("limit");
      expect(resolveFieldCategory({ name: "total_cost", type: "cost" })).toBe("telemetry");
    });

    it("computes companion reset field names for percent fields", () => {
      expect(
        companionResetFieldName({
          name: "used_percent_primary",
          type: "percent",
          windowGroup: "primary",
        }),
      ).toBe("reset_at_primary");
      expect(
        companionResetFieldName({
          name: "used_percent_weekly",
          type: "percent",
        }),
      ).toBe("reset_at_weekly");
      expect(
        companionResetFieldName({
          name: "remaining_percent_credits",
          type: "percent",
        }),
      ).toBe("reset_at_credits");
      expect(companionResetFieldName({ name: "used_percent", type: "percent" })).toBe("reset_at");
      expect(companionResetFieldName({ name: "remaining_percent", type: "percent" })).toBe(
        "reset_at",
      );
      expect(companionResetFieldName({ name: "custom_ratio", type: "percent" })).toBeNull();
      expect(companionResetFieldName({ name: "reset_at_weekly", type: "timestamp" })).toBeNull();
    });
  });

  describe("clampPercent and getFieldRows fillPercent", () => {
    it("clamps numeric values into 0..100", () => {
      expect(clampPercent(-12)).toBe(0);
      expect(clampPercent(0)).toBe(0);
      expect(clampPercent(42.5)).toBe(42.5);
      expect(clampPercent(100)).toBe(100);
      expect(clampPercent(135)).toBe(100);
      expect(clampPercent(Number.NaN)).toBeUndefined();
      expect(clampPercent(null)).toBeUndefined();
      expect(clampPercent("50")).toBeUndefined();
    });

    it("keeps fillPercent equal to remaining % while urgency tone is inverted", () => {
      const result: ReaderResult = {
        provider: "grok",
        status: ReaderStatus.OK,
        lastUpdated: 1_700_000_000_000,
        fields: [{ name: "remaining_percent_credits", value: 15, status: FieldStatus.OK }],
      };
      const rows = getFieldRows(GROK_FIELDS, result, ["remaining_percent_credits"], "panel", "en");
      expect(rows).toHaveSize(1);
      expect(rows[0].fillPercent).toBe(15);
      expect(rows[0].tone).toBe("critical");
    });
  });

  describe("tone class helpers", () => {
    function mockActor() {
      const classes = new Set<string>(["existing"]);
      return {
        classes,
        add_style_class_name: (cls: string) => classes.add(cls),
        remove_style_class_name: (cls: string) => classes.delete(cls),
      };
    }

    it("swaps usage tone classes cleanly", () => {
      const actor = mockActor();
      applyToneClass(actor, "warning");
      expect(actor.classes.has("usage-warning")).toBeTrue();
      applyToneClass(actor, "critical");
      expect(actor.classes.has("usage-warning")).toBeFalse();
      expect(actor.classes.has("usage-critical")).toBeTrue();
      applyToneClass(actor, undefined);
      expect(actor.classes.has("usage-critical")).toBeFalse();
      expect(actor.classes.has("existing")).toBeTrue();
    });

    it("swaps health tone classes cleanly", () => {
      const actor = mockActor();
      applyHealthToneClass(actor, "ok");
      expect(actor.classes.has("tone-ok")).toBeTrue();
      applyHealthToneClass(actor, "partial");
      expect(actor.classes.has("tone-ok")).toBeFalse();
      expect(actor.classes.has("tone-partial")).toBeTrue();
    });
  });

  describe("computeProviderHealthTone & computeBarWidthPx", () => {
    it("prioritizes hard errors, critical limits, partial state, warnings, ok, and idle", () => {
      expect(computeProviderHealthTone(ReaderStatus.DISABLED, [])).toBe("idle");
      expect(computeProviderHealthTone(ReaderStatus.ERROR, [])).toBe("error");
      expect(computeProviderHealthTone(ReaderStatus.UNAVAILABLE, [])).toBe("error");
      expect(
        computeProviderHealthTone(ReaderStatus.PARTIAL, [
          { label: "Used %", valueText: "85%", tone: "critical" },
        ]),
      ).toBe("critical");
      expect(
        computeProviderHealthTone(ReaderStatus.PARTIAL, [
          { label: "Used %", valueText: "60%", tone: "warning" },
        ]),
      ).toBe("partial");
      expect(
        computeProviderHealthTone(ReaderStatus.OK, [
          { label: "Used %", valueText: "20%", tone: "ok" },
          { label: "Weekly %", valueText: "65%", tone: "warning" },
        ]),
      ).toBe("warning");
      expect(
        computeProviderHealthTone(ReaderStatus.OK, [{ label: "Plan", valueText: "plus" }]),
      ).toBe("ok");
      expect(computeProviderHealthTone(ReaderStatus.OK, [{ label: "Plan", valueText: "—" }])).toBe(
        "idle",
      );
    });

    it("derives urgency from result percent fields even if status bar only shows timestamps", () => {
      const tone = computeProviderHealthTone(
        ReaderStatus.OK,
        [{ label: "Reset at", valueText: "2h" }],
        [{ name: "used_percent_primary", value: 92, status: FieldStatus.OK }],
        CODEX_FIELDS,
      );
      expect(tone).toBe("critical");
    });

    it("computes proportional bar pixel widths with min cap and bounds", () => {
      expect(computeBarWidthPx(200, 0)).toBe(0);
      expect(computeBarWidthPx(200, -10)).toBe(0);
      expect(computeBarWidthPx(200, 1)).toBe(4);
      expect(computeBarWidthPx(200, 50)).toBe(100);
      expect(computeBarWidthPx(200, 100)).toBe(200);
      expect(computeBarWidthPx(200, 140)).toBe(200);
      expect(computeBarWidthPx(0, 50, 240)).toBe(120);
    });
  });

  describe("deriveStatusBarSegments", () => {
    const statusFields = (provider: ProviderName): readonly string[] =>
      provider === "codex"
        ? ["used_percent_primary"]
        : provider === "claude"
          ? ["used_percent_session"]
          : [];

    const identity = (segments: readonly StatusBarProviderSegment[]): string[] =>
      segments.map((segment) =>
        JSON.stringify([
          segment.provider,
          segment.displayName,
          segment.result.status,
          segment.statusFields,
          segment.views.map((view) => view.name),
        ]),
      );

    it("returns no segments when results are empty", () => {
      expect(deriveStatusBarSegments(segmentsContext(new Map(), statusFields))).toEqual([]);
    });

    it("skips disabled results and derives health tones, tags, and short labels", () => {
      const results = new Map<"codex" | "claude" | "opencode" | "grok", ReaderResult>([
        [
          "codex",
          {
            provider: "codex",
            status: ReaderStatus.OK,
            lastUpdated: 1000,
            fields: [{ name: "used_percent_primary", value: 40, status: FieldStatus.OK }],
          },
        ],
        [
          "claude",
          {
            provider: "claude",
            status: ReaderStatus.PARTIAL,
            lastUpdated: 1000,
            lastError: "cached",
            fields: [{ name: "used_percent_session", value: 60, status: FieldStatus.OK }],
          },
        ],
        [
          "opencode",
          {
            provider: "opencode",
            status: ReaderStatus.ERROR,
            lastUpdated: 1000,
            lastError: "offline",
            fields: [],
          },
        ],
        [
          "grok",
          {
            provider: "grok",
            status: ReaderStatus.DISABLED,
            lastUpdated: 1000,
            fields: [],
          },
        ],
      ]);

      const segments = deriveStatusBarSegments(segmentsContext(results, statusFields));

      expect(segments).toHaveSize(3);
      expect(segments.map((segment) => segment.health.tone)).toEqual(["ok", "partial", "error"]);
      expect(segments[0].health.stateTag).toBeNull();
      expect(segments[1].health.stateTag).toBe("~");
      expect(segments[1].health.stateAccessibleText).toBe("Cached");
      expect(segments[2].health.stateTag).toBe("(error)");
      expect(segments.map((segment) => segment.displayName)).toEqual([
        "CODEX",
        "CLAUDE",
        "OPENCODE",
      ]);
    });

    it("keeps segment identity stable across value updates while health tone escalates", () => {
      const makeResults = (value: number) =>
        new Map<ProviderName, ReaderResult>([
          [
            "codex",
            {
              provider: "codex",
              status: ReaderStatus.OK,
              lastUpdated: 1000,
              fields: [{ name: "used_percent_primary", value, status: FieldStatus.OK }],
            },
          ],
        ]);

      const first = deriveStatusBarSegments(segmentsContext(makeResults(40), statusFields));
      const second = deriveStatusBarSegments(segmentsContext(makeResults(88), statusFields));

      expect(identity(second)).toEqual(identity(first));
      expect(first[0].health.tone).toBe("ok");
      expect(second[0].health.tone).toBe("critical");
    });
  });

  describe("planProviderCard & planPanel", () => {
    it("pairs percent fields with companion reset_at fields and separates limit vs telemetry rows", () => {
      const now = Date.now();
      const result: ReaderResult = {
        provider: "opencode",
        status: ReaderStatus.OK,
        lastUpdated: now,
        fields: [
          { name: "used_percent_weekly", value: 72, status: FieldStatus.OK },
          { name: "reset_at_weekly", value: now + 7_200_000, status: FieldStatus.OK },
          { name: "limit_reached", value: false, status: FieldStatus.OK },
          { name: "total_cost", value: 4.25, status: FieldStatus.OK },
          { name: "sessions_count", value: 18, status: FieldStatus.OK },
        ],
      };

      const card = planProviderCard({
        provider: "opencode",
        displayName: "OpenCode Go",
        result,
        panelFields: [
          "used_percent_weekly",
          "reset_at_weekly",
          "limit_reached",
          "total_cost",
          "sessions_count",
        ],
        locale: "en",
      });

      expect(card.badgeKind).toBe("live");
      expect(card.badgeText).toBe("Live");
      expect(card.healthTone).toBe("warning");
      expect(card.bannerText).toBeNull();
      expect(card.limitProgressRows).toHaveSize(1);
      expect(card.limitProgressRows[0].fillPercent).toBe(72);
      expect(card.limitProgressRows[0].tone).toBe("warning");
      expect(card.limitProgressRows[0].resetText).toContain("Reset at (weekly):");
      expect(card.limitMetaRows.map((r) => r.name)).toEqual(["limit_reached"]);
      expect(card.telemetryRows.map((r) => r.name)).toEqual(["total_cost", "sessions_count"]);
    });

    it("keeps standalone reset_at fields in limitMetaRows when companion percent is not configured", () => {
      const now = Date.now();
      const card = planProviderCard({
        provider: "codex",
        displayName: "Codex",
        result: {
          provider: "codex",
          status: ReaderStatus.OK,
          lastUpdated: now,
          fields: [{ name: "reset_at_secondary", value: now + 3_600_000, status: FieldStatus.OK }],
        },
        panelFields: ["reset_at_secondary"],
        locale: "en",
      });

      expect(card.limitProgressRows).toEqual([]);
      expect(card.limitMetaRows.map((r) => r.name)).toEqual(["reset_at_secondary"]);
    });

    it("consumes a shared reset_at field only once when both used and remaining % are configured", () => {
      const now = Date.now();
      const card = planProviderCard({
        provider: "codex",
        displayName: "Codex",
        result: {
          provider: "codex",
          status: ReaderStatus.OK,
          lastUpdated: now,
          fields: [
            { name: "used_percent_secondary", value: 30, status: FieldStatus.OK },
            { name: "remaining_percent_secondary", value: 70, status: FieldStatus.OK },
            { name: "reset_at_secondary", value: now + 3_600_000, status: FieldStatus.OK },
          ],
        },
        panelFields: [
          "used_percent_secondary",
          "remaining_percent_secondary",
          "reset_at_secondary",
        ],
        locale: "en",
      });

      expect(card.limitProgressRows).toHaveSize(2);
      expect(card.limitProgressRows[0].resetText).toBeDefined();
      expect(card.limitProgressRows[1].resetText).toBeUndefined();
      expect(card.limitMetaRows).toEqual([]);
    });

    it("plans diagnostic banners for PARTIAL, ERROR, and UNAVAILABLE states", () => {
      const partialCard = planProviderCard({
        provider: "claude",
        displayName: "Claude",
        result: {
          provider: "claude",
          status: ReaderStatus.PARTIAL,
          lastUpdated: Date.now(),
          lastError: "CLI fallback failed; showing Last-Known-Good.",
          fields: [{ name: "used_percent_weekly", value: 25, status: FieldStatus.OK }],
        },
        panelFields: ["used_percent_weekly"],
        locale: "en",
      });
      expect(partialCard.badgeKind).toBe("cached");
      expect(partialCard.bannerKind).toBe("warning");
      expect(partialCard.bannerText).toContain("Last-Known-Good");
      expect(partialCard.limitProgressRows).toHaveSize(1);

      const errorCard = planProviderCard({
        provider: "codex",
        displayName: "Codex",
        result: {
          provider: "codex",
          status: ReaderStatus.ERROR,
          lastUpdated: Date.now(),
          lastError: "Run codex login.",
          fields: [],
        },
        panelFields: ["used_percent_secondary"],
        locale: "en",
      });
      expect(errorCard.badgeKind).toBe("error");
      expect(errorCard.bannerKind).toBe("error");
      expect(errorCard.bannerText).toBe("Run codex login.");
      expect(errorCard.limitProgressRows).toEqual([]);
      expect(errorCard.lastUpdatedText).toBeNull();

      const unavailableCard = planProviderCard({
        provider: "grok",
        displayName: "Grok",
        result: {
          provider: "grok",
          status: ReaderStatus.UNAVAILABLE,
          lastUpdated: Date.now(),
          fields: [],
        },
        panelFields: ["used_percent_credits"],
        locale: "en",
      });
      expect(unavailableCard.badgeKind).toBe("unavailable");
      expect(unavailableCard.bannerKind).toBe("error");
      expect(unavailableCard.bannerText).toBe("Unavailable");
    });

    it("plans empty disabled and loading states in planPanel and preserves key across value updates", () => {
      const disabledPlan = planPanel({
        order: ["codex"],
        results: new Map(),
        hasEnabledProviders: false,
        running: false,
        locale: "en",
        getDisplayName: (p) => p,
        getPanelFields: () => [],
      });
      expect(disabledPlan.emptyState).toBe("disabled");
      expect(disabledPlan.emptyTitle).toBe("No providers enabled");
      expect(disabledPlan.emptySubtitle).toContain("Settings");

      const loadingPlan = planPanel({
        order: ["codex"],
        results: new Map(),
        hasEnabledProviders: true,
        running: true,
        locale: "en",
        getDisplayName: (p) => p,
        getPanelFields: () => [],
      });
      expect(loadingPlan.emptyState).toBe("loading");
      expect(loadingPlan.emptyTitle).toBe("Loading provider limits…");

      const waitingPlan = planPanel({
        order: ["codex"],
        results: new Map(),
        hasEnabledProviders: true,
        running: false,
        locale: "en",
        getDisplayName: (p) => p,
        getPanelFields: () => [],
      });
      expect(waitingPlan.emptyTitle).toBe("Waiting for provider data…");
      expect(waitingPlan.structureKey).toBe(loadingPlan.structureKey);

      const customDefs: readonly FieldDef[] = [
        { name: "used_percent_primary", label: "Used %", type: "percent", defaultZone: "panel" },
      ];
      const firstActive = planPanel({
        order: ["codex"],
        results: new Map([
          [
            "codex",
            {
              provider: "codex",
              status: ReaderStatus.OK,
              lastUpdated: 1000,
              fields: [{ name: "used_percent_primary", value: 20, status: FieldStatus.OK }],
            },
          ],
        ]),
        hasEnabledProviders: true,
        running: false,
        locale: "en",
        getDisplayName: () => "Codex",
        getPanelFields: () => ["used_percent_primary"],
        getFieldDefs: () => customDefs,
      });

      const secondActive = planPanel({
        order: ["codex"],
        results: new Map([
          [
            "codex",
            {
              provider: "codex",
              status: ReaderStatus.OK,
              lastUpdated: 2000,
              fields: [{ name: "used_percent_primary", value: 95, status: FieldStatus.OK }],
            },
          ],
        ]),
        hasEnabledProviders: true,
        running: false,
        locale: "en",
        getDisplayName: () => "Codex",
        getPanelFields: () => ["used_percent_primary"],
        getFieldDefs: () => customDefs,
      });

      expect(firstActive.emptyState).toBe("none");
      expect(secondActive.structureKey).toBe(firstActive.structureKey);
    });
  });
});
