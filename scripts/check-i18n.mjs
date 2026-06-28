#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { argv, exit } from "process";

const SRC_DIR = new URL("../src", import.meta.url).pathname;
const PO_DIR = join(SRC_DIR, "po");
const PO_FILES = ["gnome-provider-limits.pot", "en.po", "pt_BR.po"];

const VERBOSE = argv.slice(2).includes("-v") || argv.slice(2).includes("--verbose");

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules") entries.push(...walk(full));
    } else if (name.endsWith(".ts")) {
      entries.push(full);
    }
  }
  return entries;
}

function lineAt(code, index) {
  return code.slice(0, index).split("\n").length;
}

function extractStrings(file) {
  const code = readFileSync(file, "utf-8");
  const strings = [];
  const rel = relative(SRC_DIR, file);

  const patterns = [
    // _("...") or _('...')
    /_\((["'])((?:(?!\1).)+)\1\)/g,
    // tr("...") or tr('...')
    /\btr\((["'])((?:(?!\1).)+)\1\)/g,
    // label: "..." in FieldDef arrays
    /label:\s*(["'])((?:(?!\1).)+)\1/g,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(code)) !== null) {
      strings.push({ string: m[2], file: rel, line: lineAt(code, m.index) });
    }
  }

  return strings;
}

/** Resolve JS and gettext escape sequences (\n, \t, \uXXXX, \xXX, \\, \", \') */
function unescape(s) {
  // Handle escape sequences in order: uXXXX first, then xXX, then simple ones
  s = s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
  s = s.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
  s = s.replace(/\\(["'\\nrt])/g, (_, ch) => {
    if (ch === "n") return "\n";
    if (ch === "t") return "\t";
    if (ch === "r") return "\r";
    if (ch === "\\") return "\\";
    return ch; // " or '
  });
  return s;
}

function parsePo(file) {
  const content = readFileSync(file, "utf-8");
  const msgids = [];
  const re = /^msgid "((?:[^"\\]|\\.)*)"$/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    msgids.push(unescape(m[1]));
  }
  return msgids;
}

const sourceFiles = walk(SRC_DIR).filter(
  (f) => !f.includes("/node_modules/") && !f.endsWith(".d.ts"),
);

const allStrings = [];
for (const file of sourceFiles) {
  allStrings.push(...extractStrings(file));
}

// Deduplicate by normalized text, but keep first occurrence for error reporting
const seen = new Set();
const sourceMap = [];
for (const s of allStrings) {
  const key = unescape(s.string);
  if (!seen.has(key)) {
    seen.add(key);
    sourceMap.push({ ...s, normalized: key });
  }
}

let exitCode = 0;

for (const poFile of PO_FILES) {
  const poPath = join(PO_DIR, poFile);
  const msgids = parsePo(poPath);
  const msgidSet = new Set(msgids);
  const missing = sourceMap.filter((s) => !msgidSet.has(s.normalized));

  if (missing.length > 0) {
    console.error(`\n❌ ${poFile}: ${missing.length} string(s) missing:`);
    for (const s of missing) {
      console.error(`   • "${s.string}"  (${s.file}:${s.line})`);
    }
    exitCode = 1;
  } else if (VERBOSE) {
    console.log(`✓ ${poFile}: all strings present (${msgids.length} msgids)`);
  }
}

if (exitCode === 0 && VERBOSE) {
  console.log(`\n✓ i18n check passed (${sourceMap.length} unique strings)`);
}

exit(exitCode);
