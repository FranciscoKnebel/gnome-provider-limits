import { providerRecord } from "../../src/constants.js";
import type { ProviderViewContext, ViewPhase } from "../../src/ui/viewContext.js";
import {
  cardsMessages,
  cardsRunningMessages,
  cockpitMessages,
  matrixMessages,
  noProvidersPresentation,
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
const NO_PRESENTATION = { kind: "title", title: "", subtitle: "" } as const;

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
  it("shares one canonical no-providers copy across panel surfaces", () => {
    expect(cockpitMessages("empty", (text) => text)).toEqual(
      noProvidersPresentation((text) => text),
    );
    expect(cardsMessages("empty", (text) => text)).toEqual(noProvidersPresentation((text) => text));
  });

  it("returns one empty presentation for ready on every surface", () => {
    for (const surface of ALL_SURFACES) {
      expect(message("ready", surface)).toEqual(NO_PRESENTATION);
    }
  });

  it("maps cards empty and loading messages", () => {
    const empty = message("empty", "cards");
    expect(empty.kind).toBe("title");
    if (empty.kind === "title") {
      expect(empty.title).toBe("No providers enabled");
      expect(empty.subtitle).toBe("Enable a provider in Settings to monitor usage limits.");
    }
    const loading = message("loading", "cards");
    expect(loading.kind).toBe("title");
    if (loading.kind === "title") expect(loading.title).toBe("Waiting for provider data…");
  });

  it("keeps the cards-only running copy outside the shared contract", () => {
    const running = cardsRunningMessages("loading", (text) => text);
    expect(running.kind).toBe("title");
    if (running.kind === "title") expect(running.title).toBe("Loading provider limits…");
    expect(cardsRunningMessages("empty", (text) => text)).toEqual(
      cardsMessages("empty", (text) => text),
    );
  });

  it("maps matrix empty and loading messages", () => {
    const empty = message("empty", "matrix");
    const loading = message("loading", "matrix");
    expect(empty.kind).toBe("title");
    expect(loading.kind).toBe("title");
    if (empty.kind === "title") {
      expect(empty.title).toBe("No providers enabled. Open Settings to enable a provider.");
    }
    if (loading.kind === "title") expect(loading.title).toBe("Reading provider limits…");
  });

  it("maps cockpit panel empty and loading messages", () => {
    const empty = message("empty", "cockpit");
    expect(empty.kind).toBe("title");
    if (empty.kind === "title") {
      expect(empty.title).toBe("No providers enabled");
      expect(empty.subtitle).toBe("Enable a provider in Settings to monitor usage limits.");
    }
    const loading = message("loading", "cockpit");
    expect(loading.kind).toBe("title");
    if (loading.kind === "title") {
      expect(loading.title).toBe("Reading provider limits…");
      expect(loading.subtitle).toBe("Waiting for initial refresh to complete.");
    }
  });

  it("maps status bar spinner surfaces without leaking panel text", () => {
    const pills = message("loading", "pills");
    expect(pills.kind).toBe("spinner");
    if (pills.kind === "spinner") {
      expect(pills.placeholder).toBe("…");
      expect(pills.accessibleText).toBe("Loading provider limits…");
    }
    expect(message("empty", "pills")).toEqual(NO_PRESENTATION);

    const gauges = message("loading", "gauges");
    expect(gauges.kind).toBe("spinner");
    if (gauges.kind === "spinner") {
      expect(gauges.placeholder).toBe("…");
      expect(gauges.accessibleText).toBe("Refreshing…");
    }
    expect(message("empty", "gauges")).toEqual(NO_PRESENTATION);

    const compact = message("loading", "compact");
    expect(compact.kind).toBe("spinner");
    if (compact.kind === "spinner") {
      expect(compact.placeholder).toBe("…");
      expect(compact.accessibleText).toBe("Reading provider limits…");
    }
    expect(message("empty", "compact")).toEqual(NO_PRESENTATION);
  });

  it("translates mapped text through the supplied translator", () => {
    const result = messagesFor("matrix")("empty", (text) => `T:${text}`);
    expect(result.kind).toBe("title");
    if (result.kind === "title") {
      expect(result.title).toBe("T:No providers enabled. Open Settings to enable a provider.");
    }
  });
});

describe("phaseResult", () => {
  it("returns ready on every surface when the view is ready", () => {
    for (const surface of ALL_SURFACES) {
      expect(phaseResult(view("ready"), messagesFor(surface))).toEqual({ kind: "ready" });
    }
  });

  it("returns ready for status surfaces with an empty view and no words to show", () => {
    for (const surface of ["pills", "gauges", "compact"] as const) {
      expect(phaseResult(view("empty"), messagesFor(surface))).toEqual({ kind: "ready" });
    }
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
