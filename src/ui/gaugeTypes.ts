import type { FieldTone } from "./fieldRows.js";

export type GaugeTone = FieldTone | "neutral";

export type RgbTuple = readonly [number, number, number];

/** The one fill spec shared by every gauge surface. */
export interface GaugeSpec {
  readonly ratio: number;
  readonly hasValue: boolean;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly tone: GaugeTone;
  readonly rgb: RgbTuple;
  readonly isError: boolean;
}

/** Radial-only additions, kept off the cross-surface GaugeSpec. */
export interface RadialGaugeGeometry extends GaugeSpec {
  readonly fieldTone: FieldTone | undefined;
  readonly centerText: string;
  readonly trackEndAngle: number;
}
