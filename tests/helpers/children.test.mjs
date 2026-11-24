import { test } from "node:test";

import { assert, load } from "./node-harness.mjs";

test("clearChildren walks siblings in order while removing them", () => {
  const { clearChildren } = load("src/helpers/children.ts", "({ clearChildren })");
  const children = [{ id: 1 }, { id: 2 }, { id: 3 }];
  children.forEach((child, index) => {
    child.get_next_sibling = () => children[index + 1] ?? null;
  });
  const parent = { get_first_child: () => children[0] ?? null };
  const removed = [];

  clearChildren(parent, (child) => removed.push(child.id));

  assert.deepEqual(removed, [1, 2, 3]);
});

test("clearChildren is a no-op for an empty container", () => {
  const { clearChildren } = load("src/helpers/children.ts", "({ clearChildren })");
  let removals = 0;
  clearChildren({ get_first_child: () => null }, () => removals++);
  assert.equal(removals, 0);
});
