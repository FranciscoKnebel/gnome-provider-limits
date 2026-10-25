import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [poPath, moPath] = process.argv.slice(2);
if (!poPath || !moPath) throw new Error("usage: node compile-mo.mjs <input.po> <output.mo>");
mkdirSync(dirname(moPath), { recursive: true });
execFileSync("msgfmt", ["--check", "--output-file", moPath, poPath], { stdio: "inherit" });
