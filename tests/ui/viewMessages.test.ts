import type { ViewPhase } from "../../src/ui/viewContext.js";
import { viewMessages } from "../../src/ui/viewMessages.js";
import type { ViewSurface } from "../../src/ui/viewMessages.js";

function message(phase: ViewPhase, surface: ViewSurface, running = false) {
  return viewMessages({ phase, surface, locale: "en", t: (text) => text, running });
}

describe("viewMessages", () => {
  it("returns one empty presentation for ready on every surface", () => {
    for (const surface of ["cards", "matrix", "pills", "gauges", "compact"] as const) {
      expect(message("ready", surface)).toEqual({
        title: "",
        subtitle: "",
        placeholder: "",
        accessibleText: "",
        showPlaceholder: false,
      });
    }
  });

  it("maps cards empty and loading messages, including the running toggle", () => {
    const empty = message("empty", "cards");
    expect(empty.title).toBe("No providers enabled");
    expect(empty.subtitle).toBe("Enable a provider in Settings to monitor usage limits.");
    expect(empty.showPlaceholder).toBeFalse();

    expect(message("loading", "cards", true).title).toBe("Loading provider limits…");
    expect(message("loading", "cards", false).title).toBe("Waiting for provider data…");
  });

  it("maps matrix empty and loading messages", () => {
    expect(message("empty", "matrix").title).toBe(
      "No providers enabled. Open Settings to enable a provider.",
    );
    expect(message("loading", "matrix").title).toBe("Reading provider limits…");
  });

  it("maps status bar placeholder surfaces without leaking card or panel text", () => {
    const pills = message("loading", "pills");
    expect(pills.placeholder).toBe("…");
    expect(pills.accessibleText).toBe("Loading provider limits…");
    expect(pills.showPlaceholder).toBeTrue();
    expect(message("empty", "pills").showPlaceholder).toBeFalse();

    const gauges = message("loading", "gauges");
    expect(gauges.title).toBe("Reading provider limits…");
    expect(gauges.subtitle).toBe("Waiting for initial refresh to complete.");
    expect(gauges.placeholder).toBe("…");
    expect(gauges.accessibleText).toBe("Refreshing…");
    expect(gauges.showPlaceholder).toBeTrue();
    expect(message("empty", "gauges").showPlaceholder).toBeFalse();

    const compact = message("loading", "compact");
    expect(compact.placeholder).toBe("…");
    expect(compact.accessibleText).toBe("Reading provider limits…");
    expect(compact.showPlaceholder).toBeTrue();
    expect(message("empty", "compact").showPlaceholder).toBeFalse();
  });

  it("translates mapped text through the supplied translator", () => {
    const result = viewMessages({
      phase: "empty",
      surface: "matrix",
      locale: "pt_BR",
      t: (text) => `T:${text}`,
      running: false,
    });
    expect(result.title).toBe("T:No providers enabled. Open Settings to enable a provider.");
  });
});
