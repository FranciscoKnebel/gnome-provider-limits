import Clutter from "gi://Clutter";
import type Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import { ensureActorVisibleInScrollView } from "resource:///org/gnome/shell/misc/animationUtils.js";
import { Spinner } from "resource:///org/gnome/shell/ui/animation.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import type { ProviderName } from "../constants.js";
import { formatTimestampTemplate } from "../formatters.js";
import { resolveLocale } from "../helpers/locale.js";
import type { ReaderResult } from "../readers/base.js";
import type { PanelStyle } from "./styles.js";

export interface PanelStyleSection {
  readonly shell: PanelShell;
  render(results: Map<ProviderName, ReaderResult>, lastRefreshAt: number | null): void;
  setRunning(running: boolean): void;
  destroy(): void;
}

export interface CompactToolbarControls {
  readonly titleLabel: St.Label;
  readonly expandAllButton: St.Button;
  readonly expandAllLabel: St.Label;
}

export interface PanelFooterActors {
  readonly row: PopupMenu.PopupBaseMenuItem;
  readonly toolbar: St.BoxLayout;
  readonly refreshControl: St.Widget;
  readonly refreshIcon: St.Icon | null;
  readonly refreshLabel: St.Label | null;
  readonly spinner: Spinner;
  readonly lastRefreshLabel: St.Label;
  readonly settingsControl: St.Widget;
  readonly settingsLabel: St.Label | null;
  readonly compact: CompactToolbarControls | null;
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

function isActivationKey(symbol: number): boolean {
  return (
    symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter || symbol === Clutter.KEY_space
  );
}

/**
 * Shared panel infrastructure: scroll area, body, static rows and footer.
 * Style-specific renderers contribute content only.
 */
export class PanelShell extends PopupMenu.PopupMenuSection {
  private readonly _settings: Gio.Settings;
  private readonly _translate: (message: string) => string;
  private readonly _openPreferences: () => void;
  private readonly _onRefresh: () => void;
  private readonly _closeMenu: () => void;
  private readonly _variant: PanelStyle;
  private readonly _body: PopupMenu.PopupMenuSection;
  private readonly _scroll: St.ScrollView;
  private readonly _footer: PanelFooterActors;
  private _running = false;
  private _footerKeyHandler: (event: Clutter.Event) => boolean;
  private _bodyKeyHandler: ((event: Clutter.Event) => boolean) | null = null;

  constructor(options: PanelShellOptions) {
    super();
    this._settings = options.settings;
    this._translate = options.translate;
    this._openPreferences = options.openPreferences;
    this._onRefresh = options.onRefresh;
    this._closeMenu = options.closeMenu;
    this._variant = options.footerVariant;
    this._footerKeyHandler = options.onFooterKeyPress ?? (() => Clutter.EVENT_PROPAGATE);

    if (this._variant === "gauges") {
      this.box.add_style_class_name("pl-cockpit-panel");
    }

    if (this._variant === "cards") {
      this._footer = this._buildCardsFooter();
    } else if (this._variant === "compact") {
      this._footer = this._buildCompactFooter();
    } else {
      this._footer = this._buildGaugesFooter();
    }
    if (this._variant === "compact") {
      this.addMenuItem(this._footer.row);
    }

    this._body = new PopupMenu.PopupMenuSection();
    this._body.actor.connect("key-press-event", (_actor: Clutter.Actor, event: Clutter.Event) => {
      return this._bodyKeyHandler ? this._bodyKeyHandler(event) : Clutter.EVENT_PROPAGATE;
    });

    const scrollStyle =
      this._variant === "gauges"
        ? "pl-cockpit-scroll"
        : this._variant === "cards"
          ? "pl-panel-scroll"
          : undefined;
    this._scroll = new St.ScrollView({
      overlay_scrollbars: true,
      x_expand: true,
      style_class: scrollStyle,
    });
    this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
    this.addMenuItem(this._body);
    this.box.remove_child(this._body.actor);
    this._scroll.set_child(this._body.actor);
    this.box.add_child(this._scroll);

    this._scroll.connect("notify::mapped", () => {
      if (!this._scroll.mapped) return;
      const monitor = Main.layoutManager.findMonitorForActor(this.actor);
      if (!monitor) return;
      const area = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
      const scale = St.ThemeContext.get_for_stage(this.actor.get_stage()).scale_factor;
      this._scroll.style = `max-height: ${Math.max(1, Math.floor((area.height / scale) * 0.6))}px;`;
    });

    if (this._variant !== "compact") {
      this.addMenuItem(this._footer.row);
    }
  }

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

