import { type ProviderName } from "../constants.js";
import { formatAbsoluteTimestamp } from "../formatters.js";
import type { FieldDef, FieldResult, ReaderResult } from "../readers/base.js";
import { FieldStatus, ReaderStatus } from "../readers/base.js";
import type { FieldCategory } from "../readers/fields.js";
import { getProviderFields } from "../readers/fields.js";
import { getFieldRows } from "./fieldRows.js";
import type { FieldRow, FieldTone } from "./fieldRows.js";
import type { HealthTone } from "./tone.js";
import {
  clampPercent,
  collectFieldTones,
  usageStructureKey,
  worstFieldTone,
} from "./usageSnapshot.js";

export type CardBadgeKind = "live" | "cached" | "error" | "unavailable";
export type BannerKind = "warning" | "error";
export type PanelEmptyState = "none" | "disabled" | "loading";

export interface StatusPillPlan {
  provider: ProviderName;
  displayName: string;
  status: ReaderStatus;
  healthTone: HealthTone;
  isPartial: boolean;
  stateTag: string | null;
  stateAccessibleText: string | null;
  rows: FieldRow[];
  key: string;
}

export interface StatusBarPlan {
  loading: boolean;
  loadingAccessibleText: string;
  pills: StatusPillPlan[];
  structureKey: string;
}

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
  healthTone: HealthTone;
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

