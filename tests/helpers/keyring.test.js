import { assertEqual } from "../helpers/assert.js";

export async function run() {
  const { parseSecretToolSearch } = await import("../../dist/helpers/keyring.js");
  const results = [];

  const test = async (name, body) => {
    try {
      await body();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: String(error) });
    }
  };

  await test("parseSecretToolSearch reads only unlocked secret values", async () => {
    assertEqual(
      parseSecretToolSearch(
        '[26]\nlabel = Cursor CLI credentials (cursor)\nsecret = {"accessToken":"tok"}\r\ncreated = 2026-11-25 14:58:15\n',
      ),
      '{"accessToken":"tok"}',
    );
    assertEqual(
      parseSecretToolSearch("label = no secret here\nschema = org.freedesktop.Secret.Generic\n"),
      null,
    );
    assertEqual(parseSecretToolSearch("secret = \n"), null);
    assertEqual(parseSecretToolSearch(""), null);
  });

  return results;
}
