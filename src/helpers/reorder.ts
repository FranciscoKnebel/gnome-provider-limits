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
