import { providerRecord, type ProviderName } from "../../src/constants.js";
import { FieldStatus, ReaderStatus } from "../../src/readers/base.js";
import type { FieldDef, ReaderResult } from "../../src/readers/base.js";
import {
  CLAUDE_FIELDS,
  CODEX_FIELDS,
  GROK_FIELDS,
  OPENCODE_FIELDS,
  PROVIDER_FIELDS,
} from "../../src/readers/fields.js";
import type { ProviderDisplayModel } from "../../src/ui/displayModel.js";
import { deriveDisplayModel } from "../../src/ui/displayModel.js";
import { deriveFieldViews } from "../../src/ui/fieldViews.js";
import { progressResetPresentation } from "../../src/ui/panelCards.js";
import {
  deriveProviderHealth,
  deriveSeverity,
  HEALTH_BY_SEVERITY,
  worstFieldTone,
} from "../../src/ui/providerHealth.js";
import { applyHealthToneClass, applyToneClass, type HealthTone } from "../../src/ui/tone.js";
import {
  resolveViewPhase,
  type ProviderViewContext,
  type ViewPhase,
} from "../../src/ui/viewContext.js";
import { cardsMessages, cardsRunningMessages, phaseResult } from "../../src/ui/viewMessages.js";
import { viewContextFromFixture, type ViewFixtureInput } from "./contextFixture.js";

function cardFor(options: {
  provider: ProviderName;
  fieldDefs: readonly FieldDef[];
  displayName: string;
  result: ReaderResult;
  panelFields: readonly string[];
  locale: string;
}): ProviderDisplayModel {
  const model = deriveDisplayModel(options.provider, options.result, {
    fieldDefs: options.fieldDefs,
    statusFields: [],
    panelFields: options.panelFields,
    displayName: options.displayName,
    shortDisplayName: options.displayName,
    locale: options.locale,
    t: (text) => text,
  });
  if (!model) throw new Error(`Provider ${options.provider} is disabled`);
  return model;
}

function resetTextFor(model: ProviderDisplayModel, viewName: string): string | undefined {
  const view = model.facts.views.limit.progress.find((candidate) => candidate.name === viewName);
  if (!view) return undefined;
  return progressResetPresentation(view, model.resets.get(view.name), "en", (text) => text)
    .resetText;
}

function segmentsContext(
  results: ReadonlyMap<ProviderName, ReaderResult>,
  statusFields: (provider: ProviderName) => readonly string[],
): ProviderViewContext {
  const order: readonly ProviderName[] = ["codex", "claude", "opencode", "grok"];
  const input: ViewFixtureInput = {
    results,
    locale: "en",
    statusFields: providerRecord(statusFields),
    panelFields: providerRecord(() => []),
    displayNames: providerRecord((provider) => provider.toUpperCase()),
    shortDisplayNames: providerRecord((provider) => provider.toUpperCase()),
    fieldDefs: PROVIDER_FIELDS,
    activeProviders: order,
    t: (text) => text,
    phase: resolveViewPhase(order, results),
  };
  return viewContextFromFixture(input);
}

function panelContext(options: {
  providers: readonly ProviderName[];
  results: ReadonlyMap<ProviderName, ReaderResult>;
  panelFields: (provider: ProviderName) => readonly string[];
  displayName?: (provider: ProviderName) => string;
  fieldDefs?: Readonly<Record<ProviderName, readonly FieldDef[]>>;
  phase?: ViewPhase;
}): ProviderViewContext {
  const name = (provider: ProviderName) => options.displayName?.(provider) ?? provider;
  const input: ViewFixtureInput = {
    results: options.results,
    fieldDefs: options.fieldDefs ?? providerRecord((provider) => PROVIDER_FIELDS[provider]),
    activeProviders: options.providers,
    displayNames: providerRecord(name),
    shortDisplayNames: providerRecord(name),
    statusFields: providerRecord(() => []),
    panelFields: providerRecord(options.panelFields),
    locale: "en",
    t: (text) => text,
    phase: options.phase ?? resolveViewPhase(options.providers, options.results),
  };
  return viewContextFromFixture(input);
}

function toneOf(
  status: ReaderStatus,
  tones: readonly ("ok" | "warning" | "critical" | undefined)[],
  hasUsableField: boolean,
  lastKnownGood = false,
): HealthTone {
  const worst = worstFieldTone(tones);
  return HEALTH_BY_SEVERITY[deriveSeverity(status, worst, hasUsableField, lastKnownGood)].tone;
}

