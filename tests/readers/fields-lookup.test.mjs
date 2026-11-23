import { readFileSync } from "node:fs";
import { test } from "node:test";

import { assert } from "../helpers/node-harness.mjs";

test("review findings stay consolidated in shared helpers and field lookup", () => {
  const statusBar = readFileSync("src/ui/statusBar.ts", "utf8");
  const panel = readFileSync("src/ui/panel.ts", "utf8");
  const fields = readFileSync("src/readers/fields.ts", "utf8");
  const shell = readFileSync("src/ui/panelShell.ts", "utf8");
  const compactPanel = readFileSync("src/ui/panelCompact.ts", "utf8");
  const overview = readFileSync("src/ui/panelGaugesOverview.ts", "utf8");
  const renderers = [
    readFileSync("src/ui/statusBarPills.ts", "utf8"),
    readFileSync("src/ui/statusBarGauges.ts", "utf8"),
    readFileSync("src/ui/statusBarCompact.ts", "utf8"),
  ];

  assert.match(fields, /export const PROVIDER_FIELDS/);
  assert.match(fields, /export function getProviderFields/);
  assert.doesNotMatch(fields, /resolveFieldDefs/);
  for (const source of [statusBar, panel]) {
    assert.match(source, /import\s*\{\s*PROVIDER_FIELDS\s*\}\s*from\s*"\.\.\/readers\/fields\.js"/);
    assert.doesNotMatch(source, /resolveFieldDefs/);
  }
  assert.doesNotMatch(statusBar, /statusKey|_structureKey/);
  for (const source of renderers) {
    assert.match(source, /extends StatusBarRenderer/);
    assert.doesNotMatch(source, /_planFor|private _context|statusKey\(/);
  }
  for (const source of [shell, compactPanel, overview]) {
    assert.match(source, /from "\.\.\/helpers\/keyboard\.js"/);
    assert.doesNotMatch(source, /KEY_KP_Enter/);
  }
  assert.doesNotMatch(compactPanel, /_bindButtonActivate/);
  assert.doesNotMatch(shell, /_bindActivation\(/);
});
