import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";

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
  return "cleanup" in page && typeof (page as Partial<DisposablePage>).cleanup === "function";
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
  let currentChild = listBox.get_first_child();
  while (currentChild) {
    const next = currentChild.get_next_sibling();
    listBox.remove(currentChild);
    currentChild = next;
  }
}

export function setupDragSource(row: Adw.ActionRow, value: string): void {
  const dragSource = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE });
  dragSource.connect("prepare", () => Gdk.ContentProvider.new_for_value(value));
  row.add_controller(dragSource);
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
  const current = visibleValues[index];

  const box = new Gtk.Box({
    spacing: 2,
    valign: Gtk.Align.CENTER,
  });

  const upButton = new Gtk.Button({
    icon_name: "go-up-symbolic",
    valign: Gtk.Align.CENTER,
    tooltip_text: moveUpLabel,
    sensitive: index > 0,
  });
  upButton.add_css_class("flat");
  upButton.connect("clicked", () => {
    if (index <= 0) return;
    const prev = visibleValues[index - 1];
    const reordered = reorderValue(settings.get_strv(key), current, prev);
    if (reordered) settings.set_strv(key, reordered);
  });

  const downButton = new Gtk.Button({
    icon_name: "go-down-symbolic",
    valign: Gtk.Align.CENTER,
    tooltip_text: moveDownLabel,
    sensitive: index < visibleValues.length - 1,
  });
  downButton.add_css_class("flat");
  downButton.connect("clicked", () => {
    if (index >= visibleValues.length - 1) return;
    const next = visibleValues[index + 1];
    const reordered = reorderValue(settings.get_strv(key), current, next);
    if (reordered) settings.set_strv(key, reordered);
  });

  box.append(upButton);
  box.append(downButton);
  return box;
}

export function buildReorderableList(
  settings: Gio.Settings,
  key: string,
  buildRow: (value: string, context: ReorderRowContext) => Adw.ActionRow | null,
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

function stringArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function setupDropTarget(
  row: Adw.ActionRow,
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
