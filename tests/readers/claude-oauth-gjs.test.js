import GLib from "gi://GLib";

import { assertEqual } from "../helpers/assert.js";
import { MockSettings } from "../mocks/mock-settings.js";

const { ClaudeReader } = await import("../../dist/readers/claude.js");

export async function run() {
  const name = "Claude raw OAuth normalization classifies usable and invalid wire responses";
  const reader = new ClaudeReader(new MockSettings(), "claude");
  const path = GLib.filename_from_uri(
    GLib.Uri.resolve_relative(
      import.meta.url,
      "../fixtures/claude-oauth-usage.json",
      GLib.UriFlags.NONE,
    ),
  )[0];
  reader._http = {
    async getJson() {
      return JSON.parse(new TextDecoder().decode(GLib.file_get_contents(path)[1]));
    },
    destroy() {},
  };
  try {
    const payload = await reader._fetchUsage("synthetic", null);
    const result = reader._parsePayload(payload, ["oauth-api"]);
    assertEqual(result.status, "ok");
    const value = (fieldName) => result.fields.find((field) => field.name === fieldName)?.value;
    assertEqual(value("used_percent_session"), 25);
    assertEqual(value("remaining_percent_weekly"), 40);
    assertEqual(value("used_percent_sonnet"), 10);
    assertEqual(value("used_percent_opus"), 5);
    assertEqual(value("reset_at_session"), Date.parse("2099-01-01T01:00:00Z") / 1000);
    assertEqual(value("has_extra_usage_enabled"), false);
    reader._http.getJson = async () => ({ five_hour: { utilization: "bad", resets_at: "bad" } });
    const invalid = await reader._fetchUsage("synthetic", null);
    assertEqual(reader._parsePayload(invalid, ["oauth-api"]).status, "error");
    return [{ name, passed: true }];
  } catch (error) {
    return [{ name, passed: false, error: String(error) }];
  } finally {
    reader.destroy();
  }
}
