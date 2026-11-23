import { formatField } from "../formatters.js";
import type { FieldDef, FieldType, FieldZone, ReaderResult } from "../readers/base.js";
import { FieldStatus, ReaderStatus } from "../readers/base.js";
import type { FieldCategory } from "../readers/fields.js";
import { GAUGE_START_ANGLE, GAUGE_SWEEP_ANGLE, TONE_RGB } from "./cairoDrawing.js";
import type { FieldTone } from "./fieldRows.js";
import { getFieldRows } from "./fieldRows.js";
import type { GaugeTone, MicroMeterSpec } from "./gaugeTypes.js";
import { isLimitReached } from "./providerHealth.js";
import { clampFillRatio, extractWindowSuffix } from "./usageSnapshot.js";

export interface FieldView {
  readonly name: string;
  readonly type: FieldType;
  readonly category: FieldCategory;
  readonly label: string;
  readonly value: unknown;
  readonly valueText: string;
  readonly accessibleText: string;
  readonly tone?: FieldTone;
  readonly errorText?: string;
  readonly ratio: number | null;
  readonly usageRatio: number | null;
  readonly fillPercent?: number;
  readonly hasValue: boolean;
  readonly resetName: string | null;
  readonly resetText: string | null;
  readonly hasResetSlot: boolean;
}

function usedPercentOf(fieldName: string, value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return fieldName.startsWith("remaining_percent") ? 100 - value : value;
}

/** Reset facts that every row projection can carry, independent of panel style. */
export interface DisplayRowReset {
  readonly name: string | null;
  readonly text: string | null;
  readonly hasSlot: boolean;
}

/** The style-neutral projection of a FieldView, shared by every plan builder. */
export interface DisplayRow {
  readonly name: string;
  readonly label: string;
  readonly labelText: string;
  readonly valueText: string;
  readonly accessibleText: string;
  readonly category: FieldCategory;
  readonly tone?: FieldTone;
  readonly errorText?: string;
  readonly reset: DisplayRowReset;
}

/** Single FieldView-to-row projection; plan builders add only style-specific fields. */
export function toDisplayRow(view: FieldView, t: (s: string) => string): DisplayRow {
  return {
    name: view.name,
    label: view.label,
    labelText: t(view.label),
    valueText: view.valueText,
    accessibleText: view.accessibleText,
    category: view.category,
    ...(view.tone ? { tone: view.tone } : {}),
    ...(view.errorText ? { errorText: view.errorText } : {}),
    reset: { name: view.resetName, text: view.resetText, hasSlot: view.hasResetSlot },
  };
}

export function deriveFieldViews(
  defs: readonly FieldDef[],
  result: ReaderResult,
  fieldNames: readonly string[],
  zone: FieldZone,
  locale: string,
  t?: (s: string) => string,
): FieldView[] {
  const rows = getFieldRows(defs, result, fieldNames, zone, locale, t);
  const tr = t ?? ((s: string) => s);
  const limitReached = isLimitReached(result.fields);

  const activeSuffixes = new Set<string>();
  for (const row of rows) {
    if (row.type !== "percent" || !row.name) continue;
    const suffix = extractWindowSuffix(row.name);
    if (suffix !== null) activeSuffixes.add(suffix);
  }

  const pairedResets = new Set<string>();
  for (const row of rows) {
    if (!row.name?.startsWith("reset_at_") || row.type !== "timestamp") continue;
    const suffix = row.name.slice("reset_at_".length);
    if (activeSuffixes.has(suffix)) pairedResets.add(row.name);
  }

  return rows.map((row) => {
    const name = row.name ?? row.label;
    const def = defs.find((candidate) => candidate.name === name);
    const type = row.type ?? def?.type ?? "text";
    const category = row.category ?? def?.category ?? "limit";
    const resetName = row.companionResetName ?? def?.resetField ?? null;
    const field = result.fields.find((candidate) => candidate.name === name);

    let resetText: string | null = null;
    let hasResetSlot = false;
    if (
      resetName !== null &&
      defs.some((candidate) => candidate.name === resetName && candidate.type === "timestamp")
    ) {
      const resetField = result.fields.find((candidate) => candidate.name === resetName);
      if (
        resetField?.status === FieldStatus.OK &&
        resetField.value !== null &&
        resetField.value !== undefined
      ) {
        resetText = `↻ ${formatField({ type: "timestamp", value: resetField.value, zone, locale, t: tr })}`;
        hasResetSlot = true;
      } else if (pairedResets.has(resetName)) {
        resetText = "↻ —";
        hasResetSlot = true;
      }
    }

    const usedPercent = type === "percent" ? usedPercentOf(name, field?.value) : null;
    let usageRatio = usedPercent === null ? null : clampFillRatio(usedPercent / 100);
    if (limitReached && type === "percent") {
      usageRatio = usageRatio === null ? 1 : Math.max(usageRatio, 1);
    }
    const tone =
      limitReached && (name === "limit_reached" || type === "percent") ? "critical" : row.tone;
    return {
      name,
      type,
      category,
      label: row.label,
      value: field?.value ?? null,
      valueText: row.valueText,
      accessibleText: row.accessibleText ?? `${tr(row.label)}: ${row.valueText}`,
      ratio: row.fillPercent === undefined ? null : clampFillRatio(row.fillPercent / 100),
      usageRatio,
      hasValue: row.valueText !== "—",
      resetName,
      resetText,
      hasResetSlot,
      ...(row.fillPercent !== undefined ? { fillPercent: row.fillPercent } : {}),
      ...(tone ? { tone } : {}),
      ...(row.errorText ? { errorText: row.errorText } : {}),
    };
  });
}

