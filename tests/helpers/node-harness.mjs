import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import ts from "typescript";

export { assert };

export function load(path, expression, globals = {}) {
  const compiled = ts
    .transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    })
    .outputText.replace(/^import[\s\S]*?;\n/gm, "")
    .replace(/export default /g, "")
    .replace(/export /g, "");
  return vm.runInNewContext(`${compiled}\n;${expression}`, {
    console,
    Error,
    TextEncoder,
    TextDecoder,
    Date,
    Map,
    Set,
    Promise,
    ...globals,
  });
}

export function timers() {
  let next = 1;
  const sources = new Map();
  return {
    sources,
    timeout_add: (_p, _ms, fn) => {
      const id = next++;
      sources.set(id, fn);
      return id;
    },
    timeout_add_seconds: (_p, _s, fn) => {
      const id = next++;
      sources.set(id, fn);
      return id;
    },
    idle_add: (_p, fn) => {
      const id = next++;
      sources.set(id, fn);
      return id;
    },
    Source: {
      remove(id) {
        assert.ok(sources.delete(id), `removing expired timer ${id}`);
      },
    },
    fire(id) {
      const fn = sources.get(id);
      assert.ok(fn);
      sources.delete(id);
      fn();
    },
    SOURCE_REMOVE: false,
  };
}

export class Cancellable {
  handlers = new Map();
  cancelled = false;
  next = 1;
  connect(fn) {
    const id = this.next++;
    this.handlers.set(id, fn);
    if (this.cancelled) fn();
    return id;
  }
  disconnect(id) {
    this.handlers.delete(id);
  }
  is_cancelled() {
    return this.cancelled;
  }
  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const fn of this.handlers.values()) fn();
  }
}

export const gio = { Cancellable, _promisify() {}, File: { prototype: {} } };
