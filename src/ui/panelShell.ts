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

type ButtonKind = "text" | "icon" | "compactIcon";

interface FooterButtonOptions {
  readonly kind: ButtonKind;
  readonly label: string;
  readonly controlClass: string;
  readonly iconName?: string;
  readonly iconClass?: string;
  readonly labelClass?: string;
  readonly spinner: Spinner | null;
  readonly spinnerFirst?: boolean;
  readonly iconHidesWhenRunning?: boolean;
  readonly disabledRefreshClass?: string;
  readonly isRefresh: boolean;
  readonly pointerSignal: "clicked" | "button-release-event";
  readonly onActivate: () => void;
  readonly onFooterKey: (event: Clutter.Event) => boolean;
}

interface FooterButton {
  readonly control: St.Widget;
  setRunning(running: boolean): void;
}

function runningText(running: boolean): string {
  return running ? _("Refreshing…") : _("Force refresh");
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
  pointerSignal: "clicked" | "button-release-event";
  onActivate: () => void;
  onFooterKey: (event: Clutter.Event) => boolean;
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

  const control = new St.Button({
    child,
    style_class: options.controlClass,
    reactive: true,
    can_focus: true,
    track_hover: true,
    y_align: Clutter.ActorAlign.CENTER,
  });
  bindActivation(control, options.onActivate, {
    pointerSignals: [options.pointerSignal],
    onOtherKey: options.onFooterKey,
  });
  return control;
}

