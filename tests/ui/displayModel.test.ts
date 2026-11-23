import { providerRecord } from "../../src/constants.js";
import { FieldStatus, ReaderStatus } from "../../src/readers/base.js";
import type { FieldDef, ReaderResult } from "../../src/readers/base.js";
import { CODEX_FIELDS, PROVIDER_FIELDS } from "../../src/readers/fields.js";
import { deriveDisplayModel, diagnosticMessage } from "../../src/ui/displayModel.js";
import { consumedResetNames, resetDetailText, resetSlotText } from "../../src/ui/resetModel.js";
import { viewContextFromFixture, type ViewFixtureInput } from "./contextFixture.js";

const result: ReaderResult = {
  provider: "codex",
  status: ReaderStatus.OK,
  fromCache: false,
  lastUpdated: 1_700_000_000_000,
  fields: [
    { name: "used_percent_primary", value: 64, status: FieldStatus.OK },
    { name: "reset_at_primary", value: 1_700_003_600, status: FieldStatus.OK },
    { name: "plan_type", value: "plus", status: FieldStatus.OK },
  ],
};

describe("deriveDisplayModel", () => {
  it("assembles one provider from explicit options with no surrounding context", () => {
    const model = deriveDisplayModel("codex", result, {
      fieldDefs: CODEX_FIELDS,
      statusFields: ["used_percent_primary", "reset_at_primary"],
      panelFields: ["plan_type"],
      displayName: "Codex Pro",
      shortDisplayName: "CX",
      locale: "en",
      t: (text) => text,
    });

    expect(model).toBeDefined();
    expect(model?.provider).toBe("codex");
    expect(model?.displayName).toBe("Codex Pro");
    expect(model?.shortDisplayName).toBe("CX");
    expect(model?.statusViews.map((view) => view.name)).toEqual([
      "used_percent_primary",
      "reset_at_primary",
    ]);
    expect(model?.panelViews.map((view) => view.name)).toEqual(["plan_type"]);
    expect(model!.facts.badges.card).toBe("live");
    expect(model!.facts.badges.cardText).toBe("Live");
    expect(model!.facts.health.tone).toBe("warning");
    expect(model!.facts.meter.ratio).toBeCloseTo(0.64, 5);
    expect(model!.facts.diagnostic.kind).toBeNull();
  });

  it("returns nothing for a disabled result, matching the context loop", () => {
    const disabled: ReaderResult = { ...result, status: ReaderStatus.DISABLED };
    expect(
      deriveDisplayModel("codex", disabled, {
        fieldDefs: CODEX_FIELDS,
        statusFields: [],
        panelFields: [],
        displayName: "Codex",
        shortDisplayName: "Codex",
        locale: "en",
        t: (text) => text,
      }),
    ).toBeUndefined();
  });

  it("derives one model per active result and skips disabled results", () => {
    const input: ViewFixtureInput = {
      activeProviders: ["codex", "claude"],
      results: new Map([
        ["codex", result],
        ["claude", { ...result, provider: "claude", status: ReaderStatus.DISABLED }],
      ]),
      fieldDefs: PROVIDER_FIELDS,
      displayNames: providerRecord((provider) => provider),
      shortDisplayNames: providerRecord((provider) => provider.toUpperCase()),
      statusFields: providerRecord(() => []),
      panelFields: providerRecord(() => []),
      locale: "en",
      t: (text) => text,
      phase: "ready",
    };

    const models = viewContextFromFixture(input).models;
    expect(models.map((model) => model.provider)).toEqual(["codex"]);
    const direct = deriveDisplayModel("codex", result, {
      fieldDefs: CODEX_FIELDS,
      statusFields: [],
      panelFields: [],
      displayName: "codex",
      shortDisplayName: "CODEX",
      locale: "en",
      t: (text) => text,
    });
    if (!direct) throw new Error("missing direct model");
    expect(models[0]).toEqual(direct);
  });
});

