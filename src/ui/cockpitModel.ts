import type { ProviderName } from "../constants.js";
import { formatField } from "../formatters.js";
import { FieldStatus, ReaderStatus } from "../readers/base.js";
import type { FieldDef, ReaderResult } from "../readers/base.js";
import { GAUGE_END_ANGLE, GAUGE_START_ANGLE, GAUGE_SWEEP_ANGLE, TONE_RGB } from "./cairoDrawing.js";
import { fieldTone } from "./fieldRows.js";
import type { FieldTone } from "./fieldRows.js";
import { structureKey } from "./renderStructure.js";
export {
  CAIRO_LINE_CAP_ROUND,
  GAUGE_END_ANGLE,
  GAUGE_START_ANGLE,
  GAUGE_SWEEP_ANGLE,
  TRACK_RGBA,
  TONE_RGB,
  disposeCairoContext,
  drawMicroRing,
  drawMiniCapsule,
  drawRadialGauge,
  isCairoContext,
  type CairoContextLike,
} from "./cairoDrawing.js";

export type CockpitTab = "overview" | ProviderName;

export type GaugeTone = FieldTone | "neutral";

export type RgbTuple = readonly [number, number, number];

export type OverviewBadgeKind = "ok" | "cached" | "partial" | "error" | "loading";

export interface GaugeGeometry {
  readonly ratio: number;
  readonly hasValue: boolean;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly trackEndAngle: number;
  readonly tone: GaugeTone;
  readonly fieldTone: FieldTone | undefined;
  readonly rgb: RgbTuple;
  readonly centerText: string;
}

export interface MicroMeterSpec {
  readonly ratio: number;
  readonly hasValue: boolean;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly tone: GaugeTone;
  readonly rgb: RgbTuple;
  readonly isError: boolean;
}

export interface RadialGaugeItem {
  readonly fieldName: string;
  readonly label: string;
  readonly translatedLabel: string;
  readonly geometry: GaugeGeometry;
  readonly resetText: string | null;
  readonly hasResetSlot: boolean;
  readonly errorText?: string;
  readonly accessibleText: string;
}

export interface BentoTileItem {
  readonly fieldName: string;
  readonly label: string;
  readonly translatedLabel: string;
  readonly valueText: string;
  readonly errorText?: string;
  readonly accessibleText: string;
}

export interface PartitionedProviderPanel {
  readonly gauges: readonly RadialGaugeItem[];
  readonly gaugeRows: readonly (readonly RadialGaugeItem[])[];
  readonly bentoTiles: readonly BentoTileItem[];
  readonly bentoRows: readonly (readonly BentoTileItem[])[];
}

export interface OverviewRowModel {
  readonly provider: ProviderName;
  readonly displayName: string;
  readonly badgeKind: OverviewBadgeKind;
  readonly badgeText: string;
  readonly meter: MicroMeterSpec;
  readonly primaryText: string;
  readonly secondaryText: string | null;
  readonly tone: FieldTone | undefined;
  readonly accessibleText: string;
}

export function clampRatio(percentValue: unknown): number | null {
  if (typeof percentValue !== "number" || !Number.isFinite(percentValue)) {
    return null;
  }
  return Math.min(1, Math.max(0, percentValue / 100));
}

export function toneToRgb(tone: GaugeTone): RgbTuple {
  return TONE_RGB[tone];
}

export function computeGaugeGeometry(fieldName: string, rawValue: unknown): GaugeGeometry {
  const ratio = clampRatio(rawValue);
  if (ratio === null) {
    return {
      ratio: 0,
      hasValue: false,
      startAngle: GAUGE_START_ANGLE,
      endAngle: GAUGE_START_ANGLE,
      trackEndAngle: GAUGE_END_ANGLE,
      tone: "neutral",
      fieldTone: undefined,
      rgb: TONE_RGB.neutral,
      centerText: "—",
    };
  }

  const resolvedFieldTone = fieldTone(fieldName, rawValue);
  const tone: GaugeTone = resolvedFieldTone ?? "ok";
  const endAngle = GAUGE_START_ANGLE + ratio * GAUGE_SWEEP_ANGLE;
  const centerText = formatField({
    type: "percent",
    value: rawValue,
    zone: "panel",
    locale: "en",
  });

  return {
    ratio,
    hasValue: true,
    startAngle: GAUGE_START_ANGLE,
    endAngle,
    trackEndAngle: GAUGE_END_ANGLE,
    tone,
    fieldTone: resolvedFieldTone,
    rgb: TONE_RGB[tone],
    centerText,
  };
}

