import type { ProviderName } from "../constants.js";
import { formatAbsoluteTimestamp, formatField, formatTimestampTemplate } from "../formatters.js";
import { FieldStatus, ReaderStatus } from "../readers/base.js";
import type { FieldCategory, FieldDef, ReaderResult } from "../readers/base.js";
import { PROVIDER_FIELDS, resolveFieldCategory } from "../readers/fields.js";
import { fieldTone, getFieldRows, percentTone } from "./fieldRows.js";
import type { FieldTone } from "./fieldRows.js";
import { structureKey } from "./renderStructure.js";

export type StatusAttention = "quiet" | "partial" | "warning" | "critical" | "error";

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

export function clampFillRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  if (ratio <= 0) return 0;
  if (ratio >= 1) return 1;
  return ratio;
}

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

function worstFieldTone(tones: readonly (FieldTone | undefined)[]): FieldTone | undefined {
  let hasWarning = false;
  let hasOk = false;
  for (const tone of tones) {
    if (tone === "critical") return "critical";
    if (tone === "warning") hasWarning = true;
    else if (tone === "ok") hasOk = true;
  }
  if (hasWarning) return "warning";
  if (hasOk) return "ok";
  return undefined;
}

export function resolveStatusAttention(
  status: ReaderStatus,
  tones: readonly (FieldTone | undefined)[],
): StatusAttention {
  if (status === ReaderStatus.ERROR || status === ReaderStatus.UNAVAILABLE) {
    return "error";
  }
  const worst = worstFieldTone(tones);
  if (worst === "critical") return "critical";
  if (worst === "warning") return "warning";
  if (status === ReaderStatus.PARTIAL) return "partial";
  return "quiet";
}

function statusBadgeText(status: ReaderStatus, tr: (s: string) => string): string {
  switch (status) {
    case ReaderStatus.PARTIAL:
      return tr("(partial)");
    case ReaderStatus.ERROR:
      return tr("(error)");
    case ReaderStatus.UNAVAILABLE:
      return tr("(unavailable)");
    default:
      return "";
  }
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
      key: structureKey(["empty", input.locale]),
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

    if (result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE) {
      const badgeWord = statusBadgeText(result.status, tr);
      const badgeKey = JSON.stringify([provider, shortLabel, 1]);
      badges.push({
        provider,
        shortLabel,
        metricsText: "!",
        attention: "error",
        accessibleText: `${shortLabel} ${badgeWord}`.trim(),
        key: badgeKey,
      });
      continue;
    }

    const fakeReader = { FIELDS: defs };
    const rows = getFieldRows(fakeReader as never, result, configured, "status", input.locale, tr);
    const joined = rows.map((r) => r.valueText).join("·");
    const prefix = result.status === ReaderStatus.PARTIAL ? "~" : "";
    const metricsText = joined ? `${prefix}${joined}` : prefix;
    const attention = resolveStatusAttention(
      result.status,
      rows.map((r) => r.tone),
    );
    const badgeWord = statusBadgeText(result.status, tr);
    const spokenRows = rows.map((r) => r.accessibleText ?? `${r.label}: ${r.valueText}`).join(", ");
    const headerPart = badgeWord ? `${shortLabel} ${badgeWord}` : shortLabel;
    const accessibleText = spokenRows ? `${headerPart}: ${spokenRows}` : headerPart;
    const badgeKey = JSON.stringify([provider, shortLabel, metricsText ? 1 : 0]);

    badges.push({
      provider,
      shortLabel,
      metricsText,
      attention,
      accessibleText,
      key: badgeKey,
    });
  }

  if (badges.length === 0 && input.results.size === 0) {
    return {
      state: "loading",
      placeholderText: "…",
      badges: [],
      key: structureKey(["loading", input.locale]),
    };
  }

  return {
    state: "ready",
    placeholderText: null,
    badges,
    key: structureKey(["ready", input.locale, ...badges.map((b) => b.key)]),
  };
}

interface PrimarySnapshot {
  readonly summaryText: string;
  readonly fillRatio: number | null;
  readonly tone: FieldTone | "error" | undefined;
}

