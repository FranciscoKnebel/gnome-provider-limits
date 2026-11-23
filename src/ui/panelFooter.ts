import Clutter from "gi://Clutter";
import St from "gi://St";
import { Spinner } from "resource:///org/gnome/shell/ui/animation.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { gettext as _ } from "../helpers/gettext.js";
import { bindActivation, type ActivationPointerSignal } from "../helpers/keyboard.js";

type IconSpec = readonly [string, string?];

export interface PanelFooterActors {
  readonly row: PopupMenu.PopupBaseMenuItem;
  readonly refreshControl: St.Widget;
  readonly settingsControl: St.Widget;
  readonly lastRefreshLabel: St.Label;
  readonly spinner: Spinner;
}
export type FooterBuild = { actors: PanelFooterActors; applyRunning: (running: boolean) => void };
export interface FooterOptions {
  readonly extraControls: readonly St.Widget[];
  readonly onRefresh: () => void;
  readonly openPreferences: () => void;
  readonly closeMenu: () => void;
  readonly onFooterKey: (event: Clutter.Event) => boolean;
}

const ACTION_PROPS = {
  reactive: true,
  can_focus: true,
  track_hover: true,
  y_align: Clutter.ActorAlign.CENTER,
} as const;

function createSpinner(): Spinner {
  const spinner = new Spinner(14, { animate: true, hideOnStop: true });
  spinner.add_style_class_name("provider-limits-refresh-spinner");
  return spinner;
}

function label(text: string, styleClass?: string): St.Label {
  const result = new St.Label({
    text,
    ...(styleClass ? { style_class: styleClass } : {}),
    y_align: Clutter.ActorAlign.CENTER,
  });
  result.accessible_name = text;
  return result;
}

function icon(spec: IconSpec | undefined): St.Icon | null {
  if (!spec || typeof St.Icon !== "function") return null;
  return new St.Icon({
    icon_name: spec[0],
    icon_size: 14,
    ...(spec[1] ? { style_class: spec[1] } : {}),
    y_align: Clutter.ActorAlign.CENTER,
  });
}

function footerRow(styleClass: string): PopupMenu.PopupBaseMenuItem {
  const item = new PopupMenu.PopupBaseMenuItem({
    reactive: false,
    can_focus: false,
    activate: false,
    hover: false,
  });
  item.add_style_class_name("provider-limits-static-row");
  item.add_style_class_name(styleClass);
  return item;
}

function actionControl(
  children: readonly St.Widget[],
  styleClass: string,
  contentClass: string | undefined,
  asButton: boolean,
): St.Widget {
  if (!asButton) {
    const box = new St.BoxLayout({ style_class: styleClass, ...ACTION_PROPS });
    for (const child of children) box.add_child(child);
    return box;
  }
  const content = new St.BoxLayout({
    ...(contentClass ? { style_class: contentClass } : {}),
    y_align: Clutter.ActorAlign.CENTER,
  });
  for (const child of children) content.add_child(child);
  return new St.Button({ child: content, style_class: styleClass, ...ACTION_PROPS });
}

function applyRunning(
  control: St.Widget,
  spinner: Spinner,
  refreshLabel: St.Label | null,
  refreshIcon: St.Icon | null,
  disabledClass: string | undefined,
): (running: boolean) => void {
  const setRunning = (running: boolean): void => {
    spinner.visible = running;
    if (running) spinner.play();
    else spinner.stop();
    const text = running ? _("Refreshing…") : _("Force refresh");
    if (refreshLabel) {
      refreshLabel.text = text;
      refreshLabel.accessible_name = text;
    }
    control.accessible_name = text;
    if (refreshIcon && disabledClass) refreshIcon.visible = !running;
    control.reactive = !running;
    if (disabledClass) {
      if (running) control.add_style_class_name(disabledClass);
      else control.remove_style_class_name(disabledClass);
    }
  };
  setRunning(false);
  return setRunning;
}

function bindRefresh(
  control: St.Widget,
  pointerSignal: ActivationPointerSignal,
  options: FooterOptions,
): void {
  bindActivation(control, options.onRefresh, {
    pointerSignals: [pointerSignal],
    onOtherKey: options.onFooterKey,
  });
}

function bindSettings(
  control: St.Widget,
  pointerSignal: ActivationPointerSignal,
  options: FooterOptions,
): void {
  bindActivation(
    control,
    () => {
      options.closeMenu();
      options.openPreferences();
    },
    { pointerSignals: [pointerSignal], onOtherKey: options.onFooterKey },
  );
}

function toolbarTimestamp(): St.Label {
  return new St.Label({
    text: "",
    style_class: "provider-limits-dim pl-footer-timestamp",
    x_expand: true,
    x_align: Clutter.ActorAlign.CENTER,
    y_align: Clutter.ActorAlign.CENTER,
    visible: false,
  });
}

