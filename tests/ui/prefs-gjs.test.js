import GLib from "gi://GLib";

import { assert, assertDeepEqual, assertEqual, assertNotNull } from "../helpers/assert.js";
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
  if (!widget) return null;
  if (predicate(widget)) return widget;

  let child = widget.get_first_child?.() ?? null;
  while (child) {
    const found = findWidget(child, predicate);
    if (found) return found;
    child = child.get_next_sibling();
  }

  if (widget.popover) {
    const inPopover = findWidget(widget.popover, predicate);
    if (inPopover) return inPopover;
  }

  return null;
}

function findAllWidgets(widget, predicate, acc = []) {
  if (!widget) return acc;
  if (predicate(widget)) acc.push(widget);

  let child = widget.get_first_child?.() ?? null;
  while (child) {
    findAllWidgets(child, predicate, acc);
    child = child.get_next_sibling();
  }

  if (widget.popover) {
    findAllWidgets(widget.popover, predicate, acc);
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
  const { configureTranslations } = await import(gettextUrl);
  configureTranslations(`${GLib.get_current_dir()}/dist`, "en");

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
  const { ProvidersPage, ProviderExpanderRow } = await import(providerPageUrl);

  const results = [];

  // Test 1: ProviderLimitsPreferencesPage (General) binds status-bar-position
  try {
    const settings = new MockSettings({
      "refresh-short-interval-seconds": 10,
      "refresh-long-interval-seconds": 120,
      "refresh-stable-reads-threshold": 3,
      language: "en",
      "status-bar-position": "left",
    });
    const page = new ProviderLimitsPreferencesPage(settings, [{ code: "en", name: "English" }]);
    assertNotNull(page, "General page should be created");
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
    page.cleanup();
    results.push({ name: "Status bar position preference binds to settings", passed: true });
  } catch (e) {
    results.push({
      name: "Status bar position preference binds to settings",
      passed: false,
      error: String(e),
    });
  }

  // Test 2: ProviderExpanderRow can be constructed for all 4 providers with built-in enable switch
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
      assertEqual(row.title, displayName, "row title should match display name setting");
      assertEqual(row.show_enable_switch, true, "built-in enable switch should be shown");
      assertEqual(row.enable_expansion, true, "enable-expansion should reflect enabled setting");

      row["enable-expansion"] = false;
      assertEqual(
        settings.get_boolean(`${provider}-enabled`),
        false,
        "toggling built-in switch updates GSettings",
      );

      row.cleanup();
      results.push({ name, passed: true });
    } catch (e) {
      results.push({ name, passed: false, error: String(e) });
    }
  }

  // Test 3: Live Display Name & Short Name updates propagate in-place without destroying expander
  try {
    const settings = new MockSettings({
      "codex-enabled": true,
      "codex-display-name": "Codex",
      "codex-display-name-short": "cx",
      "codex-cli-path": "",
      "codex-status-fields": ["used_percent_primary"],
      "codex-panel-fields": [],
      language: "en",
    });

    const row = new ProviderExpanderRow(settings, "codex", { initialExpanded: true });
    assertEqual(row.expanded, true, "row starts expanded when requested");

    let titleChanged = false;
    row.connect("notify::title", () => {
      titleChanged = true;
    });

    settings.set_string("codex-display-name", "New Codex");
    settings.set_string("codex-display-name-short", "ncx");

    assertEqual(row.title, "New Codex", "title follows display name setting");
    assertEqual(row.subtitle, "ncx", "subtitle follows short display name setting");
    assertEqual(titleChanged, true, "changing setting notifies title");
    assertEqual(row.expanded, true, "row remains expanded during in-place title edit");
    row.cleanup();
    results.push({
      name: "Settings binding triggers live expander title/subtitle change",
      passed: true,
    });
  } catch (e) {
    results.push({
      name: "Settings binding triggers live expander title/subtitle change",
      passed: false,
      error: String(e),
    });
  }

  // Test 4: Unified ProvidersPage supports Popover field picker, keyboard Move Up/Down, and Reset
  try {
    const settings = new MockSettings({
      "providers-order": ["codex", "claude", "opencode", "grok"],
      "codex-enabled": true,
      "codex-display-name": "Codex",
      "codex-display-name-short": "codex",
      "codex-status-fields": ["used_percent_primary"],
      "codex-panel-fields": [],
      language: "en",
    });

    const providersPage = new ProvidersPage(settings);
    const expanderRows = findAllWidgets(providersPage, (w) => w instanceof Adw.ExpanderRow);
    assertEqual(expanderRows.length, 4, "all 4 providers appear in unified accordion");

    const codexRow = expanderRows[0];
    const menuButtons = findAllWidgets(
      codexRow,
      (w) => w instanceof Gtk.MenuButton && w.tooltip_text === "Add field",
    );
    assertEqual(menuButtons.length, 2, "status and panel field lists each have a MenuButton");

    // Pick a field from the status-fields Gtk.Popover
    const statusAddButton = menuButtons[0];
    assertNotNull(statusAddButton.popover, "MenuButton has native Gtk.Popover");
    const popoverOptionButtons = findAllWidgets(
      statusAddButton.popover,
      (w) => w instanceof Gtk.Button,
    );
    assert(popoverOptionButtons.length > 0, "Popover contains unused field buttons with previews");
    popoverOptionButtons[0].emit("clicked");
    assertEqual(
      settings.get_strv("codex-status-fields").length,
      2,
      "clicking Popover option appends field",
    );

    // Keyboard Move Down on the first field in codex-status-fields
    const beforeMove = settings.get_strv("codex-status-fields");
    const fieldLists = findAllWidgets(
      codexRow,
      (w) =>
        w instanceof Gtk.ListBox &&
        w.selection_mode === Gtk.SelectionMode.NONE &&
        w.has_css_class("boxed-list"),
    );
    assertEqual(fieldLists.length, 2, "status and panel boxed-list field ListBoxes exist");
    const statusFieldMoveDown = findWidget(
      fieldLists[0],
      (w) => w instanceof Gtk.Button && w.tooltip_text === "Move down" && w.sensitive,
    );
    assertNotNull(statusFieldMoveDown, "active Move down button exists on first field row");
    statusFieldMoveDown.emit("clicked");
    assertDeepEqual(
      settings.get_strv("codex-status-fields"),
      [beforeMove[1], beforeMove[0]],
      "Move down swaps field order",
    );

    // Reset button restores schema defaults
    const resetButtons = findAllWidgets(
      codexRow,
      (w) => w instanceof Gtk.Button && w.tooltip_text === "Reset fields to defaults",
    );
    assertEqual(resetButtons.length, 2, "each field list has a Reset button");
    assertEqual(resetButtons[0].sensitive, true, "Reset is sensitive when modified");
    resetButtons[0].emit("clicked");
    assertDeepEqual(
      settings.get_strv("codex-status-fields"),
      ["used_percent_primary", "reset_at_primary"],
      "Reset restores default status fields",
    );
    assertEqual(resetButtons[0].sensitive, false, "Reset becomes insensitive at defaults");

    providersPage.cleanup();
    results.push({
      name: "ProvidersPage accordion supports Popover field picker, Move Up/Down, and Reset",
      passed: true,
    });
  } catch (e) {
    results.push({
      name: "ProvidersPage accordion supports Popover field picker, Move Up/Down, and Reset",
      passed: false,
      error: String(e),
    });
  }

  return results;
}