export interface UsageViewSelection {
  readonly limitOnly?: boolean;
  readonly requireFiniteValue?: boolean;
}

export function selectUsageView(
  views: readonly FieldView[],
  preferredNames: readonly string[],
  options: UsageViewSelection = {},
): FieldView | undefined {
  const candidates = views.filter(
    (view) => view.type === "percent" && (!options.limitOnly || view.category === "limit"),
  );
  const isUsable = (view: FieldView): boolean => !options.requireFiniteValue || view.hasValue;
  for (const name of preferredNames) {
    const view = candidates.find((candidate) => candidate.name === name);
    if (view && isUsable(view)) return view;
  }
  return candidates.find(isUsable);
}

/** Builds the compact gauge spec from views that have already been derived. */
export function meterFromViews(views: readonly FieldView[]): MicroMeterSpec {
  const primary = views.find((view) => view.type === "percent" && view.hasValue);
  if (!primary) {
    return {
      ratio: 0,
      hasValue: false,
      startAngle: GAUGE_START_ANGLE,
      endAngle: GAUGE_START_ANGLE,
      tone: "neutral",
      rgb: TONE_RGB.neutral,
      isError: false,
    };
  }

  const ratio = primary.usageRatio ?? 0;
  const tone: GaugeTone = primary.tone ?? "ok";
  return {
    ratio,
    hasValue: true,
    startAngle: GAUGE_START_ANGLE,
    endAngle: GAUGE_START_ANGLE + ratio * GAUGE_SWEEP_ANGLE,
    tone,
    rgb: TONE_RGB[tone],
    isError: false,
  };
}

export interface UsageFacts {
  readonly valueText: string;
  readonly fillRatio: number | null;
  readonly tone: FieldTone | "error" | undefined;
  readonly resetText: string | null;
  readonly summaryText: string;
}

export interface UsageProjectionOptions extends UsageViewSelection {
  readonly t?: (s: string) => string;
}

export function projectUsageFacts(
  result: ReaderResult,
  views: readonly FieldView[],
  preferredFieldNames: readonly string[],
  options: UsageProjectionOptions = {},
): UsageFacts {
  const tr = options.t ?? ((s: string) => s);
  if (result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE) {
    return {
      valueText: "—",
      fillRatio: null,
      tone: "error",
      resetText: null,
      summaryText: result.status === ReaderStatus.ERROR ? tr("Error") : tr("(unavailable)"),
    };
  }

  const primary = selectUsageView(views, preferredFieldNames, options);
  const tokens: string[] = [];
  for (const name of preferredFieldNames) {
    const view = views.find((candidate) => candidate.name === name);
    if (view?.hasValue) tokens.push(view.valueText);
  }
  if (tokens.length === 0) {
    if (primary?.hasValue) tokens.push(primary.valueText);
    const resetView = views.find(
      (candidate) =>
        candidate.type === "timestamp" && candidate.category === "limit" && candidate.hasValue,
    );
    if (resetView) tokens.push(resetView.valueText);
  }

  return {
    valueText: primary?.valueText ?? "—",
    fillRatio: primary?.usageRatio ?? null,
    tone: primary?.tone,
    resetText: primary?.resetText ?? null,
    summaryText: tokens.length > 0 ? tokens.join(" · ") : "—",
  };
}
