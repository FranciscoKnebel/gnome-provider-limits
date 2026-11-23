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
import type { PanelStyle, StyleDispatch } from "./styles.js";

export interface PanelStyleSection {
  readonly shell: PanelShell;
  render(results: Map<ProviderName, ReaderResult>, lastRefreshAt: number | null): void;
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
  readonly running: boolean;
}

type ActionVariant = "text-button" | "icon-action" | "compact-icon";

interface ActionSpec {
  readonly variant: ActionVariant;
  readonly controlClass: string;
  readonly iconName?: string;
  readonly iconClass?: string;
  readonly labelClass?: string;
  readonly contentClass?: string;
  readonly spinnerFirst?: boolean;
  readonly iconHidesWhenRunning?: boolean;
}

interface ShellConfig {
  readonly panelClass: string | null;
  readonly scrollClass: string | undefined;
  readonly footerRowClass: string;
  readonly toolbarClass: string | null;
  readonly compact: boolean;
  readonly disabledRefreshClass: string | null;
  readonly refresh: ActionSpec;
  readonly settings: ActionSpec;
}

const SHELL_CONFIGS: StyleDispatch<PanelStyle, ShellConfig> = {
  gauges: {
    panelClass: "pl-cockpit-panel",
    scrollClass: "pl-cockpit-scroll",
    footerRowClass: "pl-footer-row",
    toolbarClass: "pl-footer-toolbar",
    compact: false,
    disabledRefreshClass: null,
    refresh: {
      variant: "text-button",
      controlClass: "pl-footer-button pl-refresh-button",
      contentClass: "pl-footer-button-box",
      spinnerFirst: true,
    },
    settings: {
      variant: "text-button",
      controlClass: "pl-footer-button pl-settings-button",
    },
  },
  cards: {
    panelClass: null,
    scrollClass: "pl-panel-scroll",
    footerRowClass: "pl-panel-footer-row",
    toolbarClass: "pl-panel-footer",
    compact: false,
    disabledRefreshClass: "pl-footer-action-disabled",
    refresh: {
      variant: "icon-action",
      controlClass: "pl-footer-action pl-refresh-action",
      iconName: "view-refresh-symbolic",
      iconClass: "pl-footer-icon",
      labelClass: "pl-footer-action-label",
      spinnerFirst: true,
      iconHidesWhenRunning: true,
    },
    settings: {
      variant: "icon-action",
      controlClass: "pl-footer-action pl-settings-action",
      iconName: "preferences-system-symbolic",
      iconClass: "pl-footer-icon",
      labelClass: "pl-footer-action-label",
    },
  },
  compact: {
    panelClass: null,
    scrollClass: undefined,
    footerRowClass: "provider-limits-hud-toolbar",
    toolbarClass: null,
    compact: true,
    disabledRefreshClass: null,
    refresh: {
      variant: "compact-icon",
      controlClass: "provider-limits-icon-button",
      iconName: "view-refresh-symbolic",
    },
    settings: {
      variant: "compact-icon",
      controlClass: "provider-limits-icon-button",
      iconName: "emblem-system-symbolic",
    },
  },
};

interface ActionParts {
  readonly control: St.Widget;
  readonly icon: St.Icon | null;
  readonly label: St.Label | null;
}

interface FooterBuild {
  readonly actors: PanelFooterActors;
  readonly applyRunning: (running: boolean) => void;
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
  private readonly _body: PopupMenu.PopupMenuSection;
  private readonly _scroll: St.ScrollView;
  private readonly _footer: PanelFooterActors;
  private readonly _applyFooterRunning: (running: boolean) => void;
  private _footerKeyHandler: (event: Clutter.Event) => boolean;
  private _bodyKeyHandler: ((event: Clutter.Event) => boolean) | null = null;

