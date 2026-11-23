import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import { ensureActorVisibleInScrollView } from "resource:///org/gnome/shell/misc/animationUtils.js";
import { Spinner } from "resource:///org/gnome/shell/ui/animation.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { formatTimestampTemplate } from "../formatters.js";
import { gettext as _ } from "../helpers/gettext.js";
import { bindActivation } from "../helpers/keyboard.js";
import { resolveLocale } from "../helpers/locale.js";
import { setScrollViewChild } from "../helpers/scroll.js";
import type { PanelStyle } from "./styles.js";
import type { ProviderViewContext } from "./viewContext.js";

/** Single render argument shared by every panel style section. */
export interface PanelRenderContext {
  readonly lastRefreshAt: number | null;
  readonly view: ProviderViewContext;
}

export interface PanelStyleSection {
  readonly shell: PanelShell;
  render(context: PanelRenderContext): void;
  setRunning(running: boolean): void;
  destroy(): void;
}

/** Shared footer actors exposed to the style sections after construction. */
export interface PanelFooterActors {
  readonly row: PopupMenu.PopupBaseMenuItem;
  readonly refreshControl: St.Widget;
  readonly settingsControl: St.Widget;
  readonly lastRefreshLabel: St.Label;
  readonly spinner: Spinner;
}

type PointerSignal = "clicked" | "button-release-event";

interface FooterAction {
  readonly control: St.Widget;
  setRunning(running: boolean): void;
}

interface FooterIconSpec {
  readonly name: string;
  readonly styleClass?: string;
}

interface FooterControlSpec {
  readonly factory: "button" | "box";
  readonly refreshClass: string;
  readonly settingsClass: string;
  readonly refreshIcon?: FooterIconSpec;
  readonly settingsIcon?: FooterIconSpec;
  readonly refreshIconBeforeSpinner?: boolean;
  readonly refreshLabel: boolean;
  readonly settingsLabel: boolean;
  readonly labelClass?: string;
  readonly refreshContentClass?: string;
  readonly disabledClass?: string;
  readonly syncIconVisibility?: boolean;
}

/** Every difference between footer styles, assembled by the one buildFooter. */
export interface FooterConfig {
  readonly style: PanelStyle;
  readonly rowClass: string;
  readonly shellClass: string | null;
  readonly scrollClass: string | undefined;
  readonly insertionIndex: number | undefined;
  readonly layout: "toolbar" | "split";
  readonly toolbarClass?: string;
  readonly leadingClass?: string;
  readonly trailingClass?: string;
  readonly title?: string;
  readonly titleClass?: string;
  readonly timestampClass: string;
  readonly timestampExpanded: boolean;
  readonly pointerSignal: PointerSignal;
  readonly control: FooterControlSpec;
  readonly extraControls: readonly St.Widget[];
  readonly onRefresh: () => void;
  readonly openPreferences: () => void;
  readonly closeMenu: () => void;
  readonly onFooterKey: (event: Clutter.Event) => boolean;
}

type FooterSpec = Omit<
  FooterConfig,
  "extraControls" | "onRefresh" | "openPreferences" | "closeMenu" | "onFooterKey"
>;

