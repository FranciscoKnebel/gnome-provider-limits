import { spawnSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import { assert } from "./node-harness.mjs";

test("both promise lint rules reject controlled negative fixtures", () => {
  const path = `src/__promise_lint_probe_${process.pid}.ts`;
  try {
    writeFileSync(
      path,
      "Promise.resolve(1);\nconst use = (_f: () => void): void => {};\nuse(async () => { await Promise.resolve(); });\n",
    );
    const result = spawnSync("node_modules/.bin/oxlint", ["--type-aware", path], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /no-floating-promises/);
    assert.match(result.stdout + result.stderr, /no-misused-promises/);
  } finally {
    unlinkSync(path);
  }
});
