import type { ProviderName } from "../constants.js";
import { formatField } from "../formatters.js";
import { GAUGE_END_ANGLE, emptyMeter, gaugeArc } from "./cairoDrawing.js";
import { classifyPanelViews, type ProviderDisplayModel } from "./displayModel.js";
import type { FieldTone } from "./fieldRows.js";
import type { FieldView } from "./fieldViews.js";
import { toDisplayRow } from "./fieldViews.js";
import type { GaugeSpec, GaugeTone } from "./gaugeTypes.js";
import type { Presentation } from "./providerHealth.js";
import { resetSlotText } from "./resetModel.js";

export type CockpitTab = "overview" | ProviderName;

export type OverviewBadgeKind = Presentation["overviewBadge"];

export interface RadialGaugeItem {
  readonly fieldName: string;
  readonly label: string;
  readonly translatedLabel: string;
  readonly geometry: GaugeSpec;
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
  readonly meter: GaugeSpec;
  readonly primaryText: string;
  readonly secondaryText: string | null;
  readonly tone: FieldTone | undefined;
  readonly accessibleText: string;
}

/** The one gauge spec builder: consumes the derived FieldView, never a raw value. */
export function computeGaugeGeometry(view: FieldView, locale: string): GaugeSpec {
  const tone: GaugeTone = view.hasValue ? (view.tone ?? "ok") : "neutral";
  const centerText = view.hasValue
    ? formatField({ type: "percent", value: view.value, zone: "panel", locale })
    : "—";
  return {
    ...gaugeArc(view.hasValue ? view.usageRatio : null, tone),
    fieldTone: view.tone,
    centerText,
    trackEndAngle: GAUGE_END_ANGLE,
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
  model: ProviderDisplayModel,
  locale: string,
  tr: (s: string) => string = (s) => s,
): PartitionedProviderPanel {
  const groups = classifyPanelViews(model);
  const gauges: RadialGaugeItem[] = [];
  const bentoTiles: BentoTileItem[] = [];

  for (const view of groups.progress) {
    const row = toDisplayRow(view, "panel", locale, tr);
    const pairing = model.resets.get(view.name);
    const resetText = pairing ? resetSlotText(pairing, "panel", locale, tr) : null;
    const geometry = computeGaugeGeometry(view, locale);
    const accessibleParts = [`${row.labelText}: ${geometry.centerText}`];
    if (resetText !== null) accessibleParts.push(resetText);

    gauges.push({
      fieldName: row.name,
      label: row.label,
      translatedLabel: row.labelText,
      geometry,
      resetText,
      hasResetSlot: resetText !== null,
      accessibleText: accessibleParts.join(", "),
      ...(row.errorText ? { errorText: row.errorText } : {}),
    });
  }

  for (const view of groups.keyValue) {
    const row = toDisplayRow(view, "panel", locale, tr);
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
    meter: emptyMeter("neutral", false),
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
