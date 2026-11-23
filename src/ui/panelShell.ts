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

/**
 * Shared footer actors only. Compact layout containers and their title and
 * expand-all controls are owned by CompactPanelSection.
 */
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

interface FooterBuild {
  readonly actors: PanelFooterActors;
  readonly applyRunning: (running: boolean) => void;
  readonly shellClass: string | null;
  readonly scrollClass: string | undefined;
  readonly insertionIndex: number | undefined;
}

interface FooterBuilderOptions {
  readonly onRefresh: () => void;
  readonly openPreferences: () => void;
  readonly closeMenu: () => void;
  readonly onFooterKey: (event: Clutter.Event) => boolean;
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

function buildGaugesFooter(options: FooterBuilderOptions): FooterBuild {
  const row = createFooterRow("pl-footer-row");
  const spinner = createFooterSpinner();
  const label = createLabel(_("Force refresh"));
  const control = actionButton({
    children: [spinner, label],
    controlClass: "pl-footer-button pl-refresh-button",
    contentClass: "pl-footer-button-box",
  });
  const refresh = createRefreshControl(spinner, options.onRefresh, options.onFooterKey, {
    control,
    pointerSignal: "clicked",
    setText: (text) => {
      label.text = text;
      label.accessible_name = text;
      control.accessible_name = text;
    },
  });

  const settingsLabel = createLabel(_("Settings"));
  const settings = actionButton({
    children: [settingsLabel],
    controlClass: "pl-footer-button pl-settings-button",
  });
  settings.accessible_name = _("Settings");
  bindFooterActivation(
    settings,
    () => {
      options.closeMenu();
      options.openPreferences();
    },
    "clicked",
    options.onFooterKey,
  );

  const lastRefreshLabel = createTimestamp("provider-limits-dim pl-footer-timestamp", true);
  const toolbar = new St.BoxLayout({
    style_class: "pl-footer-toolbar",
    x_expand: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  toolbar.add_child(refresh.control);
  toolbar.add_child(lastRefreshLabel);
  toolbar.add_child(settings);
  row.add_child(toolbar);

  return {
    actors: {
      row,
      refreshControl: refresh.control,
      settingsControl: settings,
      lastRefreshLabel,
      spinner,
    },
    applyRunning: (running) => refresh.setRunning(running),
    shellClass: "pl-cockpit-panel",
    scrollClass: "pl-cockpit-scroll",
    insertionIndex: undefined,
  };
}

function buildCardsFooter(options: FooterBuilderOptions): FooterBuild {
  const row = createFooterRow("pl-panel-footer-row");
  const spinner = createFooterSpinner();
  const icon = actionIcon("view-refresh-symbolic", "pl-footer-icon");
  const label = createLabel(_("Force refresh"), "pl-footer-action-label");
  const control = actionBox({
    children: icon ? [spinner, icon, label] : [spinner, label],
    controlClass: "pl-footer-action pl-refresh-action",
  });
  const refresh = createRefreshControl(spinner, options.onRefresh, options.onFooterKey, {
    control,
    pointerSignal: "button-release-event",
    setText: (text) => {
      label.text = text;
      label.accessible_name = text;
      control.accessible_name = text;
    },
    setIconVisible: (visible) => {
      if (icon) icon.visible = visible;
    },
    setDisabled: (disabled) => {
      if (disabled) control.add_style_class_name("pl-footer-action-disabled");
      else control.remove_style_class_name("pl-footer-action-disabled");
    },
  });

  const settingsIcon = actionIcon("preferences-system-symbolic", "pl-footer-icon");
  const settingsLabel = createLabel(_("Settings"), "pl-footer-action-label");
  const settings = actionBox({
    children: settingsIcon ? [settingsIcon, settingsLabel] : [settingsLabel],
    controlClass: "pl-footer-action pl-settings-action",
  });
  settings.accessible_name = _("Settings");
  bindFooterActivation(
    settings,
    () => {
      options.closeMenu();
      options.openPreferences();
    },
    "button-release-event",
    options.onFooterKey,
  );

  const lastRefreshLabel = createTimestamp("provider-limits-dim pl-footer-timestamp", true);
  const toolbar = new St.BoxLayout({
    style_class: "pl-panel-footer",
    x_expand: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  toolbar.add_child(refresh.control);
  toolbar.add_child(lastRefreshLabel);
  toolbar.add_child(settings);
  row.add_child(toolbar);

  return {
    actors: {
      row,
      refreshControl: refresh.control,
      settingsControl: settings,
      lastRefreshLabel,
      spinner,
    },
    applyRunning: (running) => refresh.setRunning(running),
    shellClass: null,
    scrollClass: "pl-panel-scroll",
    insertionIndex: undefined,
  };
}

function buildCompactFooter(options: FooterBuilderOptions): FooterBuild {
  const row = createFooterRow("provider-limits-hud-toolbar");
  const spinner = createFooterSpinner();
  const icon = actionIcon("view-refresh-symbolic");
  const control = actionButton({
    children: icon ? [icon, spinner] : [spinner],
    controlClass: "provider-limits-icon-button",
  });
  const refresh = createRefreshControl(spinner, options.onRefresh, options.onFooterKey, {
    control,
    pointerSignal: "clicked",
    setText: (text) => {
      control.accessible_name = text;
    },
  });

  const settingsIcon = actionIcon("emblem-system-symbolic");
  const settings = actionButton({
    children: settingsIcon ? [settingsIcon] : [],
    controlClass: "provider-limits-icon-button",
  });
  settings.accessible_name = _("Settings");
  bindFooterActivation(
    settings,
    () => {
      options.closeMenu();
      options.openPreferences();
    },
    "clicked",
    options.onFooterKey,
  );

  return {
    actors: {
      row,
      refreshControl: refresh.control,
      settingsControl: settings,
      lastRefreshLabel: createTimestamp("provider-limits-hud-meta provider-limits-tnum", false),
      spinner,
    },
    applyRunning: (running) => refresh.setRunning(running),
    shellClass: null,
    scrollClass: undefined,
    insertionIndex: 0,
  };
}

const FOOTER_BUILDERS: Record<PanelStyle, (options: FooterBuilderOptions) => FooterBuild> = {
  gauges: buildGaugesFooter,
  cards: buildCardsFooter,
  compact: buildCompactFooter,
};

export interface PanelShellOptions {
  settings: Gio.Settings;
  openPreferences: () => void;
  onRefresh: () => void;
  closeMenu: () => void;
  translate: (message: string) => string;
  footerVariant: PanelStyle;
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
    const footer = FOOTER_BUILDERS[options.footerVariant]({
      onRefresh: () => {
        if (!this.isRunning()) this._onRefresh();
      },
      openPreferences: this._openPreferences,
      closeMenu: this._closeMenu,
      onFooterKey,
    });
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
