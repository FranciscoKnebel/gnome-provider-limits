import type Gio from "gi://Gio";

import type { ProviderName } from "../constants.js";

export const LAST_GOOD_MAX_AGE_MS = 30 * 60 * 1000;

export enum ReaderStatus {
  OK = "ok",
  PARTIAL = "partial",
  ERROR = "error",
  UNAVAILABLE = "unavailable",
  DISABLED = "disabled",
}

export enum FieldStatus {
  OK = "ok",
  UNAVAILABLE = "unavailable",
  ERROR = "error",
}

export type FieldType = "percent" | "count" | "tokens" | "cost" | "timestamp" | "bool" | "text";

export type FieldZone = "status" | "panel";

export type FieldCategory = "limit" | "telemetry";

export interface FieldDef {
  readonly name: string;
  readonly label: string;
  readonly type: FieldType;
  readonly description?: string;
  readonly defaultZone: FieldZone;
  readonly category: FieldCategory;
  readonly resetField?: string;
}

export interface FieldResult<T = unknown> {
  readonly name: string;
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
}

export interface ReadOptions {
  force?: boolean;
}

export abstract class BaseReader {
  protected _lastGood: ReaderResult | null = null;

  /**
   * The field declarations this reader may emit. fields.ts is the single
   * source of truth; every concrete reader overrides this with its slice.
   */
  get FIELDS(): readonly FieldDef[] {
    return [];
  }

  constructor(
    protected readonly settings: Gio.Settings,
    protected readonly providerName: ProviderName,
  ) {}

  abstract read(options?: ReadOptions): Promise<ReaderResult>;

  destroy(): void {}

  protected _assertDeclared(name: string): void {
    if (this.FIELDS.length === 0) return;
    if (!this.FIELDS.some((def) => def.name === name)) {
      throw new Error(`${this.providerName}: undeclared field '${name}'.`);
    }
  }

  /** Fail loudly when an emitted set drifts from the declared contract. */
  protected _assertFieldContract(fields: readonly FieldResult[]): void {
    if (this.FIELDS.length === 0) return;
    const declared = new Set(this.FIELDS.map((def) => def.name));
    const emitted = new Set<string>();
    for (const field of fields) {
      this._assertDeclared(field.name);
      emitted.add(field.name);
    }
    for (const name of declared) {
      if (!emitted.has(name)) {
        throw new Error(`${this.providerName}: declared field '${name}' was not emitted.`);
      }
    }
  }

  protected _makeField<T>(
    name: string,
    value: T | null | undefined,
    status: FieldStatus,
    error?: string | null,
  ): FieldResult<T> {
    this._assertDeclared(name);
    return { name, value: value ?? null, status, error: error ?? null };
  }

  protected _makePercentFieldPair(
    key: string,
    usedPct: number | null | undefined,
    status: FieldStatus,
  ): [FieldResult, FieldResult] {
    const hasUsedPct = typeof usedPct === "number" && Number.isFinite(usedPct);
    const fieldStatus = hasUsedPct ? status : FieldStatus.UNAVAILABLE;
    return [
      this._makeField(`used_percent_${key}`, hasUsedPct ? usedPct : null, fieldStatus),
      this._makeField(`remaining_percent_${key}`, hasUsedPct ? 100 - usedPct : null, fieldStatus),
    ];
  }

  protected _makeWindowFields(
    key: string,
    data:
      | {
          used_percent?: number | null;
          reset_at?: number | string | null;
        }
      | null
      | undefined,
  ): FieldResult[] {
    const percentStatus =
      typeof data?.used_percent === "number" && Number.isFinite(data.used_percent)
        ? FieldStatus.OK
        : FieldStatus.UNAVAILABLE;
    const resetStatus = data?.reset_at != null ? FieldStatus.OK : FieldStatus.UNAVAILABLE;
    return [
      ...this._makePercentFieldPair(key, data?.used_percent ?? null, percentStatus),
      this._makeField(`reset_at_${key}`, data?.reset_at ?? null, resetStatus),
    ];
  }

  protected _okResult(fields: readonly FieldResult[], pathsTried: readonly string[]): ReaderResult {
    return {
      provider: this.providerName,
      status: ReaderStatus.OK,
      fields,
      lastUpdated: Date.now(),
      pathsTried,
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
    };
  }

  protected _classifyResult(
    fields: FieldResult[],
    pathsTried: readonly string[],
    prefix?: string,
    partialError?: string,
  ): ReaderResult {
    this._assertFieldContract(fields);
    const hasAny = fields.some((f) => f.status === FieldStatus.OK);
    if (!hasAny) {
      return this._errorResult(`${prefix ?? this.providerName}: no usable fields.`, pathsTried);
    }

    const hasUnavailable = fields.some(
      (f) => f.status === FieldStatus.UNAVAILABLE || f.status === FieldStatus.ERROR,
    );
    return hasUnavailable
      ? this._partialResult(
          fields,
          pathsTried,
          partialError ?? `${prefix ?? this.providerName}: some fields unavailable.`,
        )
      : this._okResult(fields, pathsTried);
  }
}
