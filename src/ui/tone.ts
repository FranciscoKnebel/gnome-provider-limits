import type { FieldTone } from "./fieldRows.js";

export type HealthTone = "ok" | "warning" | "critical" | "partial" | "error" | "idle";
export type StatusAttention = "quiet" | "partial" | "warning" | "critical" | "error";

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

interface AttentionStyle {
  readonly segment: string | null;
  readonly value: string | null;
}

const ATTENTION_STYLE: Readonly<Record<StatusAttention, AttentionStyle>> = {
  quiet: { segment: null, value: null },
  partial: { segment: "status-partial", value: "status-partial" },
  warning: { segment: null, value: "usage-warning" },
  critical: { segment: "status-critical-accent", value: "usage-critical" },
  error: { segment: "status-critical-accent", value: "provider-limits-error" },
};

export interface ToneClassOptions {
  readonly quiet?: boolean;
}

export function applyToneClass(
  target: ToneClassTarget,
  tone: FieldTone | "error" | undefined,
  options?: ToneClassOptions,
): void {
  const quiet = options?.quiet === true;
  for (const styleClass of quiet ? EXTENDED_TONE_CLASSES : USAGE_TONE_CLASSES) {
    target.remove_style_class_name(styleClass);
  }

  if (quiet) {
    if (tone === "warning") target.add_style_class_name("usage-warning");
    else if (tone === "critical") target.add_style_class_name("usage-critical");
    else if (tone === "error") target.add_style_class_name("provider-limits-error");
  } else if (tone && tone !== "error") {
    target.add_style_class_name(`usage-${tone}`);
  }
}

export function applyHealthToneClass(target: ToneClassTarget, tone: HealthTone): void {
  for (const styleClass of HEALTH_TONE_CLASSES) {
    target.remove_style_class_name(styleClass);
  }
  target.add_style_class_name(`tone-${tone}`);
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

  const style = ATTENTION_STYLE[attention];
  if (style.segment) segmentTarget.add_style_class_name(style.segment);
  if (style.value) valueTarget?.add_style_class_name(style.value);
}
