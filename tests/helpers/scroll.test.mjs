import { test } from "node:test";

import { assert, load } from "./node-harness.mjs";

test("setScrollViewChild uses add_actor when set_child is unavailable", () => {
  const { setScrollViewChild } = load("src/helpers/scroll.ts", "({ setScrollViewChild })");
  const actor = {};

  const modernCalls = [];
  setScrollViewChild({ set_child: (child) => modernCalls.push(child) }, actor);
  assert.deepEqual(modernCalls, [actor]);

  const legacyCalls = [];
  setScrollViewChild({ add_actor: (child) => legacyCalls.push(child) }, actor);
  assert.deepEqual(legacyCalls, [actor]);
});
