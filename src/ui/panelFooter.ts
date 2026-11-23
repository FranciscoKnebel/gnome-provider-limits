import Clutter from "gi://Clutter";
import St from "gi://St";
import { Spinner } from "resource:///org/gnome/shell/ui/animation.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { formatTimestampTemplate } from "../formatters.js";
import { gettext as _ } from "../helpers/gettext.js";
import { bindActivation } from "../helpers/keyboard.js";
import type { PanelStyle } from "./styles.js";

type PointerSignal = "clicked" | "button-release-event";

export interface PanelFooterActors {
  readonly row: PopupMenu.PopupBaseMenuItem;
  readonly refreshControl: St.Widget;
  readonly settingsControl: St.Widget;
  readonly lastRefreshLabel: St.Label;
  readonly spinner: Spinner;
}

export interface FooterBuild {
  readonly actors: PanelFooterActors;
  readonly applyRunning: (running: boolean) => void;
}

export interface FooterOptions {
  readonly extraControls: readonly St.Widget[];
  readonly onRefresh: () => void;
  readonly openPreferences: () => void;
  readonly closeMenu: () => void;
  readonly onFooterKey: (event: Clutter.Event) => boolean;
}

interface RefreshAction {
  readonly control: St.Widget;
  setRunning(running: boolean): void;
}

interface RefreshHooks {
  readonly control: St.Widget;
  readonly pointerSignal: PointerSignal;
  setText(text: string): void;
  setIconVisible?(visible: boolean): void;
  setDisabled?(disabled: boolean): void;
}

function createFooterSpinner(): Spinner {
  const spinner = new Spinner(14, { animate: true, hideOnStop: true });
  spinner.add_style_class_name("provider-limits-refresh-spinner");
  return spinner;
}

function createLabel(text: string, styleClass?: string): St.Label {
  const label = new St.Label({
    text,
    ...(styleClass !== undefined ? { style_class: styleClass } : {}),
    y_align: Clutter.ActorAlign.CENTER,
  });
  label.accessible_name = text;
  return label;
}

function actionIcon(iconName: string, iconClass?: string): St.Icon | null {
  if (typeof St.Icon !== "function") return null;
  return new St.Icon({
    icon_name: iconName,
    icon_size: 14,
    ...(iconClass !== undefined ? { style_class: iconClass } : {}),
    y_align: Clutter.ActorAlign.CENTER,
  });
}

function createRefreshControl(
  spinner: Spinner,
  onActivate: () => void,
  onKey: (event: Clutter.Event) => boolean,
  hooks: RefreshHooks,
): RefreshAction {
  bindActivation(hooks.control, onActivate, {
    pointerSignals: [hooks.pointerSignal],
    onOtherKey: onKey,
  });

  const setRunning = (running: boolean): void => {
    spinner.visible = running;
    if (running) spinner.play();
    else spinner.stop();
    hooks.setText(running ? _("Refreshing…") : _("Force refresh"));
    hooks.setIconVisible?.(!running);
    hooks.control.reactive = !running;
    hooks.setDisabled?.(running);
  };
  setRunning(false);

  return { control: hooks.control, setRunning };
}