export function extractWindowSuffix(fieldName: string): string | null {
  const match = /^(?:used|remaining)_percent_(.+)$/.exec(fieldName);
  return match ? match[1] : null;
}

export function computeStatusMicroMeter(
  fieldsDefs: readonly FieldDef[],
  result: ReaderResult,
  statusFieldNames: readonly string[],
): MicroMeterSpec {
  if (result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE) {
    return {
      ratio: 0,
      hasValue: false,
      startAngle: GAUGE_START_ANGLE,
      endAngle: GAUGE_START_ANGLE,
      tone: "critical",
      rgb: TONE_RGB.critical,
      isError: true,
    };
  }

  let candidateName: string | null = null;
  for (const name of statusFieldNames) {
    const def = fieldsDefs.find((f) => f.name === name);
    if (def?.type === "percent") {
      candidateName = name;
      break;
    }
  }

  if (candidateName === null) {
    const fallbackDef = fieldsDefs.find((f) => f.type === "percent");
    candidateName = fallbackDef?.name ?? null;
  }

  if (candidateName !== null) {
    const field = result.fields.find((f) => f.name === candidateName);
    if (field && field.status === FieldStatus.OK) {
      const geom = computeGaugeGeometry(candidateName, field.value);
      if (geom.hasValue) {
        return {
          ratio: geom.ratio,
          hasValue: true,
          startAngle: geom.startAngle,
          endAngle: geom.endAngle,
          tone: geom.tone,
          rgb: geom.rgb,
          isError: false,
        };
      }
    }
  }

  return {
    ratio: 0,
    hasValue: false,
    startAngle: GAUGE_START_ANGLE,
    endAngle: GAUGE_START_ANGLE,
    tone: "neutral",
    rgb: TONE_RGB.neutral,
    isError: false,
  };
}

export function chunkGauges<T>(items: readonly T[]): T[][] {
  if (items.length === 0) return [];
  if (items.length <= 3) return [[...items]];
  if (items.length === 4) return [items.slice(0, 2), items.slice(2, 4)];

  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 3) {
    rows.push(items.slice(i, i + 3));
  }
  return rows;
}

export function chunkPairs<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(items.slice(i, i + 2));
  }
  return rows;
}

