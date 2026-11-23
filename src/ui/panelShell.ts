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
import {
  PANEL_FOOTER_SPECS,
  type PanelFooterActionSpec,
  type PanelFooterSpec,
  type PanelStyle,
} from "./styles.js";

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

interface FooterActors {
  readonly row: PopupMenu.PopupBaseMenuItem;
  readonly toolbar: St.BoxLayout;
  readonly refreshControl: St.Widget;
  readonly refreshIcon: St.Icon | null;
  readonly refreshLabel: St.Label | null;
  readonly spinner: Spinner;
  readonly lastRefreshLabel: St.Label;
  readonly settingsControl: St.Widget;
  readonly settingsLabel: St.Label | null;
  readonly running: boolean;
  setRunning(running: boolean): void;
}

/** Footer of a non-compact panel. Compact toolbar controls are not reachable here. */
export type StandardPanelFooter = FooterActors & { readonly kind: "standard" };

/** Footer of the compact panel, carrying the toolbar controls owned by the compact section. */
export type CompactPanelFooter = FooterActors & {
  readonly kind: "compact";
  readonly controls: CompactToolbarControls;
};

/** Discriminated footer model: compact controls exist only on the compact branch. */
export type PanelFooter = StandardPanelFooter | CompactPanelFooter;

/** Backwards-compatible alias for consumers of the old actor bundle. */
export type PanelFooterActors = PanelFooter;

/** Type guard for narrowing the public footer accessor by kind. */
export function isCompactFooter(footer: PanelFooter): footer is CompactPanelFooter {
  return footer.kind === "compact";
}

interface ActionParts {
  readonly control: St.Widget;
  readonly icon: St.Icon | null;
  readonly label: St.Label | null;
}

let inertCompactControls: CompactToolbarControls | null = null;

