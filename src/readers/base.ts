import type Gio from "gi://Gio";

import type { ProviderName } from "../constants.js";
import type { FieldName } from "./fields.js";

export const LAST_GOOD_MAX_AGE_MS = 30 * 60 * 1000;

export enum ReaderStatus {
  OK = "ok",
  PARTIAL = "partial",
  ERROR = "error",
  UNAVAILABLE = "unavailable",
  DISABLED = "disabled",
}

export type DisplayStatus = Exclude<ReaderStatus, ReaderStatus.DISABLED>;

export enum FieldStatus {
  OK = "ok",
  UNAVAILABLE = "unavailable",
  /** The provider does not expose this field for the current plan or window. */
  NOT_APPLICABLE = "not_applicable",
  ERROR = "error",
}

export type FieldType = "percent" | "count" | "tokens" | "cost" | "timestamp" | "bool" | "text";

/** Whether a percent field reports used share or remaining share of its window. */
export type FieldValueKind = "used" | "remaining";

export type FieldZone = "status" | "panel";

export type FieldCategory = "limit" | "telemetry";

export interface FieldDef<TName extends string = string> {
  readonly name: TName;
  readonly label: string;
  readonly type: FieldType;
  readonly category: FieldCategory;
  readonly resetField?: string;
  /** For percent fields, the direction of the stored value. Absent means "used". */
  readonly valueKind?: FieldValueKind;
}

/** Full typed names for the two fields of a used/remaining percent pair. */
export interface PercentFieldNames<P extends ProviderName> {
  readonly used: FieldName<P>;
  readonly remaining: FieldName<P>;
}

/** Full typed names for a percent pair plus its companion reset timestamp. */
export interface WindowFieldNames<P extends ProviderName> extends PercentFieldNames<P> {
  readonly reset: FieldName<P>;
}

export interface FieldResult<T = unknown, TName extends string = string> {
  readonly name: TName;
  readonly value: T | null;
  readonly status: FieldStatus;
  readonly error?: string | null;
}

export interface ReaderResult {
  readonly provider: ProviderName;
  readonly status: ReaderStatus;
  readonly fields: readonly FieldResult[];
  readonly lastUpdated: number;
  readonly lastError?: string | null;
  readonly pathsTried?: readonly string[];
  readonly fromCache: boolean;
}

export function isHardStatus(status: ReaderStatus): boolean {
  return status === ReaderStatus.ERROR || status === ReaderStatus.UNAVAILABLE;
}

export function isLimitReached(fields: readonly FieldResult[] | undefined): boolean {
  const field = fields?.find((candidate) => candidate.name === "limit_reached");
  return field?.status === FieldStatus.OK && field.value === true;
}

export interface ReadOptions {
  force?: boolean;
}

export type AbsentFieldStatus = FieldStatus.UNAVAILABLE | FieldStatus.NOT_APPLICABLE;

export function hasUsableFieldValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

export function fieldStatusDegrades(status: FieldStatus): boolean {
  return status === FieldStatus.UNAVAILABLE || status === FieldStatus.ERROR;
}

export abstract class BaseReader<P extends ProviderName = ProviderName> {
  protected _lastGood: ReaderResult | null = null;

  constructor(
    protected readonly settings: Gio.Settings,
    protected readonly providerName: P,
  ) {}

  abstract read(options?: ReadOptions): Promise<ReaderResult>;

  destroy(): void {}

  /** OK requires a renderable value; null, undefined and non-finite numbers become UNAVAILABLE. */
  protected _makeField<T, Name extends FieldName<P>>(
    name: Name,
    value: T | null | undefined,
    status: FieldStatus,
    error?: string | null,
  ): FieldResult<T, Name> {
    return {
      name,
      value: value ?? null,
      status:
        status === FieldStatus.OK && !hasUsableFieldValue(value) ? FieldStatus.UNAVAILABLE : status,
      error: error ?? null,
    };
  }

  protected _makePercentFieldPair(
    names: PercentFieldNames<P>,
    usedPct: number | null | undefined,
    status: FieldStatus,
  ): [FieldResult, FieldResult] {
    const hasUsedPct = typeof usedPct === "number" && Number.isFinite(usedPct);
    const fieldStatus = hasUsedPct ? status : FieldStatus.UNAVAILABLE;
    return [
      this._makeField(names.used, hasUsedPct ? usedPct : null, fieldStatus),
      this._makeField(names.remaining, hasUsedPct ? 100 - usedPct : null, fieldStatus),
    ];
  }