export function partitionProviderPanel(
  fieldsDefs: readonly FieldDef[],
  result: ReaderResult,
  panelFieldNames: readonly string[],
  locale: string,
  t?: (s: string) => string,
): PartitionedProviderPanel {
  const tr = t ?? ((s: string) => s);
  const activeSuffixes = new Set<string>();

  for (const fieldName of panelFieldNames) {
    const def = fieldsDefs.find((f) => f.name === fieldName);
    if (def?.type !== "percent") continue;
    const suffix = extractWindowSuffix(fieldName);
    if (suffix !== null) activeSuffixes.add(suffix);
  }

  const pairedResetFields = new Set<string>();
  for (const fieldName of panelFieldNames) {
    if (!fieldName.startsWith("reset_at_")) continue;
    const suffix = fieldName.slice("reset_at_".length);
    if (activeSuffixes.has(suffix)) {
      const def = fieldsDefs.find((f) => f.name === fieldName);
      if (def?.type === "timestamp") pairedResetFields.add(fieldName);
    }
  }

  const gauges: RadialGaugeItem[] = [];
  const bentoTiles: BentoTileItem[] = [];

  for (const fieldName of panelFieldNames) {
    const def = fieldsDefs.find((f) => f.name === fieldName);
    if (!def) continue;
    if (pairedResetFields.has(fieldName)) continue;

    const field = result.fields.find((f) => f.name === fieldName);
    const translatedLabel = tr(def.label);
    const isOk = field?.status === FieldStatus.OK;
    const isError = field?.status === FieldStatus.ERROR || result.status === ReaderStatus.ERROR;
    const errorText =
      !isOk && isError ? (field?.error ?? result.lastError ?? undefined) : undefined;

    if (def.type === "percent") {
      const geometry = computeGaugeGeometry(fieldName, isOk ? field.value : null);
      const suffix = extractWindowSuffix(fieldName);
      let resetText: string | null = null;
      let hasResetSlot = false;

      if (suffix !== null) {
        const resetName = "reset_at_" + suffix;
        const resetDef = fieldsDefs.find((f) => f.name === resetName);
        if (resetDef?.type === "timestamp") {
          const resetField = result.fields.find((f) => f.name === resetName);
          if (
            resetField?.status === FieldStatus.OK &&
            resetField.value !== null &&
            resetField.value !== undefined
          ) {
            const formattedReset = formatField({
              type: "timestamp",
              value: resetField.value,
              zone: "panel",
              locale,
              t: tr,
            });
            resetText = `↻ ${formattedReset}`;
            hasResetSlot = true;
          } else if (pairedResetFields.has(resetName)) {
            resetText = "↻ —";
            hasResetSlot = true;
          }
        }
      }

      const accessibleParts = [`${translatedLabel}: ${geometry.centerText}`];
      if (resetText !== null) accessibleParts.push(resetText);

      const gauge: RadialGaugeItem = {
        fieldName,
        label: def.label,
        translatedLabel,
        geometry,
        resetText,
        hasResetSlot,
        accessibleText: accessibleParts.join(", "),
        ...(errorText ? { errorText } : {}),
      };
      gauges.push(gauge);
      continue;
    }

    const valueText = isOk
      ? formatField({
          type: def.type,
          value: field.value,
          zone: "panel",
          locale,
          t: tr,
        })
      : "—";

    const tile: BentoTileItem = {
      fieldName,
      label: def.label,
      translatedLabel,
      valueText,
      accessibleText: `${translatedLabel}: ${valueText}`,
      ...(errorText ? { errorText } : {}),
    };
    bentoTiles.push(tile);
  }

  return {
    gauges,
    gaugeRows: chunkGauges(gauges),
    bentoTiles,
    bentoRows: chunkPairs(bentoTiles),
  };
}

