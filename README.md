<div align="center">
  <img src="docs/splash-screen.png" width="600" alt="Hephaestus logo">

  # Hephaestus
  *Visual polish and useful context for the Pi coding agent TUI*

  [![npm version](https://img.shields.io/npm/v/pi-ui-hephaestus?style=flat-square)](https://www.npmjs.com/package/pi-ui-hephaestus)
  [![TypeScript](https://img.shields.io/badge/TypeScript-%3E%3D5.0-blue?style=flat-square)](https://www.typescriptlang.org)
  [![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

</div>

Hephaestus transforms the Pi coding agent terminal into a polished, information-rich workspace. It adds visual polish, useful context, and safety features — making your daily interaction with the coding agent feel more like a professional IDE and less like a raw terminal.

## Why Hephaestus?

The default Pi TUI is functional but minimal. Hephaestus fills in the gaps:

- **No more abrupt startup** — an animated splash screen greets you
- **No more guessing** — git status, token usage, and context window are always visible
- **No more blind edits** — diffs are syntax-highlighted so you can see exactly what changed
- **No more accidental quits** — a double-press guard protects your work

## Features

### 🎬 Animated splash screen

A smooth reveal animation on startup: the Pi logo fades in diagonally, then version info and loaded context (models, prompts, skills, extensions, themes) appear with staggered fade-in. Gives the TUI a proper launch feel.

### ✏️ Framed editor pane

The input area gets a clean bordered frame with decorative `▁`/`▔` top/bottom edges, visually separating it from chat history. Includes a **double-press quit guard** — pressing the clear key once shows a "press again to quit" hint, preventing accidental exits mid-conversation.

### 🤫 Muted thinking blocks

Reasoning/thinking content renders in muted colors so it doesn't compete with actual responses. Code blocks inside thinking sections are automatically unindented for readability. The label text and color are fully customizable.

### ⏱️ Response times

Each user message shows a right-aligned timer (`12.3s`, `2m 14s`) displaying how long the AI took to respond. Makes it easy to spot which prompts trigger long reasoning cycles.

### 📊 Rich single-line footer

A compact status bar at the bottom packs maximum information:

| Element | Description |
|---------|-------------|
| **Directory** | Current working directory name |
| **Git branch** | With clean/dirty indicator (`●` staged, `~` unstaged, `U` untracked) |
| **Model** | Active model name |
| **Thinking** | Level indicator when agent is reasoning |
| **Worktree** | Branch name if using git worktrees |
| **Tokens** | ↑input ↓output R-read W-write + cost estimate |
| **Context bar** | Progress bar with color warnings at 80% (yellow) and 95% (red) |

### 🔍 Syntax-highlighted diff rendering

When the agent writes or edits files, Hephaestus renders a **Shiki-powered diff** instead of plain text:

- **Split view** — side-by-side old/new with diagonal stripes in empty slots
- **Unified view** — stacked fallback when terminal is too narrow
- **Word-level emphasis** — brighter backgrounds on changed characters
- **Auto-derived colors** — diffs adapt to your Pi theme automatically
- **Graceful degradation** — falls back to plain text if Shiki fails

### 🖼️ Image paste

Paste images from your clipboard directly into your messages:

- **Ctrl+V** (Linux) / **Alt+V** (Windows) — paste image from clipboard
  - On Linux, Ctrl+V is used exclusively for image paste (pi uses Ctrl+Shift+V for text paste)
  - On Windows, Alt+V is used because the terminal reserves Ctrl+V for text paste
- **Drag-and-drop** — drop an image file into the editor
- Images are attached as content blocks and sent to the agent
- Inline preview renders after submit (controlled by `terminal.showImages` in settings)

#### Settings

Toggle image preview in `/hephaestus` settings or via `~/.pi/agent/settings.json`:

```json
{
  "terminal": {
    "showImages": true
  }
}
```

When `showImages` is `false`, images are still attached to messages but no inline preview is shown.

## Quick Start

```bash
# Install globally
npm install -g pi-ui-hephaestus

# Restart Pi — Hephaestus loads automatically
pi
```

That's it. No configuration needed — everything works out of the box with sensible defaults.

## Settings

Run the `/hephaestus` slash command to open the interactive settings panel. Navigate with arrow keys, press Enter to toggle or edit, Save to persist, ESC to cancel.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| **Muted Theme** | Toggle | Off | Use subdued colors for thinking blocks |
| **Code Unindent** | Toggle | On | Remove common indentation from code blocks inside thinking sections |
| **Label Text** | Text | `Thinking...` | Custom prefix shown before thinking blocks |
| **Label Color** | Text | `255,215,0` | RGB color for the thinking label (e.g. `255,215,0`) |
| **Diff Theme** | Text | `github-dark` | Shiki syntax-highlighting theme for diffs |
| **Split Min Width** | Number | `150` | Minimum terminal columns to show split diff view (≥ 100) |
| **Split Min Code Width** | Number | `60` | Minimum code columns per side in split view (≥ 30) |

### Configuration file

Settings are persisted in `~/.pi/agent/settings.json` under the `"hephaestus"` key:

```json
{
  "hephaestus": {
    "mutedTheme": false,
    "codeUnindent": true,
    "labelText": "Thinking...",
    "labelColor": "255,215,0",
    "diffTheme": "github-dark",
    "diffSplitMinWidth": 150,
    "diffSplitMinCodeWidth": 60
  }
}
```

You can edit this file directly for fine-tuning. Changes take effect on the next session.

## Architecture

Hephaestus is structured as a collection of focused modules:

```
src/
├── index.ts              ← Thin orchestrator — wires everything together
├── config.ts             ← Configuration loading/saving
├── settings.ts           ← Settings UI with factory-based submenus
├── chrome.ts             ← Editor chrome constants and palette resolution
│
├── utils/
│   ├── ansi.ts           ← Unified ANSI utilities (stripAnsi, stripSgr, etc.)
│   ├── text.ts           ← Text formatting (clampLine, isParentBorder)
│   └── color.ts          ← HSL/RGB color math utilities
│
├── editor/index.ts       ← Custom editor with quit guard
├── footer/               ← Status bar (git, tokens, context window)
├── message/index.ts      ← Response time patching
├── startup/              ← Animated splash screen (logo, sections, version)
├── thinking/             ← Muted thinking block rendering
└── diff-render/          ← Shiki-powered diff rendering
```

Each module has a single responsibility and communicates through well-defined interfaces. The main entry point (`index.ts`) is a thin orchestrator that wires modules together.

## Requirements

- Pi TUI with extension support (`@mariozechner/pi-coding-agent` >= 0.1.0)
- Node.js >= 24
