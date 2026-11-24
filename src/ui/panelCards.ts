import { clampPercent } from "./fieldRows.js";
import type { FieldView } from "./fieldViews.js";
import type { Presentation } from "./providerHealth.js";
import { resetDetailText, type ResetPairing } from "./resetModel.js";
import type { Translate } from "./viewMessages.js";

export function computeBarWidthPx(
  trackWidth: number,
  fillPercent: number,
  fallbackTrackWidth = 260,
): number {
  const clamped = clampPercent(fillPercent) ?? 0;
  if (clamped <= 0) return 0;
  const effectiveTrack = trackWidth > 0 ? trackWidth : fallbackTrackWidth;
  return Math.min(effectiveTrack, Math.max(4, Math.round((effectiveTrack * clamped) / 100)));
}

export type CardBadgeKind = Presentation["cardBadge"];
export type BannerKind = "warning" | "error";

/** Only the text a card progress row adds on top of its FieldView. */
export interface ProgressResetPresentation {
  readonly resetText: string | undefined;
  readonly accessibleText: string;
  readonly errorText: string | undefined;
}

/** Derives the card reset detail, accessible name and error text for a progress row. */
export function progressResetPresentation(
  view: FieldView,
  pairing: ResetPairing | undefined,
  locale: string,
  t: Translate,
): ProgressResetPresentation {
  const detail =
    pairing?.inPanel === true && pairing.claimed
      ? resetDetailText(pairing, "panel", locale, t)
      : undefined;
  const errorText = view.errorText ?? (detail ? (pairing?.errorText ?? undefined) : undefined);
  const accessibleText = detail ? `${view.accessibleText}, ${detail}` : view.accessibleText;
  return { resetText: detail, accessibleText, errorText };
}
