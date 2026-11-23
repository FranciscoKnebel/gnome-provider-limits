import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk?version=4.0";

import { reorderValue } from "../../helpers/reorder.js";
import { gettext as _ } from "./gettext.js";

export interface DisposablePage {
  cleanup(): void;
}

export interface SettingsBinding {
  target: GObject.Object;
  property: string;
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

interface VisibleRowEntry {
  value: string;
  row: Adw.ActionRow;
  upButton: Gtk.Button;
  downButton: Gtk.Button;
}

export function buildReorderableList(
  settings: Gio.Settings,
  key: string,
  buildRow: (value: string, reorderControls: Gtk.Box) => Adw.ActionRow | null,
  normalizeValues?: (values: readonly string[]) => readonly string[],
  beforeRender?: () => void,
): { listBox: Gtk.ListBox; render: () => void; destroy: () => void } {
  const listBox = new Gtk.ListBox({
    selection_mode: Gtk.SelectionMode.NONE,
    show_separators: false,
    accessible_role: Gtk.AccessibleRole.LIST,
  });
  listBox.add_css_class("boxed-list");

  let isRendering = false;
  let pendingFocus: { value: string; direction: "up" | "down" } | null = null;

  const render = () => {
    if (isRendering) return;
    isRendering = true;
    try {
      beforeRender?.();
      clearListBox(listBox);
      const currentValues = settings.get_strv(key);
      const values = normalizeValues ? [...normalizeValues(currentValues)] : currentValues;
      if (normalizeValues && !stringArraysEqual(currentValues, values)) {
        settings.set_strv(key, values);
      }

      const visibleEntries: VisibleRowEntry[] = [];
      for (const value of values) {
        const controls = new Gtk.Box({
          orientation: Gtk.Orientation.HORIZONTAL,
          spacing: 2,
          valign: Gtk.Align.CENTER,
        });

        const upLabel = _("Move up");
        const upButton = new Gtk.Button({
          icon_name: "go-up-symbolic",
          valign: Gtk.Align.CENTER,
          tooltip_text: upLabel,
        });
        upButton.add_css_class("flat");
        upButton.update_property([Gtk.AccessibleProperty.LABEL], [upLabel]);

        const downLabel = _("Move down");
        const downButton = new Gtk.Button({
          icon_name: "go-down-symbolic",
          valign: Gtk.Align.CENTER,
          tooltip_text: downLabel,
        });
        downButton.add_css_class("flat");
        downButton.update_property([Gtk.AccessibleProperty.LABEL], [downLabel]);

        controls.append(upButton);
        controls.append(downButton);

        const row = buildRow(value, controls);
        if (row) {
          visibleEntries.push({ value, row, upButton, downButton });
        }
      }

      visibleEntries.forEach((entry, index) => {
        entry.upButton.sensitive = index > 0;
        entry.downButton.sensitive = index < visibleEntries.length - 1;

        entry.upButton.connect("clicked", () => {
          if (index <= 0) return;
          const reordered = reorderValue(
            settings.get_strv(key),
            entry.value,
            visibleEntries[index - 1].value,
          );
          if (!reordered) return;
          pendingFocus = { value: entry.value, direction: "up" };
          settings.set_strv(key, reordered);
        });

        entry.downButton.connect("clicked", () => {
          if (index >= visibleEntries.length - 1) return;
          const reordered = reorderValue(
            settings.get_strv(key),
            entry.value,
            visibleEntries[index + 1].value,
          );
          if (!reordered) return;
          pendingFocus = { value: entry.value, direction: "down" };
          settings.set_strv(key, reordered);
        });

        listBox.append(entry.row);
      });

      if (pendingFocus) {
        const focusReq = pendingFocus;
        pendingFocus = null;
        const targetEntry = visibleEntries.find((e) => e.value === focusReq.value);
        if (targetEntry) {
          const primary =
            focusReq.direction === "up" ? targetEntry.upButton : targetEntry.downButton;
          const fallback =
            focusReq.direction === "up" ? targetEntry.downButton : targetEntry.upButton;
          if (primary.sensitive) primary.grab_focus();
          else if (fallback.sensitive) fallback.grab_focus();
        }
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
