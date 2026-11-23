import type { ProviderName } from "../constants.js";
import type { ReaderStatus } from "../readers/base.js";
import type { FieldCategory } from "../readers/fields.js";
import { classifyPanelViews, type ProviderDisplayModel } from "./displayModel.js";
import { clampPercent } from "./fieldRows.js";
import type { FieldTone } from "./fieldRows.js";
import type { FieldView } from "./fieldViews.js";
import type { ProviderTone } from "./providerHealth.js";
import type { Presentation } from "./providerHealth.js";
import { resetDetailText, type ResetPairing } from "./resetModel.js";
import { STYLE_REGISTRY } from "./styles.js";
import type { ProviderViewContext, ViewPhase } from "./viewContext.js";
import { phaseResult } from "./viewMessages.js";

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

function keyValueRow(view: FieldView): CardKeyValueRow {
  return {
    kind: "kv",
    name: view.name,
    category: view.category,
    label: view.labelText,
    valueText: view.valueText,
    accessibleText: view.accessibleText,
    ...(view.tone ? { tone: view.tone } : {}),
    ...(view.errorText ? { errorText: view.errorText } : {}),
  };
}

function progressRow(
  view: FieldView,
  pairing: ResetPairing | undefined,
  locale: string,
  t: (s: string) => string,
): CardProgressRow {
  const detail =
    pairing?.inPanel === true && pairing.claimed
      ? resetDetailText(pairing, "panel", locale, t)
      : undefined;
  const errorText = view.errorText ?? (detail ? (pairing?.errorText ?? undefined) : undefined);
  const accessibleText = detail ? `${view.accessibleText}, ${detail}` : view.accessibleText;

  return {
    kind: "progress",
    name: view.name,
    label: view.labelText,
    valueText: view.valueText,
    fillPercent: view.fillPercent ?? 0,
    hasValue: view.fillPercent !== undefined,
    accessibleText,
    ...(view.tone ? { tone: view.tone } : {}),
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
  const facts = model.facts;
  const limitProgressRows: CardProgressRow[] = [];
  const limitMetaRows: CardKeyValueRow[] = [];
  const telemetryRows: CardKeyValueRow[] = [];

  for (const view of groups.limit.progress) {
    limitProgressRows.push(progressRow(view, model.resets.get(view.name), locale, t));
  }
  for (const view of groups.limit.keyValue) {
    limitMetaRows.push(keyValueRow(view));
  }
  for (const view of groups.telemetry.keyValue) {
    telemetryRows.push(keyValueRow(view));
  }

  return {
    provider: model.provider,
    displayName: model.displayName,
    status: model.status,
    healthTone: facts.health.tone,
    badgeKind: facts.badges.card,
    badgeText: facts.badges.cardText,
    lastUpdatedText: facts.lastUpdatedText,
    bannerKind: facts.diagnostic.bannerKind,
    bannerText: facts.diagnostic.bannerText,
    limitProgressRows,
    limitMetaRows,
    telemetryRows,
  };
}

export function planPanel(context: ProviderViewContext, running: boolean): PanelPlan {
  const phase = phaseResult(context, STYLE_REGISTRY.panel.cards, running);

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