  setBodyKeyHandler(handler: ((event: Clutter.Event) => boolean) | null): void {
    this._bodyKeyHandler = handler;
  }

  setFooterKeyHandler(handler: (event: Clutter.Event) => boolean): void {
    this._footerKeyHandler = handler;
  }

  getCompactControls(): CompactToolbarControls {
    if (!this._footer.compact) {
      throw new Error("compact toolbar controls are only available for the compact panel style");
    }
    return this._footer.compact;
  }

  setRunning(running: boolean): void {
    this._running = running;
    const footer = this._footer;
    footer.spinner.visible = running;
    if (running) footer.spinner.play();
    else footer.spinner.stop();

    if (footer.refreshIcon) footer.refreshIcon.visible = !running;
    if (footer.refreshLabel) {
      const text = running ? this._translate("Refreshing…") : this._translate("Force refresh");
      footer.refreshLabel.text = text;
      footer.refreshLabel.accessible_name = text;
    }

    footer.refreshControl.reactive = !running;
    if (this._variant === "cards") {
      if (running) footer.refreshControl.add_style_class_name("pl-footer-action-disabled");
      else footer.refreshControl.remove_style_class_name("pl-footer-action-disabled");
    }
    if (this._variant === "compact") {
      footer.refreshControl.accessible_name = running
        ? this._translate("Refreshing…")
        : this._translate("Force refresh");
    }
  }

  setLastRefreshAt(lastRefreshAt: number | null): void {
    const locale = resolveLocale(
      this._settings.get_string("language"),
      GLib.getenv("LC_MESSAGES"),
      GLib.getenv("LANG"),
    );
    const label = this._footer.lastRefreshLabel;
    label.visible = lastRefreshAt !== null;
    label.text = formatTimestampTemplate(
      this._translate("Last refresh: %s"),
      lastRefreshAt,
      locale,
    );
    label.accessible_name = label.text;
  }

