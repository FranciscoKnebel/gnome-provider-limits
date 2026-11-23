import { type ProviderName } from "../constants.js";
import { formatAbsoluteTimestamp } from "../formatters.js";
import type { FieldDef, ReaderResult } from "../readers/base.js";
import { ReaderStatus } from "../readers/base.js";
import type { FieldCategory } from "../readers/fields.js";
import { clampPercent, type FieldTone } from "./fieldRows.js";
import type { FieldView } from "./fieldViews.js";
import {
  badgeForZone,
  cardBadgeText,
  deriveFieldViews,
  deriveProviderHealth,
} from "./fieldViews.js";
import type { Presentation, ProviderTone } from "./providerTypes.js";
import { structureKey } from "./renderStructure.js";

export type CardBadgeKind = Presentation["cardBadge"];
export type BannerKind = "warning" | "error";
export type PanelEmptyState = "none" | "disabled" | "loading";

export interface CardProgressRow {
  kind: "progress";
  name: string;
  label: string;
  valueText: string;
  fillPercent: number;
  hasValue: boolean;
  tone?: FieldTone;
  resetText?: string;
  errorText?: string;
  accessibleText: string;
}

export interface CardKeyValueRow {
  kind: "kv";
  name: string;
  category: FieldCategory;
  label: string;
  valueText: string;
  tone?: FieldTone;
  errorText?: string;
  accessibleText: string;
}

export interface ProviderCardPlan {
  provider: ProviderName;
  displayName: string;
  status: ReaderStatus;
  healthTone: ProviderTone;
  badgeKind: CardBadgeKind;
  badgeText: string;
  lastUpdatedText: string | null;
  bannerKind: BannerKind | null;
  bannerText: string | null;
  limitProgressRows: CardProgressRow[];
  limitMetaRows: CardKeyValueRow[];
  telemetryRows: CardKeyValueRow[];
  key: string;
}

export interface PanelPlan {
  emptyState: PanelEmptyState;
  emptyTitle: string | null;
  emptySubtitle: string | null;
  cards: ProviderCardPlan[];
  structureKey: string;
}

export function computeBarWidthPx(
  trackWidth: number,
  fillPercent: number,
  fallbackTrackWidth = 260,
): number {
  const clamped = clampPercent(fillPercent) ?? 0;
  if (clamped <= 0) return 0;
  const effectiveTrack = trackWidth > 0 ? trackWidth : fallbackTrackWidth;
  return Math.min(effectiveTrack, Math.max(4, Math.round((effectiveTrack * clamped) / 100)));
}

export interface PlanProviderCardOptions {
  provider: ProviderName;
  displayName: string;
  result: ReaderResult;
  panelFields: readonly string[];
  fieldDefs: readonly FieldDef[];
  locale: string;
  t?: (s: string) => string;
}