const FOOTER_SPECS: Record<PanelStyle, FooterSpec> = {
  gauges: {
    style: "gauges",
    rowClass: "pl-footer-row",
    shellClass: "pl-cockpit-panel",
    scrollClass: "pl-cockpit-scroll",
    insertionIndex: undefined,
    layout: "toolbar",
    toolbarClass: "pl-footer-toolbar",
    timestampClass: "provider-limits-dim pl-footer-timestamp",
    timestampExpanded: true,
    pointerSignal: "clicked",
    control: {
      factory: "button",
      refreshClass: "pl-footer-button pl-refresh-button",
      settingsClass: "pl-footer-button pl-settings-button",
      refreshContentClass: "pl-footer-button-box",
      refreshLabel: true,
      settingsLabel: true,
    },
  },
  cards: {
    style: "cards",
    rowClass: "pl-panel-footer-row",
    shellClass: null,
    scrollClass: "pl-panel-scroll",
    insertionIndex: undefined,
    layout: "toolbar",
    toolbarClass: "pl-panel-footer",
    timestampClass: "provider-limits-dim pl-footer-timestamp",
    timestampExpanded: true,
    pointerSignal: "button-release-event",
    control: {
      factory: "box",
      refreshClass: "pl-footer-action pl-refresh-action",
      settingsClass: "pl-footer-action pl-settings-action",
      refreshIcon: { name: "view-refresh-symbolic", styleClass: "pl-footer-icon" },
      settingsIcon: { name: "preferences-system-symbolic", styleClass: "pl-footer-icon" },
      labelClass: "pl-footer-action-label",
      refreshLabel: true,
      settingsLabel: true,
      disabledClass: "pl-footer-action-disabled",
      syncIconVisibility: true,
    },
  },
  compact: {
    style: "compact",
    rowClass: "provider-limits-hud-toolbar",
    shellClass: null,
    scrollClass: undefined,
    insertionIndex: 0,
    layout: "split",
    leadingClass: "provider-limits-hud-toolbar-left",
    trailingClass: "provider-limits-hud-actions",
    title: "Provider Limits",
    titleClass: "provider-limits-hud-title",
    timestampClass: "provider-limits-hud-meta provider-limits-tnum",
    timestampExpanded: false,
    pointerSignal: "clicked",
    control: {
      factory: "button",
      refreshClass: "provider-limits-icon-button",
      settingsClass: "provider-limits-icon-button",
      refreshIcon: { name: "view-refresh-symbolic" },
      settingsIcon: { name: "emblem-system-symbolic" },
      refreshIconBeforeSpinner: true,
      refreshLabel: false,
      settingsLabel: false,
    },
  },
};

interface FooterBuild {
  readonly actors: PanelFooterActors;
  readonly applyRunning: (running: boolean) => void;
  readonly shellClass: string | null;
  readonly scrollClass: string | undefined;
  readonly insertionIndex: number | undefined;
}

function runningText(running: boolean): string {
  return running ? _("Refreshing…") : _("Force refresh");
}

