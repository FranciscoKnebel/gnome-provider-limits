import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

function parsePo(text) {
  const entries = [];
  let current = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith('"') && current) {
      const content = JSON.parse(trimmed);
      if (current.msgid === null) {
        current.msgid = content;
      } else if (current.msgid !== null && current.msgstr !== null) {
        current.msgstr += content;
      }
      continue;
    }

    const msgidMatch = trimmed.match(/^msgid\s+(.*)/);
    if (msgidMatch) {
      if (current) entries.push(current);
      current = { msgid: JSON.parse(msgidMatch[1]), msgstr: null };
      continue;
    }

    const msgstrMatch = trimmed.match(/^msgstr\s+(.*)/);
    if (msgstrMatch && current) {
      current.msgstr = JSON.parse(msgstrMatch[1]);
      continue;
    }
  }
  if (current) entries.push(current);

  return entries.filter((e) => e.msgstr && e.msgstr !== "");
}

function sortEntries(entries) {
  // MO format requires original strings to be sorted by byte value
  // (including NUL terminator) for glibc's binary search.
  entries.sort((a, b) => {
    const bufA = Buffer.from(a.msgid + "\0", "utf-8");
    const bufB = Buffer.from(b.msgid + "\0", "utf-8");
    return bufA.compare(bufB);
  });
}

function compileMo(entries) {
  const origBufs = entries.map((e) => Buffer.from(e.msgid + "\0", "utf-8"));
  const transBufs = entries.map((e) => Buffer.from(e.msgstr + "\0", "utf-8"));

  const count = entries.length;
  const headerSize = 28;
  const origTableOff = headerSize;
  const transTableOff = origTableOff + count * 8;
  let origStrOff = transTableOff + count * 8;
  let transStrOff = origStrOff + origBufs.reduce((s, b) => s + b.length, 0);

  const parts = [];

  // header (revision 0)
  const header = Buffer.alloc(headerSize);
  header.writeUInt32LE(0x950412de, 0); // magic
  header.writeUInt32LE(0, 4); // revision
  header.writeUInt32LE(count, 8);
  header.writeUInt32LE(origTableOff, 12);
  header.writeUInt32LE(transTableOff, 16);
  header.writeUInt32LE(0, 20); // hash table size (revision 0)
  header.writeUInt32LE(0, 24); // hash table offset
  parts.push(header);

  // original strings table
  for (const buf of origBufs) {
    const entry = Buffer.alloc(8);
    entry.writeUInt32LE(buf.length, 0); // length includes NUL (rev 0)
    entry.writeUInt32LE(origStrOff, 4);
    origStrOff += buf.length;
    parts.push(entry);
  }

  // translation strings table
  for (const buf of transBufs) {
    const entry = Buffer.alloc(8);
    entry.writeUInt32LE(buf.length, 0);
    entry.writeUInt32LE(transStrOff, 4);
    transStrOff += buf.length;
    parts.push(entry);
  }

  // original strings
  for (const buf of origBufs) parts.push(buf);

  // translation strings
  for (const buf of transBufs) parts.push(buf);

  return Buffer.concat(parts);
}

// main
const poPath = process.argv[2];
const moPath = process.argv[3];

if (!poPath || !moPath) {
  console.error("usage: node compile-mo.mjs <input.po> <output.mo>");
  process.exit(1);
}

mkdirSync(dirname(moPath), { recursive: true });

const poText = readFileSync(poPath, "utf-8");
const entries = parsePo(poText);
sortEntries(entries);
const moData = compileMo(entries);
writeFileSync(moPath, moData);

console.log(`compiled ${entries.length} messages: ${poPath} → ${moPath}`);
