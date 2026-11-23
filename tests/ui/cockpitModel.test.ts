import { PROVIDER_NAMES } from "../../src/constants.js";
import { FieldStatus, ReaderStatus } from "../../src/readers/base.js";
import type { ReaderResult } from "../../src/readers/base.js";
import type { FieldDef } from "../../src/readers/base.js";
import {
  CLAUDE_FIELDS,
  CODEX_FIELDS,
  GROK_FIELDS,
  OPENCODE_FIELDS,
  PROVIDER_FIELDS,
} from "../../src/readers/fields.js";
import {
  CAIRO_LINE_CAP_ROUND,
  GAUGE_END_ANGLE,
  GAUGE_START_ANGLE,
  GAUGE_SWEEP_ANGLE,
  TONE_RGB,
  connectRepaint,
  disposeCairoContext,
  drawMicroRing,
  drawMiniCapsule,
  drawRadialGauge,
  isCairoContext,
} from "../../src/ui/cairoDrawing.js";
import type { CairoContextLike } from "../../src/ui/cairoDrawing.js";
import {
  buildOverviewRowModel,
  chunkGauges,
  chunkPairs,
  computeGaugeGeometry,
  cycleTab,
  getAvailableTabs,
  loadingOverviewRow,
  partitionProviderPanel,
  resolveActiveTab,
} from "../../src/ui/cockpitModel.js";
import { deriveDisplayModel } from "../../src/ui/displayModel.js";

function panelModel(
  fieldDefs: readonly FieldDef[],
  result: ReaderResult,
  panelFields: readonly string[],
  locale = "en",
) {
  const model = deriveDisplayModel(result.provider, result, {
    fieldDefs,
    statusFields: [],
    panelFields,
    displayName: result.provider,
    shortDisplayName: result.provider,
    locale,
    t: (text) => text,
  });
  if (!model) throw new Error(`Provider ${result.provider} is disabled`);
  return model;
}

function overviewRowFor(options: {
  provider: ReaderResult["provider"];
  displayName: string;
  fieldsDefs: readonly FieldDef[];
  result: ReaderResult | undefined;
  statusFieldNames: readonly string[];
  panelFieldNames: readonly string[];
  locale: string;
}) {
  if (!options.result) return loadingOverviewRow(options.provider, options.displayName);
  const model = deriveDisplayModel(options.provider, options.result, {
    fieldDefs: options.fieldsDefs,
    statusFields: options.statusFieldNames,
    panelFields: options.panelFieldNames,
    displayName: options.displayName,
    shortDisplayName: options.displayName,
    locale: options.locale,
    t: (text) => text,
  });
  if (!model) throw new Error(`Provider ${options.provider} is disabled`);
  return buildOverviewRowModel(model);
}
import { clampRatio } from "../../src/ui/fieldRows.js";
import { deriveFieldViews, meterFromViews, type FieldView } from "../../src/ui/fieldViews.js";

function gaugeView(fieldName: string, value: unknown): FieldView {
  const result: ReaderResult = {
    provider: "codex",
    status: ReaderStatus.OK,
    lastUpdated: 0,
    fields: value === null ? [] : [{ name: fieldName, value, status: FieldStatus.OK }],
  };
  const view = deriveFieldViews(CODEX_FIELDS, result, [fieldName])[0];
  if (!view) throw new Error(`No view for ${fieldName}`);
  return view;
}

interface RecordedCairoOp {
  readonly op: string;
  readonly args: readonly number[];
}

function createMockCairoContext(withDispose = true): {
  cr: CairoContextLike;
  ops: RecordedCairoOp[];
  disposed: () => boolean;
} {
  const ops: RecordedCairoOp[] = [];
  let wasDisposed = false;

  const cr: CairoContextLike = {
    save: () => ops.push({ op: "save", args: [] }),
    restore: () => ops.push({ op: "restore", args: [] }),
    newPath: () => ops.push({ op: "newPath", args: [] }),
    newSubPath: () => ops.push({ op: "newSubPath", args: [] }),
    moveTo: (x, y) => ops.push({ op: "moveTo", args: [x, y] }),
    lineTo: (x, y) => ops.push({ op: "lineTo", args: [x, y] }),
    arc: (xc, yc, r, a1, a2) => ops.push({ op: "arc", args: [xc, yc, r, a1, a2] }),
    setLineWidth: (w) => ops.push({ op: "setLineWidth", args: [w] }),
    setLineCap: (cap) => ops.push({ op: "setLineCap", args: [cap] }),
    setSourceRGBA: (r, g, b, a) => ops.push({ op: "setSourceRGBA", args: [r, g, b, a] }),
    stroke: () => ops.push({ op: "stroke", args: [] }),
    ...(withDispose
      ? {
          $dispose: () => {
            wasDisposed = true;
          },
        }
      : {}),
  };

  return { cr, ops, disposed: () => wasDisposed };
}