describe("deriveDisplayModel owns diagnostics and reset pairing", () => {
  function modelFor(
    result: ReaderResult,
    panelFields: readonly string[],
    fieldDefs: readonly FieldDef[] = CODEX_FIELDS,
  ) {
    const model = deriveDisplayModel(result.provider, result, {
      fieldDefs,
      statusFields: [],
      panelFields,
      displayName: result.provider,
      shortDisplayName: result.provider,
      locale: "en",
      t: (text) => text,
    });
    if (!model) throw new Error(`Provider ${result.provider} is disabled`);
    return model;
  }

  it("carries one fully formed reset model instead of re-deriving it in renderers", () => {
    const model = modelFor(result, ["used_percent_primary", "reset_at_primary"]);
    const reset = model.resets.get("used_percent_primary");
    if (!reset) throw new Error("missing reset pairing");

    expect(resetSlotText(reset, "panel", "en", (text) => text)).toContain("↻");
    expect(resetDetailText(reset, "panel", "en", (text) => text)).toContain(
      "Reset at (5h window):",
    );
    expect(model.resets.has("used_percent_primary")).toBeTrue();
    expect(Array.from(consumedResetNames(model.resets))).toEqual(["reset_at_primary"]);
  });

  it("pairs resets from explicit FieldDef metadata only, never from name suffixes", () => {
    const fieldDefs = [
      {
        name: "used_percent_custom",
        label: "Used % custom",
        type: "percent" as const,
        category: "limit" as const,
        valueKind: "used" as const,
      },
      {
        name: "reset_at_custom",
        label: "Reset custom",
        type: "timestamp" as const,
        category: "limit" as const,
      },
    ];
    const customResult: ReaderResult = {
      provider: "codex",
      status: ReaderStatus.OK,
      fromCache: false,
      lastUpdated: 1_700_000_000,
      fields: [
        { name: "used_percent_custom", value: 40, status: FieldStatus.OK },
        { name: "reset_at_custom", value: 1_700_003_600, status: FieldStatus.OK },
      ],
    };

    const model = modelFor(customResult, ["used_percent_custom", "reset_at_custom"], fieldDefs);
    expect(model.resets.size).toBe(0);
    expect(consumedResetNames(model.resets).size).toBe(0);
    expect(model.panelViews.map((view) => view.name)).toEqual([
      "used_percent_custom",
      "reset_at_custom",
    ]);
  });

  it("derives one diagnostic selected by every callout renderer", () => {
    const cachedResult: ReaderResult = {
      ...result,
      status: ReaderStatus.PARTIAL,
      fromCache: true,
      pathsTried: ["oauth-api", "last-known-good"],
      lastError: "HTTP 503",
    };
    const cached = modelFor(cachedResult, []);
    expect(cached.facts.diagnostic).toEqual({
      kind: "warning",
      badge: "Cached",
      text: "HTTP 503",
    });
    expect(diagnosticMessage(cachedResult, cached.facts.diagnostic)).toBe("HTTP 503");

    const partialResult: ReaderResult = {
      ...result,
      status: ReaderStatus.PARTIAL,
      lastError: "CLI failed",
    };
    const partial = modelFor(partialResult, []);
    expect(partial.facts.diagnostic.badge).toBe("Partial");

    const errorResult: ReaderResult = { ...result, status: ReaderStatus.ERROR, lastError: "Login" };
    const error = modelFor(errorResult, []);
    expect(error.result.status).toBe(ReaderStatus.ERROR);
    expect(error.facts.diagnostic).toEqual({ kind: "error", badge: "Error", text: "Login" });

    const unavailableResult: ReaderResult = {
      ...result,
      status: ReaderStatus.UNAVAILABLE,
    };
    const unavailable = modelFor(unavailableResult, []);
    expect(unavailable.facts.diagnostic).toEqual({
      kind: "error",
      badge: "Error",
      text: "Unavailable",
    });
    expect(diagnosticMessage(unavailableResult, unavailable.facts.diagnostic)).toBe("Error");

    const healthy = modelFor(result, []);
    expect(healthy.facts.diagnostic.kind).toBeNull();
    expect(diagnosticMessage(result, healthy.facts.diagnostic)).toBeNull();
    expect(healthy.facts.lastUpdatedText).toContain("Last updated:");
  });
});