  constructor(options: PanelShellOptions) {
    super();
    this._settings = options.settings;
    this._translate = options.translate;
    this._openPreferences = options.openPreferences;
    this._onRefresh = options.onRefresh;
    this._closeMenu = options.closeMenu;
    this._footerKeyHandler = options.onFooterKeyPress ?? (() => Clutter.EVENT_PROPAGATE);

    const config = SHELL_CONFIGS[options.footerVariant];
    if (config.panelClass !== null) this.box.add_style_class_name(config.panelClass);
    const footer = this._buildFooter(config);
    this._footer = footer.actors;
    this._applyFooterRunning = footer.applyRunning;

    this._body = new PopupMenu.PopupMenuSection();
    this._body.actor.connect("key-press-event", (_actor: Clutter.Actor, event: Clutter.Event) => {
      return this._bodyKeyHandler ? this._bodyKeyHandler(event) : Clutter.EVENT_PROPAGATE;
    });

    this._scroll = new St.ScrollView({
      overlay_scrollbars: true,
      x_expand: true,
      style_class: config.scrollClass,
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

    this.addMenuItem(this._footer.row, config.compact ? 0 : undefined);
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

  setBodyKeyHandler(handler: ((event: Clutter.Event) => boolean) | null): void {
    this._bodyKeyHandler = handler;
  }

  setFooterKeyHandler(handler: (event: Clutter.Event) => boolean): void {
    this._footerKeyHandler = handler;
  }

  setRunning(running: boolean): void {
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
    label.text = formatTimestampTemplate(
      this._translate("Last refresh: %s"),
      lastRefreshAt,
      locale,
    );
    label.accessible_name = label.text;
  }

  private _createFooterRow(styleClass: string): PopupMenu.PopupBaseMenuItem {
    const row = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
      activate: false,
      hover: false,
    });
    row.add_style_class_name("provider-limits-static-row");
    row.add_style_class_name(styleClass);
    return row;
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

  /** Shared construction path for both refresh and settings actions, in every style. */
  private _buildAction(options: {
    spec: ActionSpec;
    labelText: string;
    spinner: Spinner | null;
    accessibleName: string;
    onActivate: () => void;
  }): ActionParts {
    const { spec } = options;
    const children: St.Widget[] = [];
    const spinner = options.spinner;

    let icon: St.Icon | null = null;
    if (spec.iconName !== undefined && typeof St.Icon === "function") {
      icon = new St.Icon({
        icon_name: spec.iconName,
        icon_size: 14,
        ...(spec.iconClass !== undefined ? { style_class: spec.iconClass } : {}),
        y_align: Clutter.ActorAlign.CENTER,
      });
    }

    let label: St.Label | null = null;
    if (spec.variant !== "compact-icon") {
      label = new St.Label({
        text: options.labelText,
        ...(spec.labelClass !== undefined ? { style_class: spec.labelClass } : {}),
        y_align: Clutter.ActorAlign.CENTER,
      });
      label.accessible_name = label.text;
    }

    if (spinner !== null && spec.spinnerFirst === true) children.push(spinner);
    if (icon !== null) children.push(icon);
    if (spinner !== null && spec.spinnerFirst !== true) children.push(spinner);
    if (label !== null) children.push(label);

    let control: St.Widget;
    if (spec.variant === "icon-action") {
      control = new St.BoxLayout({
        style_class: spec.controlClass,
        reactive: true,
        can_focus: true,
        track_hover: true,
        y_align: Clutter.ActorAlign.CENTER,
      });
      for (const item of children) control.add_child(item);
    } else {
      let child: St.Widget;
      if (children.length === 1 && spec.contentClass === undefined) {
        child = children[0];
      } else {
        const content = new St.BoxLayout({
          ...(spec.contentClass !== undefined ? { style_class: spec.contentClass } : {}),
          y_align: Clutter.ActorAlign.CENTER,
        });
        for (const item of children) content.add_child(item);
        child = content;
      }
      control = new St.Button({
        child,
        style_class: spec.controlClass,
        reactive: true,
        can_focus: true,
        track_hover: true,
        y_align: Clutter.ActorAlign.CENTER,
      });
    }

    control.accessible_name = options.accessibleName;
    this._bindActivation(control, options.onActivate);
    return { control, icon, label };
  }

  private _buildFooter(config: ShellConfig): FooterBuild {
    let running = false;
    const row = this._createFooterRow(config.footerRowClass);

    const spinner = new Spinner(14, { animate: true, hideOnStop: true });
    spinner.add_style_class_name("provider-limits-refresh-spinner");

    const refresh = this._buildAction({
      spec: config.refresh,
      labelText: this._translate("Force refresh"),
      spinner,
      accessibleName: this._translate("Force refresh"),
      onActivate: () => {
        if (!running) this._onRefresh();
      },
    });

    const settings = this._buildAction({
      spec: config.settings,
      labelText: this._translate("Settings"),
      spinner: null,
      accessibleName: this._translate("Settings"),
      onActivate: () => {
        this._closeMenu();
        this._openPreferences();
      },
    });

    const lastRefreshLabel = config.compact
      ? new St.Label({
          text: "",
          visible: false,
          style_class: "provider-limits-hud-meta provider-limits-tnum",
          y_align: Clutter.ActorAlign.CENTER,
        })
      : new St.Label({
          text: formatTimestampTemplate(this._translate("Last refresh: %s"), null, "en"),
          style_class: "provider-limits-dim pl-footer-timestamp",
          x_expand: true,
          x_align: Clutter.ActorAlign.CENTER,
          y_align: Clutter.ActorAlign.CENTER,
          visible: false,
        });

    const applyRunning = (value: boolean): void => {
      running = value;
      spinner.visible = value;
      if (value) spinner.play();
      else spinner.stop();
      if (config.refresh.iconHidesWhenRunning === true && refresh.icon) {
        refresh.icon.visible = !value;
      }
      if (refresh.label) {
        const text = value ? this._translate("Refreshing…") : this._translate("Force refresh");
        refresh.label.text = text;
        refresh.label.accessible_name = text;
      }
      refresh.control.reactive = !value;
      if (config.disabledRefreshClass !== null) {
        if (value) refresh.control.add_style_class_name(config.disabledRefreshClass);
        else refresh.control.remove_style_class_name(config.disabledRefreshClass);
      }
      refresh.control.accessible_name = value
        ? this._translate("Refreshing…")
        : this._translate("Force refresh");
    };
    applyRunning(false);

    if (!config.compact) {
      const toolbar = new St.BoxLayout({
        style_class: config.toolbarClass ?? undefined,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      });
      toolbar.add_child(refresh.control);
      toolbar.add_child(lastRefreshLabel);
      toolbar.add_child(settings.control);
    }

    return {
      actors: {
        row,
        refreshControl: refresh.control,
        settingsControl: settings.control,
        lastRefreshLabel,
        spinner,
        get running() {
          return running;
        },
      },
      applyRunning,
    };
  }
}