describe("src/readers/fields", () => {
  it("exposes pure FieldDef arrays for all providers without duplicate field names", () => {
    expect(PROVIDER_FIELDS.codex).toBe(CODEX_FIELDS);
    expect(PROVIDER_FIELDS.claude).toBe(CLAUDE_FIELDS);
    expect(PROVIDER_FIELDS.opencode).toBe(OPENCODE_FIELDS);
    expect(PROVIDER_FIELDS.grok).toBe(GROK_FIELDS);

    for (const provider of PROVIDER_NAMES) {
      const defs = PROVIDER_FIELDS[provider];
      expect(defs.length).toBeGreaterThan(0);
      const names = defs.map((d) => d.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});

describe("cockpitModel gauge math", () => {
  it("clampRatio clamps numeric percentages to [0, 1] and rejects non-finite values", () => {
    expect(clampRatio(0)).toBe(0);
    expect(clampRatio(42.5)).toBeCloseTo(0.425, 5);
    expect(clampRatio(100)).toBe(1);
    expect(clampRatio(-15)).toBe(0);
    expect(clampRatio(145)).toBe(1);
    expect(clampRatio(Number.NaN)).toBeNull();
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBeNull();
    expect(clampRatio(null)).toBeNull();
    expect(clampRatio("50")).toBeNull();
  });

  it("TONE_RGB maps semantic tones to RGB tuples in [0, 1]", () => {
    for (const tone of ["ok", "warning", "critical", "neutral"] as const) {
      const rgb = TONE_RGB[tone];
      for (const channel of rgb) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  it("computeGaugeGeometry calculates sweep angles and tones for used_* and remaining_* fields", () => {
    const lowUsed = computeGaugeGeometry(gaugeView("used_percent_primary", 25), "en");
    expect(lowUsed.hasValue).toBeTrue();
    expect(lowUsed.ratio).toBeCloseTo(0.25, 5);
    expect(lowUsed.startAngle).toBeCloseTo(GAUGE_START_ANGLE, 5);
    expect(lowUsed.endAngle).toBeCloseTo(GAUGE_START_ANGLE + 0.25 * GAUGE_SWEEP_ANGLE, 5);
    expect(lowUsed.trackEndAngle).toBeCloseTo(GAUGE_END_ANGLE, 5);
    expect(lowUsed.tone).toBe("ok");
    expect(lowUsed.centerText).toBe("25%");

    const warnUsed = computeGaugeGeometry(gaugeView("used_percent_primary", 75), "en");
    expect(warnUsed.tone).toBe("warning");
    expect(warnUsed.fieldTone).toBe("warning");

    const critUsed = computeGaugeGeometry(gaugeView("used_percent_primary", 92), "en");
    expect(critUsed.tone).toBe("critical");
    expect(critUsed.fieldTone).toBe("critical");

    const lowRemaining = computeGaugeGeometry(gaugeView("remaining_percent_primary", 8), "en");
    expect(lowRemaining.tone).toBe("critical");
    expect(lowRemaining.fieldTone).toBe("critical");
    expect(lowRemaining.centerText).toBe("8%");
    expect(lowRemaining.ratio).toBeCloseTo(0.92, 5);

    const warnRemaining = computeGaugeGeometry(gaugeView("remaining_percent_primary", 35), "en");
    expect(warnRemaining.tone).toBe("warning");
    expect(warnRemaining.ratio).toBeCloseTo(0.65, 5);

    const missing = computeGaugeGeometry(gaugeView("used_percent_primary", null), "en");
    expect(missing.hasValue).toBeFalse();
    expect(missing.ratio).toBe(0);
    expect(missing.endAngle).toBe(GAUGE_START_ANGLE);
    expect(missing.tone).toBe("neutral");
    expect(missing.centerText).toBe("—");
  });
});

describe("meterFromViews", () => {
  const okResult: ReaderResult = {
    provider: "codex",
    status: ReaderStatus.OK,
    lastUpdated: 1_700_000_000,
    fields: [
      { name: "used_percent_primary", value: 30, status: FieldStatus.OK },
      { name: "used_percent_secondary", value: 65, status: FieldStatus.OK },
    ],
  };

  it("derives the meter from already-derived views in their given order", () => {
    const secondaryFirst = deriveFieldViews(CODEX_FIELDS, okResult, [
      "used_percent_secondary",
      "used_percent_primary",
    ]);
    const secondPicked = meterFromViews(secondaryFirst);
    expect(secondPicked.hasValue).toBeTrue();
    expect(secondPicked.ratio).toBeCloseTo(0.65, 5);
    expect(secondPicked.tone).toBe("warning");
    expect(secondPicked.isError).toBeFalse();

    const primaryFirst = deriveFieldViews(CODEX_FIELDS, okResult, [
      "used_percent_primary",
      "used_percent_secondary",
    ]);
    const fallbackPicked = meterFromViews(primaryFirst);
    expect(fallbackPicked.hasValue).toBeTrue();
    expect(fallbackPicked.ratio).toBeCloseTo(0.3, 5);
    expect(fallbackPicked.tone).toBe("ok");
  });

  it("returns a neutral spec when no derived percent view has a value", () => {
    const emptyOkResult: ReaderResult = {
      provider: "codex",
      status: ReaderStatus.OK,
      lastUpdated: 1_700_000_000,
      fields: [{ name: "used_percent_primary", value: null, status: FieldStatus.UNAVAILABLE }],
    };
    const views = deriveFieldViews(CODEX_FIELDS, emptyOkResult, ["used_percent_primary"]);
    const neutralSpec = meterFromViews(views);
    expect(neutralSpec.isError).toBeFalse();
    expect(neutralSpec.hasValue).toBeFalse();
    expect(neutralSpec.tone).toBe("neutral");
  });

  it("carries the error meter on models for ERROR and UNAVAILABLE results", () => {
    for (const status of [ReaderStatus.ERROR, ReaderStatus.UNAVAILABLE] as const) {
      const result: ReaderResult = {
        provider: "codex",
        status,
        lastUpdated: 1_700_000_000,
        fields: [],
        lastError: "Auth expired",
      };
      const model = deriveDisplayModel("codex", result, {
        fieldDefs: CODEX_FIELDS,
        statusFields: [],
        panelFields: [],
        displayName: "Codex",
        shortDisplayName: "Codex",
        locale: "en",
        t: (message) => message,
      });
      expect(model).toBeDefined();
      expect(model?.meter.isError).toBeTrue();
      expect(model?.meter.hasValue).toBeFalse();
      expect(model?.meter.tone).toBe("critical");
    }
  });
});

describe("partitionProviderPanel & chunking", () => {
  it("chunks gauges into balanced rows of 1-3 (with 4 split into 2+2) and Bento into pairs", () => {
    expect(chunkGauges([])).toEqual([]);
    expect(chunkGauges([1, 2])).toEqual([[1, 2]]);
    expect(chunkGauges([1, 2, 3])).toEqual([[1, 2, 3]]);
    expect(chunkGauges([1, 2, 3, 4])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(chunkGauges([1, 2, 3, 4, 5])).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);

    expect(chunkPairs([1, 2, 3])).toEqual([[1, 2], [3]]);
  });

  it("pairs reset_at_* timestamps with matching percent gauges and puts remaining fields into Bento pairs", () => {
    const futureEpoch = Math.floor(Date.now() / 1000) + 7200;
    const result: ReaderResult = {
      provider: "codex",
      status: ReaderStatus.OK,
      lastUpdated: 1_700_000_000,
      fields: [
        { name: "used_percent_primary", value: 40, status: FieldStatus.OK },
        { name: "reset_at_primary", value: futureEpoch, status: FieldStatus.OK },
        { name: "used_percent_secondary", value: 82, status: FieldStatus.OK },
        { name: "reset_at_secondary", value: null, status: FieldStatus.UNAVAILABLE },
        { name: "reset_credits_expire_at", value: futureEpoch, status: FieldStatus.OK },
        { name: "plan_type", value: "pro", status: FieldStatus.OK },
        { name: "limit_reached", value: false, status: FieldStatus.OK },
      ],
    };

    const partition = partitionProviderPanel(
      panelModel(CODEX_FIELDS, result, [
        "used_percent_primary",
        "reset_at_primary",
        "used_percent_secondary",
        "reset_at_secondary",
        "reset_credits_expire_at",
        "plan_type",
        "limit_reached",
        "unknown_field",
      ]),
      "en",
    );

    expect(partition.gauges.map((g) => g.fieldName)).toEqual([
      "used_percent_primary",
      "used_percent_secondary",
    ]);
    expect(partition.gauges[0].hasResetSlot).toBeTrue();
    expect(partition.gauges[0].resetText).toContain("↻");
    expect(partition.gauges[1].hasResetSlot).toBeTrue();
    expect(partition.gauges[1].resetText).toBe("↻ —");

    // Paired reset_at_primary and reset_at_secondary were consumed by gauges,
    // while unpaired reset_credits_expire_at, plan_type, and limit_reached stay in Bento!
    expect(partition.bentoTiles.map((b) => b.fieldName)).toEqual([
      "reset_credits_expire_at",
      "plan_type",
      "limit_reached",
    ]);
    expect(partition.bentoRows.length).toBe(2);
    expect(partition.bentoRows[0].length).toBe(2);
    expect(partition.bentoRows[1].length).toBe(1);
  });

  it("keeps unpaired reset_at_* in Bento when its companion percent gauge is not in panel fields", () => {
    const futureEpoch = Math.floor(Date.now() / 1000) + 3600;
    const result: ReaderResult = {
      provider: "codex",
      status: ReaderStatus.OK,
      lastUpdated: 1_700_000_000,
      fields: [{ name: "reset_at_primary", value: futureEpoch, status: FieldStatus.OK }],
    };

    const partition = partitionProviderPanel(
      panelModel(CODEX_FIELDS, result, ["reset_at_primary"]),
      "en",
    );
    expect(partition.gauges.length).toBe(0);
    expect(partition.bentoTiles.map((b) => b.fieldName)).toEqual(["reset_at_primary"]);
  });

  it("propagates field-level errors onto gauges and Bento tiles", () => {
    const result: ReaderResult = {
      provider: "claude",
      status: ReaderStatus.PARTIAL,
      lastUpdated: 1_700_000_000,
      fields: [
        {
          name: "used_percent_session",
          value: null,
          status: FieldStatus.ERROR,
          error: "Probe timeout",
        },
        {
          name: "has_extra_usage_enabled",
          value: null,
          status: FieldStatus.ERROR,
          error: "Missing token",
        },
      ],
    };

    const partition = partitionProviderPanel(
      panelModel(CLAUDE_FIELDS, result, ["used_percent_session", "has_extra_usage_enabled"]),
      "en",
    );
    expect(partition.gauges[0].errorText).toBe("Probe timeout");
    expect(partition.bentoTiles[0].errorText).toBe("Missing token");
  });
});

describe("buildOverviewRowModel, tabs & structure keys", () => {
  it("builds loading, OK, Cached (last-known-good), Partial, and Error overview models", () => {
    const loading = overviewRowFor({
      provider: "codex",
      displayName: "Codex",
      fieldsDefs: CODEX_FIELDS,
      result: undefined,
      statusFieldNames: ["used_percent_primary"],
      panelFieldNames: [],
      locale: "en",
    });
    expect(loading.badgeKind).toBe("loading");
    expect(loading.primaryText).toBe("…");
    expect(loading.meter.tone).toBe("neutral");
    expect(loading.meter.isError).toBeFalse();

    const futureEpoch = Math.floor(Date.now() / 1000) + 1800;
    const okRow = overviewRowFor({
      provider: "codex",
      displayName: "Codex",
      fieldsDefs: CODEX_FIELDS,
      result: {
        provider: "codex",
        status: ReaderStatus.OK,
        lastUpdated: 1_700_000_000,
        fields: [
          { name: "used_percent_primary", value: 55, status: FieldStatus.OK },
          { name: "reset_at_primary", value: futureEpoch, status: FieldStatus.OK },
        ],
      },
      statusFieldNames: ["plan_type"],
      panelFieldNames: ["used_percent_primary"],
      locale: "en",
    });
    expect(okRow.badgeKind).toBe("ok");
    expect(okRow.badgeText).toBe("OK");
    expect(okRow.primaryText).toBe("55%");
    expect(okRow.secondaryText).toContain("↻");

    const cachedRow = overviewRowFor({
      provider: "claude",
      displayName: "Claude",
      fieldsDefs: CLAUDE_FIELDS,
      result: {
        provider: "claude",
        status: ReaderStatus.PARTIAL,
        lastUpdated: 1_700_000_000,
        pathsTried: ["oauth-api", "last-known-good"],
        lastError: "HTTP 503",
        fields: [{ name: "used_percent_session", value: 72, status: FieldStatus.OK }],
      },
      statusFieldNames: [],
      panelFieldNames: [],
      locale: "en",
    });
    expect(cachedRow.badgeKind).toBe("cached");
    expect(cachedRow.badgeText).toBe("Cached");
    expect(cachedRow.tone).toBe("warning");

    const partialRow = overviewRowFor({
      provider: "opencode",
      displayName: "OpenCode Go",
      fieldsDefs: OPENCODE_FIELDS,
      result: {
        provider: "opencode",
        status: ReaderStatus.PARTIAL,
        lastUpdated: 1_700_000_000,
        pathsTried: ["sqlite"],
        fields: [{ name: "total_cost", value: 4.5, status: FieldStatus.OK }],
      },
      statusFieldNames: ["total_cost"],
      panelFieldNames: [],
      locale: "en",
    });
    expect(partialRow.badgeKind).toBe("partial");
    expect(partialRow.badgeText).toBe("Partial");
    expect(partialRow.primaryText).toBe("—");

    const errorRow = overviewRowFor({
      provider: "grok",
      displayName: "Grok",
      fieldsDefs: GROK_FIELDS,
      result: {
        provider: "grok",
        status: ReaderStatus.ERROR,
        lastUpdated: 1_700_000_000,
        lastError: "Missing auth.json",
        fields: [],
      },
      statusFieldNames: ["used_percent_credits"],
      panelFieldNames: [],
      locale: "en",
    });
    expect(errorRow.badgeKind).toBe("error");
    expect(errorRow.secondaryText).toBe("Missing auth.json");
    expect(errorRow.tone).toBe("critical");
  });

  it("resolves active tab with fallback when disabled and cycles tabs in both directions", () => {
    const enabled = ["codex", "opencode"] as const;
    expect(getAvailableTabs(enabled)).toEqual(["overview", "codex", "opencode"]);
    expect(resolveActiveTab("overview", enabled)).toBe("overview");
    expect(resolveActiveTab("codex", enabled)).toBe("codex");
    expect(resolveActiveTab("claude", enabled)).toBe("overview");

    expect(cycleTab("overview", enabled, 1)).toBe("codex");
    expect(cycleTab("codex", enabled, 1)).toBe("opencode");
    expect(cycleTab("opencode", enabled, 1)).toBe("overview");
    expect(cycleTab("overview", enabled, -1)).toBe("opencode");
    expect(cycleTab("claude", enabled, 1)).toBe("codex");
    expect(cycleTab("overview", [], 1)).toBe("overview");
  });
});

describe("Cairo vector drawing helpers & context disposal", () => {
  it("validates Cairo contexts and disposes GJS Cairo handles safely", () => {
    const { cr, disposed } = createMockCairoContext(true);
    expect(isCairoContext(cr)).toBeTrue();
    expect(isCairoContext(null)).toBeFalse();
    expect(isCairoContext({})).toBeFalse();

    disposeCairoContext(cr);
    expect(disposed()).toBeTrue();

    const noDispose = createMockCairoContext(false);
    expect(() => disposeCairoContext(noDispose.cr)).not.toThrow();
    expect(() => disposeCairoContext(null)).not.toThrow();
  });

  it("draws micro rings, radial gauges, and mini capsules with rounded line caps", () => {
    const geom = computeGaugeGeometry(gaugeView("used_percent_primary", 64), "en");
    const okMeter = {
      ratio: geom.ratio,
      hasValue: true,
      startAngle: geom.startAngle,
      endAngle: geom.endAngle,
      tone: geom.tone,
      rgb: geom.rgb,
      isError: false,
    };
    const errMeter = {
      ...okMeter,
      hasValue: false,
      ratio: 0,
      isError: true,
    };

    const ringCtx = createMockCairoContext();
    drawMicroRing(ringCtx.cr, 14, 14, okMeter);
    expect(
      ringCtx.ops.some((o) => o.op === "setLineCap" && o.args[0] === CAIRO_LINE_CAP_ROUND),
    ).toBeTrue();
    expect(ringCtx.ops.filter((o) => o.op === "stroke").length).toBe(2);

    const errRingCtx = createMockCairoContext();
    drawMicroRing(errRingCtx.cr, 14, 14, errMeter);
    expect(errRingCtx.ops.filter((o) => o.op === "stroke").length).toBe(1);

    const tinyRingCtx = createMockCairoContext();
    drawMicroRing(tinyRingCtx.cr, 1, 1, okMeter);
    expect(tinyRingCtx.ops.length).toBe(0);

    const radialCtx = createMockCairoContext();
    drawRadialGauge(radialCtx.cr, 80, 80, geom);
    // Inner subtle ring + track arc + active value arc = 3 strokes
    expect(radialCtx.ops.filter((o) => o.op === "stroke").length).toBe(3);

    const emptyRadialCtx = createMockCairoContext();
    drawRadialGauge(
      emptyRadialCtx.cr,
      80,
      80,
      computeGaugeGeometry(gaugeView("used_percent_primary", null), "en"),
    );
    expect(emptyRadialCtx.ops.filter((o) => o.op === "stroke").length).toBe(2);

    const tinyRadialCtx = createMockCairoContext();
    drawRadialGauge(tinyRadialCtx.cr, 4, 4, geom);
    expect(tinyRadialCtx.ops.length).toBe(0);

    const capsuleCtx = createMockCairoContext();
    drawMiniCapsule(capsuleCtx.cr, 56, 6, okMeter);
    expect(capsuleCtx.ops.filter((o) => o.op === "stroke").length).toBe(2);

    const errCapsuleCtx = createMockCairoContext();
    drawMiniCapsule(errCapsuleCtx.cr, 56, 6, errMeter);
    expect(errCapsuleCtx.ops.filter((o) => o.op === "stroke").length).toBe(1);

    const tinyCapsuleCtx = createMockCairoContext();
    drawMiniCapsule(tinyCapsuleCtx.cr, 2, 1, okMeter);
    expect(tinyCapsuleCtx.ops.length).toBe(0);
  });

  it("connectRepaint owns the guard, size, disposal and queue for every surface", () => {
    const calls: string[] = [];
    const makeArea = (context: unknown) => {
      const handlers: Array<() => void> = [];
      return {
        area: {
          connect: (signal: string, handler: () => void) => {
            expect(signal).toBe("repaint");
            handlers.push(handler);
          },
          get_context: () => context,
          get_surface_size: (): [number, number] => [56, 6],
          queue_repaint: () => calls.push("queue"),
        },
        repaint: () => handlers.forEach((handler) => handler()),
      };
    };
    const draw = (_cr: CairoContextLike, width: number, height: number, spec: string) => {
      calls.push(`draw:${width}x${height}:${spec}`);
    };

    const good = createMockCairoContext();
    const goodArea = makeArea(good.cr);
    connectRepaint(goodArea.area, draw, "meter");
    expect(calls).toEqual(["queue"]);
    goodArea.repaint();
    expect(calls).toEqual(["queue", "draw:56x6:meter"]);
    expect(good.disposed()).toBeTrue();

    calls.length = 0;
    const nonCairo = { $dispose: () => calls.push("dispose") };
    const nonCairoArea = makeArea(nonCairo);
    connectRepaint(nonCairoArea.area, draw, "meter");
    nonCairoArea.repaint();
    expect(calls).toEqual(["queue", "dispose"]);
  });
});
