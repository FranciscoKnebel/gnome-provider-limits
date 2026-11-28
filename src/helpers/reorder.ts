export function reorderValue(
  values: readonly string[],
  source: string,
  target: string,
): string[] | null {
  const from = values.indexOf(source);
  const to = values.indexOf(target);
  if (from < 0 || to < 0 || from === to) return null;
  const reordered = [...values];
  reordered.splice(from, 1);
  reordered.splice(to, 0, source);
  return reordered;
}

export function moveAdjacentValue(
  values: readonly string[],
  visibleValues: readonly string[],
  source: string,
  offset: -1 | 1,
): string[] | null {
  const visibleIndex = visibleValues.indexOf(source);
  const targetIndex = visibleIndex + offset;
  if (visibleIndex < 0 || targetIndex < 0 || targetIndex >= visibleValues.length) {
    return null;
  }
  const target = visibleValues[targetIndex];
  if (target === undefined) return null;
  return reorderValue(values, source, target);
}