export function computeProviderHealthTone(
  status: ReaderStatus,
  rows: readonly FieldRow[],
  fields?: readonly FieldResult[],
  fieldDefs?: readonly FieldDef[],
): HealthTone {
  if (status === ReaderStatus.DISABLED) return "idle";
  if (status === ReaderStatus.ERROR || status === ReaderStatus.UNAVAILABLE) return "error";

  const worst = worstFieldTone(collectFieldTones(rows, fields, fieldDefs));
  if (worst === "critical") return "critical";
  if (status === ReaderStatus.PARTIAL) return "partial";
  if (worst === "warning") return "warning";
  if (worst === "ok") return "ok";

  const hasUsableField =
    rows.some((r) => r.valueText !== "—") ||
    (fields?.some((f) => f.status === FieldStatus.OK) ?? false);
  return hasUsableField ? "ok" : "idle";
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

export interface PlanStatusBarOptions {
  order: readonly ProviderName[];
  results: ReadonlyMap<ProviderName, ReaderResult>;
  hasEnabledProviders: boolean;
  locale: string;
  getShortDisplayName: (provider: ProviderName) => string;
  getStatusFields: (provider: ProviderName) => readonly string[];
  getFieldDefs?: (provider: ProviderName) => readonly FieldDef[] | undefined;
  t?: (s: string) => string;
}

export function planStatusBar(options: PlanStatusBarOptions): StatusBarPlan {
  const tr = options.t ?? ((s: string) => s);
  const pills: StatusPillPlan[] = [];

  for (const provider of options.order) {
    const result = options.results.get(provider);
    if (!result || result.status === ReaderStatus.DISABLED) continue;

    const defs = options.getFieldDefs
      ? options.getFieldDefs(provider)
      : getProviderFields(provider);
    const displayName = options.getShortDisplayName(provider);
    const rows = getFieldRows(
      defs,
      result,
      options.getStatusFields(provider),
      "status",
      options.locale,
      tr,
    );
    const healthTone = computeProviderHealthTone(result.status, rows, result.fields, defs);

    let stateTag: string | null = null;
    let stateAccessibleText: string | null = null;
    const isPartial = result.status === ReaderStatus.PARTIAL;
    if (result.status === ReaderStatus.ERROR) {
      stateTag = tr("(error)");
      stateAccessibleText = stateTag;
    } else if (result.status === ReaderStatus.UNAVAILABLE) {
      stateTag = tr("(unavailable)");
      stateAccessibleText = stateTag;
    } else if (isPartial) {
      stateTag = "~";
      stateAccessibleText = tr("Cached");
    }

    const key = JSON.stringify([
      provider,
      displayName,
      result.status,
      options.locale,
      stateTag ?? "",
      rows.map((r) => r.name ?? r.label),
    ]);

    pills.push({
      provider,
      displayName,
      status: result.status,
      healthTone,
      isPartial,
      stateTag,
      stateAccessibleText,
      rows,
      key,
    });
  }

  const loading = pills.length === 0 && options.results.size === 0 && options.hasEnabledProviders;
  return {
    loading,
    loadingAccessibleText: tr("Loading provider limits…"),
    pills,
    structureKey: usageStructureKey([
      options.locale,
      loading ? "loading" : "ready",
      ...pills.map((p) => p.key),
    ]),
  };
}

export interface PlanProviderCardOptions {
  provider: ProviderName;
  displayName: string;
  result: ReaderResult;
  panelFields: readonly string[];
  fieldDefs?: readonly FieldDef[];
  locale: string;
  t?: (s: string) => string;
}

export function planProviderCard(options: PlanProviderCardOptions): ProviderCardPlan {
  const tr = options.t ?? ((s: string) => s);
  const { provider, displayName, result, panelFields, locale } = options;
  const defs = options.fieldDefs ?? getProviderFields(provider);

  const isHardError =
    result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE;

  let badgeKind: CardBadgeKind;
  let badgeText: string;
  switch (result.status) {
    case ReaderStatus.OK:
      badgeKind = "live";
      badgeText = tr("Live");
      break;
    case ReaderStatus.PARTIAL:
      badgeKind = "cached";
      badgeText = tr("Cached");
      break;
    case ReaderStatus.UNAVAILABLE:
      badgeKind = "unavailable";
      badgeText = tr("Unavailable");
      break;
    case ReaderStatus.ERROR:
    default:
      badgeKind = "error";
      badgeText = tr("Error");
      break;
  }

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

  const rawRows = isHardError ? [] : getFieldRows(defs, result, panelFields, "panel", locale, tr);
  const healthTone = computeProviderHealthTone(result.status, rawRows, result.fields, defs);

  const lastUpdatedText =
    !isHardError && Number.isFinite(result.lastUpdated)
      ? tr("Last updated: %s").replace("%s", formatAbsoluteTimestamp(result.lastUpdated, locale))
      : null;

  const rowsByName = new Map<string, FieldRow>();
  for (const row of rawRows) {
    if (row.name && !rowsByName.has(row.name)) {
      rowsByName.set(row.name, row);
    }
  }

  const pairedResets = new Map<string, FieldRow>();
  const consumedResetNames = new Set<string>();
  for (const row of rawRows) {
    if (row.type !== "percent" || !row.name || !row.companionResetName) continue;
    if (consumedResetNames.has(row.companionResetName)) continue;
    const resetRow = rowsByName.get(row.companionResetName);
    if (resetRow) {
      pairedResets.set(row.name, resetRow);
      consumedResetNames.add(row.companionResetName);
    }
  }

  const limitProgressRows: CardProgressRow[] = [];
  const limitMetaRows: CardKeyValueRow[] = [];
  const telemetryRows: CardKeyValueRow[] = [];

  for (const row of rawRows) {
    const rowName = row.name ?? row.label;
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
  getFieldDefs?: (provider: ProviderName) => readonly FieldDef[] | undefined;
  t?: (s: string) => string;
}

export function planPanel(options: PlanPanelOptions): PanelPlan {
  const tr = options.t ?? ((s: string) => s);
  const cards: ProviderCardPlan[] = [];

  for (const provider of options.order) {
    const result = options.results.get(provider);
    if (!result || result.status === ReaderStatus.DISABLED) continue;

    const fieldDefs = options.getFieldDefs
      ? options.getFieldDefs(provider)
      : getProviderFields(provider);
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
        structureKey: usageStructureKey([options.locale, "empty:disabled"]),
      };
    }

    return {
      emptyState: "loading",
      emptyTitle: options.running
        ? tr("Loading provider limits…")
        : tr("Waiting for provider data…"),
      emptySubtitle: null,
      cards: [],
      structureKey: usageStructureKey([options.locale, "empty:loading"]),
    };
  }

  return {
    emptyState: "none",
    emptyTitle: null,
    emptySubtitle: null,
    cards,
    structureKey: usageStructureKey([options.locale, ...cards.map((c) => c.key)]),
  };
}
