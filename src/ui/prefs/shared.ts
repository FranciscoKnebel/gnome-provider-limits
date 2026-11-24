import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";

import { clearChildren } from "../../helpers/children.js";
import { reorderValue } from "../../helpers/reorder.js";

export interface DisposablePage {
  cleanup(): void;
}

export interface SettingsBinding {
  target: GObject.Object;
  property: string;
}

export interface ReorderRowContext {
  index: number;
  visibleValues: readonly string[];
}

export function isDisposablePage(
  page: Adw.PreferencesPage,
): page is Adw.PreferencesPage & DisposablePage {
  return "cleanup" in page && typeof page.cleanup === "function";
}

/** Rows in a rebuilt list own subscriptions that must be released before unparenting. */
function isDisposableWidget(widget: Gtk.Widget): widget is Gtk.Widget & DisposablePage {
  return "cleanup" in widget && typeof widget.cleanup === "function";
}

export function bindSetting(
  settings: Gio.Settings,
  key: string,
  target: GObject.Object,
  property: string,
  bindings: SettingsBinding[],
): void {
  settings.bind(key, target, property, Gio.SettingsBindFlags.DEFAULT);
  bindings.push({ target, property });
}

export function unbindSettings(bindings: SettingsBinding[]): void {
  for (const { target, property } of bindings) {
    Gio.Settings.unbind(target, property);
  }
  bindings.length = 0;
}

export function clearListBox(listBox: Gtk.ListBox): void {
  clearChildren(listBox, (child) => {
    if (isDisposableWidget(child)) child.cleanup();
    listBox.remove(child);
  });
}

export function setupDragSource(row: Gtk.Widget, value: string): void {
  const dragSource = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE });
  dragSource.connect("prepare", () => Gdk.ContentProvider.new_for_value(value));
  row.add_controller(dragSource);
}

export function stringArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function createMoveButtons(options: {
  settings: Gio.Settings;
  key: string;
  visibleValues: readonly string[];
  index: number;
  moveUpLabel: string;
  moveDownLabel: string;
}): Gtk.Box {
  const { settings, key, visibleValues, index, moveUpLabel, moveDownLabel } = options;
  const value = visibleValues[index];
  const box = new Gtk.Box({ spacing: 2, valign: Gtk.Align.CENTER });

  const up = new Gtk.Button({
    icon_name: "go-up-symbolic",
    tooltip_text: moveUpLabel,
    valign: Gtk.Align.CENTER,
    sensitive: index > 0,
  });
  up.add_css_class("flat");
  up.connect("clicked", () => {
    const target = visibleValues[index - 1];
    if (!target) return;
    const reordered = reorderValue(settings.get_strv(key), value, target);
    if (reordered) settings.set_strv(key, reordered);
  });

  const down = new Gtk.Button({
    icon_name: "go-down-symbolic",
    tooltip_text: moveDownLabel,
    valign: Gtk.Align.CENTER,
    sensitive: index < visibleValues.length - 1,
  });
  down.add_css_class("flat");
  down.connect("clicked", () => {
    const target = visibleValues[index + 1];
    if (!target) return;
    const reordered = reorderValue(settings.get_strv(key), value, target);
    if (reordered) settings.set_strv(key, reordered);
  });

  box.append(up);
  box.append(down);
  return box;
}

export function buildReorderableList(
  settings: Gio.Settings,
  key: string,
  buildRow: (value: string, context: ReorderRowContext) => Gtk.Widget | null,
  options?: {
    normalizeValues?: (values: readonly string[]) => readonly string[];
    beforeRender?: () => void;
    isRenderable?: (value: string) => boolean;
    emptyText?: string;
  },
): { listBox: Gtk.ListBox; render: () => void; destroy: () => void } {
  const listBox = new Gtk.ListBox({
    selection_mode: Gtk.SelectionMode.NONE,
    show_separators: false,
    accessible_role: Gtk.AccessibleRole.LIST,
  });
  listBox.add_css_class("boxed-list");

  let isRendering = false;

  const render = () => {
    if (isRendering) return;
    isRendering = true;
    try {
      options?.beforeRender?.();
      clearListBox(listBox);
      const currentValues = settings.get_strv(key);
      const values = options?.normalizeValues
        ? [...options.normalizeValues(currentValues)]
        : currentValues;
      if (options?.normalizeValues && !stringArraysEqual(currentValues, values)) {
        settings.set_strv(key, values);
      }

      const visibleValues = options?.isRenderable ? values.filter(options.isRenderable) : values;

      if (visibleValues.length === 0 && options?.emptyText) {
        const emptyRow = new Adw.ActionRow({
          title: options.emptyText,
          activatable: false,
          sensitive: false,
        });
        listBox.append(emptyRow);
        return;
      }

      visibleValues.forEach((value, index) => {
        const row = buildRow(value, { index, visibleValues });
        if (row) listBox.append(row);
      });
    } finally {
      isRendering = false;
    }
  };

  render();
  const changedId = settings.connect(`changed::${key}`, render);
  return {
    listBox,
    render,
    destroy: () => {
      settings.disconnect(changedId);
    },
  };
}

export function setupDropTarget(
  row: Gtk.Widget,
  settings: Gio.Settings,
  key: string,
  targetValue: string,
): void {
  const dropTarget = new Gtk.DropTarget({ actions: Gdk.DragAction.MOVE });
  dropTarget.set_gtypes([GObject.TYPE_STRING]);
  dropTarget.connect("drop", (_target: Gtk.DropTarget, value: unknown) => {
    const reordered = reorderValue(settings.get_strv(key), String(value), targetValue);
    if (!reordered) return false;
    settings.set_strv(key, reordered);
    return true;
  });
  row.add_controller(dropTarget);
}
