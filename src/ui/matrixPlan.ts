import type { ProviderName } from "../constants.js";
import type { ReaderStatus } from "../readers/base.js";
import type { FieldCategory } from "../readers/fields.js";
import type { FieldRowSet } from "./displayModel.js";
import { clampFillRatio, type FieldTone } from "./fieldRows.js";
import { toDisplayRow } from "./fieldViews.js";
import type { ProviderViewContext, ViewPhase } from "./viewContext.js";
import { viewMessages } from "./viewMessages.js";

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

function groupsFromViews(rows: FieldRowSet, tr: (s: string) => string): MatrixRowGroup[] {
  const toDetailRow = (view: FieldRowSet["panelViews"][number]): MatrixDetailRow => {
    const row = toDisplayRow(view, tr);
    return {
      name: row.name,
      labelText: row.labelText,
      valueText: row.valueText,
      microBar:
        view.type === "percent" && row.category === "limit" && view.ratio !== null
          ? formatSegmentedBar(view.ratio, 8)
          : null,
      ...(row.tone ? { tone: row.tone } : {}),
      ...(row.errorText ? { errorText: row.errorText } : {}),
      accessibleText: row.accessibleText,
      category: row.category,
    };
  };

  const groups: MatrixRowGroup[] = [];
  if (rows.groupedViews.limit.length > 0) {
    groups.push({
      category: "limit",
      title: tr("Limits"),
      rows: rows.groupedViews.limit.map(toDetailRow),
    });
  }
  if (rows.groupedViews.telemetry.length > 0) {
    groups.push({
      category: "telemetry",
      title: tr("Telemetry"),
      rows: rows.groupedViews.telemetry.map(toDetailRow),
    });
  }
  return groups;
}

export function planPanelMatrix(
  context: ProviderViewContext,
  expandedOverrides: ReadonlyMap<ProviderName, boolean>,
): PanelMatrixPlan {
  const tr = context.t;

  if (context.phase !== "ready") {
    const message = viewMessages({
      phase: context.phase,
      surface: "matrix",
      t: tr,
      running: false,
    });
    return {
      phase: context.phase,
      messageText: message.title,
      allExpanded: false,
      canToggleAll: false,
      providers: [],
    };
  }

  const models = context.models;
  const enabledCount = context.activeProviders.length;
  const providers: ProviderMatrixPlan[] = [];

  for (const model of models) {
    const expanded = resolveProviderExpanded(model.provider, enabledCount, expandedOverrides);
    const chevron: "▾" | "▸" = expanded ? "▾" : "▸";
    const statusBadge = model.badges.status;
    const facts = model.usage.header;
    const fiveSegmentBar = facts.fillRatio !== null ? formatSegmentedBar(facts.fillRatio, 5) : "";
    const errorText = model.diagnostic.errorText;
    const detailText = model.diagnostic.detailText;
    const groups = expanded && errorText === null ? groupsFromViews(model, tr) : [];
    const lastUpdatedText = expanded && errorText === null ? model.lastUpdatedText : null;

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
