import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("packaged catalogs load in Python gettext and translate non-ASCII text", () => {
  execFileSync(process.execPath, ["scripts/prepare-languages.mjs"], { stdio: "pipe" });
  execFileSync("python3", [
    "-c",
    `
import gettext, json, pathlib
root = pathlib.Path('dist/locale')
for lang in json.loads((root/'languages.json').read_text()):
    path = root/lang['code']/'LC_MESSAGES/gnome-provider-limits.mo'
    with path.open('rb') as f: catalog = gettext.GNUTranslations(f)
    assert catalog.gettext('LANGUAGE_NAME') == lang['name']
    assert catalog.info()['content-type'].lower().endswith('charset=utf-8')
with (root/'pt_BR/LC_MESSAGES/gnome-provider-limits.mo').open('rb') as f:
    catalog = gettext.GNUTranslations(f)
assert catalog.gettext('Language') == 'Idioma'
assert catalog.gettext('Settings') == 'Configurações'
`,
  ]);
});

test("GNU compiler preserves metadata, UTF-8, multiline originals and translations", () => {
  const dir = mkdtempSync(join(tmpdir(), "provider-limits-mo-"));
  try {
    const input = join(dir, "sample.po");
    const output = join(dir, "sample.mo");
    writeFileSync(
      input,
      'msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid ""\n"Hello "\n"world"\nmsgstr ""\n"Olá "\n"mundo"\n',
    );
    execFileSync(process.execPath, ["scripts/compile-mo.mjs", input, output]);
    const bytes = readFileSync(output);
    const count = bytes.readUInt32LE(8);
    for (const table of [bytes.readUInt32LE(12), bytes.readUInt32LE(16)]) {
      for (let i = 0; i < count; i++) {
        const length = bytes.readUInt32LE(table + i * 8);
        const offset = bytes.readUInt32LE(table + i * 8 + 4);
        assert.equal(bytes[offset + length], 0);
        assert.ok(!bytes.subarray(offset, offset + length).includes(0));
      }
    }
    execFileSync("python3", [
      "-c",
      "import gettext,sys; f=open(sys.argv[1],'rb'); c=gettext.GNUTranslations(f); assert c.gettext('Hello world') == 'Olá mundo'",
      output,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