function buildGaugesFooter(options: FooterOptions): FooterBuild {
  const row = new PopupMenu.PopupBaseMenuItem({
    reactive: false,
    can_focus: false,
    activate: false,
    hover: false,
  });
  row.add_style_class_name("provider-limits-static-row");
  row.add_style_class_name("pl-footer-row");

  const spinner = createFooterSpinner();
  const refreshLabel = createLabel(_("Force refresh"));
  const refreshContent = new St.BoxLayout({
    style_class: "pl-footer-button-box",
    y_align: Clutter.ActorAlign.CENTER,
  });
  refreshContent.add_child(spinner);
  refreshContent.add_child(refreshLabel);
  const refresh = new St.Button({
    child: refreshContent,
    style_class: "pl-footer-button pl-refresh-button",
    reactive: true,
    can_focus: true,
    track_hover: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  const refreshAction = createRefreshControl(spinner, options.onRefresh, options.onFooterKey, {
    control: refresh,
    pointerSignal: "clicked",
    setText: (text) => {
      refreshLabel.text = text;
      refreshLabel.accessible_name = text;
      refresh.accessible_name = text;
    },
  });

  const settingsLabel = createLabel(_("Settings"));
  const settingsControl = new St.Button({
    child: settingsLabel,
    style_class: "pl-footer-button pl-settings-button",
    reactive: true,
    can_focus: true,
    track_hover: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  settingsControl.accessible_name = _("Settings");
  bindActivation(
    settingsControl,
    () => {
      options.closeMenu();
      options.openPreferences();
    },
    { pointerSignals: ["clicked"], onOtherKey: options.onFooterKey },
  );

  const lastRefreshLabel = new St.Label({
    text: formatTimestampTemplate(_("Last refresh: %s"), null, "en"),
    style_class: "provider-limits-dim pl-footer-timestamp",
    x_expand: true,
    x_align: Clutter.ActorAlign.CENTER,
    y_align: Clutter.ActorAlign.CENTER,
    visible: false,
  });

  const toolbar = new St.BoxLayout({
    style_class: "pl-footer-toolbar",
    x_expand: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  toolbar.add_child(refreshAction.control);
  toolbar.add_child(lastRefreshLabel);
  toolbar.add_child(settingsControl);
  row.add_child(toolbar);

  return {
    actors: {
      row,
      refreshControl: refreshAction.control,
      settingsControl,
      lastRefreshLabel,
      spinner,
    },
    applyRunning: (running) => refreshAction.setRunning(running),
  };
}

function buildCardsFooter(options: FooterOptions): FooterBuild {
  const row = new PopupMenu.PopupBaseMenuItem({
    reactive: false,
    can_focus: false,
    activate: false,
    hover: false,
  });
  row.add_style_class_name("provider-limits-static-row");
  row.add_style_class_name("pl-panel-footer-row");

  const spinner = createFooterSpinner();
  const refreshIcon = actionIcon("view-refresh-symbolic", "pl-footer-icon");
  const refreshLabel = createLabel(_("Force refresh"), "pl-footer-action-label");
  const refreshChildren: St.Widget[] = [spinner];
  if (refreshIcon) refreshChildren.push(refreshIcon);
  refreshChildren.push(refreshLabel);
  const refreshControl = new St.BoxLayout({
    style_class: "pl-footer-action pl-refresh-action",
    reactive: true,
    can_focus: true,
    track_hover: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  for (const child of refreshChildren) refreshControl.add_child(child);

  const refreshAction = createRefreshControl(spinner, options.onRefresh, options.onFooterKey, {
    control: refreshControl,
    pointerSignal: "button-release-event",
    setText: (text) => {
      refreshLabel.text = text;
      refreshLabel.accessible_name = text;
      refreshControl.accessible_name = text;
    },
    setIconVisible: (visible) => {
      if (refreshIcon) refreshIcon.visible = visible;
    },
    setDisabled: (disabled) => {
      if (disabled) refreshControl.add_style_class_name("pl-footer-action-disabled");
      else refreshControl.remove_style_class_name("pl-footer-action-disabled");
    },
  });

  const settingsIcon = actionIcon("preferences-system-symbolic", "pl-footer-icon");
  const settingsLabel = createLabel(_("Settings"), "pl-footer-action-label");
  const settingsControl = new St.BoxLayout({
    style_class: "pl-footer-action pl-settings-action",
    reactive: true,
    can_focus: true,
    track_hover: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  if (settingsIcon) settingsControl.add_child(settingsIcon);
  settingsControl.add_child(settingsLabel);
  settingsControl.accessible_name = _("Settings");
  bindActivation(
    settingsControl,
    () => {
      options.closeMenu();
      options.openPreferences();
    },
    { pointerSignals: ["button-release-event"], onOtherKey: options.onFooterKey },
  );

  const lastRefreshLabel = new St.Label({
    text: formatTimestampTemplate(_("Last refresh: %s"), null, "en"),
    style_class: "provider-limits-dim pl-footer-timestamp",
    x_expand: true,
    x_align: Clutter.ActorAlign.CENTER,
    y_align: Clutter.ActorAlign.CENTER,
    visible: false,
  });

  const toolbar = new St.BoxLayout({
    style_class: "pl-panel-footer",
    x_expand: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  toolbar.add_child(refreshAction.control);
  toolbar.add_child(lastRefreshLabel);
  toolbar.add_child(settingsControl);
  row.add_child(toolbar);

  return {
    actors: {
      row,
      refreshControl: refreshAction.control,
      settingsControl,
      lastRefreshLabel,
      spinner,
    },
    applyRunning: (running) => refreshAction.setRunning(running),
  };
}

function buildCompactFooter(options: FooterOptions): FooterBuild {
  const row = new PopupMenu.PopupBaseMenuItem({
    reactive: false,
    can_focus: false,
    activate: false,
    hover: false,
  });
  row.add_style_class_name("provider-limits-static-row");
  row.add_style_class_name("provider-limits-hud-toolbar");

  const spinner = createFooterSpinner();
  const refreshIcon = actionIcon("view-refresh-symbolic");
  const refreshChildren: St.Widget[] = [];
  if (refreshIcon) refreshChildren.push(refreshIcon);
  refreshChildren.push(spinner);
  const refreshContent = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
  for (const child of refreshChildren) refreshContent.add_child(child);
  const refreshControl = new St.Button({
    child: refreshContent,
    style_class: "provider-limits-icon-button",
    reactive: true,
    can_focus: true,
    track_hover: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  const refreshAction = createRefreshControl(spinner, options.onRefresh, options.onFooterKey, {
    control: refreshControl,
    pointerSignal: "clicked",
    setText: (text) => {
      refreshControl.accessible_name = text;
    },
  });

  const settingsIcon = actionIcon("emblem-system-symbolic");
  const settingsControl = new St.Button({
    child: settingsIcon ?? undefined,
    style_class: "provider-limits-icon-button",
    reactive: true,
    can_focus: true,
    track_hover: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  settingsControl.accessible_name = _("Settings");
  bindActivation(
    settingsControl,
    () => {
      options.closeMenu();
      options.openPreferences();
    },
    { pointerSignals: ["clicked"], onOtherKey: options.onFooterKey },
  );

  const title = _("Provider Limits");
  const titleLabel = new St.Label({
    text: title,
    style_class: "provider-limits-hud-title",
    y_align: Clutter.ActorAlign.CENTER,
  });
  titleLabel.accessible_name = title;

  const lastRefreshLabel = new St.Label({
    text: "",
    style_class: "provider-limits-hud-meta provider-limits-tnum",
    y_align: Clutter.ActorAlign.CENTER,
    visible: false,
  });

  const leading = new St.BoxLayout({
    style_class: "provider-limits-hud-toolbar-left",
    x_expand: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  leading.add_child(titleLabel);
  leading.add_child(lastRefreshLabel);

  const trailing = new St.BoxLayout({
    style_class: "provider-limits-hud-actions",
    y_align: Clutter.ActorAlign.CENTER,
  });
  for (const control of options.extraControls) trailing.add_child(control);
  trailing.add_child(refreshAction.control);
  trailing.add_child(settingsControl);

  row.add_child(leading);
  row.add_child(trailing);

  return {
    actors: {
      row,
      refreshControl: refreshAction.control,
      settingsControl,
      lastRefreshLabel,
      spinner,
    },
    applyRunning: (running) => refreshAction.setRunning(running),
  };
}

/** One explicit footer per panel style; no shared config spec. */
export function buildPanelFooter(variant: PanelStyle, options: FooterOptions): FooterBuild {
  switch (variant) {
    case "gauges":
      return buildGaugesFooter(options);
    case "cards":
      return buildCardsFooter(options);
    case "compact":
      return buildCompactFooter(options);
    default:
      throw new Error(`Unknown footer variant: ${String(variant)}`);
  }
}
