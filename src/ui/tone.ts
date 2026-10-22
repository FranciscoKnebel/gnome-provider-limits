import type { FieldTone } from "./fieldRows.js";

export interface ToneClassTarget {
  add_style_class_name(styleClass: string): void;
  remove_style_class_name(styleClass: string): void;
}

const TONE_CLASSES = ["usage-ok", "usage-warning", "usage-critical"] as const;

export function applyToneClass(target: ToneClassTarget, tone: FieldTone | undefined): void {
  for (const styleClass of TONE_CLASSES) {
    target.remove_style_class_name(styleClass);
  }
  if (tone) target.add_style_class_name(`usage-${tone}`);
}
