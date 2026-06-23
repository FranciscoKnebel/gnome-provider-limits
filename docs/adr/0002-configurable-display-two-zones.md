# Configurable display per provider, two zones (status bar + panel)

Each provider exposes its own set of fields (e.g. prompts used, % remaining,
reset timestamp), because each CLI persists different data. The extension
doesn't force a single schema. Each reader publishes the fields it can read,
and the user configures:

- **which fields** appear for each provider;
- **where** each field appears: in the status bar (compact zone) or in the
  panel (expanded window on click);
- **in which order** fields and providers appear;
- **which providers** appear (multiple simultaneously, per config).

The status bar is minimalist: few characters, lightweight, low footprint. The
panel shows detail that doesn't fit in the status bar.

Rationale: providers have no common denominator of fields; trying to normalize
everything to a single schema either loses information (rich provider) or
invents data (poor provider). Letting the user choose per provider keeps the
UI honest with what each CLI writes and gives control over status bar space.
