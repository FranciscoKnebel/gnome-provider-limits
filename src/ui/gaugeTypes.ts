import type { FieldTone } from "./fieldRows.js";

export type GaugeTone = FieldTone | "neutral";

export type RgbTuple = readonly [number, number, number];

/**
 * The one fill spec shared by radial gauges and compact meters.
 * `centerText` and `trackEndAngle` are only used by surfaces that draw them.
 */
export interface GaugeSpec {
  readonly ratio: number;
  readonly hasValue: boolean;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly tone: GaugeTone;
  readonly fieldTone?: FieldTone;
  readonly rgb: RgbTuple;
  readonly isError: boolean;
  readonly centerText?: string;
  readonly trackEndAngle?: number;
}
