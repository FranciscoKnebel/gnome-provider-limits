import type { GaugeSpec, GaugeTone, RgbTuple } from "./gaugeTypes.js";

export const CAIRO_LINE_CAP_ROUND = 1;

export const GAUGE_START_ANGLE = 0.75 * Math.PI;
export const GAUGE_SWEEP_ANGLE = 1.5 * Math.PI;
export const GAUGE_END_ANGLE = GAUGE_START_ANGLE + GAUGE_SWEEP_ANGLE;

export const TONE_RGB: Record<GaugeTone, RgbTuple> = {
  ok: [0x2e / 255, 0xc2 / 255, 0x7e / 255],
  warning: [0xe5 / 255, 0xa5 / 255, 0x0a / 255],
  critical: [0xe0 / 255, 0x1b / 255, 0x24 / 255],
  neutral: [0x88 / 255, 0x88 / 255, 0x90 / 255],
};

function clampGaugeRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(1, Math.max(0, ratio));
}

/** The single fill-math home: ratio, sweep angles and color for every gauge surface. */
export function gaugeArc(
  ratio: number | null,
  tone: GaugeTone,
): Pick<GaugeSpec, "ratio" | "hasValue" | "startAngle" | "endAngle" | "tone" | "rgb" | "isError"> {
  if (ratio === null) {
    return {
      ratio: 0,
      hasValue: false,
      startAngle: GAUGE_START_ANGLE,
      endAngle: GAUGE_START_ANGLE,
      tone,
      rgb: TONE_RGB[tone],
      isError: false,
    };
  }
  const clamped = clampGaugeRatio(ratio);
  return {
    ratio: clamped,
    hasValue: true,
    startAngle: GAUGE_START_ANGLE,
    endAngle: GAUGE_START_ANGLE + clamped * GAUGE_SWEEP_ANGLE,
    tone,
    rgb: TONE_RGB[tone],
    isError: false,
  };
}

/** One empty meter for loading, unavailable and error surfaces. */
export function emptyMeter(tone: GaugeTone, isError: boolean): GaugeSpec {
  return { ...gaugeArc(null, tone), isError };
}

export const TRACK_RGBA: readonly [number, number, number, number] = [0.5, 0.5, 0.5, 0.24];

export interface CairoContextLike {
  save(): void;
  restore(): void;
  newPath(): void;
  newSubPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(xc: number, yc: number, radius: number, angle1: number, angle2: number): void;
  setLineWidth(width: number): void;
  setLineCap(cap: number): void;
  setSourceRGBA(r: number, g: number, b: number, a: number): void;
  stroke(): void;
  $dispose?: () => void;
}

export function isCairoContext(value: unknown): value is CairoContextLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "arc" in value &&
    "setSourceRGBA" in value &&
    "stroke" in value
  );
}

function hasDisposeMethod(value: unknown): value is { $dispose: () => void } {
  return (
    typeof value === "object" &&
    value !== null &&
    "$dispose" in value &&
    typeof value.$dispose === "function"
  );
}

export function disposeCairoContext(value: unknown): void {
  if (hasDisposeMethod(value)) {
    value.$dispose();
  }
}