  protected _makeAbsentWindowFields(
    names: WindowFieldNames<P>,
    status: AbsentFieldStatus,
  ): FieldResult[] {
    return [
      this._makeField(names.used, null, status),
      this._makeField(names.remaining, null, status),
      this._makeField(names.reset, null, status),
    ];
  }

  protected _makeWindowFields(
    names: WindowFieldNames<P>,
    data:
      | {
          used_percent?: number | null;
          reset_at?: number | string | null;
        }
      | null
      | undefined,
    resetStatus: AbsentFieldStatus = FieldStatus.UNAVAILABLE,
  ): FieldResult[] {
    if (!data) {
      return this._makeAbsentWindowFields(names, FieldStatus.UNAVAILABLE);
    }
    const percentStatus =
      typeof data.used_percent === "number" && Number.isFinite(data.used_percent)
        ? FieldStatus.OK
        : FieldStatus.UNAVAILABLE;
    const resolvedResetStatus = data.reset_at != null ? FieldStatus.OK : resetStatus;
    return [
      ...this._makePercentFieldPair(names, data.used_percent ?? null, percentStatus),
      this._makeField(names.reset, data.reset_at ?? null, resolvedResetStatus),
    ];
  }

  protected _okResult(fields: readonly FieldResult[], pathsTried: readonly string[]): ReaderResult {
    return {
      provider: this.providerName,
      status: ReaderStatus.OK,
      fields,
      lastUpdated: Date.now(),
      pathsTried,
      fromCache: false,
    };
  }

  protected _partialResult(
    fields: readonly FieldResult[],
    pathsTried: readonly string[],
    lastError?: string,
  ): ReaderResult {
    return {
      provider: this.providerName,
      status: ReaderStatus.PARTIAL,
      fields,
      lastUpdated: Date.now(),
      lastError: lastError ?? null,
      pathsTried,
      fromCache: false,
    };
  }

  protected _errorResult(message: string, pathsTried: readonly string[]): ReaderResult {
    return {
      provider: this.providerName,
      status: ReaderStatus.ERROR,
      fields: [],
      lastUpdated: Date.now(),
      lastError: message,
      pathsTried,
      fromCache: false,
    };
  }

  protected _rememberResult(result: ReaderResult): ReaderResult {
    if (result.status === ReaderStatus.OK || result.status === ReaderStatus.PARTIAL) {
      this._lastGood = result;
    }
    return result;
  }

  protected _finalizeResult(
    result: ReaderResult,
    pathsTried: readonly string[],
    fallbackMessage: string,
  ): ReaderResult {
    if (result.status === ReaderStatus.ERROR) {
      return this._lastGoodOrError(result.lastError ?? fallbackMessage, pathsTried);
    }
    return this._rememberResult(result);
  }

  protected _lastGoodOrError(message: string, pathsTried: readonly string[]): ReaderResult {
    const lastGood = this._lastGood;
    if (!lastGood || Date.now() - lastGood.lastUpdated > LAST_GOOD_MAX_AGE_MS) {
      return this._errorResult(message, pathsTried);
    }

    return {
      provider: this.providerName,
      status: ReaderStatus.PARTIAL,
      fields: lastGood.fields,
      lastUpdated: lastGood.lastUpdated,
      lastError: message,
      pathsTried: [...pathsTried, "last-known-good"],
      fromCache: true,
    };
  }

  protected _classifyResult(
    fields: FieldResult[],
    pathsTried: readonly string[],
    prefix?: string,
    partialError?: string,
  ): ReaderResult {
    const hasAny = fields.some((f) => f.status === FieldStatus.OK);
    if (!hasAny) {
      return this._errorResult(`${prefix ?? this.providerName}: no usable fields.`, pathsTried);
    }

    const hasUnavailable = fields.some((f) => fieldStatusDegrades(f.status));
    return hasUnavailable
      ? this._partialResult(
          fields,
          pathsTried,
          partialError ?? `${prefix ?? this.providerName}: some fields unavailable.`,
        )
      : this._okResult(fields, pathsTried);
  }
}