  private _createFooterRow(...classes: string[]): PopupMenu.PopupBaseMenuItem {
    const row = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
      activate: false,
      hover: false,
    });
    row.add_style_class_name("provider-limits-static-row");
    for (const cls of classes) row.add_style_class_name(cls);
    return row;
  }

  private _createSpinner(): Spinner {
    const spinner = new Spinner(14, { animate: true, hideOnStop: true });
    spinner.add_style_class_name("provider-limits-refresh-spinner");
    spinner.visible = this._running;
    if (this._running) spinner.play();
    return spinner;
  }

  private _bindActivation(actor: St.Widget, onActivate: () => void): void {
    const activate = () => {
      onActivate();
      return Clutter.EVENT_STOP;
    };
    actor.connect("button-release-event", activate);
    actor.connect("clicked", activate);
    actor.connect("key-press-event", (_actor: Clutter.Actor, event: Clutter.Event) => {
      if (isActivationKey(event.get_key_symbol())) {
        onActivate();
        return Clutter.EVENT_STOP;
      }
      return this._footerKeyHandler(event);
    });
  }

  private _bindSettingsActivation(actor: St.Widget): void {
    this._bindActivation(actor, () => {
      this._closeMenu();
      this._openPreferences();
    });
  }

  private _buildCardsFooter(): PanelFooterActors {
    const row = this._createFooterRow("pl-panel-footer-row");
    const toolbar = new St.BoxLayout({ x_expand: true, style_class: "pl-panel-footer" });

    const refreshControl = new St.BoxLayout({
      reactive: !this._running,
      can_focus: true,
      track_hover: true,
      style_class: "pl-footer-action pl-refresh-action",
      y_align: Clutter.ActorAlign.CENTER,
    });
    refreshControl.accessible_name = this._translate("Force refresh");

    const spinner = this._createSpinner();
    refreshControl.add_child(spinner);

    let refreshIcon: St.Icon | null = null;
    if (typeof St.Icon === "function") {
      refreshIcon = new St.Icon({
        icon_name: "view-refresh-symbolic",
        icon_size: 14,
        style_class: "pl-footer-icon",
        y_align: Clutter.ActorAlign.CENTER,
      });
      refreshIcon.visible = !this._running;
      refreshControl.add_child(refreshIcon);
    }

    const refreshLabel = new St.Label({
      text: this._running ? this._translate("Refreshing…") : this._translate("Force refresh"),
      style_class: "pl-footer-action-label",
      y_align: Clutter.ActorAlign.CENTER,
    });
    refreshLabel.accessible_name = refreshLabel.text;
    refreshControl.add_child(refreshLabel);
    this._bindActivation(refreshControl, () => {
      if (!this._running) this._onRefresh();
    });

    const lastRefreshLabel = new St.Label({
      text: formatTimestampTemplate(this._translate("Last refresh: %s"), null, "en"),
      style_class: "provider-limits-dim pl-footer-timestamp",
      x_expand: true,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    lastRefreshLabel.visible = false;

    const settingsControl = new St.BoxLayout({
      reactive: true,
      can_focus: true,
      track_hover: true,
      style_class: "pl-footer-action pl-settings-action",
      y_align: Clutter.ActorAlign.CENTER,
    });
    settingsControl.accessible_name = this._translate("Settings");
    if (typeof St.Icon === "function") {
      settingsControl.add_child(
        new St.Icon({
          icon_name: "preferences-system-symbolic",
          icon_size: 14,
          style_class: "pl-footer-icon",
          y_align: Clutter.ActorAlign.CENTER,
        }),
      );
    }
    const settingsLabel = new St.Label({
      text: this._translate("Settings"),
      style_class: "pl-footer-action-label",
      y_align: Clutter.ActorAlign.CENTER,
    });
    settingsLabel.accessible_name = settingsLabel.text;
    settingsControl.add_child(settingsLabel);
    this._bindSettingsActivation(settingsControl);

    toolbar.add_child(refreshControl);
    toolbar.add_child(lastRefreshLabel);
    toolbar.add_child(settingsControl);
    row.add_child(toolbar);

    return {
      row,
      toolbar,
      refreshControl,
      refreshIcon,
      refreshLabel,
      spinner,
      lastRefreshLabel,
      settingsControl,
      settingsLabel,
      compact: null,
    };
  }

  private _buildGaugesFooter(): PanelFooterActors {
    const row = this._createFooterRow("pl-footer-row");
    const toolbar = new St.BoxLayout({
      style_class: "pl-footer-toolbar",
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });

    const refreshContent = new St.BoxLayout({
      style_class: "pl-footer-button-box",
      y_align: Clutter.ActorAlign.CENTER,
    });
    const spinner = this._createSpinner();
    const refreshLabel = new St.Label({
      text: this._running ? this._translate("Refreshing…") : this._translate("Force refresh"),
      y_align: Clutter.ActorAlign.CENTER,
    });
    refreshLabel.accessible_name = refreshLabel.text;
    refreshContent.add_child(spinner);
    refreshContent.add_child(refreshLabel);

    const refreshControl = new St.Button({
      style_class: "pl-footer-button pl-refresh-button",
      reactive: !this._running,
      can_focus: true,
      track_hover: true,
      child: refreshContent,
    });
    refreshControl.accessible_name = refreshLabel.text;
    this._bindActivation(refreshControl, () => {
      if (!this._running) this._onRefresh();
    });

    const lastRefreshLabel = new St.Label({
      text: formatTimestampTemplate(this._translate("Last refresh: %s"), null, "en"),
      style_class: "provider-limits-dim pl-footer-timestamp",
      x_expand: true,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    lastRefreshLabel.visible = false;

    const settingsLabel = new St.Label({
      text: this._translate("Settings"),
      y_align: Clutter.ActorAlign.CENTER,
    });
    const settingsControl = new St.Button({
      style_class: "pl-footer-button pl-settings-button",
      reactive: true,
      can_focus: true,
      track_hover: true,
      child: settingsLabel,
    });
    settingsControl.accessible_name = this._translate("Settings");
    this._bindSettingsActivation(settingsControl);

    toolbar.add_child(refreshControl);
    toolbar.add_child(lastRefreshLabel);
    toolbar.add_child(settingsControl);
    row.add_child(toolbar);

    return {
      row,
      toolbar,
      refreshControl,
      refreshIcon: null,
      refreshLabel,
      spinner,
      lastRefreshLabel,
      settingsControl,
      settingsLabel,
      compact: null,
    };
  }

  private _buildCompactFooter(): PanelFooterActors {
    const row = this._createFooterRow("provider-limits-hud-toolbar");
    const toolbar: St.BoxLayout = row;

    const leftBox = new St.BoxLayout({
      style_class: "provider-limits-hud-toolbar-left",
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    const titleLabel = new St.Label({
      text: this._translate("Provider Limits"),
      style_class: "provider-limits-hud-title",
      y_align: Clutter.ActorAlign.CENTER,
    });
    titleLabel.accessible_name = titleLabel.text;
    leftBox.add_child(titleLabel);

    const lastRefreshLabel = new St.Label({
      text: "",
      visible: false,
      style_class: "provider-limits-hud-meta provider-limits-tnum",
      y_align: Clutter.ActorAlign.CENTER,
    });
    leftBox.add_child(lastRefreshLabel);

    const actionsBox = new St.BoxLayout({
      style_class: "provider-limits-hud-actions",
      y_align: Clutter.ActorAlign.CENTER,
    });

    const expandAllLabel = new St.Label({
      text: "▾",
      style_class: "provider-limits-toolbar-glyph",
      y_align: Clutter.ActorAlign.CENTER,
    });
    const expandAllButton = new St.Button({
      child: expandAllLabel,
      style_class: "provider-limits-icon-button",
      reactive: true,
      can_focus: true,
      visible: false,
      y_align: Clutter.ActorAlign.CENTER,
    });
    expandAllButton.accessible_name = this._translate("Expand all");
    actionsBox.add_child(expandAllButton);

    const refreshContent = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
    const refreshIcon = new St.Icon({
      icon_name: "view-refresh-symbolic",
      icon_size: 14,
      y_align: Clutter.ActorAlign.CENTER,
    });
    const spinner = this._createSpinner();
    refreshContent.add_child(refreshIcon);
    refreshContent.add_child(spinner);

    const refreshControl = new St.Button({
      child: refreshContent,
      style_class: "provider-limits-icon-button",
      reactive: !this._running,
      can_focus: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    refreshControl.accessible_name = this._translate("Force refresh");
    this._bindActivation(refreshControl, () => {
      if (!this._running) this._onRefresh();
    });
    actionsBox.add_child(refreshControl);

    const settingsControl = new St.Button({
      child: new St.Icon({
        icon_name: "emblem-system-symbolic",
        icon_size: 14,
        y_align: Clutter.ActorAlign.CENTER,
      }),
      style_class: "provider-limits-icon-button",
      reactive: true,
      can_focus: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    settingsControl.accessible_name = this._translate("Settings");
    this._bindSettingsActivation(settingsControl);
    actionsBox.add_child(settingsControl);

    toolbar.add_child(leftBox);
    toolbar.add_child(actionsBox);

    return {
      row,
      toolbar,
      refreshControl,
      refreshIcon,
      refreshLabel: null,
      spinner,
      lastRefreshLabel,
      settingsControl,
      settingsLabel: null,
      compact: { titleLabel, expandAllButton, expandAllLabel },
    };
  }
}