function createFooterRow(rowClass: string): PopupMenu.PopupBaseMenuItem {
  const row = new PopupMenu.PopupBaseMenuItem({
    reactive: false,
    can_focus: false,
    activate: false,
    hover: false,
  });
  row.add_style_class_name("provider-limits-static-row");
  row.add_style_class_name(rowClass);
  return row;
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

function actionButton(options: {
  children: readonly St.Widget[];
  controlClass: string;
  contentClass?: string;
}): St.Button {
  let child: St.Widget;
  if (options.children.length === 1 && options.contentClass === undefined) {
    child = options.children[0];
  } else {
    const content = new St.BoxLayout({
      ...(options.contentClass !== undefined ? { style_class: options.contentClass } : {}),
      y_align: Clutter.ActorAlign.CENTER,
    });
    for (const item of options.children) content.add_child(item);
    child = content;
  }

  return new St.Button({
    child,
    style_class: options.controlClass,
    reactive: true,
    can_focus: true,
    track_hover: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
}

function actionBox(options: {
  children: readonly St.Widget[];
  controlClass: string;
}): St.BoxLayout {
  const control = new St.BoxLayout({
    style_class: options.controlClass,
    reactive: true,
    can_focus: true,
    track_hover: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  for (const child of options.children) control.add_child(child);
  return control;
}

function bindFooterActivation(
  control: St.Widget,
  onActivate: () => void,
  pointerSignal: PointerSignal,
  onFooterKey: (event: Clutter.Event) => boolean,
): void {
  bindActivation(control, onActivate, {
    pointerSignals: [pointerSignal],
    onOtherKey: onFooterKey,
  });
}

function createTimestamp(styleClass: string, expanded: boolean): St.Label {
  return new St.Label({
    text: expanded ? formatTimestampTemplate(_("Last refresh: %s"), null, "en") : "",
    style_class: styleClass,
    ...(expanded ? { x_expand: true, x_align: Clutter.ActorAlign.CENTER } : {}),
    y_align: Clutter.ActorAlign.CENTER,
    visible: false,
  });
}

interface RefreshHooks {
  readonly control: St.Widget;
  readonly pointerSignal: PointerSignal;
  setText(text: string): void;
  setIconVisible?(visible: boolean): void;
  setDisabled?(disabled: boolean): void;
}

/** The one place that owns refresh spinner, text and running state. */
function createRefreshControl(
  spinner: Spinner,
  onActivate: () => void,
  onKey: (event: Clutter.Event) => boolean,
  hooks: RefreshHooks,
): FooterAction {
  bindFooterActivation(hooks.control, onActivate, hooks.pointerSignal, onKey);

  const setRunning = (running: boolean): void => {
    spinner.visible = running;
    if (running) spinner.play();
    else spinner.stop();
    hooks.setText(runningText(running));
    hooks.setIconVisible?.(!running);
    hooks.control.reactive = !running;
    hooks.setDisabled?.(running);
  };
  setRunning(false);

  return { control: hooks.control, setRunning };
}

function createActionWidget(
  spec: FooterControlSpec,
  children: readonly St.Widget[],
  controlClass: string,
  contentClass?: string,
): St.Widget {
  return spec.factory === "button"
    ? actionButton({ children, controlClass, contentClass })
    : actionBox({ children, controlClass });
}

function createFooterRefresh(config: FooterConfig, spinner: Spinner): FooterAction {
  const spec = config.control;
  const icon = spec.refreshIcon
    ? actionIcon(spec.refreshIcon.name, spec.refreshIcon.styleClass)
    : null;
  const label = spec.refreshLabel ? createLabel(_("Force refresh"), spec.labelClass) : null;
  const children: St.Widget[] = [];
  if (icon && spec.refreshIconBeforeSpinner) children.push(icon);
  children.push(spinner);
  if (icon && !spec.refreshIconBeforeSpinner) children.push(icon);
  if (label) children.push(label);

  const control = createActionWidget(spec, children, spec.refreshClass, spec.refreshContentClass);
  const disabledClass = spec.disabledClass;
  return createRefreshControl(spinner, config.onRefresh, config.onFooterKey, {
    control,
    pointerSignal: config.pointerSignal,
    setText: (text) => {
      if (label) {
        label.text = text;
        label.accessible_name = text;
      }
      control.accessible_name = text;
    },
    ...(spec.syncIconVisibility && icon
      ? {
          setIconVisible: (visible: boolean) => {
            icon.visible = visible;
          },
        }
      : {}),
    ...(disabledClass !== undefined
      ? {
          setDisabled: (disabled: boolean) => {
            if (disabled) control.add_style_class_name(disabledClass);
            else control.remove_style_class_name(disabledClass);
          },
        }
      : {}),
  });
}

function createFooterSettings(config: FooterConfig): St.Widget {
  const spec = config.control;
  const icon = spec.settingsIcon
    ? actionIcon(spec.settingsIcon.name, spec.settingsIcon.styleClass)
    : null;
  const label = spec.settingsLabel ? createLabel(_("Settings"), spec.labelClass) : null;
  const children: St.Widget[] = [];
  if (icon) children.push(icon);
  if (label) children.push(label);

  const control = createActionWidget(spec, children, spec.settingsClass);
  control.accessible_name = _("Settings");
  bindFooterActivation(
    control,
    () => {
      config.closeMenu();
      config.openPreferences();
    },
    config.pointerSignal,
    config.onFooterKey,
  );
  return control;
}

function buildFooter(config: FooterConfig): FooterBuild {
  const row = createFooterRow(config.rowClass);
  const spinner = createFooterSpinner();
  const refresh = createFooterRefresh(config, spinner);
  const settings = createFooterSettings(config);
  const lastRefreshLabel = createTimestamp(config.timestampClass, config.timestampExpanded);

  if (config.layout === "split") {
    const leading = new St.BoxLayout({
      ...(config.leadingClass !== undefined ? { style_class: config.leadingClass } : {}),
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    if (config.title !== undefined && config.titleClass !== undefined) {
      const title = _(config.title);
      const titleLabel = new St.Label({
        text: title,
        style_class: config.titleClass,
        y_align: Clutter.ActorAlign.CENTER,
      });
      titleLabel.accessible_name = title;
      leading.add_child(titleLabel);
    }
    leading.add_child(lastRefreshLabel);

    const trailing = new St.BoxLayout({
      ...(config.trailingClass !== undefined ? { style_class: config.trailingClass } : {}),
      y_align: Clutter.ActorAlign.CENTER,
    });
    for (const control of config.extraControls) trailing.add_child(control);
    trailing.add_child(refresh.control);
    trailing.add_child(settings);

    row.add_child(leading);
    row.add_child(trailing);
  } else {
    const toolbar = new St.BoxLayout({
      ...(config.toolbarClass !== undefined ? { style_class: config.toolbarClass } : {}),
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    toolbar.add_child(refresh.control);
    toolbar.add_child(lastRefreshLabel);
    toolbar.add_child(settings);
    row.add_child(toolbar);
  }

  return {
    actors: {
      row,
      refreshControl: refresh.control,
      settingsControl: settings,
      lastRefreshLabel,
      spinner,
    },
    applyRunning: (running) => refresh.setRunning(running),
    shellClass: config.shellClass,
    scrollClass: config.scrollClass,
    insertionIndex: config.insertionIndex,
  };
}

export interface PanelShellOptions {
  settings: Gio.Settings;
  openPreferences: () => void;
  onRefresh: () => void;
  closeMenu: () => void;
  translate: (message: string) => string;
  footerVariant: PanelStyle;
  extraControls?: readonly St.Widget[];
  onFooterKeyPress?: (event: Clutter.Event) => boolean;
}

/**
 * Shared panel infrastructure: scroll area, body, static rows and footer.
 * Style-specific renderers contribute content only.
 */
export class PanelShell extends PopupMenu.PopupMenuSection {
  private readonly _settings: Gio.Settings;
  private readonly _openPreferences: () => void;
  private readonly _onRefresh: () => void;
  private readonly _closeMenu: () => void;
  private readonly _body: PopupMenu.PopupMenuSection;
  private readonly _scroll: St.ScrollView;
  private readonly _footer: PanelFooterActors;
  private readonly _applyFooterRunning: (running: boolean) => void;
  private _footerKeyHandler: (event: Clutter.Event) => boolean;
  private _bodyKeyHandler: ((event: Clutter.Event) => boolean) | null = null;
  private _running = false;

  constructor(options: PanelShellOptions) {
    super();
    this._settings = options.settings;
    this._openPreferences = options.openPreferences;
    this._onRefresh = options.onRefresh;
    this._closeMenu = options.closeMenu;
    this._footerKeyHandler = options.onFooterKeyPress ?? (() => Clutter.EVENT_PROPAGATE);

    const onFooterKey = (event: Clutter.Event): boolean => this._footerKeyHandler(event);
    const config: FooterConfig = {
      ...FOOTER_SPECS[options.footerVariant],
      extraControls: options.extraControls ?? [],
      onRefresh: () => {
        if (!this.isRunning()) this._onRefresh();
      },
      openPreferences: this._openPreferences,
      closeMenu: this._closeMenu,
      onFooterKey,
    };
    const footer = buildFooter(config);
    if (footer.shellClass !== null) this.box.add_style_class_name(footer.shellClass);

    this._footer = footer.actors;
    this._applyFooterRunning = footer.applyRunning;

    this._body = new PopupMenu.PopupMenuSection();
    this._body.actor.connect("key-press-event", (_actor: Clutter.Actor, event: Clutter.Event) => {
      return this._bodyKeyHandler ? this._bodyKeyHandler(event) : Clutter.EVENT_PROPAGATE;
    });

    this._scroll = new St.ScrollView({
      overlay_scrollbars: true,
      x_expand: true,
      ...(footer.scrollClass !== undefined ? { style_class: footer.scrollClass } : {}),
    });
    this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
    this.addMenuItem(this._body);
    this.box.remove_child(this._body.actor);
    setScrollViewChild(this._scroll, this._body.actor);
    this.box.add_child(this._scroll);

    this._scroll.connect("notify::mapped", () => {
      if (!this._scroll.mapped) return;
      const monitor = Main.layoutManager.findMonitorForActor(this.actor);
      if (!monitor) return;
      const area = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
      const scale = St.ThemeContext.get_for_stage(this.actor.get_stage()).scale_factor;
      this._scroll.style = `max-height: ${Math.max(1, Math.floor((area.height / scale) * 0.6))}px;`;
    });

    this.addMenuItem(this._footer.row, footer.insertionIndex);
  }

  /** Shared footer row and action actors. No style-specific controls live here. */
  get footer(): Readonly<PanelFooterActors> {
    return this._footer;
  }

  get scrollView(): St.ScrollView {
    return this._scroll;
  }

  override destroy(): void {
    this._body.destroy();
    super.destroy();
  }

  addHeaderItem(item: PopupMenu.PopupBaseMenuItem): void {
    this.addMenuItem(item, 0);
  }

  addBodyItem(item: PopupMenu.PopupBaseMenuItem): void {
    this._body.addMenuItem(item);
  }

  clearBody(): void {
    this._body.removeAll();
  }

  addStaticRow(): PopupMenu.PopupBaseMenuItem {
    const row = new PopupMenu.PopupBaseMenuItem({
      reactive: true,
      can_focus: true,
      activate: false,
      hover: false,
    });
    row.add_style_class_name("provider-limits-static-row");
    row.connect("key-focus-in", () => ensureActorVisibleInScrollView(this._scroll, row));
    return row;
  }

  /** Shared empty-state row. Returns the title label for in-place text updates. */
  addEmptyStateRow(title: string, subtitle?: string): St.Label {
    const row = this.addStaticRow();
    const box = new St.BoxLayout({
      vertical: true,
      x_expand: true,
      style_class: "pl-empty-state",
    });

    const titleLabel = new St.Label({
      text: title,
      style_class: "pl-empty-title",
      x_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
    });
    titleLabel.clutter_text.line_wrap = true;
    titleLabel.accessible_name = title;
    box.add_child(titleLabel);

    if (subtitle !== undefined) {
      const subtitleLabel = new St.Label({
        text: subtitle,
        style_class: "provider-limits-dim pl-empty-subtitle",
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      subtitleLabel.clutter_text.line_wrap = true;
      subtitleLabel.accessible_name = subtitle;
      box.add_child(subtitleLabel);
    }

    row.add_child(box);
    this.addBodyItem(row);
    return titleLabel;
  }

  setBodyKeyHandler(handler: ((event: Clutter.Event) => boolean) | null): void {
    this._bodyKeyHandler = handler;
  }

  setFooterKeyHandler(handler: (event: Clutter.Event) => boolean): void {
    this._footerKeyHandler = handler;
  }

  isRunning(): boolean {
    return this._running;
  }

  setRunning(running: boolean): void {
    this._running = running;
    this._applyFooterRunning(running);
  }

  setLastRefreshAt(lastRefreshAt: number | null): void {
    const locale = resolveLocale(
      this._settings.get_string("language"),
      GLib.getenv("LC_MESSAGES"),
      GLib.getenv("LANG"),
    );
    const label = this._footer.lastRefreshLabel;
    label.visible = lastRefreshAt !== null;
    label.text = formatTimestampTemplate(_("Last refresh: %s"), lastRefreshAt, locale);
    label.accessible_name = label.text;
  }
}