export function buildOverviewRowModel(options: {
  provider: ProviderName;
  displayName: string;
  fieldsDefs: readonly FieldDef[];
  result: ReaderResult | undefined;
  statusFieldNames: readonly string[];
  panelFieldNames: readonly string[];
  locale: string;
  t?: (s: string) => string;
}): OverviewRowModel {
  const {
    provider,
    displayName,
    fieldsDefs,
    result,
    statusFieldNames,
    panelFieldNames,
    locale,
    t,
  } = options;
  const tr = t ?? ((s: string) => s);

  if (!result) {
    return {
      provider,
      displayName,
      badgeKind: "loading",
      badgeText: "…",
      meter: {
        ratio: 0,
        hasValue: false,
        startAngle: GAUGE_START_ANGLE,
        endAngle: GAUGE_START_ANGLE,
        tone: "neutral",
        rgb: TONE_RGB.neutral,
        isError: false,
      },
      primaryText: "…",
      secondaryText: null,
      tone: undefined,
      accessibleText: `${displayName}: …`,
    };
  }

  let badgeKind: OverviewBadgeKind = "ok";
  let badgeText = tr("OK");

  if (result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE) {
    badgeKind = "error";
    badgeText = tr("Error");
  } else if (result.status === ReaderStatus.PARTIAL) {
    if (result.pathsTried?.includes("last-known-good")) {
      badgeKind = "cached";
      badgeText = tr("Cached");
    } else {
      badgeKind = "partial";
      badgeText = tr("Partial");
    }
  }

  const meter = computeStatusMicroMeter(fieldsDefs, result, statusFieldNames);

  if (badgeKind === "error") {
    const errSummary = result.lastError ?? tr("Error");
    return {
      provider,
      displayName,
      badgeKind,
      badgeText,
      meter,
      primaryText: "—",
      secondaryText: errSummary,
      tone: "critical",
      accessibleText: `${displayName} (${badgeText}): ${errSummary}`,
    };
  }

  const searchOrder = [...statusFieldNames, ...panelFieldNames];
  let primaryPercentDef: FieldDef | undefined;
  for (const name of searchOrder) {
    const def = fieldsDefs.find((f) => f.name === name);
    if (def?.type === "percent") {
      primaryPercentDef = def;
      break;
    }
  }
  if (!primaryPercentDef) {
    primaryPercentDef = fieldsDefs.find((f) => f.type === "percent");
  }

  let primaryText = "—";
  let resolvedTone: FieldTone | undefined;
  let secondaryText: string | null = null;

  if (primaryPercentDef) {
    const field = result.fields.find((f) => f.name === primaryPercentDef.name);
    if (field?.status === FieldStatus.OK && field.value !== null && field.value !== undefined) {
      primaryText = formatField({
        type: "percent",
        value: field.value,
        zone: "status",
        locale,
        t: tr,
      });
      resolvedTone = fieldTone(primaryPercentDef.name, field.value);
    }

    const suffix = extractWindowSuffix(primaryPercentDef.name);
    if (suffix !== null) {
      const resetField = result.fields.find((f) => f.name === "reset_at_" + suffix);
      if (
        resetField?.status === FieldStatus.OK &&
        resetField.value !== null &&
        resetField.value !== undefined
      ) {
        const formattedReset = formatField({
          type: "timestamp",
          value: resetField.value,
          zone: "status",
          locale,
          t: tr,
        });
        secondaryText = `↻ ${formattedReset}`;
      }
    }
  }

  const summaryParts = [displayName, badgeText, primaryText];
  if (secondaryText !== null) summaryParts.push(secondaryText);

  return {
    provider,
    displayName,
    badgeKind,
    badgeText,
    meter,
    primaryText,
    secondaryText,
    tone: resolvedTone,
    accessibleText: summaryParts.join(" · "),
  };
}

export function resolveActiveTab(
  current: CockpitTab,
  enabledProviders: readonly ProviderName[],
): CockpitTab {
  if (current === "overview") return "overview";
  if (enabledProviders.includes(current)) return current;
  return "overview";
}

export function getAvailableTabs(enabledProviders: readonly ProviderName[]): CockpitTab[] {
  return ["overview", ...enabledProviders];
}

export function cycleTab(
  current: CockpitTab,
  enabledProviders: readonly ProviderName[],
  direction: -1 | 1,
): CockpitTab {
  const tabs = getAvailableTabs(enabledProviders);
  if (tabs.length <= 1) return "overview";
  const resolved = resolveActiveTab(current, enabledProviders);
  const idx = tabs.indexOf(resolved);
  const nextIdx = (idx + direction + tabs.length) % tabs.length;
  return tabs[nextIdx];
}

export function providerDetailStructureKey(options: {
  provider: ProviderName;
  displayName: string;
  status: string;
  locale: string;
  hasCallout: boolean;
  hasTimestamp: boolean;
  partition: PartitionedProviderPanel;
}): string {
  const gaugeKeys = options.partition.gauges.map((g) => [
    g.fieldName,
    g.hasResetSlot ? 1 : 0,
    g.errorText === undefined ? 0 : 1,
  ]);
  const bentoKeys = options.partition.bentoTiles.map((b) => [
    b.fieldName,
    b.errorText === undefined ? 0 : 1,
  ]);

  return structureKey([
    options.provider,
    options.displayName,
    options.status,
    options.locale,
    options.hasCallout ? "1" : "0",
    options.hasTimestamp ? "1" : "0",
    JSON.stringify(gaugeKeys),
    JSON.stringify(bentoKeys),
  ]);
}
