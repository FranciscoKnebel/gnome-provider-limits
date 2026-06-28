---
layout: splash
title: "Provider Limits"
excerpt: "GNOME Shell extension that monitors session limits for Codex, Claude, and OpenCode directly from the top bar"
header:
  overlay_color: "#2d3748"
  overlay_filter: 0.5
  actions:
    - label: "View on GitHub"
      url: "https://github.com/FranciscoKnebel/gnome-provider-limits"
    - label: "Install"
      url: "https://github.com/FranciscoKnebel/gnome-provider-limits#installation"
feature_row:
  - image_path: ""
    title: "Multi-provider"
    excerpt: "Codex, Claude, and OpenCode in a single indicator"
  - image_path: ""
    title: "Two display zones"
    excerpt: "Compact status bar for at-a-glance fields; expanded panel on click for full detail"
  - image_path: ""
    title: "Resilient readers"
    excerpt: "Each provider tries the best available source first (OAuth API), falls back to disk or CLI"
feature_row2:
  - image_path: ""
    title: "No persistent tokens"
    excerpt: "Tokens and cookies are read fresh on every refresh and discarded immediately"
  - image_path: ""
    title: "Adaptive polling"
    excerpt: "Refreshes every 10s while readings change, slows to 120s once stable"
  - image_path: ""
    title: "Internationalization"
    excerpt: "English and Brazilian Portuguese included"
---

[![CI](https://img.shields.io/github/actions/workflow/status/FranciscoKnebel/gnome-provider-limits/ci.yml?branch=main&label=CI&logo=github)](https://github.com/FranciscoKnebel/gnome-provider-limits/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/FranciscoKnebel/gnome-provider-limits/gh-pages/coverage.json)](https://github.com/FranciscoKnebel/gnome-provider-limits/actions/workflows/ci.yml)
[![GNOME Shell](https://img.shields.io/badge/GNOME_Shell-45%E2%80%9350-4a86cf)](https://extensions.gnome.org)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

{% include feature_row id="feature_row" %}

{% include feature_row id="feature_row2" %}

---

See the [README](https://github.com/FranciscoKnebel/gnome-provider-limits#readme) for installation, configuration, and development docs.
