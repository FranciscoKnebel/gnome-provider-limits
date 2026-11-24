import { test } from "node:test";

import { assert, load } from "./node-harness.mjs";

test("reordering preserves unknown fields and uses identities in both directions", () => {
  const reorder = load("src/helpers/reorder.ts", "reorderValue");
  for (const values of [
    ["obsolete", "A", "B", "C"],
    ["A", "obsolete", "B", "C"],
  ]) {
    const result = Array.from(reorder(values, "C", "B"));
    assert.deepEqual(
      result.filter((v) => v !== "obsolete"),
      ["A", "C", "B"],
    );
    assert.ok(result.includes("obsolete"));
  }
  assert.deepEqual(Array.from(reorder(["A", "x", "B", "C"], "A", "C")), ["x", "B", "C", "A"]);
  assert.equal(reorder(["A", "B"], "A", "A"), null);
  assert.equal(reorder(["A", "B"], "missing", "B"), null);
});
