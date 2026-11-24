export function currentRefreshInterval(
  stableReads: number,
  threshold: number,
  shortIntervalSeconds: number,
  longIntervalSeconds: number,
): number {
  return stableReads >= threshold ? longIntervalSeconds : shortIntervalSeconds;
}