function hudTimestamp(): St.Label {
  return new St.Label({
    text: "",
    style_class: "provider-limits-hud-meta provider-limits-tnum",
    y_align: Clutter.ActorAlign.CENTER,
    visible: false,
  });
}

/** Gauges footer: a button-wrapped spinner followed by the refresh label. */
export function buildGaugesFooter(options: FooterOptions): FooterBuild {
  const row = footerRow("pl-footer-row");
  const spinner = createSpinner();
  const refreshLabel = label(_("Force refresh"));
  const refresh = actionControl(
    [spinner, refreshLabel],
    "pl-footer-button pl-refresh-button",
    "pl-footer-button-box",
    true,
  );
  bindRefresh(refresh, "clicked", options);
  const setRunning = applyRunning(refresh, spinner, refreshLabel, null, undefined);

  const settingsLabel = label(_("Settings"));
  const settings = new St.Button({
    child: settingsLabel,
    style_class: "pl-footer-button pl-settings-button",
    ...ACTION_PROPS,
  });
  settings.accessible_name = _("Settings");
  bindSettings(settings, "clicked", options);

  const lastRefreshLabel = toolbarTimestamp();
  const toolbar = new St.BoxLayout({
    style_class: "pl-footer-toolbar",
    x_expand: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  toolbar.add_child(refresh);
  toolbar.add_child(lastRefreshLabel);
  toolbar.add_child(settings);
  row.add_child(toolbar);

  return {
    actors: { row, refreshControl: refresh, settingsControl: settings, lastRefreshLabel, spinner },
    applyRunning: setRunning,
  };
}

/** Cards footer: an inline box with icons beside the labels, activated on release. */
export function buildCardsFooter(options: FooterOptions): FooterBuild {
  const row = footerRow("pl-panel-footer-row");
  const spinner = createSpinner();
  const refreshIcon = icon(["view-refresh-symbolic", "pl-footer-icon"]);
  const refreshLabel = label(_("Force refresh"), "pl-footer-action-label");
  const refresh = actionControl(
    [spinner, ...(refreshIcon ? [refreshIcon] : []), refreshLabel],
    "pl-footer-action pl-refresh-action",
    undefined,
    false,
  );
  bindRefresh(refresh, "button-release-event", options);
  const setRunning = applyRunning(
    refresh,
    spinner,
    refreshLabel,
    refreshIcon,
    "pl-footer-action-disabled",
  );

  const settingsIcon = icon(["preferences-system-symbolic", "pl-footer-icon"]);
  const settingsLabel = label(_("Settings"), "pl-footer-action-label");
  const settings = actionControl(
    [...(settingsIcon ? [settingsIcon] : []), settingsLabel],
    "pl-footer-action pl-settings-action",
    undefined,
    false,
  );
  settings.accessible_name = _("Settings");
  bindSettings(settings, "button-release-event", options);

  const lastRefreshLabel = toolbarTimestamp();
  const toolbar = new St.BoxLayout({
    style_class: "pl-panel-footer",
    x_expand: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  toolbar.add_child(refresh);
  toolbar.add_child(lastRefreshLabel);
  toolbar.add_child(settings);
  row.add_child(toolbar);

  return {
    actors: { row, refreshControl: refresh, settingsControl: settings, lastRefreshLabel, spinner },
    applyRunning: setRunning,
  };
}

/** HUD footer: leading title and timestamp, trailing extra controls and icon buttons. */
export function buildHudFooter(options: FooterOptions): FooterBuild {
  const row = footerRow("provider-limits-hud-toolbar");
  const spinner = createSpinner();
  const refreshIcon = icon(["view-refresh-symbolic"]);
  const refresh = actionControl(
    [...(refreshIcon ? [refreshIcon] : []), spinner],
    "provider-limits-icon-button",
    undefined,
    true,
  );
  bindRefresh(refresh, "clicked", options);
  const setRunning = applyRunning(refresh, spinner, null, refreshIcon, undefined);

  const settingsIcon = icon(["emblem-system-symbolic"]);
  const settings = new St.Button({
    child: settingsIcon ?? undefined,
    style_class: "provider-limits-icon-button",
    ...ACTION_PROPS,
  });
  settings.accessible_name = _("Settings");
  bindSettings(settings, "clicked", options);

  const lastRefreshLabel = hudTimestamp();
  const title = _("Provider Limits");
  const leading = new St.BoxLayout({
    style_class: "provider-limits-hud-toolbar-left",
    x_expand: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  leading.add_child(label(title, "provider-limits-hud-title"));
  leading.add_child(lastRefreshLabel);
  const trailing = new St.BoxLayout({
    style_class: "provider-limits-hud-actions",
    y_align: Clutter.ActorAlign.CENTER,
  });
  for (const control of options.extraControls) trailing.add_child(control);
  trailing.add_child(refresh);
  trailing.add_child(settings);
  row.add_child(leading);
  row.add_child(trailing);

  return {
    actors: { row, refreshControl: refresh, settingsControl: settings, lastRefreshLabel, spinner },
    applyRunning: setRunning,
  };
}
