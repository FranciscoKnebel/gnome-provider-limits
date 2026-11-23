import type { ProviderName } from "../constants.js";
import { formatAbsoluteTimestamp, formatTimestampTemplate } from "../formatters.js";
import { ReaderStatus } from "../readers/base.js";
import type { FieldDef, ReaderResult } from "../readers/base.js";
import type { FieldCategory } from "../readers/fields.js";
import { PROVIDER_FIELDS } from "../readers/fields.js";
import type { FieldTone } from "./fieldRows.js";
import type { AttentionValue, FieldView } from "./fieldViews.js";
import {
  deriveFieldViews,
  deriveProviderHealth,
  healthFromStatusAndTones,
  statusBadgeText,
  toAttention,
} from "./fieldViews.js";
import { clampFillRatio, deriveUsageSnapshot, usageStructureKey } from "./usageSnapshot.js";

export { clampFillRatio };

export type StatusAttention = AttentionValue;

export interface StatusBarBadgePlan {
  readonly provider: ProviderName;
  readonly shortLabel: string;
  readonly metricsText: string;
  readonly attention: StatusAttention;
  readonly accessibleText: string;
  readonly key: string;
}

export interface StatusBarPlan {
  readonly state: "empty" | "loading" | "ready";
  readonly placeholderText: string | null;
  readonly badges: readonly StatusBarBadgePlan[];
  readonly key: string;
}

export interface PlanStatusBarInput {
  readonly order: readonly ProviderName[];
  readonly enabledProviders: ReadonlySet<ProviderName>;
  readonly results: ReadonlyMap<ProviderName, ReaderResult>;
  readonly shortLabels: Readonly<Record<ProviderName, string>>;
  readonly statusFields: Readonly<Record<ProviderName, readonly string[]>>;
  readonly fieldDefs?: Readonly<Partial<Record<ProviderName, readonly FieldDef[]>>>;
  readonly locale: string;
  readonly t?: (s: string) => string;
}

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
  readonly key: string;
}

export interface PanelMatrixPlan {
  readonly state: "empty" | "loading" | "ready";
  readonly messageText: string | null;
  readonly allExpanded: boolean;
  readonly canToggleAll: boolean;
  readonly providers: readonly ProviderMatrixPlan[];
  readonly key: string;
}

