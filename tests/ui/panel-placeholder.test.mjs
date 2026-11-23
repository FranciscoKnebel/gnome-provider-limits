import { test } from "node:test";

import { assert, load } from "../helpers/node-harness.mjs";

const messages = () => ({});

function PopupMenuSection() {}

function helperFor(phaseResult) {
  return load("src/ui/panelShell.ts", "({ addPlaceholderIfNeeded })", {
    PopupMenu: { PopupMenuSection },
    phaseResult,
  }).addPlaceholderIfNeeded;
}

function shellStub() {
  const calls = { clear: 0, rows: [] };
  return {
    calls,
    clearBody() {
      calls.clear++;
    },
    addEmptyStateRow(title, subtitle) {
      calls.rows.push([title, subtitle]);
    },
  };
}

test("addPlaceholderIfNeeded clears the body and builds the shared empty-state row", () => {
  const add = helperFor(() => ({
    kind: "placeholder",
    message: { title: "No providers enabled", subtitle: "Enable a provider in Settings." },
  }));
  const shell = shellStub();

  assert.equal(add(shell, {}, messages()), true);
  assert.equal(shell.calls.clear, 1);
  assert.deepEqual(shell.calls.rows, [["No providers enabled", "Enable a provider in Settings."]]);
});

test("addPlaceholderIfNeeded omits empty subtitles and title-less placeholders", () => {
  const noSubtitle = helperFor(() => ({
    kind: "placeholder",
    message: { title: "Reading provider limits…", subtitle: "" },
  }));
  const shell = shellStub();
  assert.equal(noSubtitle(shell, {}, messages()), true);
  assert.deepEqual(shell.calls.rows, [["Reading provider limits…", undefined]]);

  const titleless = helperFor(() => ({ kind: "placeholder", message: { title: "" } }));
  const shell2 = shellStub();
  assert.equal(titleless(shell2, {}, messages()), false);
  assert.deepEqual(shell2.calls.rows, []);

  const ready = helperFor(() => ({ kind: "ready" }));
  const shell3 = shellStub();
  assert.equal(ready(shell3, {}, messages()), false);
  assert.equal(shell3.calls.clear, 1, "the body is cleared even without a placeholder");
});
