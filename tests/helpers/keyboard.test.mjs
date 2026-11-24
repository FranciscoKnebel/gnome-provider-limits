import { test } from "node:test";

import { assert, load } from "./node-harness.mjs";

test("keyboard activation is shared across buttons and key-press fallbacks", () => {
  const Clutter = {
    KEY_Return: 1,
    KEY_KP_Enter: 2,
    KEY_space: 3,
    KEY_Left: 4,
    EVENT_STOP: 1,
    EVENT_PROPAGATE: 0,
  };
  const { isActivationKey, bindActivation } = load(
    "src/helpers/keyboard.ts",
    "({ isActivationKey, bindActivation })",
    { Clutter },
  );

  assert.equal(isActivationKey(Clutter.KEY_Return), true);
  assert.equal(isActivationKey(Clutter.KEY_KP_Enter), true);
  assert.equal(isActivationKey(Clutter.KEY_space), true);
  assert.equal(isActivationKey(Clutter.KEY_Left), false);

  class Actor {
    handlers = new Map();
    connect(name, fn) {
      const list = this.handlers.get(name) ?? [];
      list.push(fn);
      this.handlers.set(name, list);
      return list.length;
    }
    fire(name, ...args) {
      return (this.handlers.get(name) ?? []).map((fn) => fn(this, ...args));
    }
  }
  let activations = 0;
  const forwarded = [];
  const actor = new Actor();
  bindActivation(actor, () => activations++, {
    pointerSignals: ["clicked"],
    onOtherKey: (e) => {
      forwarded.push(e.get_key_symbol());
      return 42;
    },
  });

  assert.deepEqual([...actor.handlers.keys()], ["clicked", "key-press-event"]);
  actor.fire("clicked");
  assert.equal(activations, 1);
  assert.equal(
    actor.fire("key-press-event", { get_key_symbol: () => Clutter.KEY_KP_Enter })[0],
    Clutter.EVENT_STOP,
  );
  assert.equal(activations, 2);
  assert.equal(actor.fire("key-press-event", { get_key_symbol: () => Clutter.KEY_Left })[0], 42);
  assert.deepEqual(forwarded, [Clutter.KEY_Left]);
  assert.equal(activations, 2);
});

test("keyboard binding activates exactly once per click with the shipped default", () => {
  const Clutter = {
    KEY_Return: 1,
    KEY_KP_Enter: 2,
    KEY_space: 3,
    EVENT_STOP: 1,
    EVENT_PROPAGATE: 0,
  };
  const { bindActivation } = load("src/helpers/keyboard.ts", "({ bindActivation })", { Clutter });

  class Actor {
    handlers = new Map();
    connect(name, fn) {
      const list = this.handlers.get(name) ?? [];
      list.push(fn);
      this.handlers.set(name, list);
      return list.length;
    }
    fire(name, ...args) {
      return (this.handlers.get(name) ?? []).map((fn) => fn(this, ...args));
    }
  }
  let activations = 0;
  const actor = new Actor();
  bindActivation(actor, () => activations++);

  assert.deepEqual([...actor.handlers.keys()], ["clicked", "key-press-event"]);
  actor.fire("clicked");
  actor.fire("clicked");
  assert.equal(activations, 2, "each click activates exactly once");
  actor.fire("button-release-event");
  assert.equal(activations, 2, "button-release-event is not bound by default");
});
