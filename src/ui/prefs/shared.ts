import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";

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

export function buildReorderableList(
  settings: Gio.Settings,
  key: string,
  buildRow: (value: string) => Adw.ActionRow | null,
  normalizeValues?: (values: readonly string[]) => readonly string[],
): { listBox: Gtk.ListBox; render: () => void; destroy: () => void } {
  const listBox = new Gtk.ListBox({
    selection_mode: Gtk.SelectionMode.SINGLE,
    show_separators: false,
    accessible_role: Gtk.AccessibleRole.LIST,
  });
  listBox.add_css_class("boxed-list");

  let isRendering = false;

  const render = () => {
    if (isRendering) return;
    isRendering = true;
    try {
      clearListBox(listBox);
      const currentValues = settings.get_strv(key);
      const values = normalizeValues ? [...normalizeValues(currentValues)] : currentValues;
      if (normalizeValues && !stringArraysEqual(currentValues, values)) {
        settings.set_strv(key, values);
      }
      for (const value of values) {
        const row = buildRow(value);
        if (row) listBox.append(row);
      }
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

export function setupDropTarget(row: Adw.ActionRow, settings: Gio.Settings, key: string): void {
  const dropTarget = new Gtk.DropTarget({ actions: Gdk.DragAction.MOVE });
  dropTarget.set_gtypes([GObject.TYPE_STRING]);
  dropTarget.connect("drop", (_target: Gtk.DropTarget, value: unknown) => {
    const draggedValue = String(value);
    const values = settings.get_strv(key);
    const fromIndex = values.indexOf(draggedValue);
    if (fromIndex < 0) return false;
    const targetIndex = row.get_index();
    if (targetIndex < 0 || targetIndex === fromIndex) return false;
    const reordered = [...values];
    reordered.splice(fromIndex, 1);
    reordered.splice(Math.min(targetIndex, reordered.length), 0, draggedValue);
    settings.set_strv(key, reordered);
    return true;
  });
  row.add_controller(dropTarget);
}