describe("Fork 1 Quick Settings cards & progress bars view-model", () => {
  describe("fields metadata module", () => {
    it("exposes field definitions for every provider without GI dependencies", () => {
      expect(PROVIDER_FIELDS.codex).toBe(CODEX_FIELDS);
      expect(PROVIDER_FIELDS.claude).toBe(CLAUDE_FIELDS);
      expect(PROVIDER_FIELDS.opencode).toBe(OPENCODE_FIELDS);
      expect(PROVIDER_FIELDS.grok).toBe(GROK_FIELDS);
      expect(Object.keys(PROVIDER_FIELDS)).toEqual([
        "codex",
        "claude",
        "opencode",
        "grok",
        "cursor",
        "google",
      ]);
    });

    it("reads field categories directly from the declaration", () => {
      expect({ name: "plan_type", type: "text", category: "telemetry" }.category).toBe("telemetry");
      expect({ name: "used_percent_primary", type: "percent", category: "limit" }.category).toBe(
        "limit",
      );
      expect({ name: "limit_reached", type: "bool", category: "limit" }.category).toBe("limit");
      expect({ name: "total_cost", type: "cost", category: "telemetry" }.category).toBe(
        "telemetry",
      );
    });

    it("reads companion reset field names directly from the declaration", () => {
      expect(
        {
          name: "used_percent_primary",
          type: "percent",
          resetField: "reset_at_primary",
        }.resetField,
      ).toBe("reset_at_primary");
      expect(
        {
          name: "used_percent_weekly",
          type: "percent",
          resetField: "reset_at_weekly",
        }.resetField,
      ).toBe("reset_at_weekly");
      expect(
        {
          name: "remaining_percent_credits",
          type: "percent",
          resetField: "reset_at_credits",
        }.resetField,
      ).toBe("reset_at_credits");
      const withoutReset = (name: string, type: FieldDef["type"]): FieldDef => ({
        name,
        type,
        label: name,
        category: "limit",
      });
      expect(withoutReset("used_percent", "percent").resetField ?? null).toBeNull();
      expect(withoutReset("custom_ratio", "percent").resetField ?? null).toBeNull();
      expect(withoutReset("reset_at_weekly", "timestamp").resetField ?? null).toBeNull();
    });
  });

  describe("remaining percent view derivation", () => {
    it("keeps fillPercent equal to remaining % while urgency tone is inverted", () => {
      const result: ReaderResult = {
        provider: "grok",
        status: ReaderStatus.OK,
        fromCache: false,
        lastUpdated: 1_700_000_000_000,
        fields: [{ name: "remaining_percent_credits", value: 15, status: FieldStatus.OK }],
      };
      const views = deriveFieldViews(GROK_FIELDS, result, ["remaining_percent_credits"], {
        zone: "panel",
        locale: "en",
        t: (text) => text,
      });
      expect(views).toHaveSize(1);
      expect(views[0].fillPercent).toBe(15);
      expect(views[0].tone).toBe("critical");
      expect(views[0].usageRatio).toBeCloseTo(0.85, 5);
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

  describe("provider health derivation", () => {
    it("prioritizes hard errors, critical limits, partial state, warnings, ok, and idle", () => {
      expect(toneOf(ReaderStatus.DISABLED, [], false)).toBe("idle");
      expect(toneOf(ReaderStatus.ERROR, [], false)).toBe("error");
      expect(toneOf(ReaderStatus.UNAVAILABLE, [], false)).toBe("error");
      expect(toneOf(ReaderStatus.PARTIAL, ["critical"], true)).toBe("critical");
      expect(toneOf(ReaderStatus.PARTIAL, ["warning"], true)).toBe("partial");
      expect(toneOf(ReaderStatus.OK, ["ok", "warning"], true)).toBe("warning");
      expect(toneOf(ReaderStatus.OK, [], true)).toBe("ok");
      expect(toneOf(ReaderStatus.OK, [], false)).toBe("idle");
    });

    it("derives urgency from result percent fields even when status views only show timestamps", () => {
      const result: ReaderResult = {
        provider: "codex",
        status: ReaderStatus.OK,
        fromCache: false,
        lastUpdated: 1_700_000_000_000,
        fields: [{ name: "used_percent_primary", value: 92, status: FieldStatus.OK }],
      };
      const views = deriveFieldViews(CODEX_FIELDS, result, ["reset_at_primary"], {
        zone: "panel",
        locale: "en",
        t: (text) => text,
      });
      expect(views.every((view) => view.type !== "percent")).toBeTrue();
      expect(
        deriveProviderHealth({
          fields: result.fields,
          fromCache: result.fromCache,
          status: ReaderStatus.OK,
          views,
          fieldDefs: CODEX_FIELDS,
          t: (text) => text,
        }).tone,
      ).toBe("critical");
    });

    it("reports error and empty health through the card model", () => {
      const errorCard = cardFor({
        provider: "codex",
        fieldDefs: PROVIDER_FIELDS["codex"],
        displayName: "Codex",
        result: {
          provider: "codex",
          status: ReaderStatus.ERROR,
          fromCache: false,
          lastUpdated: Date.now(),
          lastError: "Run codex login.",
          fields: [],
        },
        panelFields: [],
        locale: "en",
      });
      expect(errorCard.facts.health.tone).toBe("error");

      const emptyCard = cardFor({
        provider: "codex",
        fieldDefs: PROVIDER_FIELDS["codex"],
        displayName: "Codex",
        result: {
          provider: "codex",
          status: ReaderStatus.OK,
          fromCache: false,
          lastUpdated: Date.now(),
          fields: [],
        },
        panelFields: [],
        locale: "en",
      });
      expect(emptyCard.facts.health.tone).toBe("idle");
    });
  });

  describe("status bar model derivation", () => {
    const statusFields = (provider: ProviderName): readonly string[] =>
      provider === "codex"
        ? ["used_percent_primary"]
        : provider === "claude"
          ? ["used_percent_session", "reset_at_session"]
          : [];

    const identity = (models: ProviderViewContext["models"]): string[] =>
      models.map((model) =>
        JSON.stringify([
          model.provider,
          model.shortDisplayName,
          model.facts.displayStatus,
          model.statusViews.map((view) => view.name),
        ]),
      );

    it("returns no models when results are empty", () => {
      expect(segmentsContext(new Map(), statusFields).models).toEqual([]);
    });

    it("skips disabled results and derives health tones, tags, and short labels", () => {
      const results = new Map<"codex" | "claude" | "opencode" | "grok", ReaderResult>([
        [
          "codex",
          {
            provider: "codex",
            status: ReaderStatus.OK,
            fromCache: false,
            lastUpdated: 1000,
            fields: [{ name: "used_percent_primary", value: 40, status: FieldStatus.OK }],
          },
        ],
        [
          "claude",
          {
            provider: "claude",
            status: ReaderStatus.PARTIAL,
            fromCache: false,
            lastUpdated: 1000,
            lastError: "cached",
            fields: [
              { name: "used_percent_session", value: 20, status: FieldStatus.OK },
              { name: "reset_at_session", value: null, status: FieldStatus.UNAVAILABLE },
            ],
          },
        ],
        [
          "opencode",
          {
            provider: "opencode",
            status: ReaderStatus.ERROR,
            fromCache: false,
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
            fromCache: false,
            lastUpdated: 1000,
            fields: [],
          },
        ],
      ]);

      const models = segmentsContext(results, statusFields).models;

      expect(models).toHaveSize(3);
      expect(models.map((model) => model.facts.health.tone)).toEqual(["ok", "partial", "error"]);
      expect(models[0].facts.health.stateTag).toBeNull();
      expect(models[1].facts.health.stateTag).toBe("~");
      expect(models[1].facts.health.stateAccessibleText).toBe("Cached");
      expect(models[2].facts.health.stateTag).toBe("(error)");
      expect(models[2].facts.meter.isError).toBeTrue();
      expect(models.map((model) => model.shortDisplayName)).toEqual([
        "CODEX",
        "CLAUDE",
        "OPENCODE",
      ]);
    });

    it("keeps model identity stable across value updates while health tone escalates", () => {
      const makeResults = (value: number) =>
        new Map<ProviderName, ReaderResult>([
          [
            "codex",
            {
              provider: "codex",
              status: ReaderStatus.OK,
              fromCache: false,
              lastUpdated: 1000,
              fields: [{ name: "used_percent_primary", value, status: FieldStatus.OK }],
            },
          ],
        ]);

      const first = segmentsContext(makeResults(40), statusFields).models;
      const second = segmentsContext(makeResults(88), statusFields).models;

      expect(identity(second)).toEqual(identity(first));
      expect(first[0].facts.health.tone).toBe("ok");
      expect(second[0].facts.health.tone).toBe("critical");
      expect(first[0].facts.meter.ratio).toBeCloseTo(0.4, 5);
      expect(second[0].facts.meter.ratio).toBeCloseTo(0.88, 5);
      expect(second[0].facts.meter.tone).toBe("critical");
    });
  });

  describe("card model & phase derivation", () => {
    it("pairs percent fields with companion reset_at fields and separates limit vs telemetry rows", () => {
      const now = Date.now();
      const result: ReaderResult = {
        provider: "opencode",
        status: ReaderStatus.OK,
        fromCache: false,
        lastUpdated: now,
        fields: [
          { name: "used_percent_weekly", value: 72, status: FieldStatus.OK },
          { name: "reset_at_weekly", value: now + 7_200_000, status: FieldStatus.OK },
          { name: "limit_reached", value: false, status: FieldStatus.OK },
          { name: "total_cost", value: 4.25, status: FieldStatus.OK },
          { name: "sessions_count", value: 18, status: FieldStatus.OK },
        ],
      };

      const card = cardFor({
        provider: "opencode",
        fieldDefs: PROVIDER_FIELDS["opencode"],
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

      expect(card.facts.badges.card).toBe("live");
      expect(card.facts.badges.cardText).toBe("Live");
      expect(card.facts.health.tone).toBe("warning");
      expect(card.facts.diagnostic).toEqual({ kind: null });
      expect(card.facts.views.limit.progress).toHaveSize(1);
      expect(card.facts.views.limit.progress[0].fillPercent).toBe(72);
      expect(card.facts.views.limit.progress[0].tone).toBe("warning");
      expect(resetTextFor(card, "used_percent_weekly")).toContain("Reset at (weekly):");
      expect(card.facts.views.limit.keyValue.map((view) => view.name)).toEqual(["limit_reached"]);
      expect(card.facts.views.telemetry.keyValue.map((view) => view.name)).toEqual([
        "total_cost",
        "sessions_count",
      ]);
    });

    it("keeps standalone reset_at fields in limitMetaRows when companion percent is not configured", () => {
      const now = Date.now();
      const card = cardFor({
        provider: "codex",
        fieldDefs: PROVIDER_FIELDS["codex"],
        displayName: "Codex",
        result: {
          provider: "codex",
          status: ReaderStatus.OK,
          fromCache: false,
          lastUpdated: now,
          fields: [{ name: "reset_at_secondary", value: now + 3_600_000, status: FieldStatus.OK }],
        },
        panelFields: ["reset_at_secondary"],
        locale: "en",
      });

      expect(card.facts.views.limit.progress).toEqual([]);
      expect(card.facts.views.limit.keyValue.map((view) => view.name)).toEqual([
        "reset_at_secondary",
      ]);
    });

    it("consumes a shared reset_at field only once when both used and remaining % are configured", () => {
      const now = Date.now();
      const card = cardFor({
        provider: "codex",
        fieldDefs: PROVIDER_FIELDS["codex"],
        displayName: "Codex",
        result: {
          provider: "codex",
          status: ReaderStatus.OK,
          fromCache: false,
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

      expect(card.facts.views.limit.progress).toHaveSize(2);
      expect(resetTextFor(card, "used_percent_secondary")).toBeDefined();
      expect(resetTextFor(card, "remaining_percent_secondary")).toBeUndefined();
      expect(card.facts.views.limit.keyValue).toEqual([]);
    });

    it("plans diagnostic banners for PARTIAL, ERROR, and UNAVAILABLE states", () => {
      const partialCard = cardFor({
        provider: "claude",
        fieldDefs: PROVIDER_FIELDS["claude"],
        displayName: "Claude",
        result: {
          provider: "claude",
          status: ReaderStatus.PARTIAL,
          fromCache: true,
          lastUpdated: Date.now(),
          lastError: "CLI fallback failed; showing Last-Known-Good.",
          fields: [{ name: "used_percent_weekly", value: 25, status: FieldStatus.OK }],
        },
        panelFields: ["used_percent_weekly"],
        locale: "en",
      });
      expect(partialCard.facts.badges.card).toBe("cached");
      expect(partialCard.facts.diagnostic).toEqual({
        kind: "warning",
        text: "CLI fallback failed; showing Last-Known-Good.",
        badge: "Cached",
        message: "CLI fallback failed; showing Last-Known-Good.",
      });
      expect(partialCard.facts.views.limit.progress).toHaveSize(1);

      const errorCard = cardFor({
        provider: "codex",
        fieldDefs: PROVIDER_FIELDS["codex"],
        displayName: "Codex",
        result: {
          provider: "codex",
          status: ReaderStatus.ERROR,
          fromCache: false,
          lastUpdated: Date.now(),
          lastError: "Run codex login.",
          fields: [],
        },
        panelFields: ["used_percent_secondary"],
        locale: "en",
      });
      expect(errorCard.facts.badges.card).toBe("error");
      expect(errorCard.facts.diagnostic).toEqual({
        kind: "error",
        text: "Run codex login.",
        badge: "Error",
        message: "Run codex login.",
      });
      expect(errorCard.facts.views.limit.progress).toEqual([]);
      expect(errorCard.facts.lastUpdatedText).toBeNull();

      const unavailableCard = cardFor({
        provider: "grok",
        fieldDefs: PROVIDER_FIELDS["grok"],
        displayName: "Grok",
        result: {
          provider: "grok",
          status: ReaderStatus.UNAVAILABLE,
          fromCache: false,
          lastUpdated: Date.now(),
          fields: [],
        },
        panelFields: ["used_percent_credits"],
        locale: "en",
      });
      expect(unavailableCard.facts.badges.card).toBe("unavailable");
      expect(unavailableCard.facts.diagnostic).toEqual({
        kind: "error",
        text: "Unavailable",
        badge: "Error",
        message: "Error",
      });
    });

    it("derives empty, loading, ready and refresh-aware card states from the view", () => {
      const disabled = phaseResult(
        panelContext({
          providers: ["codex"],
          results: new Map(),
          panelFields: () => [],
          phase: "empty",
        }),
        cardsMessages,
      );
      expect(disabled.kind).toBe("placeholder");
      if (disabled.kind === "placeholder") {
        expect(disabled.phase).toBe("empty");
        expect(disabled.message.kind).toBe("title");
        if (disabled.message.kind === "title") {
          expect(disabled.message.title).toBe("No providers enabled");
          expect(disabled.message.subtitle).toContain("Settings");
        }
      }

      const loadingView = panelContext({
        providers: ["codex"],
        results: new Map(),
        panelFields: () => [],
        phase: "loading",
      });
      const running = phaseResult(loadingView, cardsRunningMessages);
      expect(running.kind).toBe("placeholder");
      if (running.kind === "placeholder") {
        expect(running.phase).toBe("loading");
        expect(running.message.kind).toBe("title");
        if (running.message.kind === "title") {
          expect(running.message.title).toBe("Loading provider limits…");
        }
      }
      const waiting = phaseResult(loadingView, cardsMessages);
      if (waiting.kind === "placeholder") {
        expect(waiting.message.kind).toBe("title");
        if (waiting.message.kind === "title") {
          expect(waiting.message.title).toBe("Waiting for provider data…");
        }
      }

      const customDefs: readonly FieldDef[] = [
        {
          name: "used_percent_primary",
          label: "Used %",
          type: "percent",
          category: "limit",
          resetField: "reset_at_primary",
          valueKind: "used",
        },
      ];
      const firstView = panelContext({
        providers: ["codex"],
        results: new Map([
          [
            "codex",
            {
              provider: "codex",
              status: ReaderStatus.OK,
              fromCache: false,
              lastUpdated: 1000,
              fields: [{ name: "used_percent_primary", value: 20, status: FieldStatus.OK }],
            },
          ],
        ]),
        panelFields: () => ["used_percent_primary"],
        displayName: () => "Codex",
        fieldDefs: providerRecord(() => customDefs),
      });

      const secondView = panelContext({
        providers: ["codex"],
        results: new Map([
          [
            "codex",
            {
              provider: "codex",
              status: ReaderStatus.OK,
              fromCache: false,
              lastUpdated: 2000,
              fields: [{ name: "used_percent_primary", value: 95, status: FieldStatus.OK }],
            },
          ],
        ]),
        panelFields: () => ["used_percent_primary"],
        displayName: () => "Codex",
        fieldDefs: providerRecord(() => customDefs),
      });

      expect(phaseResult(firstView, cardsMessages).kind).toBe("ready");
      expect(phaseResult(secondView, cardsMessages).kind).toBe("ready");
      expect(secondView.models[0].facts.views.limit.progress[0].valueText).not.toBe(
        firstView.models[0].facts.views.limit.progress[0].valueText,
      );
    });
  });
});
