import { test } from "node:test";

import { assert, load } from "../helpers/node-harness.mjs";

const { clearChildren } = load("src/helpers/children.ts", "({ clearChildren })");

function ActionRow(props) {
  Object.assign(this, props);
}

class ListBoxStub {
  constructor() {
    this.children = [];
    this.classes = [];
  }
  add_css_class(name) {
    this.classes.push(name);
  }
  get_first_child() {
    return this.children[0] ?? null;
  }
  append(child) {
    child.parent = this;
    this.children.push(child);
  }
  remove(child) {
    const index = this.children.indexOf(child);
    assert.ok(index >= 0, "removed child belongs to the list");
    this.children.splice(index, 1);
    child.parent = null;
  }
}

function createHarness(initialValues) {
  let values = [...initialValues];
  let nextId = 0;
  const active = new Map();
  const settings = {
    connect(signal, _fn) {
      const id = ++nextId;
      active.set(id, signal);
      return id;
    },
    disconnect(id) {
      assert.ok(active.delete(id), `handler ${id} is still connected`);
    },
    get_strv() {
      return [...values];
    },
    set_strv(_key, next) {
      values = [...next];
    },
  };
  const cleanups = [];
  const buildRow = (value) => {
    let handlerId = settings.connect(`changed::${value}`, () => {});
    return {
      get_next_sibling() {
        const siblings = this.parent?.children ?? [];
        return siblings[siblings.indexOf(this) + 1] ?? null;
      },
      cleanup() {
        if (handlerId === null) return;
        settings.disconnect(handlerId);
        handlerId = null;
        cleanups.push(value);
      },
    };
  };
  const { buildReorderableList } = load("src/ui/prefs/shared.ts", "({ buildReorderableList })", {
    Adw: {
      ActionRow,
    },
    Gdk: {},
    Gio: {},
    GObject: {},
    Gtk: { ListBox: ListBoxStub, SelectionMode: { NONE: 0 }, AccessibleRole: { LIST: 1 } },
    clearChildren,
    reorderValue: () => null,
  });
  return { settings, active, cleanups, buildRow, buildReorderableList };
}

test("rebuilding the providers list cleans up rows instead of leaking settings handlers", () => {
  const h = createHarness(["codex", "claude"]);
  const list = h.buildReorderableList(h.settings, "providers-order", h.buildRow);

  assert.equal(h.active.size, 3, "one list handler plus one handler per row");
  assert.deepEqual(h.cleanups, []);

  list.render();
  assert.deepEqual(h.cleanups, ["codex", "claude"], "each replaced row is cleaned up once");
  assert.equal(h.active.size, 3, "old row handlers are gone before new rows are built");

  list.render();
  list.render();
  assert.equal(h.cleanups.length, 6, "every rebuild cleans up the previous rows");
  assert.equal(h.active.size, 3, "handlers do not accumulate across rebuilds");

  list.destroy();
  assert.equal(h.active.size, 2, "destroy releases only the list-level handler");
  for (const child of list.listBox.children) child.cleanup();
  assert.equal(h.active.size, 0, "the rows release their own handlers");
});

test("row cleanup is idempotent when a detached row is also destroyed", () => {
  const h = createHarness(["codex"]);
  const list = h.buildReorderableList(h.settings, "providers-order", h.buildRow);
  const row = list.listBox.get_first_child();

  row.cleanup();
  row.cleanup();
  assert.deepEqual(h.cleanups, ["codex"], "a second cleanup is a no-op");
  assert.equal(h.active.size, 1, "only the list-level handler remains");

  list.render();
  assert.equal(h.active.size, 2, "the replacement row has its own handler");
  assert.deepEqual(h.cleanups, ["codex"], "cleaning an already-cleaned row stays a no-op");

  list.destroy();
  assert.equal(h.active.size, 1, "destroy leaves the replacement row handler intact");
  list.listBox.get_first_child().cleanup();
  assert.equal(h.active.size, 0);
});
