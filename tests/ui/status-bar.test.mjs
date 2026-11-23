import { test } from "node:test";

import { assert, load } from "../helpers/node-harness.mjs";

test("status bar renderer plans once per render and owns structure rebuilds", () => {
  const destroyed = [];
  const parent = {
    children: [],
    add_child(child) {
      this.children.push(child);
      child.parent = this;
    },
    get_first_child() {
      return this.children[0] ?? null;
    },
  };
  const makeChild = (id) => ({
    id,
    parent: null,
    get_next_sibling() {
      const siblings = this.parent?.children ?? [];
      return siblings[siblings.indexOf(this) + 1] ?? null;
    },
    destroy() {
      destroyed.push(this.id);
      if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    },
  });
  const { StatusBarRenderer } = load("src/ui/statusBarRenderer.ts", "({ StatusBarRenderer })");

  const plans = [];
  const builds = [];
  const updates = [];
  class Renderer extends StatusBarRenderer {
    plan(context) {
      plans.push(context.key);
      return { key: context.key, value: context.value };
    }
    build(plan) {
      builds.push(plan.key);
      const child = makeChild(plan.key);
      this.parent.add_child(child);
    }
    update(plan) {
      updates.push(plan.value);
    }
  }
  const renderer = new Renderer(parent);

  renderer.render({ key: "a", value: 1 });
  assert.deepEqual(plans, ["a"], "one plan per render");
  assert.deepEqual(builds, ["a"], "first render builds");
  assert.deepEqual(updates, []);
  assert.equal(parent.children.length, 1);

  renderer.render({ key: "a", value: 2 });
  assert.deepEqual(plans, ["a", "a"], "one plan per render on update");
  assert.deepEqual(builds, ["a"], "same structure key updates in place");
  assert.deepEqual(updates, [2]);
  assert.equal(parent.children.length, 1);

  renderer.render({ key: "b", value: 3 });
  assert.deepEqual(plans, ["a", "a", "b"]);
  assert.deepEqual(builds, ["a", "b"], "changed structure key rebuilds");
  assert.deepEqual(destroyed, ["a"], "old children are disposed on rebuild");
  assert.equal(parent.children.length, 1);

  renderer.dispose();
  assert.deepEqual(destroyed, ["a", "b"]);
  assert.equal(parent.children.length, 0);

  renderer.render({ key: "b", value: 4 });
  assert.deepEqual(builds, ["a", "b", "b"], "dispose clears the structure key");
  assert.deepEqual(updates, [2]);
});
