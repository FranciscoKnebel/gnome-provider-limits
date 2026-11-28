import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function assertKnownKeys(config, schema, label) {
  const allowed = new Set(Object.keys(schema.properties ?? {}));
  for (const key of Object.keys(config)) {
    if (key === "$schema") continue;
    assert.ok(allowed.has(key), `${label}: unknown option "${key}"`);
  }
}

test("oxfmt configuration uses schema-backed options", () => {
  const schema = readJson("../node_modules/oxfmt/configuration_schema.json");
  const config = readJson("../.oxfmtrc.json");

  assertKnownKeys(config, schema, "oxfmt");
  assert.equal(config.singleQuote, false);
  assert.equal(config.tabWidth, 2);
  assert.equal(config.useTabs, false);
  assert.equal(config.endOfLine, "lf");
});

test("oxlint configuration uses schema-backed options", () => {
  const schema = readJson("../node_modules/oxlint/configuration_schema.json");
  const config = readJson("../.oxlintrc.json");

  assertKnownKeys(config, schema, "oxlint");
  assert.ok(config.plugins.includes("import"), "oxlint import plugin must be enabled");
  assert.equal(config.rules["import/no-cycle"], "error");
  assert.equal(config.rules["typescript/no-unsafe-type-assertion"], "error");
});

test("quality scripts enforce the configured gates", () => {
  const pkg = readJson("../package.json");
  const lint = pkg.scripts.lint;

  for (const flag of [
    "--type-aware",
    "--import-plugin",
    "--deny-warnings",
    "--report-unused-disable-directives",
  ]) {
    assert.ok(lint.includes(flag), `lint script must include ${flag}`);
  }

  assert.match(pkg.scripts.typecheck, /typecheck:src/);
  assert.match(pkg.scripts.typecheck, /typecheck:tests/);
  assert.ok(pkg.engines?.node, "package.json must declare an engines.node range");
  assert.ok(pkg.packageManager, "package.json must pin the package manager");
});
