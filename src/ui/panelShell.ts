import Clutter from "gi://Clutter";
import St from "gi://St";
import { ensureActorVisibleInScrollView } from "resource:///org/gnome/shell/misc/animationUtils.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { formatTimestampTemplate } from "../formatters.js";
import { gettext as _ } from "../helpers/gettext.js";
import { setScrollViewChild } from "../helpers/scroll.js";
import type { PanelFooterActors } from "./panelFooter.js";
import type { PanelStyleSpec } from "./styles.js";
import type { ProviderViewContext } from "./viewContext.js";

/** Single render argument shared by every panel style section. */
export interface PanelRenderContext {
  readonly lastRefreshAt: number | null;
  readonly view: ProviderViewContext;
}

/** Base for style sections: owns the shell and its shared lifecycle. */
export abstract class PanelStyleSection {
  readonly shell: PanelShell;

  constructor(shell: PanelShell) {
    this.shell = shell;
  }

  abstract render(context: PanelRenderContext): void;

  /** Optional per-style state for the running indicator; the shell always tracks it too. */
  setRunning(_running: boolean): void {}
}

export interface PanelShellOptions {
  openPreferences: () => void;
  onRefresh: () => void;
  closeMenu: () => void;
  style: PanelStyleSpec;
  extraControls?: readonly St.Widget[];
  onFooterKeyPress?: (event: Clutter.Event) => boolean;
}

/**
 * Shared panel infrastructure: scroll area, body and static rows.
 * Footer construction lives in panelFooter; style renderers own body content.
 */
export class PanelShell extends PopupMenu.PopupMenuSection {
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
    this._openPreferences = options.openPreferences;
    this._onRefresh = options.onRefresh;
    this._closeMenu = options.closeMenu;
    this._footerKeyHandler = options.onFooterKeyPress ?? (() => Clutter.EVENT_PROPAGATE);

    const onFooterKey = (event: Clutter.Event): boolean => this._footerKeyHandler(event);
    const placement = options.style.shellPlacement;
    const footer = options.style.footerFactory({
      extraControls: options.extraControls ?? [],
      onRefresh: () => {
        if (!this.isRunning()) this._onRefresh();
      },
      openPreferences: this._openPreferences,
      closeMenu: this._closeMenu,
      onFooterKey,
    });
    if (placement.shellClass !== null) this.box.add_style_class_name(placement.shellClass);

    this._footer = footer.actors;
    this._applyFooterRunning = footer.applyRunning;

    this._body = new PopupMenu.PopupMenuSection();
    this._body.actor.connect("key-press-event", (_actor: Clutter.Actor, event: Clutter.Event) => {
      return this._bodyKeyHandler ? this._bodyKeyHandler(event) : Clutter.EVENT_PROPAGATE;
    });

    this._scroll = new St.ScrollView({
      overlay_scrollbars: true,
      x_expand: true,
      ...(placement.scrollClass !== undefined ? { style_class: placement.scrollClass } : {}),
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

    this.addMenuItem(this._footer.row, placement.insertionIndex);
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

  setLastRefreshAt(lastRefreshAt: number | null, locale: string): void {
    const label = this._footer.lastRefreshLabel;
    label.visible = lastRefreshAt !== null;
    label.text = formatTimestampTemplate(_("Last refresh: %s"), lastRefreshAt, locale);
    label.accessible_name = label.text;
  }
}
