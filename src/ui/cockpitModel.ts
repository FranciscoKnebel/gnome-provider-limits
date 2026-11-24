import type { ProviderName } from "../constants.js";
import { formatField } from "../formatters.js";
import { ReaderStatus } from "../readers/base.js";
import type { FieldDef, ReaderResult } from "../readers/base.js";
import { GAUGE_END_ANGLE, GAUGE_START_ANGLE, GAUGE_SWEEP_ANGLE, TONE_RGB } from "./cairoDrawing.js";
import { fieldTone, type FieldTone } from "./fieldRows.js";
import {
  badgeForZone,
  deriveFieldViews,
  deriveProviderHealth,
  overviewBadgeText,
  projectUsageFacts,
  selectUsageView,
} from "./fieldViews.js";
import type { GaugeGeometry, GaugeTone, MicroMeterSpec, RgbTuple } from "./gaugeTypes.js";
import type { OverviewBadgeValue } from "./providerTypes.js";
import { structureKey } from "./renderStructure.js";
import { clampRatio } from "./usageSnapshot.js";

export type CockpitTab = "overview" | ProviderName;

export type OverviewBadgeKind = OverviewBadgeValue;

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

  const viewNames = [...statusFieldNames, ...fieldsDefs.map((def) => def.name)];
  const views = deriveFieldViews(fieldsDefs, result, viewNames, "status", "en");
  const primary = selectUsageView(views, statusFieldNames);

  if (primary?.hasValue && primary.type === "percent") {
    const ratio = primary.usageRatio ?? 0;
    const tone: GaugeTone = primary.tone ?? "ok";
    return {
      ratio,
      hasValue: true,
      startAngle: GAUGE_START_ANGLE,
      endAngle: GAUGE_START_ANGLE + ratio * GAUGE_SWEEP_ANGLE,
      tone,
      rgb: TONE_RGB[tone],
      isError: false,
    };
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
  const views = deriveFieldViews(fieldsDefs, result, panelFieldNames, "panel", locale, tr);
  const consumedResets = new Set<string>();
  for (const view of views) {
    if (view.type === "percent" && view.hasResetSlot && view.resetName !== null) {
      consumedResets.add(view.resetName);
    }
  }

  const gauges: RadialGaugeItem[] = [];
  const bentoTiles: BentoTileItem[] = [];

  for (const view of views) {
    if (consumedResets.has(view.name)) continue;
    const translatedLabel = tr(view.label);

    if (view.type === "percent") {
      const geometry = computeGaugeGeometry(view.name, view.hasValue ? view.value : null);
      const accessibleParts = [`${translatedLabel}: ${geometry.centerText}`];
      if (view.resetText !== null) accessibleParts.push(view.resetText);

      const gauge: RadialGaugeItem = {
        fieldName: view.name,
        label: view.label,
        translatedLabel,
        geometry,
        resetText: view.resetText,
        hasResetSlot: view.hasResetSlot,
        accessibleText: accessibleParts.join(", "),
        ...(view.errorText ? { errorText: view.errorText } : {}),
      };
      gauges.push(gauge);
      continue;
    }

    const tile: BentoTileItem = {
      fieldName: view.name,
      label: view.label,
      translatedLabel,
      valueText: view.valueText,
      accessibleText: view.accessibleText,
      ...(view.errorText ? { errorText: view.errorText } : {}),
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

  const searchOrder = [...statusFieldNames, ...panelFieldNames];
  const overviewViews = deriveFieldViews(fieldsDefs, result, searchOrder, "status", locale, tr);
  const health = deriveProviderHealth(result, overviewViews, tr, fieldsDefs);
  const badgeKind: OverviewBadgeKind = badgeForZone(health, "overview");
  const badgeText = overviewBadgeText(health, tr);

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

  const facts = projectUsageFacts(result, overviewViews, searchOrder, { t: tr });
  const resolvedTone = health.hasUsableField ? health.worstTone : undefined;
  const primaryText = facts.valueText;
  const secondaryText = facts.resetText;

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