function getInertCompactControls(): CompactToolbarControls {
  if (inertCompactControls === null) {
    const expandAllLabel = new St.Label({ text: "", visible: false });
    inertCompactControls = {
      titleLabel: new St.Label({ text: "", visible: false }),
      expandAllButton: new St.Button({ child: expandAllLabel, visible: false }),
      expandAllLabel,
    };
  }
  return inertCompactControls;
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
  private readonly _footer: PanelFooter;
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

    const spec = PANEL_FOOTER_SPECS[options.footerVariant];
    if (spec.panelClass !== null) this.box.add_style_class_name(spec.panelClass);
    this._footer = this._buildFooter(spec);

    this._body = new PopupMenu.PopupMenuSection();
    this._body.actor.connect("key-press-event", (_actor: Clutter.Actor, event: Clutter.Event) => {
      return this._bodyKeyHandler ? this._bodyKeyHandler(event) : Clutter.EVENT_PROPAGATE;
    });

    this._scroll = new St.ScrollView({
      overlay_scrollbars: true,
      x_expand: true,
      style_class: spec.scrollClass,
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

    this.addMenuItem(this._footer.row, spec.footerAboveBody ? 0 : undefined);
  }

  /** Public accessor: narrow with `footer.kind` before touching compact-only controls. */
  get footer(): Readonly<PanelFooter> {
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

  /**
   * Compatibility shim for the compact section. New code should narrow `footer`
   * with `isCompactFooter()` instead. Non-compact shells receive inert controls.
   */
  getCompactControls(): CompactToolbarControls {
    const footer = this._footer;
    return isCompactFooter(footer) ? footer.controls : getInertCompactControls();
  }

  setRunning(running: boolean): void {
    this._footer.setRunning(running);
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
    spec: PanelFooterActionSpec;
    labelText: string;
    spinner: Spinner | null;
    accessibleName: string;
    onActivate: () => void;
  }): ActionParts {
    const { spec } = options;
    const children: St.Widget[] = [];
    const spinner = options.spinner;

    let icon: St.Icon | null = null;
    if (spec.iconName !== null && typeof St.Icon === "function") {
      icon = new St.Icon({
        icon_name: spec.iconName,
        icon_size: 14,
        ...(spec.iconClass !== null ? { style_class: spec.iconClass } : {}),
        y_align: Clutter.ActorAlign.CENTER,
      });
    }

    let label: St.Label | null = null;
    if (spec.includeLabel) {
      label = new St.Label({
        text: options.labelText,
        ...(spec.labelClass !== null ? { style_class: spec.labelClass } : {}),
        y_align: Clutter.ActorAlign.CENTER,
      });
      label.accessible_name = label.text;
    }

    if (spinner !== null && spec.spinnerFirst) children.push(spinner);
    if (icon !== null) children.push(icon);
    if (spinner !== null && !spec.spinnerFirst) children.push(spinner);
    if (label !== null) children.push(label);

    let control: St.Widget;
    if (spec.useButton) {
      let child: St.Widget;
      if (children.length === 1 && spec.contentClass === null) {
        child = children[0];
      } else {
        const content = new St.BoxLayout({
          ...(spec.contentClass !== null ? { style_class: spec.contentClass } : {}),
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
    } else {
      control = new St.BoxLayout({
        style_class: spec.controlClass,
        reactive: true,
        can_focus: true,
        track_hover: true,
        y_align: Clutter.ActorAlign.CENTER,
      });
      for (const item of children) control.add_child(item);
    }

    control.accessible_name = options.accessibleName;
    this._bindActivation(control, options.onActivate);
    return { control, icon, label };
  }

  private _buildFooter(spec: PanelFooterSpec): PanelFooter {
    let running = false;
    const row = this._createFooterRow(spec.footerRowClass);
    const toolbar: St.BoxLayout =
      spec.toolbarClass === null
        ? row
        : new St.BoxLayout({
            style_class: spec.toolbarClass,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
          });

    const spinner = new Spinner(14, { animate: true, hideOnStop: true });
    spinner.add_style_class_name("provider-limits-refresh-spinner");

    const refresh = this._buildAction({
      spec: spec.refresh,
      labelText: this._translate("Force refresh"),
      spinner,
      accessibleName: this._translate("Force refresh"),
      onActivate: () => {
        if (!running) this._onRefresh();
      },
    });

    const settings = this._buildAction({
      spec: spec.settings,
      labelText: this._translate("Settings"),
      spinner: null,
      accessibleName: this._translate("Settings"),
      onActivate: () => {
        this._closeMenu();
        this._openPreferences();
      },
    });

    const lastRefreshLabel = spec.compact
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
      if (spec.refresh.iconHidesWhenRunning && refresh.icon) {
        refresh.icon.visible = !value;
      }
      if (refresh.label) {
        const text = value ? this._translate("Refreshing…") : this._translate("Force refresh");
        refresh.label.text = text;
        refresh.label.accessible_name = text;
      }
      refresh.control.reactive = !value;
      if (spec.disabledRefreshClass !== null) {
        if (value) refresh.control.add_style_class_name(spec.disabledRefreshClass);
        else refresh.control.remove_style_class_name(spec.disabledRefreshClass);
      }
      refresh.control.accessible_name = value
        ? this._translate("Refreshing…")
        : this._translate("Force refresh");
    };
    applyRunning(false);

    const actors = {
      row,
      toolbar,
      refreshControl: refresh.control,
      refreshIcon: refresh.icon,
      refreshLabel: refresh.label,
      spinner,
      lastRefreshLabel,
      settingsControl: settings.control,
      settingsLabel: settings.label,
      setRunning: applyRunning,
    };

    if (!spec.compact) {
      toolbar.add_child(refresh.control);
      toolbar.add_child(lastRefreshLabel);
      toolbar.add_child(settings.control);
      return {
        ...actors,
        kind: "standard" as const,
        get running() {
          return running;
        },
      };
    }

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
    actionsBox.add_child(refresh.control);
    actionsBox.add_child(settings.control);

    toolbar.add_child(leftBox);
    toolbar.add_child(actionsBox);

    return {
      ...actors,
      kind: "compact" as const,
      get running() {
        return running;
      },
      controls: { titleLabel, expandAllButton, expandAllLabel },
    };
  }
}
