---
layout: splash
title: "Provider Limits"
excerpt: "Monitor usage limits for Codex, Claude, OpenCode Go, Grok/SuperGrok, Cursor, and Google AI from your GNOME top bar, with selectable Status Bar and Panel styles."
header:
  overlay_color: "#2d3748"
  overlay_filter: 0.5
  actions:
    - label: "Install from GNOME Extensions"
      url: "https://extensions.gnome.org/extension/10340/provider-limits/"
    - label: "Latest release"
      url: "https://github.com/FranciscoKnebel/gnome-provider-limits/releases/latest"
    - label: "View on GitHub"
      url: "https://github.com/FranciscoKnebel/gnome-provider-limits"
---

[![CI](https://img.shields.io/github/actions/workflow/status/FranciscoKnebel/gnome-provider-limits/ci.yml?branch=main&label=CI&logo=github)](https://github.com/FranciscoKnebel/gnome-provider-limits/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/FranciscoKnebel/gnome-provider-limits/gh-pages/coverage.json)](https://github.com/FranciscoKnebel/gnome-provider-limits/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/FranciscoKnebel/gnome-provider-limits)](https://github.com/FranciscoKnebel/gnome-provider-limits/releases/latest)
[![GNOME Shell](https://img.shields.io/badge/GNOME_Shell-45--50-4a86cf)](https://extensions.gnome.org)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

## Why

AI coding tools restrict usage with hourly or weekly limits that reset at unpredictable times. To check your remaining limits, you usually have to run a command or open a browser tab. Both options interrupt your work.

This extension reads the local files that AI tools already save to your disk, such as session databases and auth tokens, and displays the information in the GNOME top bar. It reuses your existing logins and sends credentials only to their respective first-party provider APIs to read usage. There is no separate extension account or third-party credential collection.

## Features

- Supports Codex, Claude, OpenCode Go, Grok/SuperGrok, Cursor, and Google AI
  (Gemini and Antigravity) in a single indicator. Grok, Cursor, and Google can be
  enabled in preferences.
- Displays information in two areas: a compact status bar and a detailed dropdown panel.
- Lets you choose a Status Bar Style (Pills, Gauges, or Compact) and Panel Style
  (Gauges, Cards, or Compact) independently.
- Allows you to configure which fields show up in the status bar and panel, and customize their order for each provider.
- Adjusts the refresh frequency automatically, polling every 10 seconds during active usage and slowing to 120 seconds when stable.
- Falls back gracefully to disk files or CLI output if the primary API is unavailable, showing partial data instead of failing.
- Discards auth tokens and cookies immediately after each check. The extension does not store credentials.
- Multilanguage support.

## Provider support

| Provider             | Limit fields                                                                                       | Telemetry fields                                                | Data source                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Codex**            | Used % (5h), Used % (weekly), Reset at, Limit reached                                              | Plan type                                                       | OAuth API (`chatgpt.com`), SQLite disk fallback (`~/.codex/logs_2.sqlite`)                                   |
| **Claude**           | Used % (session 5h), Used % (weekly), Used % (Sonnet weekly), Used % (Opus weekly), Reset at       | Extra usage status                                              | OAuth API (`api.anthropic.com`), CLI PTY fallback                                                            |
| **OpenCode Go**      | Used % (rolling 5h), Used % (weekly), Used % (monthly), Reset at, Limit reached                    | Total cost, Sessions count                                      | Usage API (`opencode.ai/zen/go/v1/usage`), SQLite telemetry (`~/.local/share/opencode/opencode.db`)          |
| **Grok / SuperGrok** | Used % (credits), Remaining % (credits), Reset at (credits)                                        | Purchased credits (USD), Shared subscription credits, Plan type | Grok subscription credits API (`cli-chat-proxy.grok.com`), login from `~/.grok/auth.json`                    |
| **Cursor**           | Used % (credits), Remaining % (credits), Reset at (credits), Used % (Auto + Composer / API), Limit | Remaining credits (USD), On-demand spend (USD), Plan type       | Cursor SDK `DashboardService` (`api2.cursor.sh`), login from `~/.cursor/sdk/auth.json` or `~/.config/cursor` |
| **Google**           | Used % (session 5h), Used % (weekly), Used % (Claude & GPT 5h / weekly), Reset at, Limit reached   | Plan type                                                       | Google Cloud Code quota API (`cloudcode-pa.googleapis.com`), login from Gemini CLI or Antigravity            |

## Requirements

- **GNOME Shell** version 45 to 50
- **Node.js** version 22 or newer (needed for build only)
- **glib-compile-schemas** (from `libglib2.0-dev-bin` or equivalent)
- **gnome-extensions** CLI (installed with GNOME Shell)
- **Python 3** installed at runtime (standard library only) to run the SQLite helper

## Installation

### From GNOME Extensions

Install Provider Limits from the
[GNOME Extensions listing](https://extensions.gnome.org/extension/10340/provider-limits/).

### From a GitHub release

Download the `.shell-extension.zip` file from the
[latest release](https://github.com/FranciscoKnebel/gnome-provider-limits/releases/latest) and run:

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
