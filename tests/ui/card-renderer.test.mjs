import { test } from "node:test";

import { assert, load } from "../helpers/node-harness.mjs";

function SectionBase(shell) {
  this.shell = shell;
}

test("computeBarWidthPx clamps and scales progress fills in the card renderer", () => {
  const { computeBarWidthPx } = load("src/ui/panelCards.ts", "({ computeBarWidthPx })", {
    Clutter: { ActorAlign: { CENTER: 0, START: 1, END: 2 } },
    St: {},
    PanelStyleSection: SectionBase,
    clampPercent: (value) =>
      typeof value !== "number" || !Number.isFinite(value)
        ? undefined
        : Math.min(100, Math.max(0, value)),
  });

  assert.equal(computeBarWidthPx(200, 0), 0);
  assert.equal(computeBarWidthPx(200, -10), 0);
  assert.equal(computeBarWidthPx(200, 1), 4);
  assert.equal(computeBarWidthPx(200, 50), 100);
  assert.equal(computeBarWidthPx(200, 100), 200);
  assert.equal(computeBarWidthPx(200, 140), 200);
  assert.equal(computeBarWidthPx(0, 50, 240), 120);
});
