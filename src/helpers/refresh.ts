export function currentRefreshInterval(
  stableReads: number,
  threshold: number,
  shortIntervalSeconds: number,
  longIntervalSeconds: number,
): number {
  return stableReads >= threshold ? longIntervalSeconds : shortIntervalSeconds;
}

export function shouldRender(hasRendered: boolean, anyChanged: boolean): boolean {
  return anyChanged || !hasRendered;
}
