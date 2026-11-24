/** Removes every child of a container, in sibling order. */
export function clearChildren<T extends { get_next_sibling(): T | null }>(
  parent: { get_first_child(): T | null },
  remove: (child: T) => void,
): void {
  let child = parent.get_first_child();
  while (child) {
    const next = child.get_next_sibling();
    remove(child);
    child = next;
  }
}
