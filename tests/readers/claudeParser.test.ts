import { findPercent, parseClaudeCliOutput, stripAnsi } from "../../src/readers/claudeParser.js";

describe("claudeParser", () => {
  describe("stripAnsi", () => {
    it("removes SGR escape sequences", () => {
      const esc = String.fromCharCode(27);
      const input = `${esc}[1mBold${esc}[0m text ${esc}[38;5;202m colours ${esc}[0m ok`;
      expect(stripAnsi(input)).toBe("Bold text  colours  ok");
    });

    it("passes through plain text unchanged", () => {
      expect(stripAnsi("Current session: 42% used")).toBe("Current session: 42% used");
    });
  });

  describe("findPercent", () => {
    it("matches '<n>% used' near the header", () => {
      const text = "Current session\n  42% used, resets in 3h";
      expect(findPercent(text, "Current session")).toBe(42);
    });

    it("matches '<n>% left' and converts to used", () => {
      const text = "Current week\n  58% left";
      expect(findPercent(text, "Current week")).toBe(42);
    });

    it("falls back to the first '<n>%' when no used/left hint", () => {
      const text = "Current session\n  71% of weekly cap";
      expect(findPercent(text, "Current session")).toBe(71);
    });

    it("returns null when the header is missing", () => {
      expect(findPercent("nothing here", "Current session")).toBeNull();
    });
  });

  describe("parseClaudeCliOutput", () => {
    it("parses both session and week windows", () => {
      const esc = String.fromCharCode(27);
      const stdout = [
        "Welcome to Claude Code",
        `${esc}[1mCurrent session${esc}[0m: 42% used`,
        `${esc}[1mCurrent week${esc}[0m: 75% left`,
      ].join("\n");

      const payload = parseClaudeCliOutput(stdout);
      expect(payload).not.toBeNull();
      expect(payload?.five_hour?.used_percent).toBe(42);
      expect(payload?.seven_day?.used_percent).toBe(25);
    });

    it("parses session only when week header is absent", () => {
      const stdout = "noise\nCurrent session: 12% used\nmore noise";
      const payload = parseClaudeCliOutput(stdout);
      expect(payload).not.toBeNull();
      expect(payload?.five_hour?.used_percent).toBe(12);
      expect(payload?.seven_day).toBeNull();
    });

    it("returns null when no recognizable header is present", () => {
      expect(parseClaudeCliOutput("totally unrelated output")).toBeNull();
    });
  });
});
