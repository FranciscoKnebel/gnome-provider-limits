import Clutter from "gi://Clutter";
import St from "gi://St";
import { Spinner } from "resource:///org/gnome/shell/ui/animation.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

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
export type FooterBuild = { actors: PanelFooterActors; applyRunning: (running: boolean) => void };
export interface FooterOptions {
  readonly extraControls: readonly St.Widget[];
  readonly onRefresh: () => void;
  readonly openPreferences: () => void;
  readonly closeMenu: () => void;
  readonly onFooterKey: (event: Clutter.Event) => boolean;
}

interface FooterSpec {
  readonly rowClass: string;
  readonly pointerSignal: PointerSignal;
  readonly refreshClass: string;
  readonly settingsClass: string;
  readonly layout: "toolbar" | "hud";
  readonly toolbarClass?: string;
  readonly refreshIcon?: readonly [string, string?];
  readonly settingsIcon?: readonly [string, string?];
  readonly labelClass?: string;
  readonly refreshContentClass?: string;
  readonly disabledClass?: string;
  readonly buttonControls?: boolean;
}

const SPECS: Record<PanelStyle, FooterSpec> = {
  gauges: {
    rowClass: "pl-footer-row",
    toolbarClass: "pl-footer-toolbar",
    pointerSignal: "clicked",
    refreshClass: "pl-footer-button pl-refresh-button",
    settingsClass: "pl-footer-button pl-settings-button",
    layout: "toolbar",
    buttonControls: true,
    refreshContentClass: "pl-footer-button-box",
  },
  cards: {
    rowClass: "pl-panel-footer-row",
    toolbarClass: "pl-panel-footer",
    pointerSignal: "button-release-event",
    refreshClass: "pl-footer-action pl-refresh-action",
    settingsClass: "pl-footer-action pl-settings-action",
    layout: "toolbar",
    refreshIcon: ["view-refresh-symbolic", "pl-footer-icon"],
    settingsIcon: ["preferences-system-symbolic", "pl-footer-icon"],
    labelClass: "pl-footer-action-label",
    disabledClass: "pl-footer-action-disabled",
  },
  compact: {
    rowClass: "provider-limits-hud-toolbar",
    pointerSignal: "clicked",
    refreshClass: "provider-limits-icon-button",
    settingsClass: "provider-limits-icon-button",
    layout: "hud",
    buttonControls: true,
    refreshIcon: ["view-refresh-symbolic"],
    settingsIcon: ["emblem-system-symbolic"],
  },
};

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

function icon(spec: readonly [string, string?] | undefined): St.Icon | null {
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

function buildRefresh(
  spec: FooterSpec,
  options: FooterOptions,
  spinner: Spinner,
): { control: St.Widget; setRunning: (running: boolean) => void } {
  const isHud = spec.layout === "hud";
  const refreshIcon = icon(spec.refreshIcon);
  const refreshLabel = isHud ? null : label(_("Force refresh"), spec.labelClass);
  const children: St.Widget[] = [];
  if (refreshIcon && isHud) children.push(refreshIcon);
  children.push(spinner);
  if (refreshIcon && !isHud) children.push(refreshIcon);
  if (refreshLabel) children.push(refreshLabel);

  let control: St.Widget;
  if (spec.buttonControls) {
    const content = new St.BoxLayout({
      ...(spec.refreshContentClass ? { style_class: spec.refreshContentClass } : {}),
      y_align: Clutter.ActorAlign.CENTER,
    });
    for (const child of children) content.add_child(child);
    control = new St.Button({ child: content, style_class: spec.refreshClass, ...ACTION_PROPS });
  } else {
    control = new St.BoxLayout({ style_class: spec.refreshClass, ...ACTION_PROPS });
    for (const child of children) control.add_child(child);
  }

  bindActivation(control, options.onRefresh, {
    pointerSignals: [spec.pointerSignal],
    onOtherKey: options.onFooterKey,
  });
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
    if (refreshIcon && spec.disabledClass) refreshIcon.visible = !running;
    control.reactive = !running;
    if (spec.disabledClass) {
      if (running) control.add_style_class_name(spec.disabledClass);
      else control.remove_style_class_name(spec.disabledClass);
    }
  };
  setRunning(false);
  return { control, setRunning };
}

function buildSettings(spec: FooterSpec, options: FooterOptions): St.Widget {
  const settingsIcon = icon(spec.settingsIcon);
  const settingsLabel = spec.layout === "hud" ? null : label(_("Settings"), spec.labelClass);
  const control = spec.buttonControls
    ? new St.Button({
        child: (spec.layout === "hud" ? settingsIcon : settingsLabel) ?? undefined,
        style_class: spec.settingsClass,
        ...ACTION_PROPS,
      })
    : new St.BoxLayout({ style_class: spec.settingsClass, ...ACTION_PROPS });
  if (!spec.buttonControls) {
    if (settingsIcon) control.add_child(settingsIcon);
    if (settingsLabel) control.add_child(settingsLabel);
  }
  control.accessible_name = _("Settings");
  bindActivation(
    control,
    () => {
      options.closeMenu();
      options.openPreferences();
    },
    { pointerSignals: [spec.pointerSignal], onOtherKey: options.onFooterKey },
  );
  return control;
}

function buildFooter(spec: FooterSpec, options: FooterOptions): FooterBuild {
  const row = footerRow(spec.rowClass);
  const spinner = createSpinner();
  const refresh = buildRefresh(spec, options, spinner);
  const settings = buildSettings(spec, options);
  const lastRefreshLabel = new St.Label({
    text: "",
    style_class:
      spec.layout === "toolbar"
        ? "provider-limits-dim pl-footer-timestamp"
        : "provider-limits-hud-meta provider-limits-tnum",
    ...(spec.layout === "toolbar" ? { x_expand: true, x_align: Clutter.ActorAlign.CENTER } : {}),
    y_align: Clutter.ActorAlign.CENTER,
    visible: false,
  });

  if (spec.layout === "toolbar") {
    const toolbar = new St.BoxLayout({
      style_class: spec.toolbarClass,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    toolbar.add_child(refresh.control);
    toolbar.add_child(lastRefreshLabel);
    toolbar.add_child(settings);
    row.add_child(toolbar);
  } else {
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
    trailing.add_child(refresh.control);
    trailing.add_child(settings);
    row.add_child(leading);
    row.add_child(trailing);
  }

  return {
    actors: {
      row,
      refreshControl: refresh.control,
      settingsControl: settings,
      lastRefreshLabel,
      spinner,
    },
    applyRunning: refresh.setRunning,
  };
}

/** Build the footer for one panel style from the shared descriptor. */
export function buildPanelFooter(variant: PanelStyle, options: FooterOptions): FooterBuild {
  const spec = SPECS[variant];
  if (!spec) throw new Error(`Unknown footer variant: ${String(variant)}`);
  return buildFooter(spec, options);
}
