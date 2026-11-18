import GLib from "gi://GLib";

import { assertDeepEqual, assertEqual, assertNotNull } from "../helpers/assert.js";
import { MockSettings } from "../mocks/mock-settings.js";

const PROVIDER_DISPLAY_NAMES = {
  codex: "Codex Pro",
  claude: "Claude Max",
  opencode: "OpenCode Go",
  grok: "SuperGrok",
};

function skipResult(reason) {
  return [
    { name: "preferences page binds the status bar position setting", skipped: true, reason },
  ];
}

function messageOf(e) {
  return e instanceof Error ? (e.message ?? String(e)) : String(e);
}

function findWidget(widget, predicate) {
  if (predicate(widget)) return widget;

  let child = widget.get_first_child?.() ?? null;
  while (child) {
    const found = findWidget(child, predicate);
    if (found) return found;
    child = child.get_next_sibling();
  }

  return null;
}

function findAllWidgets(widget, predicate, acc = []) {
  if (predicate(widget)) acc.push(widget);

  let child = widget.get_first_child?.() ?? null;
  while (child) {
    findAllWidgets(child, predicate, acc);
    child = child.get_next_sibling();
  }

  return acc;
}

export async function run() {
  let Gtk;
  let Adw;
  try {
    Gtk = (await import("gi://Gtk?version=4.0")).default;
    Adw = (await import("gi://Adw?version=1")).default;
  } catch (e) {
    return skipResult(`Gtk/Adw typelibs unavailable: ${messageOf(e)}`);
  }

  if (!Gtk.init_check()) {
    return skipResult("Gtk.init_check() failed (no display available)");
  }
  Adw.init();

  const gettextUrl = GLib.Uri.resolve_relative(
    import.meta.url,
    "../../dist/helpers/gettext.js",
    GLib.UriFlags.NONE,
  );
  const mainPageUrl = GLib.Uri.resolve_relative(
    import.meta.url,
    "../../dist/ui/prefs/main-page.js",
    GLib.UriFlags.NONE,
  );
  const providerPageUrl = GLib.Uri.resolve_relative(
    import.meta.url,
    "../../dist/ui/prefs/provider-page.js",
    GLib.UriFlags.NONE,
  );
  const { configureTranslations } = await import(gettextUrl);
  const { ProviderLimitsPreferencesPage } = await import(mainPageUrl);
  const { ProviderPage } = await import(providerPageUrl);

  configureTranslations(`${GLib.get_current_dir()}/dist`, "en");

  const results = [];

  // Test 1: ProviderLimitsPreferencesPage can be constructed and reorders providers via Up/Down buttons
  try {
    const settings = new MockSettings({
      "providers-order": ["codex", "claude", "opencode", "grok"],
      "codex-enabled": true,
      "claude-enabled": false,
      "opencode-enabled": true,
      "grok-enabled": true,
      "refresh-short-interval-seconds": 10,
      "refresh-long-interval-seconds": 120,
      "refresh-stable-reads-threshold": 3,
      language: "en",
      "status-bar-position": "left",
    });
    const page = new ProviderLimitsPreferencesPage(settings, [{ code: "en", name: "English" }]);
    assertNotNull(page, "page should be created");
    const positionRow = findWidget(
      page,
      (widget) => widget instanceof Adw.ComboRow && widget.title === "Status bar position",
    );
    assertNotNull(positionRow, "status bar position row should exist");
    assertEqual(positionRow.selected, 0, "left should be selected from settings");
    positionRow.selected = 1;
    assertEqual(
      settings.get_string("status-bar-position"),
      "right",
      "selection should update settings",
    );
    settings.set_string("status-bar-position", "left");
    assertEqual(positionRow.selected, 0, "selection should follow external setting changes");

    const moveDownButtons = findAllWidgets(
      page,
      (widget) => widget instanceof Gtk.Button && widget.icon_name === "go-down-symbolic",
    );
    assertEqual(moveDownButtons.length, 4, "each provider row should have a Move down button");
    moveDownButtons[0].emit("clicked");
    assertDeepEqual(
      settings.get_strv("providers-order"),
      ["claude", "codex", "opencode", "grok"],
      "clicking Move down on first provider reorders providers-order",
    );

    page.cleanup();
    results.push({
      name: "Status bar position preference and provider Move buttons bind to settings",
      passed: true,
    });
  } catch (e) {
    results.push({
      name: "Status bar position preference and provider Move buttons bind to settings",
      passed: false,
      error: String(e),
    });
  }

  // Test 2: ProviderPage can be constructed for each provider with the configured title
  for (const provider of Object.keys(PROVIDER_DISPLAY_NAMES)) {
    const name = `ProviderPage is constructable for ${provider}`;
    try {
      const displayName = PROVIDER_DISPLAY_NAMES[provider];
      const settings = new MockSettings({
        [`${provider}-enabled`]: true,
        [`${provider}-display-name`]: displayName,
        [`${provider}-display-name-short`]: provider,
        [`${provider}-cli-path`]: "",
        [`${provider}-status-fields`]: [],
        [`${provider}-panel-fields`]: [],
        language: "en",
      });
      const page = new ProviderPage(settings, provider);
      assertNotNull(page, "ProviderPage should be created");
      assertEqual(page.title, displayName, "page title should match the display name setting");
      page.cleanup();
      results.push({ name, passed: true });
    } catch (e) {
      results.push({ name, passed: false, error: String(e) });
    }
  }

  // Test 3: Settings bindings propagate to the page title
  try {
    const settings = new MockSettings({
      "codex-enabled": true,
      "codex-display-name": "Codex",
      "codex-display-name-short": "CX",
      "codex-cli-path": "",
      "codex-status-fields": ["used_percent_primary"],
      "codex-panel-fields": [],
      language: "en",
    });

    const page = new ProviderPage(settings, "codex");
    assertNotNull(page, "page should exist");

    let titleChanged = false;
    page.connect("notify::title", () => {
      titleChanged = true;
    });

    settings.set_string("codex-display-name", "New Name");

    assertEqual(page.title, "New Name", "title should follow the display name setting");
    assertEqual(titleChanged, true, "changing the setting should notify the title");
    page.cleanup();
    results.push({ name: "Settings binding triggers title change", passed: true });
  } catch (e) {
    results.push({
      name: "Settings binding triggers title change",
      passed: false,
      error: String(e),
    });
  }

  // Test 4: Field Matrix inline [Top Bar]/[Panel] toggles and Reset defaults update settings
  try {
    const settings = new MockSettings({
      "codex-enabled": true,
      "codex-display-name": "Codex",
      "codex-display-name-short": "CX",
      "codex-cli-path": "",
      "codex-status-fields": [],
      "codex-panel-fields": [],
      language: "en",
    });

    const page = new ProviderPage(settings, "codex");
    const toggles = findAllWidgets(page, (w) => w instanceof Gtk.ToggleButton);
    const topBarToggles = toggles.filter((t) => t.label === "Top Bar");
    const panelToggles = toggles.filter((t) => t.label === "Panel");
    assertEqual(topBarToggles.length, 12, "Codex Field Matrix should expose 12 Top Bar toggles");
    assertEqual(panelToggles.length, 12, "Codex Field Matrix should expose 12 Panel toggles");

    topBarToggles[0].active = true;
    assertDeepEqual(
      settings.get_strv("codex-status-fields"),
      ["used_percent_primary"],
      "toggling Top Bar adds field to status-fields",
    );

    panelToggles[0].active = true;
    panelToggles[1].active = true;
    assertDeepEqual(
      settings.get_strv("codex-panel-fields"),
      ["used_percent_primary", "remaining_percent_primary"],
      "toggling Panel adds fields to panel-fields",
    );

    const resetBtn = findWidget(
      page,
      (w) => w instanceof Gtk.Button && w.label === "Reset defaults",
    );
    assertNotNull(resetBtn, "Reset defaults button should exist");
    resetBtn.emit("clicked");
    assertDeepEqual(
      settings.get_strv("codex-status-fields"),
      ["used_percent_primary", "reset_at_primary"],
      "Reset defaults restores schema status-fields",
    );

    page.cleanup();
    results.push({
      name: "Field Matrix inline toggles and Reset defaults update zone settings",
      passed: true,
    });
  } catch (e) {
    results.push({
      name: "Field Matrix inline toggles and Reset defaults update zone settings",
      passed: false,
      error: String(e),
    });
  }

  // Test 5: MockSettings.set_strv emits changed:: signal
  try {
    const settings = new MockSettings({
      "codex-status-fields": ["used_percent_primary"],
    });

    let signalFired = false;
    settings.connect("changed::codex-status-fields", () => {
      signalFired = true;
    });

    settings.set_strv("codex-status-fields", ["used_percent_primary", "reset_at_primary"]);
    assertEqual(signalFired, true, "signal should fire on set_strv");
    assertEqual(settings.get_strv("codex-status-fields").length, 2, "should have 2 fields");
    results.push({ name: "MockSettings.set_strv emits signal", passed: true });
  } catch (e) {
    results.push({ name: "MockSettings.set_strv emits signal", passed: false, error: String(e) });
  }

  return results;
}
