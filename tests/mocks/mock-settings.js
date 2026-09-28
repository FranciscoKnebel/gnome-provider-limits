import GObject from "gi://GObject";

function valuesEqual(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  return a === b;
}

function defaultValueFor(key) {
  if (key.endsWith("-enabled")) return false;
  if (key.endsWith("-fields") || key === "providers-order") return [];
  if (key.endsWith("-seconds") || key.endsWith("-threshold")) return 0;
  return "";
}

export const MockSettings = GObject.registerClass(
  class MockSettings extends GObject.Object {
    _init(props = {}) {
      super._init();
      this._values = { ...props };
      this._handlers = new Map();
      this._bindings = new Map();
      this._nextHandlerId = 1;
      this._pushing = false;
    }

    connect(signal, callback) {
      const id = this._nextHandlerId++;
      const handlers = this._handlers.get(signal) ?? new Map();
      handlers.set(id, callback);
      this._handlers.set(signal, handlers);
      return id;
    }

    disconnect(id) {
      for (const handlers of this._handlers.values()) {
        if (handlers.delete(id)) return;
      }
    }

    emit(signal, ...args) {
      const handlers = this._handlers.get(signal);
      if (!handlers) return;
      for (const handler of handlers.values()) {
        handler(this, ...args);
      }
    }

    get_strv(key) {
      return [...(this._values[key] ?? [])];
    }

    get_string(key) {
      return this._values[key] ?? "";
    }

    get_boolean(key) {
      return this._values[key] ?? false;
    }

    get_int(key) {
      return this._values[key] ?? 0;
    }

    set_strv(key, val) {
      this._values[key] = [...val];
      this._emitChange(key);
    }

    set_string(key, val) {
      this._values[key] = val;
      this._emitChange(key);
    }

    set_int(key, val) {
      this._values[key] = val;
      this._emitChange(key);
    }

    set_boolean(key, val) {
      this._values[key] = val;
      this._emitChange(key);
    }

    bind(srcKey, target, prop, flags) {
      if (this._values[srcKey] === undefined) {
        this._values[srcKey] = defaultValueFor(srcKey);
      }
      const binding = { target, prop, flags, notifyId: 0 };
      if (typeof target.connect === "function") {
        binding.notifyId = target.connect(`notify::${prop}`, () => {
          if (this._pushing) return;
          const value = target[prop];
          if (valuesEqual(this._values[srcKey], value)) return;
          this._values[srcKey] = value;
          this.emit(`changed::${srcKey}`);
        });
      }
      const bindings = this._bindings.get(srcKey) ?? [];
      bindings.push(binding);
      this._bindings.set(srcKey, bindings);
      this._pushToTargets(srcKey);
    }

    unbind(target, prop) {
      for (const [key, bindings] of this._bindings) {
        const removed = bindings.filter((b) => b.target === target && b.prop === prop);
        for (const binding of removed) {
          if (binding.notifyId && typeof target.disconnect === "function") {
            target.disconnect(binding.notifyId);
          }
        }
        const remaining = bindings.filter((b) => b.target !== target || b.prop !== prop);
        if (remaining.length > 0) {
          this._bindings.set(key, remaining);
        } else {
          this._bindings.delete(key);
        }
      }
    }

    _emitChange(key) {
      this.emit(`changed::${key}`);
      this._pushToTargets(key);
    }

    _pushToTargets(key) {
      this._pushing = true;
      try {
        for (const { target, prop } of this._bindings.get(key) ?? []) {
          target[prop] = this._values[key];
        }
      } finally {
        this._pushing = false;
      }
    }
  },
);
