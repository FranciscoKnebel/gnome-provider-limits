import type { ProviderName } from "../constants.js";
import type { ReaderStatus } from "../readers/base.js";
import type { FieldCategory } from "../readers/fields.js";
import type { ProviderDisplayModel } from "./displayModel.js";
import { clampFillRatio, type FieldTone } from "./fieldRows.js";
import { STYLE_REGISTRY } from "./styles.js";
import type { ProviderViewContext, ViewPhase } from "./viewContext.js";
import { phaseResult } from "./viewMessages.js";

export interface MatrixDetailRow {
  readonly name: string;
  readonly labelText: string;
  readonly valueText: string;
  readonly microBar: string | null;
  readonly tone?: FieldTone;
  readonly errorText?: string;
  readonly accessibleText: string;
  readonly category: FieldCategory;
}

export interface MatrixRowGroup {
  readonly category: FieldCategory;
  readonly title: string;
  readonly rows: readonly MatrixDetailRow[];
}

export interface ProviderMatrixPlan {
  readonly provider: ProviderName;
  readonly displayName: string;
  readonly status: ReaderStatus;
  readonly expanded: boolean;
  readonly chevron: "▾" | "▸";
  readonly statusBadge: string;
  readonly primarySummary: string;
  readonly fiveSegmentBar: string;
  readonly fillRatio: number | null;
  readonly headerTone: FieldTone | "error" | undefined;
  readonly headerAccessibleName: string;
  readonly detailText: string | null;
  readonly errorText: string | null;
  readonly groups: readonly MatrixRowGroup[];
  readonly lastUpdatedText: string | null;
}

export interface PanelMatrixPlan {
  readonly phase: ViewPhase;
  readonly messageText: string | null;
  readonly allExpanded: boolean;
  readonly canToggleAll: boolean;
  readonly providers: readonly ProviderMatrixPlan[];
}

const FILLED_SEGMENT = "▰";
const EMPTY_SEGMENT = "▱";

export function formatSegmentedBar(ratio: number, segments = 8): string {
  const count = Math.max(1, Math.trunc(segments));
  const clamped = clampFillRatio(ratio);
  const filled = Math.round(clamped * count);
  return `${FILLED_SEGMENT.repeat(filled)}${EMPTY_SEGMENT.repeat(count - filled)}`;
}

export function resolveProviderExpanded(
  provider: ProviderName,
  enabledCount: number,
  overrides: ReadonlyMap<ProviderName, boolean>,
): boolean {
  const explicit = overrides.get(provider);
  if (explicit !== undefined) return explicit;
  return enabledCount <= 2;
}

export function areAllProvidersExpanded(
  providers: readonly ProviderName[],
  enabledCount: number,
  overrides: ReadonlyMap<ProviderName, boolean>,
): boolean {
  if (providers.length === 0) return false;
  return providers.every((p) => resolveProviderExpanded(p, enabledCount, overrides));
}

export function toggleAllProvidersExpanded(
  providers: readonly ProviderName[],
  enabledCount: number,
  overrides: ReadonlyMap<ProviderName, boolean>,
): Map<ProviderName, boolean> {
  const nextExpanded = !areAllProvidersExpanded(providers, enabledCount, overrides);
  const next = new Map<ProviderName, boolean>(overrides);
  for (const provider of providers) {
    next.set(provider, nextExpanded);
  }
  return next;
}

function groupsFromViews(
  model: ProviderDisplayModel,
  locale: string,
  tr: (s: string) => string,
): MatrixRowGroup[] {
  const toDetailRow = (view: ProviderDisplayModel["panelViews"][number]): MatrixDetailRow => {
    return {
      name: view.name,
      labelText: view.labelText,
      valueText: view.valueText,
      microBar:
        view.type === "percent" && view.category === "limit" && view.ratio !== null
          ? formatSegmentedBar(view.ratio, 8)
          : null,
      ...(view.tone ? { tone: view.tone } : {}),
      ...(view.errorText ? { errorText: view.errorText } : {}),
      accessibleText: view.accessibleText,
      category: view.category,
    };
  };

  const classified = model.facts.viewsIncludingConsumedResets;
  const groups: MatrixRowGroup[] = [];
  if (classified.limit.all.length > 0) {
    groups.push({
      category: "limit",
      title: tr("Limits"),
      rows: classified.limit.all.map(toDetailRow),
    });
  }
  if (classified.telemetry.all.length > 0) {
    groups.push({
      category: "telemetry",
      title: tr("Telemetry"),
      rows: classified.telemetry.all.map(toDetailRow),
    });
  }
  return groups;
}

export function planPanelMatrix(
  context: ProviderViewContext,
  expandedOverrides: ReadonlyMap<ProviderName, boolean>,
): PanelMatrixPlan {
  const tr = context.t;

  const phase = phaseResult(context, STYLE_REGISTRY.panel.compact, false);
  if (phase.kind === "placeholder") {
    return {
      phase: phase.phase,
      messageText: phase.message.title,
      allExpanded: false,
      canToggleAll: false,
      providers: [],
    };
  }

  const models = context.models;
  const enabledCount = context.activeProviders.length;
  const providers: ProviderMatrixPlan[] = [];

  for (const model of models) {
    const modelFacts = model.facts;
    const expanded = resolveProviderExpanded(model.provider, enabledCount, expandedOverrides);
    const chevron: "▾" | "▸" = expanded ? "▾" : "▸";
    const statusBadge = modelFacts.badges.status;
    const facts = modelFacts.usage.header;
    const fiveSegmentBar = facts.fillRatio !== null ? formatSegmentedBar(facts.fillRatio, 5) : "";
    const errorText = modelFacts.diagnostic.errorText;
    const detailText = modelFacts.diagnostic.detailText;
    const groups = expanded && errorText === null ? groupsFromViews(model, context.locale, tr) : [];
    const lastUpdatedText = expanded && errorText === null ? modelFacts.lastUpdatedText : null;

    const accessibleParts = [model.displayName];
    if (statusBadge) accessibleParts.push(statusBadge);
    if (facts.summaryText) accessibleParts.push(facts.summaryText);
    const headerAccessibleName = accessibleParts.join(" ");

    providers.push({
      provider: model.provider,
      displayName: model.displayName,
      status: model.status,
      expanded,
      chevron,
      statusBadge,
      primarySummary: facts.summaryText,
      fiveSegmentBar,
      fillRatio: facts.fillRatio,
      headerTone: facts.tone,
      headerAccessibleName,
      detailText,
      errorText,
      groups,
      lastUpdatedText,
    });
  }

  const allExpanded = areAllProvidersExpanded(
    context.activeProviders,
    enabledCount,
    expandedOverrides,
  );

  return {
    phase: "ready",
    messageText: null,
    allExpanded,
    canToggleAll: providers.length > 0,
    providers,
  };
}
