---
layout: splash
title: "Provider Limits"
excerpt: "Monitor session limits for Codex, Claude, and OpenCode Go from your GNOME top bar without running CLI commands or opening web dashboards."
header:
  overlay_color: "#2d3748"
  overlay_filter: 0.5
  actions:
    - label: "View on GitHub"
      url: "https://github.com/FranciscoKnebel/gnome-provider-limits"
    - label: "Install"
      url: "https://github.com/FranciscoKnebel/gnome-provider-limits#installation"
feature_row_demo:
  - image_path: /assets/images/demo-status-bar.png
    alt: "Compact status bar in the GNOME top bar showing per-provider usage"
    title: "Status bar"
    excerpt: "An always-on indicator in the GNOME top bar that displays key fields at a glance."
  - image_path: /assets/images/demo-panel.png
    alt: "Expanded detail panel with per-provider limit fields and reset times"
    title: "Detail panel"
    excerpt: "Clicking the indicator opens a panel with all available fields, progress bars, and reset times, plus a manual refresh option."
  - image_path: /assets/images/demo-prefs.png
    alt: "Preferences window for per-provider field configuration"
    title: "Preferences"
    excerpt: "Choose which fields to show in the status bar versus the panel, enable or disable specific providers, and customize their display order."
---

[![CI](https://img.shields.io/github/actions/workflow/status/FranciscoKnebel/gnome-provider-limits/ci.yml?branch=main&label=CI&logo=github)](https://github.com/FranciscoKnebel/gnome-provider-limits/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/FranciscoKnebel/gnome-provider-limits/gh-pages/coverage.json)](https://github.com/FranciscoKnebel/gnome-provider-limits/actions/workflows/ci.yml)
[![GNOME Shell](https://img.shields.io/badge/GNOME_Shell-45--50-4a86cf)](https://extensions.gnome.org)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

{% include feature_row id="feature_row_demo" %}

## Why

AI coding tools restrict usage with hourly or weekly limits that reset at unpredictable times. To check your remaining limits, you usually have to run a command or open a browser tab. Both options interrupt your work.

This extension reads the local files that AI tools already save to your disk, such as session databases and auth tokens, and displays the information in the GNOME top bar. It does not require a separate login or send your credentials to any external servers.

## Features

- Supports Codex, Claude, and OpenCode Go in a single indicator.
- Displays information in two areas: a compact status bar and a detailed dropdown panel.
- Allows you to configure which fields show up in the status bar and panel, and customize their order for each provider.
- Adjusts the refresh frequency automatically, polling every 10 seconds during active usage and slowing to 120 seconds when stable.
- Falls back gracefully to disk files or CLI output if the primary API is unavailable, showing partial data instead of failing.
- Discards auth tokens and cookies immediately after each check. The extension does not store credentials.
- Multilanguage support.

## Provider support

| Provider        | Limit fields                                                                   | Telemetry fields                         | Data source                                                                |
| --------------- | ------------------------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------- |
| **Codex**       | Used % (5h), Used % (weekly), Reset at, Limit reached                          | Plan type                                | OAuth API (`chatgpt.com`), SQLite disk fallback (`~/.codex/logs_2.sqlite`) |
| **Claude**      | Used % (session 5h), Used % (weekly), Used % (Sonnet), Used % (Opus), Reset at | Extra usage status                       | OAuth API (`api.anthropic.com`), CLI PTY fallback                          |
| **OpenCode Go** | _(coming in v1.x via web cookies)_                                             | Total cost, Sessions count, Token expiry | SQLite disk (`~/.local/share/opencode/opencode.db`)                        |

## Requirements

- **GNOME Shell** version 45 to 50
- **Node.js** version 22 or newer (needed for build only)
- **glib-compile-schemas** (from `libglib2.0-dev-bin` or equivalent)
- **gnome-extensions** CLI (installed with GNOME Shell)
- **Python 3** installed at runtime (standard library only) to run the SQLite helper

## Installation

### From a release

Download the `.shell-extension.zip` file from the [releases page](https://github.com/FranciscoKnebel/gnome-provider-limits/releases) and run:

```bash
gnome-extensions install --force gnome-provider-limits@franciscoknebel.com.shell-extension.zip
gnome-extensions enable gnome-provider-limits@franciscoknebel.com
```

You can open the configuration window using the GNOME Extensions application or by running:

```bash
gnome-extensions prefs gnome-provider-limits@franciscoknebel.com
```

---

The [README](https://github.com/FranciscoKnebel/gnome-provider-limits#readme) contains details on configuration, development, and how to contribute.
