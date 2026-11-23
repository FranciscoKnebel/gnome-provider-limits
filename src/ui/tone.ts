import type { FieldTone } from "./fieldRows.js";
import type { StatusAttention } from "./matrixPlan.js";

export type HealthTone = "ok" | "warning" | "critical" | "partial" | "error" | "idle";

export interface ToneClassTarget {
  add_style_class_name(styleClass: string): void;
  remove_style_class_name(styleClass: string): void;
}

const USAGE_TONE_CLASSES = ["usage-ok", "usage-warning", "usage-critical"] as const;
const HEALTH_TONE_CLASSES = [
  "tone-ok",
  "tone-warning",
  "tone-critical",
  "tone-partial",
  "tone-error",
  "tone-idle",
] as const;
const EXTENDED_TONE_CLASSES = [
  "usage-ok",
  "usage-warning",
  "usage-critical",
  "provider-limits-error",
] as const;
const ATTENTION_CLASSES = [
  "usage-warning",
  "usage-critical",
  "status-partial",
  "status-critical-accent",
  "provider-limits-error",
] as const;

export function applyToneClass(target: ToneClassTarget, tone: FieldTone | undefined): void {
  for (const styleClass of USAGE_TONE_CLASSES) {
    target.remove_style_class_name(styleClass);
  }
  if (tone) target.add_style_class_name(`usage-${tone}`);
}

export function applyHealthToneClass(target: ToneClassTarget, tone: HealthTone): void {
  for (const styleClass of HEALTH_TONE_CLASSES) {
    target.remove_style_class_name(styleClass);
  }
  target.add_style_class_name(`tone-${tone}`);
}

export function applyQuietToneClass(
  target: ToneClassTarget,
  tone: FieldTone | "error" | undefined,
): void {
  for (const styleClass of EXTENDED_TONE_CLASSES) {
    target.remove_style_class_name(styleClass);
  }
  if (tone === "warning") target.add_style_class_name("usage-warning");
  else if (tone === "critical") target.add_style_class_name("usage-critical");
  else if (tone === "error") target.add_style_class_name("provider-limits-error");
}

export function applyStatusAttentionClass(
  segmentTarget: ToneClassTarget,
  valueTarget: ToneClassTarget | null,
  attention: StatusAttention,
): void {
  for (const styleClass of ATTENTION_CLASSES) {
    segmentTarget.remove_style_class_name(styleClass);
    valueTarget?.remove_style_class_name(styleClass);
  }

  switch (attention) {
    case "warning":
      valueTarget?.add_style_class_name("usage-warning");
      break;
    case "critical":
      segmentTarget.add_style_class_name("status-critical-accent");
      valueTarget?.add_style_class_name("usage-critical");
      break;
    case "error":
      segmentTarget.add_style_class_name("status-critical-accent");
      valueTarget?.add_style_class_name("provider-limits-error");
      break;
    case "partial":
      segmentTarget.add_style_class_name("status-partial");
      valueTarget?.add_style_class_name("status-partial");
      break;
    case "quiet":
      break;
  }
}
