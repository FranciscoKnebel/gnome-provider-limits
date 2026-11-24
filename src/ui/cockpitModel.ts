import type { ProviderName } from "../constants.js";
import { GAUGE_END_ANGLE, emptyMeter, gaugeArc } from "./cairoDrawing.js";
import { type ProviderDisplayModel } from "./displayModel.js";
import type { FieldTone } from "./fieldRows.js";
import type { FieldView } from "./fieldViews.js";
import type { GaugeSpec, GaugeTone, RadialGaugeGeometry } from "./gaugeTypes.js";
import type { Presentation } from "./providerHealth.js";

export type CockpitTab = "overview" | ProviderName;

export type OverviewBadgeKind = Presentation["overviewBadge"];

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

/** The one gauge spec builder: consumes the formatted view, never a raw value. */
export function computeGaugeGeometry(view: FieldView): RadialGaugeGeometry {
  const tone: GaugeTone = view.hasValue ? (view.tone ?? "ok") : "neutral";
  const centerText = view.hasValue ? view.valueText : "—";
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
  const facts = model.facts;
  const badgeKind: OverviewBadgeKind = facts.badges.overview;
  const badgeText = facts.badges.overviewText;
  const meter = facts.meter;

  if (badgeKind === "error") {
    const errSummary = facts.diagnostic.message ?? "Error";
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

  const usage = facts.usage.overview;
  const resolvedTone = facts.health.hasUsableField ? facts.health.worstTone : undefined;
  const primaryText = usage.valueText;
  const secondaryText = usage.resetText;

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
