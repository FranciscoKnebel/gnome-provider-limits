import { formatField } from "../formatters.js";
import { FieldStatus, ReaderStatus } from "../readers/base.js";
import type { FieldDef, FieldResult, ReaderResult } from "../readers/base.js";
import { companionResetFieldName, resolveFieldCategory } from "../readers/fields.js";
import { clampPercent, fieldTone } from "./fieldRows.js";
import type { FieldRow, FieldTone } from "./fieldRows.js";

const TONE_SEVERITY: Record<FieldTone, number> = {
  ok: 1,
  warning: 2,
  critical: 3,
};

export function clampRatio(value: unknown): number | null {
  const percent = clampPercent(value);
  return percent === undefined ? null : percent / 100;
}

export function clampFillRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function worstFieldTone(tones: readonly (FieldTone | undefined)[]): FieldTone | undefined {
  let worst: FieldTone | undefined;
  for (const candidate of tones) {
    if (candidate && (!worst || TONE_SEVERITY[candidate] > TONE_SEVERITY[worst])) {
      worst = candidate;
    }
  }
  return worst;
}

export function isLimitReached(fields: readonly FieldResult[] | undefined): boolean {
  const field = fields?.find((candidate) => candidate.name === "limit_reached");
  return field?.status === FieldStatus.OK && field.value === true;
}

export function collectFieldTones(
  rows: readonly FieldRow[],
  fields?: readonly FieldResult[],
  fieldDefs?: readonly FieldDef[],
): (FieldTone | undefined)[] {
  const tones: (FieldTone | undefined)[] = rows.map((row) => row.tone);
  if (fields && fieldDefs) {
    for (const def of fieldDefs) {
      if (def.type !== "percent") continue;
      const field = fields.find((candidate) => candidate.name === def.name);
      if (field?.status === FieldStatus.OK) tones.push(fieldTone(def.name, field.value));
    }
  }
  if (isLimitReached(fields)) tones.push("critical");
  return tones;
}

export interface PercentFieldSelection {
  readonly limitOnly?: boolean;
  readonly requireFiniteValue?: boolean;
}

export function selectPercentField(
  defs: readonly FieldDef[],
  preferredNames: readonly string[],
  fields: readonly FieldResult[],
  options: PercentFieldSelection = {},
): FieldDef | undefined {
  const candidates = defs.filter(
    (def) =>
      def.type === "percent" && (!options.limitOnly || resolveFieldCategory(def) === "limit"),
  );
  const isUsable = (def: FieldDef): boolean => {
    if (!options.requireFiniteValue) return true;
    const field = fields.find((candidate) => candidate.name === def.name);
    return (
      field?.status === FieldStatus.OK &&
      typeof field.value === "number" &&
      Number.isFinite(field.value)
    );
  };

  for (const name of preferredNames) {
    const def = candidates.find((candidate) => candidate.name === name);
    if (def && isUsable(def)) return def;
  }
  return candidates.find(isUsable);
}

export function extractWindowSuffix(fieldName: string): string | null {
  const match = /^(?:used|remaining)_percent_(.+)$/.exec(fieldName);
  return match ? match[1] : null;
}

export function usagePercent(fieldName: string, value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return fieldName.startsWith("remaining_percent") ? 100 - value : value;
}

export interface UsageSnapshot {
  readonly fieldName: string | null;
  readonly value: unknown;
  readonly usedPercent: number | null;
  readonly fillRatio: number | null;
  readonly tone: FieldTone | "error" | undefined;
  readonly resetFieldName: string | null;
  readonly summaryText: string;
}

export interface UsageSnapshotOptions {
  readonly fieldDefs: readonly FieldDef[];
  readonly result: ReaderResult;
  readonly preferredFieldNames: readonly string[];
  readonly locale: string;
  readonly t?: (s: string) => string;
  readonly limitOnly?: boolean;
  readonly requireFiniteValue?: boolean;
}

function buildSummaryText(
  defs: readonly FieldDef[],
  result: ReaderResult,
  preferredNames: readonly string[],
  activeDef: FieldDef | undefined,
  activeField: FieldResult | undefined,
  locale: string,
  tr: (s: string) => string,
): string {
  const tokens: string[] = [];
  for (const name of preferredNames) {
    const def = defs.find((candidate) => candidate.name === name);
    if (!def) continue;
    const field = result.fields.find((candidate) => candidate.name === name);
    if (!field || field.status !== FieldStatus.OK) continue;
    tokens.push(formatField({ type: def.type, value: field.value, zone: "status", locale, t: tr }));
  }

  if (tokens.length === 0) {
    if (activeDef && activeField?.status === FieldStatus.OK) {
      tokens.push(
        formatField({
          type: "percent",
          value: activeField.value,
          zone: "status",
          locale,
          t: tr,
        }),
      );
    }
    const resetDef = defs.find(
      (candidate) => candidate.type === "timestamp" && resolveFieldCategory(candidate) === "limit",
    );
    if (resetDef) {
      const resetField = result.fields.find((candidate) => candidate.name === resetDef.name);
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

  return tokens.length > 0 ? tokens.join(" · ") : "—";
}

export function deriveUsageSnapshot(options: UsageSnapshotOptions): UsageSnapshot {
  const { fieldDefs, result, preferredFieldNames, locale, t } = options;
  const tr = t ?? ((s: string) => s);

  if (result.status === ReaderStatus.ERROR || result.status === ReaderStatus.UNAVAILABLE) {
    return {
      fieldName: null,
      value: null,
      usedPercent: null,
      fillRatio: null,
      tone: "error",
      resetFieldName: null,
      summaryText: result.status === ReaderStatus.ERROR ? tr("Error") : tr("(unavailable)"),
    };
  }

  const def = selectPercentField(fieldDefs, preferredFieldNames, result.fields, {
    limitOnly: options.limitOnly,
    requireFiniteValue: options.requireFiniteValue,
  });
  const field = def ? result.fields.find((candidate) => candidate.name === def.name) : undefined;
  const value = field?.value ?? null;
  const usedPercent = def ? usagePercent(def.name, value) : null;
  let fillRatio = usedPercent === null ? null : clampFillRatio(usedPercent / 100);
  let tone: FieldTone | undefined = def ? fieldTone(def.name, value) : undefined;

  if (isLimitReached(result.fields)) {
    fillRatio = fillRatio === null ? 1 : Math.max(fillRatio, 1);
    tone = "critical";
  }

  return {
    fieldName: def?.name ?? null,
    value,
    usedPercent,
    fillRatio,
    tone,
    resetFieldName: def ? companionResetFieldName(def) : null,
    summaryText: buildSummaryText(fieldDefs, result, preferredFieldNames, def, field, locale, tr),
  };
}
