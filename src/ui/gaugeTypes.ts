import type { FieldTone } from "./fieldRows.js";

export type GaugeTone = FieldTone | "neutral";

export type RgbTuple = readonly [number, number, number];

export interface GaugeGeometry {
  readonly ratio: number;
  readonly hasValue: boolean;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly trackEndAngle: number;
  readonly tone: GaugeTone;
  readonly fieldTone: FieldTone | undefined;
  readonly rgb: RgbTuple;
  readonly centerText: string;
}

export interface MicroMeterSpec {
  readonly ratio: number;
  readonly hasValue: boolean;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly tone: GaugeTone;
  readonly rgb: RgbTuple;
  readonly isError: boolean;
}
