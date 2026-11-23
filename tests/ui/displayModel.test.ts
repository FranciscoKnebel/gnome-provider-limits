import { FieldStatus, ReaderStatus } from "../../src/readers/base.js";
import type { ReaderResult } from "../../src/readers/base.js";
import { CODEX_FIELDS, PROVIDER_FIELDS } from "../../src/readers/fields.js";
import { deriveDisplayModel, deriveDisplayModels } from "../../src/ui/displayModel.js";
import { providerRecord, withDisplayModels } from "../../src/ui/viewContext.js";
import type { ProviderViewContextBase } from "../../src/ui/viewContext.js";

const result: ReaderResult = {
  provider: "codex",
  status: ReaderStatus.OK,
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
    expect(model?.badges.card).toBe("live");
    expect(model?.badges.cardText).toBe("Live");
    expect(model?.health.tone).toBe("warning");
    expect(model?.meter.ratio).toBeCloseTo(0.64, 5);
    expect(model?.diagnostic.bannerKind).toBeNull();
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

  it("stays a thin loop over active results", () => {
    const base: ProviderViewContextBase = {
      order: ["codex", "claude"],
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

    const models = withDisplayModels(base).models;
    expect(models).toEqual(deriveDisplayModels(base));
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
    expect(direct).toBeDefined();
    expect(direct?.provider).toBe(models[0].provider);
  });
});

describe("deriveDisplayModel owns diagnostics and reset pairing", () => {
  function modelFor(
    result: ReaderResult,
    panelFields: readonly string[],
    fieldDefs = CODEX_FIELDS,
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

  it("carries fully formed reset descriptors instead of re-deriving them in renderers", () => {
    const model = modelFor(result, ["used_percent_primary", "reset_at_primary"]);
    const reset = model.resetPairs.get("used_percent_primary");

    expect(model.panelViews[0].resetText).toContain("↻");
    expect(model.panelViews[0].hasResetSlot).toBeTrue();
    expect(model.resetPairs.has("used_percent_primary")).toBeTrue();
    expect(reset?.text).toContain("Reset at (5h window):");
    expect(reset?.accessibleText).toContain("Reset at (5h window):");
    expect(Array.from(model.consumedResets)).toEqual(["reset_at_primary"]);
  });

  it("pairs resets from explicit FieldDef metadata only, never from name suffixes", () => {
    const fieldDefs = [
      {
        name: "used_percent_custom",
        label: "Used % custom",
        type: "percent" as const,
        defaultZone: "panel" as const,
        category: "limit" as const,
      },
      {
        name: "reset_at_custom",
        label: "Reset custom",
        type: "timestamp" as const,
        defaultZone: "panel" as const,
        category: "limit" as const,
      },
    ];
    const customResult: ReaderResult = {
      provider: "codex",
      status: ReaderStatus.OK,
      lastUpdated: 1_700_000_000,
      fields: [
        { name: "used_percent_custom", value: 40, status: FieldStatus.OK },
        { name: "reset_at_custom", value: 1_700_003_600, status: FieldStatus.OK },
      ],
    };

    const model = modelFor(customResult, ["used_percent_custom", "reset_at_custom"], fieldDefs);
    expect(model.resetPairs.size).toBe(0);
    expect(model.consumedResets.size).toBe(0);
    expect(model.panelViews[0].resetText).toBeNull();
    expect(model.panelViews.map((view) => view.name)).toEqual([
      "used_percent_custom",
      "reset_at_custom",
    ]);
  });

  it("derives the panel callout with the same diagnostic classification", () => {
    const cached = modelFor(
      {
        ...result,
        status: ReaderStatus.PARTIAL,
        pathsTried: ["oauth-api", "last-known-good"],
        lastError: "HTTP 503",
      },
      [],
    );
    expect(cached.callout).toEqual({ kind: "warning", badge: "Cached", text: "HTTP 503" });
    expect(cached.diagnostic.bannerKind).toBe("warning");

    const partial = modelFor(
      { ...result, status: ReaderStatus.PARTIAL, lastError: "CLI failed" },
      [],
    );
    expect(partial.callout?.badge).toBe("Partial");

    const error = modelFor({ ...result, status: ReaderStatus.ERROR, lastError: "Login" }, []);
    expect(error.isHardError).toBeTrue();
    expect(error.callout).toEqual({ kind: "error", badge: "Error", text: "Login" });

    const unavailable = modelFor({ ...result, status: ReaderStatus.UNAVAILABLE }, []);
    expect(unavailable.diagnostic.bannerText).toBe("Unavailable");
    expect(unavailable.callout).toEqual({ kind: "error", badge: "Error", text: "Error" });

    const healthy = modelFor(result, []);
    expect(healthy.callout).toBeNull();
    expect(healthy.lastUpdatedText).toContain("Last updated:");
  });
});
