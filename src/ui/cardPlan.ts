import { type ProviderName } from "../constants.js";
import type { ReaderStatus } from "../readers/base.js";
import type { FieldCategory } from "../readers/fields.js";
import type { ProviderDisplayModel } from "./displayModel.js";
import { clampPercent, type FieldTone } from "./fieldRows.js";
import { toDisplayRow, type DisplayRow } from "./fieldViews.js";
import type { Presentation, ProviderTone } from "./providerHealth.js";
import type { ProviderViewContext, ViewPhase } from "./viewContext.js";
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

function keyValueRow(row: DisplayRow): CardKeyValueRow {
  return {
    kind: "kv",
    name: row.name,
    category: row.category,
    label: row.labelText,
    valueText: row.valueText,
    accessibleText: row.accessibleText,
    ...(row.tone ? { tone: row.tone } : {}),
    ...(row.errorText ? { errorText: row.errorText } : {}),
  };
}

/** Pure card projection from one canonical model; the only card derivation. */
export function cardFromModel(
  model: ProviderDisplayModel,
  panelFields: readonly string[],
  locale: string,
  t: (s: string) => string,
): ProviderCardPlan {
  const limitProgressRows: CardProgressRow[] = [];
  const limitMetaRows: CardKeyValueRow[] = [];
  const telemetryRows: CardKeyValueRow[] = [];
  const configured = new Set(panelFields);

  for (const view of model.groupedViews.limit) {
    if (!configured.has(view.name) || model.consumedResets.has(view.name)) continue;
    const row = toDisplayRow(view, t);

    if (view.type === "percent") {
      const reset = model.resetPairs.get(view.name);
      const errorText = row.errorText ?? reset?.errorText ?? undefined;

      const progressRow: CardProgressRow = {
        kind: "progress",
        name: row.name,
        label: row.labelText,
        valueText: row.valueText,
        fillPercent: view.fillPercent ?? 0,
        hasValue: view.fillPercent !== undefined,
        accessibleText: reset?.accessibleText ?? row.accessibleText,
        ...(row.tone ? { tone: row.tone } : {}),
        ...(reset ? { resetText: reset.text } : {}),
        ...(errorText ? { errorText } : {}),
      };
      limitProgressRows.push(progressRow);
      continue;
    }

    limitMetaRows.push(keyValueRow(row));
  }

  for (const view of model.groupedViews.telemetry) {
    if (!configured.has(view.name) || model.consumedResets.has(view.name)) continue;
    telemetryRows.push(keyValueRow(toDisplayRow(view, t)));
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

export function planPanel(context: ProviderViewContext, running: boolean): PanelPlan {
  const message = viewMessages({
    phase: context.phase,
    surface: "cards",
    t: context.t,
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

  const cards = context.models.map((model) =>
    cardFromModel(model, context.panelFields[model.provider], context.locale, context.t),
  );

  return {
    phase: "ready",
    emptyTitle: null,
    emptySubtitle: null,
    cards,
  };
}
