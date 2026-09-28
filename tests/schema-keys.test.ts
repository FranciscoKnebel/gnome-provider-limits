import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { PROVIDER_NAMES, SCHEMA_ID } from "../src/constants.js";

const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));
const SCHEMA_PATH = fileURLToPath(
  new URL(
    "../../src/schemas/org.gnome.shell.extensions.gnome-provider-limits.gschema.xml",
    import.meta.url,
  ),
);

const PROVIDER_KEY_SUFFIXES = [
  "enabled",
  "display-name",
  "display-name-short",
  "cli-path",
  "status-fields",
  "panel-fields",
] as const;

const GLOBAL_KEYS = [
  "providers-order",
  "language",
  "refresh-short-interval-seconds",
  "refresh-long-interval-seconds",
  "refresh-stable-reads-threshold",
] as const;

function walkTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

function readSchema(): { xml: string; keys: Set<string> } {
  const xml = readFileSync(SCHEMA_PATH, "utf-8");
  const keys = new Set<string>();
  for (const match of xml.matchAll(/<key\s+name="([^"]+)"/g)) keys.add(match[1]);
  return { xml, keys };
}

function literalKeysUsedInSource(): Set<string> {
  const keys = new Set<string>();
  const accessor = /\b(?:get|set)_(?:string|boolean|int|strv)\(\s*"([^"]+)"\s*\)/g;
  const changed = /changed::([a-z0-9-]+)["'`]/g;
  for (const file of walkTsFiles(SRC_DIR)) {
    const code = readFileSync(file, "utf-8");
    for (const match of code.matchAll(accessor)) keys.add(match[1]);
    for (const match of code.matchAll(changed)) keys.add(match[1]);
  }
  return keys;
}

function templateKeySuffixesUsedInSource(): { suffix: string; file: string }[] {
  const found: { suffix: string; file: string }[] = [];
  const template = /\$\{[^}]*\}-([a-z0-9][a-z0-9-]*)/g;
  for (const file of walkTsFiles(SRC_DIR)) {
    const code = readFileSync(file, "utf-8");
    for (const match of code.matchAll(template)) {
      found.push({ suffix: match[1], file: relative(SRC_DIR, file) });
    }
  }
  return found;
}

describe("GSettings schema keys", () => {
  const providerKeys = PROVIDER_NAMES.flatMap((name) =>
    PROVIDER_KEY_SUFFIXES.map((suffix) => `${name}-${suffix}`),
  );
  const allowedKeys = new Set<string>([...providerKeys, ...GLOBAL_KEYS]);
  const { xml, keys: declaredKeys } = readSchema();

  it("reads the schema for the extension id", () => {
    expect(xml).toContain(`id="${SCHEMA_ID}"`);
  });

  it("declares every per-provider key", () => {
    const missing = providerKeys.filter((key) => !declaredKeys.has(key));
    expect(missing)
      .withContext(`missing provider keys: ${missing.join(", ")}`)
      .toEqual([]);
  });

  it("declares every literal key used in src/", () => {
    const undeclared = [...literalKeysUsedInSource()]
      .filter((key) => !declaredKeys.has(key))
      .toSorted();
    expect(undeclared)
      .withContext(`keys used in src/ but missing from the schema: ${undeclared.join(", ")}`)
      .toEqual([]);
  });

  it("uses only known provider key suffixes in template literals", () => {
    const known = new Set<string>(PROVIDER_KEY_SUFFIXES);
    const unknown = templateKeySuffixesUsedInSource().filter(({ suffix }) => !known.has(suffix));
    const named = unknown.map(({ suffix, file }) => `${suffix} (${file})`);
    expect(named)
      .withContext(`template keys with unknown suffixes: ${named.join(", ")}`)
      .toEqual([]);
  });

  it("declares no keys beyond providers and globals", () => {
    const unexpected = [...declaredKeys].filter((key) => !allowedKeys.has(key)).toSorted();
    expect(unexpected)
      .withContext(`schema keys outside the provider/global allowlist: ${unexpected.join(", ")}`)
      .toEqual([]);
  });

  it("declares every allowlisted key", () => {
    const missing = [...allowedKeys].filter((key) => !declaredKeys.has(key)).toSorted();
    expect(missing)
      .withContext(`allowlisted keys missing from the schema: ${missing.join(", ")}`)
      .toEqual([]);
  });
});
