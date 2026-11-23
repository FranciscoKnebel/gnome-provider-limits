import GLib from "gi://GLib";

import { assertEqual, assertNotNull } from "../helpers/assert.js";
import { MockSettings } from "../mocks/mock-settings.js";

const PROVIDER_DISPLAY_NAMES = {
  codex: "Codex Pro",
  claude: "Claude Max",
  opencode: "OpenCode Go",
  grok: "SuperGrok",
  cursor: "Cursor Pro",
  google: "Google AI Ultra",
};

function findAllWidgets(widget, predicate, acc = []) {
  if (predicate(widget)) acc.push(widget);

  let child = widget.get_first_child?.() ?? null;
  while (child) {
    findAllWidgets(child, predicate, acc);
    child = child.get_next_sibling();
  }

  return acc;
}

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

export async function run() {
  const results = [];

  // Test 0: the scroll helper supports legacy ScrollViews without set_child.
  try {
    const scrollUrl = GLib.Uri.resolve_relative(
      import.meta.url,
      "../../dist/helpers/scroll.js",
      GLib.UriFlags.NONE,
    );
    const { setScrollViewChild } = await import(scrollUrl);
    const actor = {};

    const legacyCalls = [];
    const legacyScrollView = { add_actor: (child) => legacyCalls.push(["add_actor", child]) };
    setScrollViewChild(legacyScrollView, actor);
    assertEqual(legacyCalls.length, 1, "legacy ScrollView receives one child");
    assertEqual(legacyCalls[0][0], "add_actor", "legacy ScrollView uses add_actor");
    assertEqual(legacyCalls[0][1], actor, "the original actor is added");

    const modernCalls = [];
    const modernScrollView = { set_child: (child) => modernCalls.push(child) };
    setScrollViewChild(modernScrollView, actor);
    assertEqual(modernCalls.length, 1, "modern ScrollView receives one child");
    assertEqual(modernCalls[0], actor, "the original actor becomes the child");
    results.push({
      name: "setScrollViewChild supports legacy and modern ScrollView",
      passed: true,
    });
  } catch (e) {
    results.push({
      name: "setScrollViewChild supports legacy and modern ScrollView",
      passed: false,
      error: messageOf(e),
    });
  }

  let Gtk;
  let Adw;
  try {
    Gtk = (await import("gi://Gtk?version=4.0")).default;
    Adw = (await import("gi://Adw?version=1")).default;
  } catch (e) {
    return [...results, ...skipResult(`Gtk/Adw typelibs unavailable: ${messageOf(e)}`)];
  }

  if (!Gtk.init_check()) {
    return [...results, ...skipResult("Gtk.init_check() failed (no display available)")];
  }
  Adw.init();

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
  const { ProviderLimitsPreferencesPage } = await import(mainPageUrl);
  const { ProviderExpanderRow } = await import(providerPageUrl);
  const gettextUrl = GLib.Uri.resolve_relative(
    import.meta.url,
    "../../dist/helpers/gettext.js",
    GLib.UriFlags.NONE,
  );
  const { configureTranslations } = await import(gettextUrl);
  configureTranslations("/nonexistent-locale-path", "en");

  // Test 1: ProviderLimitsPreferencesPage can be constructed
  try {
    const settings = new MockSettings({
      "providers-order": ["codex", "claude", "opencode"],
      "codex-enabled": true,
      "claude-enabled": false,
      "opencode-enabled": true,
      "refresh-short-interval-seconds": 10,
      "refresh-long-interval-seconds": 120,
      "refresh-stable-reads-threshold": 3,
      language: "",
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
    results.push({ name: "Status bar position preference binds to settings", passed: true });
  } catch (e) {
    results.push({
      name: "Status bar position preference binds to settings",
      passed: false,
      error: String(e),
    });
  }

  // Test 2: ProviderExpanderRow can be constructed for each provider with the configured title
  for (const provider of Object.keys(PROVIDER_DISPLAY_NAMES)) {
    const name = `ProviderExpanderRow is constructable for ${provider}`;
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
      const row = new ProviderExpanderRow(settings, provider);
      assertNotNull(row, "ProviderExpanderRow should be created");
      assertEqual(row.title, displayName, "row title should match the display name setting");
      results.push({ name, passed: true });
    } catch (e) {
      results.push({ name, passed: false, error: String(e) });
    }
  }

  // Test 3: Settings bindings propagate to the row title
  try {
    const settings = new MockSettings({
      "codex-enabled": true,
      "codex-display-name": "Codex",
      "codex-display-name-short": "CX",
      "codex-cli-path": "",
      "codex-status-fields": ["used_percent_primary"],
      "codex-panel-fields": [],
      language: "",
    });

    const row = new ProviderExpanderRow(settings, "codex");
    assertNotNull(row, "row should exist");

    let titleChanged = false;
    row.connect("notify::title", () => {
      titleChanged = true;
    });

    settings.set_string("codex-display-name", "New Name");

    assertEqual(row.title, "New Name", "title should follow the display name setting");
    assertEqual(titleChanged, true, "changing the setting should notify the title");
    results.push({ name: "Settings binding triggers title change", passed: true });
  } catch (e) {
    results.push({
      name: "Settings binding triggers title change",
      passed: false,
      error: String(e),
    });
  }

  // Test 4: MockSettings.set_strv emits changed:: signal
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

  // Test 5: Field Matrix toggles visibility and reorders inside each zone row
  try {
    const settings = new MockSettings({
      "codex-enabled": true,
      "codex-display-name": "Codex",
      "codex-display-name-short": "CX",
      "codex-cli-path": "",
      "codex-status-fields": ["used_percent_primary", "reset_at_primary"],
      "codex-panel-fields": [],
      language: "en",
    });
    const page = new ProviderExpanderRow(settings, "codex");
    const rows = findAllWidgets(
      page,
      (w) => w instanceof Adw.ActionRow && w.title === "Used % (5h window)",
    );
    assertEqual(rows.length, 1, "one matrix row should exist for the field");

    const row = rows[0];
    const panelToggle = findWidget(
      row,
      (w) => w instanceof Gtk.ToggleButton && w.label === "Panel",
    );
    assertNotNull(panelToggle, "Panel toggle should exist in the matrix row");
    panelToggle.active = true;
    assertEqual(
      settings.get_strv("codex-panel-fields").includes("used_percent_primary"),
      true,
      "toggling Panel should add the field to panel fields",
    );

    const topBarUp = findWidget(
      row,
      (w) => w instanceof Gtk.Button && w.icon_name === "go-up-symbolic",
    );
    const topBarDown = findAllWidgets(
      row,
      (w) => w instanceof Gtk.Button && w.icon_name === "go-down-symbolic",
    )[0];
    assertEqual(topBarUp.sensitive, false, "first field cannot move up");
    assertEqual(topBarDown.sensitive, true, "first field can move down");
    topBarDown.emit("clicked");
    assertEqual(
      JSON.stringify(settings.get_strv("codex-status-fields")),
      JSON.stringify(["reset_at_primary", "used_percent_primary"]),
      "inline down button should reorder status fields",
    );
    assertEqual(topBarUp.sensitive, true, "field can now move up");
    results.push({ name: "Field Matrix toggles visibility and reorders inline", passed: true });
  } catch (e) {
    results.push({
      name: "Field Matrix toggles visibility and reorders inline",
      passed: false,
      error: String(e),
    });
  }

  return results;
}