/** One builder for all three footer button variants. */
function buildFooterButton(options: FooterButtonOptions): FooterButton {
  if (options.kind === "icon") {
    const children: St.Widget[] = [];
    const icon = actionIcon(options.iconName ?? "", options.iconClass);
    const label = new St.Label({
      text: options.label,
      ...(options.labelClass !== undefined ? { style_class: options.labelClass } : {}),
      y_align: Clutter.ActorAlign.CENTER,
    });
    label.accessible_name = label.text;
    if (options.spinner !== null && options.spinnerFirst === true) children.push(options.spinner);
    if (icon !== null) children.push(icon);
    if (options.spinner !== null && options.spinnerFirst !== true) children.push(options.spinner);
    children.push(label);

    const control = new St.BoxLayout({
      style_class: options.controlClass,
      reactive: true,
      can_focus: true,
      track_hover: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    for (const item of children) control.add_child(item);
    control.accessible_name = options.label;
    bindActivation(control, options.onActivate, {
      pointerSignals: [options.pointerSignal],
      onOtherKey: options.onFooterKey,
    });

    return {
      control,
      setRunning(running) {
        if (!options.isRefresh) return;
        if (options.iconHidesWhenRunning === true && icon !== null) icon.visible = !running;
        const text = runningText(running);
        label.text = text;
        label.accessible_name = text;
        control.reactive = !running;
        if (options.disabledRefreshClass !== undefined) {
          if (running) control.add_style_class_name(options.disabledRefreshClass);
          else control.remove_style_class_name(options.disabledRefreshClass);
        }
        control.accessible_name = text;
      },
    };
  }

  const children: St.Widget[] = [];
  const icon = options.kind === "compactIcon" ? actionIcon(options.iconName ?? "") : null;
  if (icon !== null) children.push(icon);

  const label = new St.Label({
    text: options.label,
    y_align: Clutter.ActorAlign.CENTER,
  });
  label.accessible_name = label.text;
  if (options.kind === "text" && options.spinner !== null && options.spinnerFirst === true) {
    children.push(options.spinner);
  }
  if (options.kind === "text") children.push(label);
  if (options.kind === "compactIcon" && options.spinner !== null) children.push(options.spinner);

  const control = actionButton({
    children,
    controlClass: options.controlClass,
    ...(options.kind === "text" && options.spinner !== null
      ? { contentClass: "pl-footer-button-box" }
      : {}),
    pointerSignal: options.pointerSignal,
    onActivate: options.onActivate,
    onFooterKey: options.onFooterKey,
  });
  control.accessible_name = options.label;

  return {
    control,
    setRunning(running) {
      if (!options.isRefresh) return;
      control.reactive = !running;
      if (options.kind === "text") {
        const text = runningText(running);
        label.text = text;
        label.accessible_name = text;
        control.accessible_name = text;
      } else {
        control.accessible_name = runningText(running);
      }
    },
  };
}

interface FooterBuild {
  readonly actors: PanelFooterActors;
  readonly applyRunning: (running: boolean) => void;
  readonly insertionIndex: number | undefined;
}

function buildFooter(options: {
  variant: PanelStyle;
  rowClass: string;
  onRefresh: () => void;
  openPreferences: () => void;
  closeMenu: () => void;
  onFooterKey: (event: Clutter.Event) => boolean;
}): FooterBuild {
  const { variant } = options;
  const isCompact = variant === "compact";
  const isGauges = variant === "gauges";

  const row = new PopupMenu.PopupBaseMenuItem({
    reactive: false,
    can_focus: false,
    activate: false,
    hover: false,
  });
  row.add_style_class_name("provider-limits-static-row");
  row.add_style_class_name(options.rowClass);

  const spinner = new Spinner(14, { animate: true, hideOnStop: true });
  spinner.add_style_class_name("provider-limits-refresh-spinner");

  const refresh = buildFooterButton({
    kind: isGauges ? "text" : variant === "cards" ? "icon" : "compactIcon",
    label: _("Force refresh"),
    controlClass: isGauges
      ? "pl-footer-button pl-refresh-button"
      : variant === "cards"
        ? "pl-footer-action pl-refresh-action"
        : "provider-limits-icon-button",
    ...(variant === "cards"
      ? {
          iconName: "view-refresh-symbolic",
          iconClass: "pl-footer-icon",
          labelClass: "pl-footer-action-label",
        }
      : variant === "compact"
        ? { iconName: "view-refresh-symbolic" }
        : {}),
    spinner,
    spinnerFirst: isGauges || variant === "cards",
    ...(variant === "cards"
      ? { iconHidesWhenRunning: true, disabledRefreshClass: "pl-footer-action-disabled" }
      : {}),
    isRefresh: true,
    pointerSignal: variant === "cards" ? "button-release-event" : "clicked",
    onActivate: () => {
      // Running state is checked through applyRunning, which disables the control.
      options.onRefresh();
    },
    onFooterKey: options.onFooterKey,
  });

  const settings = buildFooterButton({
    kind: isGauges ? "text" : variant === "cards" ? "icon" : "compactIcon",
    label: _("Settings"),
    controlClass: isGauges
      ? "pl-footer-button pl-settings-button"
      : variant === "cards"
        ? "pl-footer-action pl-settings-action"
        : "provider-limits-icon-button",
    ...(variant === "cards"
      ? {
          iconName: "preferences-system-symbolic",
          iconClass: "pl-footer-icon",
          labelClass: "pl-footer-action-label",
        }
      : variant === "compact"
        ? { iconName: "emblem-system-symbolic" }
        : {}),
    spinner: null,
    isRefresh: false,
    pointerSignal: variant === "cards" ? "button-release-event" : "clicked",
    onActivate: () => {
      options.closeMenu();
      options.openPreferences();
    },
    onFooterKey: options.onFooterKey,
  });

  const lastRefreshLabel = new St.Label({
    text: isCompact ? "" : formatTimestampTemplate(_("Last refresh: %s"), null, "en"),
    ...(isCompact
      ? { style_class: "provider-limits-hud-meta provider-limits-tnum" }
      : { style_class: "provider-limits-dim pl-footer-timestamp" }),
    ...(isCompact ? {} : { x_expand: true, x_align: Clutter.ActorAlign.CENTER }),
    y_align: Clutter.ActorAlign.CENTER,
    visible: false,
  });

  if (!isCompact) {
    const toolbar = new St.BoxLayout({
      style_class: isGauges ? "pl-footer-toolbar" : "pl-panel-footer",
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    toolbar.add_child(refresh.control);
    toolbar.add_child(lastRefreshLabel);
    toolbar.add_child(settings.control);
    row.add_child(toolbar);
  }

  const applyRunning = (value: boolean): void => {
    spinner.visible = value;
    if (value) spinner.play();
    else spinner.stop();
    refresh.setRunning(value);
  };
  applyRunning(false);

  return {
    actors: {
      row,
      refreshControl: refresh.control,
      settingsControl: settings.control,
      lastRefreshLabel,
      spinner,
    },
    applyRunning,
    insertionIndex: isCompact ? 0 : undefined,
  };
}

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

    const variant = options.footerVariant;
    if (variant === "gauges") this.box.add_style_class_name("pl-cockpit-panel");

    const onFooterKey = (event: Clutter.Event): boolean => this._footerKeyHandler(event);
    const footer = buildFooter({
      variant,
      rowClass:
        variant === "compact"
          ? "provider-limits-hud-toolbar"
          : variant === "cards"
            ? "pl-panel-footer-row"
            : "pl-footer-row",
      onRefresh: () => {
        if (!this.isRunning()) this._onRefresh();
      },
      openPreferences: this._openPreferences,
      closeMenu: this._closeMenu,
      onFooterKey,
    });
    this._footer = footer.actors;
    this._applyFooterRunning = footer.applyRunning;

    this._body = new PopupMenu.PopupMenuSection();
    this._body.actor.connect("key-press-event", (_actor: Clutter.Actor, event: Clutter.Event) => {
      return this._bodyKeyHandler ? this._bodyKeyHandler(event) : Clutter.EVENT_PROPAGATE;
    });

    this._scroll = new St.ScrollView({
      overlay_scrollbars: true,
      x_expand: true,
      style_class:
        variant === "gauges"
          ? "pl-cockpit-scroll"
          : variant === "cards"
            ? "pl-panel-scroll"
            : undefined,
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
