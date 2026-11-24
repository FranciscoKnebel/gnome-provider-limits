import { formatField } from "../formatters.js";
import type { FieldDef, FieldZone, ReaderResult } from "../readers/base.js";
import { FieldStatus, hasUsableFieldValue } from "../readers/base.js";
import type { FieldView } from "./fieldViews.js";

/** The one reset pairing per percent field, independent of the consuming surface. */
export interface ResetPairing {
  readonly name: string;
  readonly label: string;
  readonly value: unknown;
  readonly hasValue: boolean;
  readonly inPanel: boolean;
  readonly claimed: boolean;
  readonly errorText: string | null;
}

/** Build every gauge/reset slot once from explicit FieldDef pairings only. */
export function deriveResetPairings(
  defs: readonly FieldDef[],
  result: ReaderResult,
  views: readonly FieldView[],
  zoneFields: readonly string[],
  panelFields: readonly string[],
): ReadonlyMap<string, ResetPairing> {
  const defByName = new Map(defs.map((def) => [def.name, def]));
  const fieldByName = new Map(result.fields.map((field) => [field.name, field]));
  const pairings = new Map<string, ResetPairing>();
  const claimed = new Set<string>();

  for (const view of views) {
    if (view.type !== "percent" || view.resetName === null) continue;
    if (defByName.get(view.resetName)?.type !== "timestamp") continue;

    const resetField = fieldByName.get(view.resetName);
    const hasValue = resetField?.status === FieldStatus.OK && hasUsableFieldValue(resetField.value);
    const inPanel = panelFields.includes(view.resetName);
    if (!hasValue && !zoneFields.includes(view.resetName)) continue;
    const isClaimed = panelFields.includes(view.name) && !claimed.has(view.resetName);
    if (isClaimed) claimed.add(view.resetName);

    pairings.set(view.name, {
      name: view.resetName,
      label: defByName.get(view.resetName)?.label ?? view.resetName,
      value: resetField?.value ?? null,
      hasValue,
      inPanel,
      claimed: isClaimed,
      errorText:
        resetField?.status === FieldStatus.ERROR ? (resetField.error ?? "Provider error") : null,
    });
  }

  return pairings;
}

function pairingValueText(
  pairing: ResetPairing,
  zone: FieldZone,
  locale: string,
  t: (s: string) => string,
): string {
  return pairing.hasValue
    ? formatField({ type: "timestamp", value: pairing.value, zone, locale, t })
    : "—";
}

/** The compact gauge reset slot, e.g. "↻ 1h (14:30)". */
export function resetSlotText(
  pairing: ResetPairing,
  zone: FieldZone,
  locale: string,
  t: (s: string) => string,
): string {
  return `↻ ${pairingValueText(pairing, zone, locale, t)}`;
}

/** The card row detail, e.g. "Reset at (5h window): 1h (14:30)". */
export function resetDetailText(
  pairing: ResetPairing,
  zone: FieldZone,
  locale: string,
  t: (s: string) => string,
): string {
  return `${t(pairing.label)}: ${pairingValueText(pairing, zone, locale, t)}`;
}

/** Reset fields that are rendered as a slot and must be hidden from field rows. */
export function consumedResetNames(
  pairings: ReadonlyMap<string, ResetPairing>,
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const pairing of pairings.values()) {
    if (pairing.inPanel && pairing.claimed) names.add(pairing.name);
  }
  return names;
}
