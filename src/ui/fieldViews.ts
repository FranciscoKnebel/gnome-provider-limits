import { formatField } from "../formatters.js";
import type { FieldDef, FieldType, FieldZone, ReaderResult } from "../readers/base.js";
import { FieldStatus, isHardError, isLimitReached, ReaderStatus } from "../readers/base.js";
import type { FieldCategory } from "../readers/fields.js";
import { emptyMeter, gaugeArc } from "./cairoDrawing.js";
import type { FieldTone } from "./fieldRows.js";
import { clampFillRatio, clampPercent, fieldTone } from "./fieldRows.js";
import type { GaugeSpec } from "./gaugeTypes.js";

/**
 * The one formatted projection of a field. Text is rendered at derivation for
 * the view's zone, so renderers consume it directly without a second stage.
 */
export interface FieldView {
  readonly name: string;
  readonly type: FieldType;
  readonly category: FieldCategory;
  readonly label: string;
  readonly labelText: string;
  readonly valueText: string;
  readonly accessibleText: string;
  readonly hasValue: boolean;
  readonly tone?: FieldTone;
  readonly errorText?: string;
  readonly ratio: number | null;
  readonly usageRatio: number | null;
  readonly fillPercent?: number;
  readonly resetName: string | null;
}

function usedPercentOf(fieldName: string, value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return fieldName.startsWith("remaining_percent") ? 100 - value : value;
}

export interface FieldViewOptions {
  readonly zone: FieldZone;
  readonly locale: string;
  readonly t: (s: string) => string;
}

/** The single zone-aware derivation for one provider's configured fields. */
export function deriveFieldViews(
  defs: readonly FieldDef[],
  result: ReaderResult,
  fieldNames: readonly string[],
  options: FieldViewOptions,
): FieldView[] {
  const { zone, locale, t: tr } = options;
  const limitReached = isLimitReached(result.fields);
  const fieldByName = new Map(result.fields.map((field) => [field.name, field]));
  const views: FieldView[] = [];
  const seen = new Set<string>();

  for (const name of fieldNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    const def = defs.find((candidate) => candidate.name === name);
    if (!def) continue;

    const field = fieldByName.get(name);
    const value = field?.value ?? null;
    const hasValue =
      field?.status === FieldStatus.OK &&
      value !== null &&
      value !== undefined &&
      (typeof value !== "number" || Number.isFinite(value));

    let usageRatio: number | null = null;
    let ratio: number | null = null;
    let fillPercent: number | undefined;
    if (def.type === "percent") {
      const usedPercent = usedPercentOf(name, hasValue ? value : null);
      usageRatio = usedPercent === null ? null : clampFillRatio(usedPercent / 100);
      if (limitReached) usageRatio = usageRatio === null ? 1 : Math.max(usageRatio, 1);
      fillPercent = hasValue ? clampPercent(value) : undefined;
      ratio = fillPercent === undefined ? null : clampFillRatio(fillPercent / 100);
    }

    const tone =
      limitReached && (name === "limit_reached" || def.type === "percent")
        ? "critical"
        : def.type === "percent"
          ? fieldTone(name, value)
          : undefined;
    const errorText =
      field?.status === FieldStatus.ERROR || result.status === ReaderStatus.ERROR
        ? (field?.error ?? result.lastError ?? "Provider error")
        : undefined;
    const labelText = tr(def.label);
    const valueText = hasValue ? formatField({ type: def.type, value, zone, locale, t: tr }) : "—";

    views.push({
      name,
      type: def.type,
      category: def.category,
      label: def.label,
      labelText,
      valueText,
      accessibleText: `${labelText}: ${valueText}`,
      hasValue,
      ...(tone ? { tone } : {}),
      ...(errorText ? { errorText } : {}),
      ratio,
      usageRatio,
      ...(fillPercent !== undefined ? { fillPercent } : {}),
      resetName: def.resetField ?? null,
    });
  }

  return views;
}

/** Project one derived view set into a zone's configured order. */
export function selectViews(
  views: readonly FieldView[],
  fieldNames: readonly string[],
): FieldView[] {
  const byName = new Map(views.map((view) => [view.name, view]));
  const selected: FieldView[] = [];
  const seen = new Set<string>();
  for (const name of fieldNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    const view = byName.get(name);
    if (view) selected.push(view);
  }
  return selected;
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
export function meterFromViews(views: readonly FieldView[]): GaugeSpec {
  const primary = views.find((view) => view.type === "percent" && view.hasValue);
  if (!primary) return emptyMeter("neutral", false);
  return gaugeArc(primary.usageRatio ?? 0, primary.tone ?? "ok");
}

export interface UsageFacts {
  readonly valueText: string;
  readonly fillRatio: number | null;
  readonly tone: FieldTone | "error" | undefined;
  readonly resetText: string | null;
  readonly summaryText: string;
}

export interface UsageProjectionOptions extends UsageViewSelection {
  readonly t: (s: string) => string;
  readonly resetTextFor?: (view: FieldView) => string | null;
}

export function projectUsageFacts(
  result: ReaderResult,
  views: readonly FieldView[],
  preferredFieldNames: readonly string[],
  options: UsageProjectionOptions,
): UsageFacts {
  const tr = options.t;
  if (isHardError(result)) {
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
    valueText: primary ? primary.valueText : "—",
    fillRatio: primary?.usageRatio ?? null,
    tone: primary?.tone,
    resetText: primary ? (options.resetTextFor?.(primary) ?? null) : null,
    summaryText: tokens.length > 0 ? tokens.join(" · ") : "—",
  };
}
