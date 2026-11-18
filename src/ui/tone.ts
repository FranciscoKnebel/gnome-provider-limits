import type { FieldTone } from "./fieldRows.js";

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
