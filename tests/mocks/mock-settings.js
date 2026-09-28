import GObject from "gi://GObject";

export const MockSettings = GObject.registerClass(
  class MockSettings extends GObject.Object {
    _init(props = {}) {
      super._init();
      this._values = { ...props };
      this._handlers = new Map();
      this._bindings = new Map();
      this._nextHandlerId = 1;
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
      const bindings = this._bindings.get(srcKey) ?? [];
      bindings.push({ target, prop, flags });
      this._bindings.set(srcKey, bindings);
      target[prop] = this._values[srcKey] ?? "";
    }

    unbind(_target, _prop) {}

    _emitChange(key) {
      this.emit(`changed::${key}`);
      for (const { target, prop } of this._bindings.get(key) ?? []) {
        target[prop] = this._values[key];
      }
    }
  },
);
