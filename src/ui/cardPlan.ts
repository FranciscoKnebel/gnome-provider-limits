import { type ProviderName } from "../constants.js";
import type { ReaderStatus } from "../readers/base.js";
import type { FieldCategory } from "../readers/fields.js";
import { classifyPanelViews, type ProviderDisplayModel } from "./displayModel.js";
import type { FieldTone } from "./fieldRows.js";
import { toDisplayRow, type DisplayRow } from "./fieldViews.js";
import type { Presentation, ProviderTone } from "./providerHealth.js";
import { resetDetailText, type ResetPairing } from "./resetModel.js";
import type { ProviderViewContext, ViewPhase } from "./viewContext.js";
import { phaseResult } from "./viewMessages.js";

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

function progressRow(
  view: ProviderDisplayModel["panelViews"][number],
  pairing: ResetPairing | undefined,
  row: DisplayRow,
  locale: string,
  t: (s: string) => string,
): CardProgressRow {
  const detail =
    pairing?.inPanel === true && pairing.claimed
      ? resetDetailText(pairing, "panel", locale, t)
      : undefined;
  const errorText = row.errorText ?? (detail ? (pairing?.errorText ?? undefined) : undefined);
  const accessibleText = detail ? `${row.accessibleText}, ${detail}` : row.accessibleText;

  return {
    kind: "progress",
    name: row.name,
    label: row.labelText,
    valueText: row.valueText,
    fillPercent: view.fillPercent ?? 0,
    hasValue: view.fillPercent !== undefined,
    accessibleText,
    ...(row.tone ? { tone: row.tone } : {}),
    ...(detail ? { resetText: detail } : {}),
    ...(errorText ? { errorText } : {}),
  };
}

/** Pure card projection from one canonical model; the only card derivation. */
export function cardFromModel(
  model: ProviderDisplayModel,
  locale: string,
  t: (s: string) => string,
): ProviderCardPlan {
  const groups = classifyPanelViews(model);
  const limitProgressRows: CardProgressRow[] = [];
  const limitMetaRows: CardKeyValueRow[] = [];
  const telemetryRows: CardKeyValueRow[] = [];

  for (const view of groups.limit.progress) {
    limitProgressRows.push(
      progressRow(
        view,
        model.resets.get(view.name),
        toDisplayRow(view, "panel", locale, t),
        locale,
        t,
      ),
    );
  }
  for (const view of groups.limit.keyValue) {
    limitMetaRows.push(keyValueRow(toDisplayRow(view, "panel", locale, t)));
  }
  for (const view of groups.telemetry.keyValue) {
    telemetryRows.push(keyValueRow(toDisplayRow(view, "panel", locale, t)));
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
  const phase = phaseResult(context, "cards", running);

  if (phase.kind === "placeholder") {
    return {
      phase: phase.phase,
      emptyTitle: phase.message.title || null,
      emptySubtitle: phase.message.subtitle || null,
      cards: [],
    };
  }

  const cards = context.models.map((model) => cardFromModel(model, context.locale, context.t));

  return {
    phase: "ready",
    emptyTitle: null,
    emptySubtitle: null,
    cards,
  };
}
