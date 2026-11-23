import type { ProviderName } from "../constants.js";
import { clampFillRatio } from "./fieldRows.js";

const FILLED_SEGMENT = "▰";
const EMPTY_SEGMENT = "▱";

/** Text micro-bar for a 0..1 usage ratio; the only segmented-bar formatter. */
export function formatSegmentedBar(ratio: number, segments = 8): string {
  const count = Math.max(1, Math.trunc(segments));
  const clamped = clampFillRatio(ratio);
  const filled = Math.round(clamped * count);
  return `${FILLED_SEGMENT.repeat(filled)}${EMPTY_SEGMENT.repeat(count - filled)}`;
}

export function resolveProviderExpanded(
  provider: ProviderName,
  enabledCount: number,
  overrides: ReadonlyMap<ProviderName, boolean>,
): boolean {
  const explicit = overrides.get(provider);
  if (explicit !== undefined) return explicit;
  return enabledCount <= 2;
}

export function areAllProvidersExpanded(
  providers: readonly ProviderName[],
  enabledCount: number,
  overrides: ReadonlyMap<ProviderName, boolean>,
): boolean {
  if (providers.length === 0) return false;
  return providers.every((p) => resolveProviderExpanded(p, enabledCount, overrides));
}

export function toggleAllProvidersExpanded(
  providers: readonly ProviderName[],
  enabledCount: number,
  overrides: ReadonlyMap<ProviderName, boolean>,
): Map<ProviderName, boolean> {
  const nextExpanded = !areAllProvidersExpanded(providers, enabledCount, overrides);
  const next = new Map<ProviderName, boolean>(overrides);
  for (const provider of providers) {
    next.set(provider, nextExpanded);
  }
  return next;
}
