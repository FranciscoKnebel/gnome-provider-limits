import type Gio from "gi://Gio";

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

export interface FieldDef {
  readonly name: string;
  readonly label: string;
  readonly type: FieldType;
  readonly description?: string;
  readonly defaultZone: FieldZone;
}

export interface FieldResult<T = unknown> {
  readonly name: string;
  readonly value: T | null;
  readonly status: FieldStatus;
  readonly error?: string | null;
}

export interface ReaderResult {
  readonly provider: string;
  readonly status: ReaderStatus;
  readonly fields: readonly FieldResult[];
  readonly lastUpdated: number;
  readonly lastError?: string | null;
  readonly pathsTried?: readonly string[];
}

export abstract class BaseReader {
  constructor(
    protected readonly settings: Gio.Settings,
    protected readonly providerName: string,
  ) {}

  abstract get FIELDS(): readonly FieldDef[];

  abstract read(): Promise<ReaderResult>;

  destroy(): void {}

  protected _makeField<T>(
    name: string,
    value: T | null,
    status: FieldStatus,
    error?: string | null,
  ): FieldResult<T> {
    return { name, value, status, error: error ?? null };
  }

  protected _makePercentFieldPair(
    key: string,
    usedPct: number | null | undefined,
    status: FieldStatus,
  ): [FieldResult, FieldResult] {
    return [
      this._makeField(`used_percent_${key}`, usedPct ?? null, status),
      this._makeField(`remaining_percent_${key}`, usedPct != null ? 100 - usedPct : null, status),
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
    const status = data ? FieldStatus.OK : FieldStatus.UNAVAILABLE;
    return [
      ...this._makePercentFieldPair(key, data?.used_percent ?? null, status),
      this._makeField(`reset_at_${key}`, data?.reset_at ?? null, status),
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

  protected _classifyResult(
    fields: FieldResult[],
    pathsTried: readonly string[],
    prefix?: string,
  ): ReaderResult {
    const hasAny = fields.some((f) => f.status === FieldStatus.OK);
    if (!hasAny) {
      return this._errorResult(`${prefix ?? this.providerName}: no usable fields.`, pathsTried);
    }

    const hasUnavailable = fields.some(
      (f) => f.status === FieldStatus.UNAVAILABLE || f.status === FieldStatus.ERROR,
    );
    return hasUnavailable
      ? this._partialResult(fields, pathsTried)
      : this._okResult(fields, pathsTried);
  }
}