export function drawMicroRing(
  cr: CairoContextLike,
  width: number,
  height: number,
  spec: GaugeSpec,
): void {
  const size = Math.min(width, height);
  if (size <= 2) return;

  const cx = width / 2;
  const cy = height / 2;
  const lineWidth = Math.max(1.8, size * 0.17);
  const radius = Math.max(1, size / 2 - lineWidth / 2 - 0.5);

  cr.save();
  cr.setLineWidth(lineWidth);
  cr.setLineCap(CAIRO_LINE_CAP_ROUND);

  if (spec.isError) {
    const [er, eg, eb] = TONE_RGB.critical;
    cr.newSubPath();
    cr.arc(cx, cy, radius, GAUGE_START_ANGLE, GAUGE_END_ANGLE);
    cr.setSourceRGBA(er, eg, eb, 0.45);
    cr.stroke();
    cr.restore();
    return;
  }

  const [tr, tg, tb, ta] = TRACK_RGBA;
  cr.newSubPath();
  cr.arc(cx, cy, radius, GAUGE_START_ANGLE, GAUGE_END_ANGLE);
  cr.setSourceRGBA(tr, tg, tb, ta);
  cr.stroke();

  if (spec.hasValue && spec.endAngle > spec.startAngle) {
    const [r, g, b] = spec.rgb;
    cr.newSubPath();
    cr.arc(cx, cy, radius, spec.startAngle, spec.endAngle);
    cr.setSourceRGBA(r, g, b, 1);
    cr.stroke();
  }

  cr.restore();
}

export function drawRadialGauge(
  cr: CairoContextLike,
  width: number,
  height: number,
  geometry: GaugeSpec,
): void {
  const size = Math.min(width, height);
  if (size <= 6) return;

  const cx = width / 2;
  const cy = height / 2;
  const lineWidth = Math.max(4, size * 0.09);
  const radius = Math.max(4, size / 2 - lineWidth / 2 - 2);

  cr.save();

  const innerRadius = Math.max(2, radius - lineWidth * 0.95);
  cr.newSubPath();
  cr.arc(cx, cy, innerRadius, 0, 2 * Math.PI);
  cr.setLineWidth(1);
  cr.setSourceRGBA(0.5, 0.5, 0.5, 0.1);
  cr.stroke();

  cr.setLineWidth(lineWidth);
  cr.setLineCap(CAIRO_LINE_CAP_ROUND);

  const [tr, tg, tb, ta] = TRACK_RGBA;
  cr.newSubPath();
  cr.arc(cx, cy, radius, geometry.startAngle, geometry.trackEndAngle ?? GAUGE_END_ANGLE);
  cr.setSourceRGBA(tr, tg, tb, ta);
  cr.stroke();

  if (geometry.hasValue && geometry.endAngle > geometry.startAngle) {
    const [r, g, b] = geometry.rgb;
    cr.newSubPath();
    cr.arc(cx, cy, radius, geometry.startAngle, geometry.endAngle);
    cr.setSourceRGBA(r, g, b, 1);
    cr.stroke();
  }

  cr.restore();
}

export function drawMiniCapsule(
  cr: CairoContextLike,
  width: number,
  height: number,
  spec: GaugeSpec,
): void {
  if (width <= 4 || height <= 1) return;

  const barHeight = Math.min(height, Math.max(3, height * 0.75));
  const capRadius = barHeight / 2;
  const x0 = capRadius + 0.5;
  const x1 = Math.max(x0, width - capRadius - 0.5);
  const cy = height / 2;
  const span = x1 - x0;

  cr.save();
  cr.setLineWidth(barHeight);
  cr.setLineCap(CAIRO_LINE_CAP_ROUND);

  if (spec.isError) {
    const [er, eg, eb] = TONE_RGB.critical;
    cr.newPath();
    cr.moveTo(x0, cy);
    cr.lineTo(x1, cy);
    cr.setSourceRGBA(er, eg, eb, 0.35);
    cr.stroke();
    cr.restore();
    return;
  }

  const [tr, tg, tb, ta] = TRACK_RGBA;
  cr.newPath();
  cr.moveTo(x0, cy);
  cr.lineTo(x1, cy);
  cr.setSourceRGBA(tr, tg, tb, ta);
  cr.stroke();

  if (spec.hasValue && spec.ratio > 0) {
    const [r, g, b] = spec.rgb;
    const fillX = x0 + Math.max(0.01, spec.ratio) * span;
    cr.newPath();
    cr.moveTo(x0, cy);
    cr.lineTo(fillX, cy);
    cr.setSourceRGBA(r, g, b, 1);
    cr.stroke();
  }

  cr.restore();
}