function extractPrimarySnapshot(
  defs: readonly FieldDef[],
  result: ReaderResult,
  preferredNames: readonly string[],
  locale: string,
  tr: (s: string) => string,
): PrimarySnapshot {
  if (result.status === ReaderStatus.ERROR) {
    return { summaryText: tr("Error"), fillRatio: null, tone: "error" };
  }
  if (result.status === ReaderStatus.UNAVAILABLE) {
    return { summaryText: tr("(unavailable)"), fillRatio: null, tone: "error" };
  }

  const limitPercentDefs = defs.filter(
    (d) => d.type === "percent" && resolveFieldCategory(d) === "limit",
  );
  const preferredPercentDef = preferredNames
    .map((n) => limitPercentDefs.find((d) => d.name === n))
    .find((d): d is FieldDef => {
      if (!d) return false;
      const f = result.fields.find((rf) => rf.name === d.name);
      return (
        f?.status === FieldStatus.OK && typeof f.value === "number" && Number.isFinite(f.value)
      );
    });

  const activePercentDef =
    preferredPercentDef ??
    limitPercentDefs.find((d) => {
      const f = result.fields.find((rf) => rf.name === d.name);
      return (
        f?.status === FieldStatus.OK && typeof f.value === "number" && Number.isFinite(f.value)
      );
    });

  let fillRatio: number | null = null;
  let tone: FieldTone | undefined;

  if (activePercentDef) {
    const rawVal = Number(result.fields.find((rf) => rf.name === activePercentDef.name)?.value);
    const usedPct = activePercentDef.name.startsWith("remaining_") ? 100 - rawVal : rawVal;
    fillRatio = clampFillRatio(usedPct / 100);
    tone = percentTone(usedPct);
  }

  const limitReached = result.fields.find((rf) => rf.name === "limit_reached");
  if (limitReached?.status === FieldStatus.OK && limitReached.value === true) {
    fillRatio = fillRatio === null ? 1 : Math.max(fillRatio, 1);
    tone = "critical";
  }

  const tokens: string[] = [];
  for (const fieldName of preferredNames) {
    const def = defs.find((d) => d.name === fieldName);
    if (!def) continue;
    const field = result.fields.find((rf) => rf.name === fieldName);
    if (!field || field.status !== FieldStatus.OK) continue;
    tokens.push(formatField({ type: def.type, value: field.value, zone: "status", locale, t: tr }));
  }

  if (tokens.length === 0) {
    if (activePercentDef) {
      const pctField = result.fields.find((rf) => rf.name === activePercentDef.name);
      if (pctField?.status === FieldStatus.OK) {
        tokens.push(
          formatField({
            type: "percent",
            value: pctField.value,
            zone: "status",
            locale,
            t: tr,
          }),
        );
      }
    }
    const firstResetDef = defs.find(
      (d) => d.type === "timestamp" && resolveFieldCategory(d) === "limit",
    );
    if (firstResetDef) {
      const resetField = result.fields.find((rf) => rf.name === firstResetDef.name);
      if (resetField?.status === FieldStatus.OK) {
        tokens.push(
          formatField({
            type: "timestamp",
            value: resetField.value,
            zone: "status",
            locale,
            t: tr,
          }),
        );
      }
    }
  }

  return {
    summaryText: tokens.length > 0 ? tokens.join(" · ") : "—",
    fillRatio,
    tone,
  };
}

function buildDetailGroups(
  defs: readonly FieldDef[],
  result: ReaderResult,
  panelFieldNames: readonly string[],
  locale: string,
  tr: (s: string) => string,
): MatrixRowGroup[] {
  const limitRows: MatrixDetailRow[] = [];
  const telemetryRows: MatrixDetailRow[] = [];

  for (const fieldName of panelFieldNames) {
    const def = defs.find((d) => d.name === fieldName);
    if (!def) continue;

    const category = resolveFieldCategory(def);
    const labelText = tr(def.label);
    const field = result.fields.find((rf) => rf.name === fieldName);

    let tone: FieldTone | undefined;
    if (def.type === "percent") {
      tone = fieldTone(fieldName, field?.value);
    } else if (
      def.name === "limit_reached" &&
      field?.status === FieldStatus.OK &&
      field.value === true
    ) {
      tone = "critical";
    }

    if (!field || field.status !== FieldStatus.OK) {
      const isError = field?.status === FieldStatus.ERROR || result.status === ReaderStatus.ERROR;
      const errorText = isError ? (field?.error ?? result.lastError ?? undefined) : undefined;
      const missingRow: MatrixDetailRow = {
        name: def.name,
        labelText,
        valueText: "—",
        microBar: null,
        ...(tone ? { tone } : {}),
        ...(errorText ? { errorText } : {}),
        accessibleText: `${labelText}: —`,
        category,
      };
      if (category === "telemetry") telemetryRows.push(missingRow);
      else limitRows.push(missingRow);
      continue;
    }

    const valueText = formatField({
      type: def.type,
      value: field.value,
      zone: "panel",
      locale,
      t: tr,
    });

    const microBar =
      def.type === "percent" &&
      category === "limit" &&
      typeof field.value === "number" &&
      Number.isFinite(field.value)
        ? formatSegmentedBar(clampFillRatio(field.value / 100), 8)
        : null;

    const row: MatrixDetailRow = {
      name: def.name,
      labelText,
      valueText,
      microBar,
      ...(tone ? { tone } : {}),
      accessibleText: `${labelText}: ${valueText}`,
      category,
    };

    if (category === "telemetry") telemetryRows.push(row);
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
      key: structureKey(["empty", input.locale]),
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
      key: structureKey(["loading", input.locale]),
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
    const statusBadge = statusBadgeText(result.status, tr);

    const snapshot = extractPrimarySnapshot(
      defs,
      result,
      input.statusFields[provider] ?? [],
      input.locale,
      tr,
    );
    const fiveSegmentBar =
      snapshot.fillRatio !== null ? formatSegmentedBar(snapshot.fillRatio, 5) : "";

    const errorText =
      result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE
        ? (result.lastError ?? tr("Error"))
        : null;
    const detailText = result.status === ReaderStatus.PARTIAL ? (result.lastError ?? null) : null;

    const groups =
      expanded && errorText === null
        ? buildDetailGroups(defs, result, input.panelFields[provider] ?? [], input.locale, tr)
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
    key: structureKey(["ready", input.locale, ...providers.map((p) => p.key)]),
  };
}
