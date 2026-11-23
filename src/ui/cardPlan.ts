import { type ProviderName } from "../constants.js";
import type { FieldDef, ReaderResult, ReaderStatus } from "../readers/base.js";
import type { FieldCategory } from "../readers/fields.js";
import { deriveDisplayModel, deriveDisplayModels } from "./displayModel.js";
import type { ProviderDisplayModel } from "./displayModel.js";
import { clampPercent, type FieldTone } from "./fieldRows.js";
import type { FieldView } from "./fieldViews.js";
import type { Presentation, ProviderTone } from "./providerHealth.js";
import { providerRecord, type ProviderViewContext, type ViewPhase } from "./viewContext.js";
import { viewMessages } from "./viewMessages.js";

export type CardBadgeKind = Presentation["cardBadge"];
export type BannerKind = "warning" | "error";

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
}

export interface PanelPlan {
  phase: ViewPhase;
  emptyTitle: string | null;
  emptySubtitle: string | null;
  cards: ProviderCardPlan[];
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

function cardFromModel(model: ProviderDisplayModel, tr: (s: string) => string): ProviderCardPlan {
  const limitProgressRows: CardProgressRow[] = [];
  const limitMetaRows: CardKeyValueRow[] = [];
  const telemetryRows: CardKeyValueRow[] = [];

  const toKeyValueRow = (row: FieldView): CardKeyValueRow => {
    const kvRow: CardKeyValueRow = {
      kind: "kv",
      name: row.name,
      category: row.category ?? "telemetry",
      label: tr(row.label),
      valueText: row.valueText,
      accessibleText: row.accessibleText ?? `${tr(row.label)}: ${row.valueText}`,
    };
    if (row.tone) kvRow.tone = row.tone;
    if (row.errorText) kvRow.errorText = row.errorText;
    return kvRow;
  };

  for (const row of model.groupedViews.limit) {
    const rowName = row.name;
    if (model.consumedResets.has(rowName)) continue;

    const translatedLabel = tr(row.label);
    const defaultAccessible = row.accessibleText ?? `${translatedLabel}: ${row.valueText}`;

    if (row.type === "percent") {
      const pairedReset = model.resetPairs.get(rowName);
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

    limitMetaRows.push(toKeyValueRow(row));
  }

  for (const row of model.groupedViews.telemetry) {
    if (model.consumedResets.has(row.name)) continue;
    telemetryRows.push(toKeyValueRow(row));
  }

  return {
    provider: model.provider,
    displayName: model.displayName,
    status: model.status,
    healthTone: model.health.tone,
    badgeKind: model.badges.card,
    badgeText: model.badges.cardText,
    lastUpdatedText: model.lastUpdatedText,
    bannerKind: model.diagnostic.bannerKind,
    bannerText: model.diagnostic.bannerText,
    limitProgressRows,
    limitMetaRows,
    telemetryRows,
  };
}

export function planProviderCard(options: PlanProviderCardOptions): ProviderCardPlan {
  const tr = options.t ?? ((s: string) => s);
  const model = deriveDisplayModel(options.provider, options.result, {
    fieldDefs: options.fieldDefs,
    statusFields: [],
    panelFields: options.panelFields,
    displayName: options.displayName,
    shortDisplayName: options.displayName,
    locale: options.locale,
    t: tr,
  });
  if (!model) throw new Error(`Provider ${options.provider} is disabled`);
  return cardFromModel(model, tr);
}

export function planPanel(context: ProviderViewContext, running: boolean): PanelPlan {
  const tr = context.t;
  const message = viewMessages({
    phase: context.phase,
    surface: "cards",
    t: tr,
    running,
  });

  if (context.phase !== "ready") {
    return {
      phase: context.phase,
      emptyTitle: message.title,
      emptySubtitle: message.subtitle || null,
      cards: [],
    };
  }

  const cardContext: ProviderViewContext = {
    ...context,
    statusFields: providerRecord(() => []),
  };
  const cards = deriveDisplayModels(cardContext).map((model) => cardFromModel(model, tr));

  return {
    phase: "ready",
    emptyTitle: null,
    emptySubtitle: null,
    cards,
  };
}
