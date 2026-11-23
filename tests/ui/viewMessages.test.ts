import { providerRecord } from "../../src/constants.js";
import type { ProviderViewContext, ViewPhase } from "../../src/ui/viewContext.js";
import {
  cardsMessages,
  cardsRunningMessages,
  cockpitMessages,
  matrixMessages,
  phaseResult,
  pillsMessages,
  statusCompactMessages,
  statusGaugesMessages,
  type PhaseMessages,
} from "../../src/ui/viewMessages.js";

const MESSAGES = {
  cards: cardsMessages,
  matrix: matrixMessages,
  cockpit: cockpitMessages,
  pills: pillsMessages,
  gauges: statusGaugesMessages,
  compact: statusCompactMessages,
} as const;

type Surface = keyof typeof MESSAGES;
const PANEL_SURFACES: readonly Surface[] = ["cards", "matrix", "cockpit"];
const ALL_SURFACES: readonly Surface[] = [
  "cards",
  "matrix",
  "cockpit",
  "pills",
  "gauges",
  "compact",
];

function messagesFor(surface: Surface): PhaseMessages {
  return MESSAGES[surface];
}

function message(phase: ViewPhase, surface: Surface) {
  return messagesFor(surface)(phase, (text) => text);
}

function view(phase: ViewPhase): ProviderViewContext {
  return {
    phase,
    activeProviders: [],
    results: new Map(),
    displayNames: providerRecord(() => ""),
    models: [],
    locale: "en",
    t: (text: string) => text,
  };
}

describe("viewMessages", () => {
  it("returns one empty presentation for ready on every surface", () => {
    for (const surface of ALL_SURFACES) {
      expect(message("ready", surface)).toEqual({
        title: "",
        subtitle: "",
        placeholder: "",
        accessibleText: "",
        showPlaceholder: false,
      });
    }
  });

  it("maps cards empty and loading messages", () => {
    const empty = message("empty", "cards");
    expect(empty.title).toBe("No providers enabled");
    expect(empty.subtitle).toBe("Enable a provider in Settings to monitor usage limits.");
    expect(empty.showPlaceholder).toBeFalse();
    expect(message("loading", "cards").title).toBe("Waiting for provider data…");
  });

  it("keeps the cards-only running copy outside the shared contract", () => {
    expect(cardsRunningMessages("loading", (text) => text).title).toBe("Loading provider limits…");
    expect(cardsRunningMessages("empty", (text) => text)).toEqual(
      cardsMessages("empty", (text) => text),
    );
  });

  it("maps matrix empty and loading messages", () => {
    expect(message("empty", "matrix").title).toBe(
      "No providers enabled. Open Settings to enable a provider.",
    );
    expect(message("loading", "matrix").title).toBe("Reading provider limits…");
  });

  it("maps cockpit panel empty and loading messages", () => {
    const empty = message("empty", "cockpit");
    expect(empty.title).toBe("No providers enabled");
    expect(empty.subtitle).toBe("Enable a provider in Settings to monitor usage limits.");
    const loading = message("loading", "cockpit");
    expect(loading.title).toBe("Reading provider limits…");
    expect(loading.subtitle).toBe("Waiting for initial refresh to complete.");
    expect(loading.placeholder).toBe("…");
    expect(loading.accessibleText).toBe("Refreshing…");
    expect(loading.showPlaceholder).toBeTrue();
  });

  it("maps status bar placeholder surfaces without leaking panel text", () => {
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
    const result = messagesFor("matrix")("empty", (text) => `T:${text}`);
    expect(result.title).toBe("T:No providers enabled. Open Settings to enable a provider.");
  });
});

describe("phaseResult", () => {
  it("returns ready on every surface when the view is ready", () => {
    for (const surface of ALL_SURFACES) {
      expect(phaseResult(view("ready"), messagesFor(surface))).toEqual({ kind: "ready" });
    }
  });

  it("returns ready for status surfaces with an empty view and no words to show", () => {
    expect(phaseResult(view("empty"), messagesFor("pills"))).toEqual({ kind: "ready" });
    expect(phaseResult(view("empty"), messagesFor("compact"))).toEqual({ kind: "ready" });
  });

  it("returns a typed placeholder carrying the derived message for every loading surface", () => {
    expect(phaseResult(view("loading"), cardsRunningMessages)).toEqual({
      kind: "placeholder",
      phase: "loading",
      message: cardsRunningMessages("loading", (text) => text),
    });
    for (const surface of ALL_SURFACES.filter((candidate) => candidate !== "cards")) {
      const result = phaseResult(view("loading"), messagesFor(surface));
      expect(result.kind).toBe("placeholder");
      if (result.kind === "placeholder") {
        expect(result.message).toEqual(message("loading", surface));
      }
    }
  });

  it("returns a typed placeholder for panel empty states", () => {
    for (const surface of PANEL_SURFACES) {
      const result = phaseResult(view("empty"), messagesFor(surface));
      expect(result.kind).toBe("placeholder");
      if (result.kind === "placeholder") {
        expect(result.message).toEqual(message("empty", surface));
      }
    }
  });
});