export function planProviderCard(options: PlanProviderCardOptions): ProviderCardPlan {
  const tr = options.t ?? ((s: string) => s);
  const { provider, displayName, result, panelFields, fieldDefs: defs, locale } = options;

  const isHardError =
    result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE;

  const views = isHardError ? [] : deriveFieldViews(defs, result, panelFields, "panel", locale, tr);
  const health = deriveProviderHealth(result.status, {
    result,
    views,
    fieldDefs: defs,
    t: tr,
  });
  const badgeKind: CardBadgeKind = badgeForZone(health, "card");
  const badgeText = cardBadgeText(health, tr);
  const healthTone = health.tone;

  let bannerKind: BannerKind | null = null;
  let bannerText: string | null = null;
  if (result.status === ReaderStatus.ERROR) {
    bannerKind = "error";
    bannerText = result.lastError ?? tr("Error");
  } else if (result.status === ReaderStatus.UNAVAILABLE) {
    bannerKind = "error";
    bannerText = result.lastError ?? tr("Unavailable");
  } else if (result.status === ReaderStatus.PARTIAL && result.lastError) {
    bannerKind = "warning";
    bannerText = result.lastError;
  }

  const lastUpdatedText =
    !isHardError && Number.isFinite(result.lastUpdated)
      ? tr("Last updated: %s").replace("%s", formatAbsoluteTimestamp(result.lastUpdated, locale))
      : null;

  const rowsByName = new Map<string, FieldView>();
  for (const row of views) {
    rowsByName.set(row.name, row);
  }

  const pairedResets = new Map<string, FieldView>();
  const consumedResetNames = new Set<string>();
  for (const row of views) {
    if (row.type !== "percent" || row.resetName === null) continue;
    if (consumedResetNames.has(row.resetName)) continue;
    const resetRow = rowsByName.get(row.resetName);
    if (resetRow) {
      pairedResets.set(row.name, resetRow);
      consumedResetNames.add(row.resetName);
    }
  }

  const limitProgressRows: CardProgressRow[] = [];
  const limitMetaRows: CardKeyValueRow[] = [];
  const telemetryRows: CardKeyValueRow[] = [];

  for (const row of views) {
    const rowName = row.name;
    if (consumedResetNames.has(rowName)) continue;

    const translatedLabel = tr(row.label);
    const defaultAccessible = row.accessibleText ?? `${translatedLabel}: ${row.valueText}`;

    if (row.type === "percent") {
      const pairedReset = pairedResets.get(rowName);
      const resetText = pairedReset
        ? `${tr(pairedReset.label)}: ${pairedReset.valueText}`
        : undefined;
      const errorText = row.errorText ?? pairedReset?.errorText;
      const accessibleText = resetText ? `${defaultAccessible}, ${resetText}` : defaultAccessible;

      const progressRow: CardProgressRow = {
        kind: "progress",
        name: rowName,
        label: translatedLabel,
        valueText: row.valueText,
        fillPercent: row.fillPercent ?? 0,
        hasValue: row.fillPercent !== undefined,
        accessibleText,
      };
      if (row.tone) progressRow.tone = row.tone;
      if (resetText) progressRow.resetText = resetText;
      if (errorText) progressRow.errorText = errorText;
      limitProgressRows.push(progressRow);
      continue;
    }

    const kvRow: CardKeyValueRow = {
      kind: "kv",
      name: rowName,
      category: row.category ?? "telemetry",
      label: translatedLabel,
      valueText: row.valueText,
      accessibleText: defaultAccessible,
    };
    if (row.tone) kvRow.tone = row.tone;
    if (row.errorText) kvRow.errorText = row.errorText;

    if (kvRow.category === "limit") {
      limitMetaRows.push(kvRow);
    } else {
      telemetryRows.push(kvRow);
    }
  }

  const key = JSON.stringify([
    provider,
    displayName,
    result.status,
    badgeKind,
    locale,
    bannerKind ?? "",
    lastUpdatedText === null ? 0 : 1,
    limitProgressRows.map((r) => [r.name, r.resetText ? 1 : 0, r.errorText ? 1 : 0]),
    limitMetaRows.map((r) => [r.name, r.errorText ? 1 : 0]),
    telemetryRows.map((r) => [r.name, r.errorText ? 1 : 0]),
  ]);

  return {
    provider,
    displayName,
    status: result.status,
    healthTone,
    badgeKind,
    badgeText,
    lastUpdatedText,
    bannerKind,
    bannerText,
    limitProgressRows,
    limitMetaRows,
    telemetryRows,
    key,
  };
}

export interface PlanPanelOptions {
  order: readonly ProviderName[];
  results: ReadonlyMap<ProviderName, ReaderResult>;
  hasEnabledProviders: boolean;
  running: boolean;
  locale: string;
  getDisplayName: (provider: ProviderName) => string;
  getPanelFields: (provider: ProviderName) => readonly string[];
  getFieldDefs: (provider: ProviderName) => readonly FieldDef[];
  t?: (s: string) => string;
}

export function planPanel(options: PlanPanelOptions): PanelPlan {
  const tr = options.t ?? ((s: string) => s);
  const cards: ProviderCardPlan[] = [];

  for (const provider of options.order) {
    const result = options.results.get(provider);
    if (!result || result.status === ReaderStatus.DISABLED) continue;

    const fieldDefs = options.getFieldDefs(provider);
    cards.push(
      planProviderCard({
        provider,
        displayName: options.getDisplayName(provider),
        result,
        panelFields: options.getPanelFields(provider),
        fieldDefs,
        locale: options.locale,
        t: tr,
      }),
    );
  }

  if (cards.length === 0) {
    if (!options.hasEnabledProviders) {
      return {
        emptyState: "disabled",
        emptyTitle: tr("No providers enabled"),
        emptySubtitle: tr("Enable a provider in Settings to monitor usage limits."),
        cards: [],
        structureKey: structureKey([options.locale, "empty:disabled"]),
      };
    }

    return {
      emptyState: "loading",
      emptyTitle: options.running
        ? tr("Loading provider limits…")
        : tr("Waiting for provider data…"),
      emptySubtitle: null,
      cards: [],
      structureKey: structureKey([options.locale, "empty:loading"]),
    };
  }

  return {
    emptyState: "none",
    emptyTitle: null,
    emptySubtitle: null,
    cards,
    structureKey: structureKey([options.locale, ...cards.map((c) => c.key)]),
  };
}