export interface PlanPanelMatrixInput {
  readonly order: readonly ProviderName[];
  readonly enabledProviders: ReadonlySet<ProviderName>;
  readonly results: ReadonlyMap<ProviderName, ReaderResult>;
  readonly displayNames: Readonly<Record<ProviderName, string>>;
  readonly statusFields: Readonly<Record<ProviderName, readonly string[]>>;
  readonly panelFields: Readonly<Record<ProviderName, readonly string[]>>;
  readonly expandedOverrides: ReadonlyMap<ProviderName, boolean>;
  readonly fieldDefs?: Readonly<Partial<Record<ProviderName, readonly FieldDef[]>>>;
  readonly locale: string;
  readonly t?: (s: string) => string;
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

export function resolveStatusAttention(
  status: ReaderStatus,
  tones: readonly (FieldTone | undefined)[],
): StatusAttention {
  return toAttention(healthFromStatusAndTones(status, tones));
}

function defsFor(
  provider: ProviderName,
  custom?: Readonly<Partial<Record<ProviderName, readonly FieldDef[]>>>,
): readonly FieldDef[] {
  return custom?.[provider] ?? PROVIDER_FIELDS[provider];
}

export function planStatusBar(input: PlanStatusBarInput): StatusBarPlan {
  const tr = input.t ?? ((s: string) => s);

  if (input.enabledProviders.size === 0) {
    return {
      state: "empty",
      placeholderText: null,
      badges: [],
      key: usageStructureKey(["empty", input.locale]),
    };
  }

  const badges: StatusBarBadgePlan[] = [];

  for (const provider of input.order) {
    if (!input.enabledProviders.has(provider)) continue;
    const result = input.results.get(provider);
    if (!result || result.status === ReaderStatus.DISABLED) continue;

    const shortLabel = input.shortLabels[provider] || provider;
    const defs = defsFor(provider, input.fieldDefs);
    const configured = [...(input.statusFields[provider] ?? [])];
    const views = deriveFieldViews(defs, result, configured, "status", input.locale, tr);
    const health = deriveProviderHealth(result, views, tr, defs);
    const badgeWord = statusBadgeText(health, tr);

    if (health.state === "error" || health.state === "unavailable") {
      const badgeKey = JSON.stringify([provider, shortLabel, 1]);
      badges.push({
        provider,
        shortLabel,
        metricsText: "!",
        attention: toAttention(health),
        accessibleText: `${shortLabel} ${badgeWord}`.trim(),
        key: badgeKey,
      });
      continue;
    }

    const joined = views.map((view) => view.valueText).join("·");
    const prefix = result.status === ReaderStatus.PARTIAL ? "~" : "";
    const metricsText = joined ? `${prefix}${joined}` : prefix;
    const spokenRows = views.map((view) => view.accessibleText).join(", ");
    const headerPart = badgeWord ? `${shortLabel} ${badgeWord}` : shortLabel;
    const accessibleText = spokenRows ? `${headerPart}: ${spokenRows}` : headerPart;
    const badgeKey = JSON.stringify([provider, shortLabel, metricsText ? 1 : 0]);

    badges.push({
      provider,
      shortLabel,
      metricsText,
      attention: toAttention(health),
      accessibleText,
      key: badgeKey,
    });
  }

  if (badges.length === 0 && input.results.size === 0) {
    return {
      state: "loading",
      placeholderText: "…",
      badges: [],
      key: usageStructureKey(["loading", input.locale]),
    };
  }

  return {
    state: "ready",
    placeholderText: null,
    badges,
    key: usageStructureKey(["ready", input.locale, ...badges.map((b) => b.key)]),
  };
}

function groupsFromViews(views: readonly FieldView[], tr: (s: string) => string): MatrixRowGroup[] {
  const limitRows: MatrixDetailRow[] = [];
  const telemetryRows: MatrixDetailRow[] = [];

  for (const view of views) {
    const row: MatrixDetailRow = {
      name: view.name,
      labelText: tr(view.label),
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
    if (view.category === "telemetry") telemetryRows.push(row);
    else limitRows.push(row);
  }

  const groups: MatrixRowGroup[] = [];
  if (limitRows.length > 0) {
    groups.push({ category: "limit", title: tr("Limits"), rows: limitRows });
  }
  if (telemetryRows.length > 0) {
    groups.push({ category: "telemetry", title: tr("Telemetry"), rows: telemetryRows });
  }
  return groups;
}

export function planPanelMatrix(input: PlanPanelMatrixInput): PanelMatrixPlan {
  const tr = input.t ?? ((s: string) => s);
  const enabledInOrder = input.order.filter((p) => input.enabledProviders.has(p));

  if (enabledInOrder.length === 0) {
    const msg = tr("No providers enabled. Open Settings to enable a provider.");
    return {
      state: "empty",
      messageText: msg,
      allExpanded: false,
      canToggleAll: false,
      providers: [],
      key: usageStructureKey(["empty", input.locale]),
    };
  }

  const activeProviders: ProviderName[] = [];
  const providers: ProviderMatrixPlan[] = [];

  for (const provider of enabledInOrder) {
    const result = input.results.get(provider);
    if (!result || result.status === ReaderStatus.DISABLED) continue;
    activeProviders.push(provider);
  }

  if (activeProviders.length === 0 && input.results.size === 0) {
    const msg = tr("Reading provider limits…");
    return {
      state: "loading",
      messageText: msg,
      allExpanded: false,
      canToggleAll: false,
      providers: [],
      key: usageStructureKey(["loading", input.locale]),
    };
  }

  const enabledCount = activeProviders.length;

  for (const provider of activeProviders) {
    const result = input.results.get(provider);
    if (!result) continue;

    const displayName = input.displayNames[provider] || provider;
    const defs = defsFor(provider, input.fieldDefs);
    const expanded = resolveProviderExpanded(provider, enabledCount, input.expandedOverrides);
    const chevron: "▾" | "▸" = expanded ? "▾" : "▸";
    const statusViews = deriveFieldViews(
      defs,
      result,
      input.statusFields[provider] ?? [],
      "status",
      input.locale,
      tr,
    );
    const statusBadge = statusBadgeText(deriveProviderHealth(result, statusViews, tr, defs), tr);

    const snapshot = deriveUsageSnapshot({
      fieldDefs: defs,
      result,
      preferredFieldNames: input.statusFields[provider] ?? [],
      locale: input.locale,
      t: tr,
      limitOnly: true,
      requireFiniteValue: true,
    });
    const fiveSegmentBar =
      snapshot.fillRatio !== null ? formatSegmentedBar(snapshot.fillRatio, 5) : "";

    const errorText =
      result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE
        ? (result.lastError ?? tr("Error"))
        : null;
    const detailText = result.status === ReaderStatus.PARTIAL ? (result.lastError ?? null) : null;

    const groups =
      expanded && errorText === null
        ? groupsFromViews(
            deriveFieldViews(
              defs,
              result,
              input.panelFields[provider] ?? [],
              "panel",
              input.locale,
              tr,
            ),
            tr,
          )
        : [];

    const lastUpdatedText =
      expanded && errorText === null && Number.isFinite(result.lastUpdated)
        ? formatTimestampTemplate(tr("Last updated: %s"), result.lastUpdated, input.locale) ||
          formatAbsoluteTimestamp(result.lastUpdated, input.locale)
        : null;

    const accessibleParts = [displayName];
    if (statusBadge) accessibleParts.push(statusBadge);
    if (snapshot.summaryText) accessibleParts.push(snapshot.summaryText);
    const headerAccessibleName = accessibleParts.join(" ");

    const groupStructure = groups.map((g) => [
      g.category,
      g.rows.map((r) => [r.name, r.microBar !== null ? 1 : 0, r.errorText !== undefined ? 1 : 0]),
    ]);

    const providerKey = JSON.stringify([
      provider,
      displayName,
      result.status,
      input.locale,
      expanded ? 1 : 0,
      statusBadge ? 1 : 0,
      fiveSegmentBar ? 1 : 0,
      detailText !== null ? 1 : 0,
      errorText !== null ? 1 : 0,
      lastUpdatedText !== null ? 1 : 0,
      groupStructure,
    ]);

    providers.push({
      provider,
      displayName,
      status: result.status,
      expanded,
      chevron,
      statusBadge,
      primarySummary: snapshot.summaryText,
      fiveSegmentBar,
      fillRatio: snapshot.fillRatio,
      headerTone: snapshot.tone,
      headerAccessibleName,
      detailText,
      errorText,
      groups,
      lastUpdatedText,
      key: providerKey,
    });
  }

  const allExpanded = areAllProvidersExpanded(
    activeProviders,
    enabledCount,
    input.expandedOverrides,
  );

  return {
    state: "ready",
    messageText: null,
    allExpanded,
    canToggleAll: providers.length > 0,
    providers,
    key: usageStructureKey(["ready", input.locale, ...providers.map((p) => p.key)]),
  };
}
