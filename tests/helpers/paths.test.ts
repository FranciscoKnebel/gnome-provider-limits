import {
  resolveClaudeConfigDir,
  resolveCodexHome,
  resolveOpenCodeDataDir,
} from "../../src/helpers/paths.js";

const HOME = "/home/tester";

describe("resolveCodexHome", () => {
  it("prefers CODEX_HOME", () => {
    expect(resolveCodexHome({ CODEX_HOME: "/custom/codex" }, HOME)).toBe("/custom/codex");
  });

  it("falls back to ~/.codex", () => {
    expect(resolveCodexHome({}, HOME)).toBe("/home/tester/.codex");
  });

  it("ignores blank and non-string values", () => {
    expect(resolveCodexHome({ CODEX_HOME: "   " }, HOME)).toBe("/home/tester/.codex");
    expect(resolveCodexHome({ CODEX_HOME: null }, HOME)).toBe("/home/tester/.codex");
    expect(resolveCodexHome({ CODEX_HOME: undefined }, HOME)).toBe("/home/tester/.codex");
  });

  it("trims surrounding whitespace", () => {
    expect(resolveCodexHome({ CODEX_HOME: "  /custom/codex  " }, HOME)).toBe("/custom/codex");
  });
});

describe("resolveClaudeConfigDir", () => {
  it("prefers CLAUDE_CONFIG_DIR", () => {
    expect(resolveClaudeConfigDir({ CLAUDE_CONFIG_DIR: "/custom/claude" }, HOME)).toBe(
      "/custom/claude",
    );
  });

  it("falls back to ~/.claude", () => {
    expect(resolveClaudeConfigDir({}, HOME)).toBe("/home/tester/.claude");
  });

  it("ignores blank values", () => {
    expect(resolveClaudeConfigDir({ CLAUDE_CONFIG_DIR: "" }, HOME)).toBe("/home/tester/.claude");
  });
});

describe("resolveOpenCodeDataDir", () => {
  it("prefers XDG_DATA_HOME", () => {
    expect(resolveOpenCodeDataDir({ XDG_DATA_HOME: "/data" }, HOME)).toBe("/data/opencode");
  });

  it("falls back to ~/.local/share", () => {
    expect(resolveOpenCodeDataDir({}, HOME)).toBe("/home/tester/.local/share/opencode");
  });

  it("ignores blank values", () => {
    expect(resolveOpenCodeDataDir({ XDG_DATA_HOME: "  " }, HOME)).toBe(
      "/home/tester/.local/share/opencode",
    );
  });
});
