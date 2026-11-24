import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildStylesheet } from "../../scripts/build-stylesheet.mjs";
import { assert } from "../helpers/node-harness.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("the committed stylesheet matches the generated sources", () => {
  const expected = buildStylesheet(root);
  const committed = readFileSync(join(root, "src/stylesheet.css"), "utf8");

  assert.equal(committed, expected, "run npm run build:stylesheet and commit the result");
});
