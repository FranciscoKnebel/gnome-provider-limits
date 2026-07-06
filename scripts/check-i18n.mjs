#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";
import { argv, exit } from "process";

const SRC_DIR = new URL("../src", import.meta.url).pathname;
const PO_DIR = join(SRC_DIR, "po");
const LINGUAS_PATH = join(PO_DIR, "LINGUAS");
const POT_PATH = join(PO_DIR, "gnome-provider-limits.pot");

const LANGUAGE_SENTINEL = "LANGUAGE_NAME";

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
    /_\((["'])((?:(?!\1).)+)\1\)/g,
    /\btr\((["'])((?:(?!\1).)+)\1\)/g,
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

function unescape(s) {
  s = s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
  s = s.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
  s = s.replace(/\\(["'\\nrt])/g, (_, ch) => {
    if (ch === "n") return "\n";
    if (ch === "t") return "\t";
    if (ch === "r") return "\r";
    if (ch === "\\") return "\\";
    return ch;
  });
  return s;
}

function parsePoEntries(text) {
  const entries = new Map();
  let current = null;
  let field = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current && current.msgid !== null) entries.set(current.msgid, current.msgstr ?? "");
      current = null;
      field = null;
      continue;
    }
    if (trimmed.startsWith('"')) {
      const content = JSON.parse(trimmed);
      if (field === "msgid" && current.msgid === "") current.msgid = content;
      else if (field === "msgstr" && current !== null) current.msgstr += content;
      else if (field === "msgid" && current !== null) current.msgid += content;
      continue;
    }
    const msgidMatch = trimmed.match(/^msgid\s+(.*)/);
    if (msgidMatch) {
      if (current && current.msgid !== null) entries.set(current.msgid, current.msgstr ?? "");
      current = { msgid: JSON.parse(msgidMatch[1]), msgstr: "" };
      field = "msgid";
      continue;
    }
    const msgstrMatch = trimmed.match(/^msgstr\s+(.*)/);
    if (msgstrMatch && current) {
      current.msgstr = JSON.parse(msgstrMatch[1]);
      field = "msgstr";
      continue;
    }
  }
  if (current && current.msgid !== null) entries.set(current.msgid, current.msgstr ?? "");
  return entries;
}

function readLinguas() {
  if (!existsSync(LINGUAS_PATH)) {
    console.error(
      `❌ ${relative("", LINGUAS_PATH)} not found. Create it with one locale code per line.`,
    );
    exit(1);
  }
  return readFileSync(LINGUAS_PATH, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

const sourceFiles = walk(SRC_DIR).filter(
  (f) => !f.includes("/node_modules/") && !f.endsWith(".d.ts"),
);

const allStrings = [];
for (const file of sourceFiles) allStrings.push(...extractStrings(file));

const seen = new Set();
const sourceMap = [];
for (const s of allStrings) {
  const key = unescape(s.string);
  if (!seen.has(key)) {
    seen.add(key);
    sourceMap.push({ ...s, normalized: key });
  }
}

const sourceStringSet = new Set(sourceMap.map((s) => s.normalized));

let exitCode = 0;
const warnings = [];

function checkPoAgainstSource(poPath, label, { requireComplete, isTemplate }) {
  if (!existsSync(poPath)) {
    console.error(`❌ ${label}: file not found at ${poPath}`);
    exitCode = 1;
    return null;
  }
  const entries = parsePoEntries(readFileSync(poPath, "utf-8"));
  const missing = sourceMap.filter((s) => !entries.has(s.normalized));
  const empty = [];
  if (!isTemplate) {
    for (const [msgid, msgstr] of entries) {
      if (msgid === "") continue;
      if (sourceStringSet.has(msgid) && !msgstr) empty.push(msgid);
    }
  }
  if (requireComplete) {
    if (missing.length > 0) {
      console.error(`❌ ${label}: ${missing.length} string(s) missing:`);
      for (const s of missing) console.error(`   • "${s.string}"  (${s.file}:${s.line})`);
      exitCode = 1;
    }
    if (empty.length > 0) {
      console.error(`❌ ${label}: ${empty.length} string(s) with empty msgstr:`);
      for (const s of empty) console.error(`   • "${s}"`);
      exitCode = 1;
    }
    if (!entries.has(LANGUAGE_SENTINEL) || !entries.get(LANGUAGE_SENTINEL)) {
      console.error(
        `❌ ${label}: missing or empty Language Sentinel (msgid "${LANGUAGE_SENTINEL}")`,
      );
      exitCode = 1;
    } else if (VERBOSE) {
      console.log(`✓ ${label}: complete (${entries.size} msgids)`);
    }
  } else {
    if (missing.length > 0 || empty.length > 0) {
      warnings.push(
        `${label}: ${missing.length} missing, ${empty.length} empty msgstr (draft, non-blocking)`,
      );
    }
  }
  return entries;
}

const linguas = readLinguas();

if (existsSync(POT_PATH)) {
  const potEntries = checkPoAgainstSource(POT_PATH, "gnome-provider-limits.pot", {
    requireComplete: false,
    isTemplate: true,
  });
  if (potEntries) {
    const missing = sourceMap.filter((s) => !potEntries.has(s.normalized));
    if (missing.length > 0) {
      console.error(
        `❌ gnome-provider-limits.pot: ${missing.length} string(s) drifted from source:`,
      );
      for (const s of missing) console.error(`   • "${s.string}"  (${s.file}:${s.line})`);
      exitCode = 1;
    } else if (VERBOSE) {
      console.log(`✓ gnome-provider-limits.pot: in sync (${potEntries.size} msgids)`);
    }
  }
} else {
  console.error("❌ gnome-provider-limits.pot not found");
  exitCode = 1;
}

for (const code of linguas) {
  checkPoAgainstSource(join(PO_DIR, `${code}.po`), `${code}.po`, { requireComplete: true });
}

const poFiles = readdirSync(PO_DIR).filter((f) => f.endsWith(".po"));
const linguasSet = new Set(linguas.map((c) => `${c}.po`));
const drafts = poFiles.filter((f) => !linguasSet.has(f));
for (const f of drafts) {
  const entries = parsePoEntries(readFileSync(join(PO_DIR, f), "utf-8"));
  const missing = sourceMap.filter((s) => !entries.has(s.normalized));
  const empty = [];
  for (const [msgid, msgstr] of entries) {
    if (msgid === "") continue;
    if (sourceStringSet.has(msgid) && !msgstr) empty.push(msgid);
  }
  const sentinel = entries.get(LANGUAGE_SENTINEL);
  const sentinelMissing = !sentinel;
  if (missing.length || empty.length || sentinelMissing) {
    let line = `⚠ ${f} (draft): ${missing.length} missing, ${empty.length} empty`;
    if (sentinelMissing) line += ", Language Sentinel missing";
    warnings.push(line);
  }
}

for (const w of warnings) console.warn(w);

if (exitCode === 0 && VERBOSE) {
  console.log(
    `\n✓ i18n check passed (${sourceMap.length} unique strings, ${linguas.length} language(s))`,
  );
}

exit(exitCode);
