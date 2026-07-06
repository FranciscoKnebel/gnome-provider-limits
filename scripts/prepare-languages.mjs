import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PO_DIR = join(ROOT, "src", "po");
const DIST_LOCALE = join(ROOT, "dist", "locale");
const LINGUAS_PATH = join(PO_DIR, "LINGUAS");
const LANGUAGE_SENTINEL = "LANGUAGE_NAME";
const DOMAIN = "gnome-provider-limits";

function readLinguas() {
  return readFileSync(LINGUAS_PATH, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function unescapePo(s) {
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
      if (field === "msgid" && current && current.msgid === "") current.msgid = content;
      else if (field === "msgstr" && current) current.msgstr += content;
      else if (field === "msgid" && current) current.msgid += content;
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
    }
  }
  if (current && current.msgid !== null) entries.set(current.msgid, current.msgstr ?? "");
  return entries;
}

const linguas = readLinguas();
const languages = [];

for (const code of linguas) {
  const poPath = join(PO_DIR, `${code}.po`);
  const moPath = join(DIST_LOCALE, code, "LC_MESSAGES", `${DOMAIN}.mo`);
  if (!existsSync(poPath)) {
    console.error(`✗ ${code}.po not found in LINGUAS`);
    process.exit(1);
  }
  const entries = parsePoEntries(readFileSync(poPath, "utf-8"));
  const name = entries.get(LANGUAGE_SENTINEL);
  if (!name) {
    console.error(`✗ ${code}.po missing Language Sentinel (msgid "${LANGUAGE_SENTINEL}")`);
    process.exit(1);
  }
  execSync(`node scripts/compile-mo.mjs "${poPath}" "${moPath}"`, { stdio: "inherit", cwd: ROOT });
  languages.push({ code, name: unescapePo(name) });
}

const outPath = join(DIST_LOCALE, "languages.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(languages, null, 2) + "\n");
console.log(
  `✓ ${languages.length} language(s): ${languages.map((l) => l.code).join(", ")} → ${outPath}`,
);
