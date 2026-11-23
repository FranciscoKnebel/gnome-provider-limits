import type { ProviderName } from "../constants.js";
import { formatField } from "../formatters.js";
import { GAUGE_END_ANGLE, GAUGE_START_ANGLE, GAUGE_SWEEP_ANGLE, TONE_RGB } from "./cairoDrawing.js";
import type { FieldRowSet, ProviderDisplayModel } from "./displayModel.js";
import { clampRatio, fieldTone, type FieldTone } from "./fieldRows.js";
import { toDisplayRow } from "./fieldViews.js";
import type { GaugeGeometry, GaugeTone, MicroMeterSpec } from "./gaugeTypes.js";
import type { Presentation } from "./providerHealth.js";

export type CockpitTab = "overview" | ProviderName;

export type OverviewBadgeKind = Presentation["overviewBadge"];

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

export function computeGaugeGeometry(
  fieldName: string,
  rawValue: unknown,
  locale: string,
): GaugeGeometry {
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
    locale,
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
  rows: FieldRowSet,
  locale: string,
  tr: (s: string) => string = (s) => s,
): PartitionedProviderPanel {
  const gauges: RadialGaugeItem[] = [];
  const bentoTiles: BentoTileItem[] = [];

  for (const view of rows.panelViews) {
    if (rows.consumedResets.has(view.name)) continue;
    const row = toDisplayRow(view, tr);

    if (view.type === "percent") {
      const geometry = computeGaugeGeometry(row.name, view.hasValue ? view.value : null, locale);
      const accessibleParts = [`${row.labelText}: ${geometry.centerText}`];
      if (row.reset.text !== null) accessibleParts.push(row.reset.text);

      gauges.push({
        fieldName: row.name,
        label: row.label,
        translatedLabel: row.labelText,
        geometry,
        resetText: row.reset.text,
        hasResetSlot: row.reset.hasSlot,
        accessibleText: accessibleParts.join(", "),
        ...(row.errorText ? { errorText: row.errorText } : {}),
      });
      continue;
    }

    bentoTiles.push({
      fieldName: row.name,
      label: row.label,
      translatedLabel: row.labelText,
      valueText: row.valueText,
      accessibleText: row.accessibleText,
      ...(row.errorText ? { errorText: row.errorText } : {}),
    });
  }

  return {
    gauges,
    gaugeRows: chunkGauges(gauges),
    bentoTiles,
    bentoRows: chunkPairs(bentoTiles),
  };
}

export function loadingOverviewRow(provider: ProviderName, displayName: string): OverviewRowModel {
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

export function buildOverviewRowModel(model: ProviderDisplayModel): OverviewRowModel {
  const { provider, displayName } = model;
  const badgeKind: OverviewBadgeKind = model.badges.overview;
  const badgeText = model.badges.overviewText;
  const meter = model.meter;

  if (badgeKind === "error") {
    const errSummary = model.diagnostic.errorText ?? "Error";
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

  const facts = model.usage.overview;
  const resolvedTone = model.health.hasUsableField ? model.health.worstTone : undefined;
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
