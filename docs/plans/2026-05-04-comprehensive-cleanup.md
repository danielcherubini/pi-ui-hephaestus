# Comprehensive Codebase Cleanup Plan

**Goal:** Refactor pi-ui-hephaestus into a well-organized codebase with clear module boundaries, unified utilities, and reduced file complexity.

**Architecture:** Split monolithic files into focused modules. `src/index.ts` goes from ~350 lines to ~150 lines as a thin orchestrator. `src/startup/index.ts` goes from ~640 lines to ~280 lines. Create `src/utils/` directory with unified ANSI, text, and color utilities. Extract config/settings into dedicated modules. Rename confusing modules.

**Tech Stack:** TypeScript, Node.js ESM, pi SDK (`@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`)

---

### Task 1: Create utils/ Directory with Unified ANSI, Text, and Color Utilities

**Context:**
The codebase has three different `stripAnsi` implementations scattered across `src/utils.ts`, `src/startup/index.ts`, and `src/diff-render/ansi.ts`. The startup module also has duplicate color helpers (`gray`, `rgb`, `extractRgb`, `lerp`). The HSL/RGB math in `src/thinking/hsl.ts` is pure utility code that doesn't belong inside the `thinking/` module. This task creates `src/utils/` as a single source of truth for all shared utilities.

**Files:**
- Create: `src/utils/ansi.ts`
- Create: `src/utils/text.ts`
- Create: `src/utils/color.ts`
- Create: `src/utils/index.ts`

**What to implement:**

#### 1a. `src/utils/ansi.ts` — Canonical ANSI utilities

This file combines the most capable implementations from the codebase. It exports two strip functions:

```typescript
// src/utils/ansi.ts

/** Strip ALL ANSI escapes (SGR color/style + OSC sequences). Trims whitespace. Use for text extraction. */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)/g, "").trim();
}

/** Strip only SGR color/style escapes (no trim). Use for width calculations. */
export function stripSgr(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// --- Color helpers (moved from startup/index.ts) ---
const ESC_RE = "\u001b";
const ANSI_CAPTURE_RE = new RegExp(`${ESC_RE}\\[([^m]*)m`, "g");
const ANSI_PARAM_CAPTURE_RE = new RegExp(`${ESC_RE}\\[([0-9;]*)m`, "g");

function gray(level: number, text: string): string {
  const l = Math.max(0, Math.min(255, Math.floor(level)));
  return `\x1b[38;2;${l};${l};${l}m${text}\x1b[0m`;
}

function rgb(r: number, g: number, b: number, text: string): string {
  return `\x1b[38;2;${Math.floor(r)};${Math.floor(g)};${Math.floor(b)}m${text}\x1b[0m`;
}

function extractRgb(themed: string): [number, number, number] {
  const m = themed.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
  return m ? [+m[1], +m[2], +m[3]] : [100, 100, 100];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// --- Width calculation helpers (from diff-render/ansi.ts) ---
export function tabs(s: string): string {
  return s.replace(/\t/g, "  ");
}

export function fit(s: string, w: number): string {
  if (w <= 0) return "";
  const plain = stripSgr(s);
  if (plain.length <= w) return s + " ".repeat(w - plain.length);
  const showW = w > 2 ? w - 1 : w;
  let vis = 0, i = 0;
  while (i < s.length && vis < showW) {
    if (s[i] === "\x1b") {
      const e = s.indexOf("m", i);
      if (e !== -1) { i = e + 1; continue; }
    }
    vis++;
    i++;
  }
  return w > 2 ? `${s.slice(0, i)}\x1b[0m\x1b[38;2;80;80;80m›\x1b[0m` : `${s.slice(0, i)}\x1b[0m`;
}

export function ansiState(s: string): string {
  let fg = "", bg = "";
  for (const match of s.matchAll(ANSI_CAPTURE_RE)) {
    const p = match[1] ?? "";
    const seq = match[0] ?? "";
    if (p === "0") { fg = ""; bg = ""; }
    else if (p === "39") { fg = ""; }
    else if (p.startsWith("38;")) { fg = seq; }
    else if (p.startsWith("48;")) { bg = seq; }
  }
  return bg + fg;
}

export function lnum(n: number | null, w: number, fg = "\x1b[38;2;100;100;100m"): string {
  if (n === null) return " ".repeat(w);
  const v = String(n);
  return `${fg}${" ".repeat(Math.max(0, w - v.length))}${v}\x1b[0m`;
}

export function rule(w: number): string {
  return `\x1b[48;2;18;18;18m\x1b[38;2;50;50;50m${"─".repeat(w)}\x1b[0m`;
}

export function shortPath(cwd: string, home: string, p: string): string {
  const r = relative(cwd, p);
  if (!r.startsWith("..") && !r.startsWith("/")) return r;
  return p.replace(home, "~");
}

export function summarize(a: number, d: number): string {
  const p: string[] = [];
  if (a > 0) p.push(`\x1b[38;2;100;180;120m+${a}\x1b[0m`);
  if (d > 0) p.push(`\x1b[38;2;200;100;100m-${d}\x1b[0m`);
  return p.length ? p.join(" ") : `\x1b[38;2;80;80;80mno changes\x1b[0m`;
}

// Re-export the color helpers (used by logo.ts)
export { gray, rgb, extractRgb, lerp };

// Import relative for shortPath
import { relative } from "node:path";
```

**Important notes:**
- `stripAnsi` uses the broad regex (SGR + OSC) with `.trim()` — for text extraction
- `stripSgr` uses narrow SGR-only regex without trim — for width calculations
- `gray`, `rgb`, `extractRgb`, `lerp` are moved from startup/index.ts (they're ANSI color helpers, not logo-specific)
- `tabs`, `fit`, `ansiState`, `lnum`, `rule`, `shortPath`, `summarize` are moved from diff-render/ansi.ts

#### 1b. `src/utils/text.ts` — Text formatting helpers

```typescript
// src/utils/text.ts
import { truncateToWidth } from "@mariozechner/pi-tui";
import { stripSgr } from "./ansi.js";

/** Clamp a line to maxW visible characters, preserving ANSI escapes. */
export function clampLine(line: string, maxW: number): string {
  return truncateToWidth(line, maxW);
}

/** Clamp an array of lines to maxW visible characters each. */
export function clampLines(lines: string[], maxW: number): string[] {
  return lines.map((l) => clampLine(l, maxW));
}

// isParentBorder uses the narrow SGR-only strip (no trim) for char-level checks
export const isParentBorder = (s: string) => {
  const clean = stripSgr(s);
  return clean.length > 0 && clean[0] === "─";
};

export const isParentBorder = (s: string) => {
  const clean = stripAnsi(s);
  return clean.length > 0 && clean[0] === "─";
};

export function formatKey(key: string | undefined): string {
  if (!key) return "that key";
  return key
    .split("+")
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "ctrl") return "Ctrl";
      if (lower === "alt") return "Alt";
      if (lower === "shift") return "Shift";
      if (lower === "cmd" || lower === "meta") return "Cmd";
      return part.length === 1
        ? part.toUpperCase()
        : part[0]!.toUpperCase() + part.slice(1);
    })
    .join("+");
}
```

**Note:** This file keeps the existing `stripAnsi` (narrow, no trim) for `isParentBorder`'s char-level check. The other functions are moved from `src/utils.ts`.

#### 1c. `src/utils/color.ts` — Pure HSL/RGB math (moved from `thinking/hsl.ts`)

Copy the ENTIRE contents of `src/thinking/hsl.ts` to `src/utils/color.ts` verbatim. This file contains: `RGB`, `HSL` interfaces, `XTERM_16` palette, `CUBE_LEVELS`, and all color conversion functions (`hexToRgb`, `rgbToHex`, `rgbToHsl`, `hslToRgb`, `ansi256ToRgb`, `parseAnsiFgToRgb`, `deriveDimColor`, `rgbToTruecolorFg`).

#### 1d. `src/utils/index.ts` — Barrel file

```typescript
// src/utils/index.ts
export { clampLine, clampLines, isParentBorder, formatKey } from "./text.js";
export { stripAnsi, stripSgr, tabs, fit, ansiState, lnum, rule, shortPath, summarize, gray, rgb, extractRgb, lerp } from "./ansi.js";
export type { RGB, HSL } from "./color.js";
```

**Steps:**
- [ ] Create `src/utils/` directory
- [ ] Create `src/utils/ansi.ts` with the complete content shown above
- [ ] Create `src/utils/text.ts` with the complete content shown above
- [ ] Copy `src/thinking/hsl.ts` entirely to `src/utils/color.ts` (verbatim, no changes)
- [ ] Create `src/utils/index.ts` with the barrel re-exports
- [ ] Run `npx tsc --noEmit` to verify types compile
  - This will fail because old files still exist and other modules import from old paths — that's expected. We'll fix imports in later tasks.

**Acceptance criteria:**
- [ ] `src/utils/ansi.ts` exists with both `stripAnsi` (broad+trim) and `stripSgr` (narrow, no trim)
- [ ] `src/utils/text.ts` exists with `clampLine`, `clampLines`, `isParentBorder`, `formatKey`
- [ ] `src/utils/color.ts` exists with all HSL/RGB functions from `thinking/hsl.ts`
- [ ] `src/utils/index.ts` re-exports from ansi.ts and text.ts
- [ ] TypeScript compiles (old import errors are expected — they'll be fixed in later tasks)

---

### Task 2: Create config.ts and settings.ts Abstraction

**Context:**
`src/index.ts` currently contains `loadConfig()`, `saveConfig()`, and `openSettings()` (~200 lines of config management and settings UI). This task extracts these into dedicated modules. The settings UI uses factory functions to eliminate ~150 lines of duplicated inline submenu code.

**Files:**
- Create: `src/config.ts`
- Create: `src/settings.ts`

**What to implement:**

#### 2a. `src/config.ts` — Configuration management

```typescript
// src/config.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

// Note: HephaestusConfig does NOT extend HephaestusDiffConfig from diff-render/index.ts
// because that would create a circular dependency (diff-render imports config via registerDiffTools).
// Instead, we define the diff fields inline. The types are structurally compatible —
// registerDiffTools only reads diffTheme, diffSplitMinWidth, diffSplitMinCodeWidth.
export interface HephaestusConfig {
  // Thinking settings
  mutedTheme: boolean;
  codeUnindent: boolean;
  labelText: string;
  labelColor: string;
  // Diff settings (structurally compatible with HephaestusDiffConfig)
  diffTheme: string;
  diffSplitMinWidth: number;
  diffSplitMinCodeWidth: number;
}

const SETTINGS_PATH = join(getAgentDir(), "settings.json");

export const DEFAULT_CONFIG: HephaestusConfig = {
  mutedTheme: false,
  codeUnindent: true,
  labelText: "Thinking...",
  labelColor: "255,215,0",
  diffTheme: "github-dark",
  diffSplitMinWidth: 150,
  diffSplitMinCodeWidth: 60,
};

export function loadConfig(): HephaestusConfig {
  if (existsSync(SETTINGS_PATH)) {
    try {
      const full = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
      return { ...DEFAULT_CONFIG, ...(full.hephaestus ?? {}) };
    } catch {
      /* ignore corrupt file */
    }
  }
  return DEFAULT_CONFIG;
}

export function saveConfig(config: HephaestusConfig): void {
  let full: Record<string, unknown> = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      full = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
    } catch {
      /* ignore corrupt file */
    }
  }
  full.hephaestus = config;
  writeFileSync(SETTINGS_PATH, JSON.stringify(full, null, 2), "utf-8");
}
```

#### 2b. `src/settings.ts` — Settings UI with factory submenus

This file contains:
1. Factory functions for text and number submenus
2. The `openSettings()` function that builds the settings list

```typescript
// src/settings.ts
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { KeybindingsManager, getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { SettingsList, SettingItem, TUI } from "@mariozechner/pi-tui";
import { loadConfig, saveConfig, DEFAULT_CONFIG, type HephaestusConfig } from "./config.js";

// ── Factory: text submenu ───────────────────────────────────────────────

function createTextSubmenu(opts: {
  label: string;
  cancelHint?: string;
  confirmHint?: string;
}): SettingItem["submenu"] {
  return (currentValue: string, done: (selectedValue?: string) => void) => {
    const state = { value: currentValue };
    return {
      invalidate(): void { /* no-op */ },
      render(): string[] {
        const hints: string[] = [];
        if (opts.cancelHint) hints.push(opts.cancelHint);
        if (opts.confirmHint) hints.push(opts.confirmHint);
        return [
          opts.label,
          "",
          `  ${state.value}`,
          "",
          hints.join(" | "),
        ];
      },
      handleInput(data: string): void {
        if (data === "\x1b") { done(); return; }
        if (data === "\r" || data === "\n") { done(state.value); return; }
        if (data === "\x7f" || data === "\x08") { state.value = state.value.slice(0, -1); }
        else if (data.length === 1) { state.value += data; }
      },
    };
  };
}

// ── Factory: number submenu ─────────────────────────────────────────────

function createNumberSubmenu(opts: {
  label: string;
  cancelHint?: string;
  confirmHint?: string;
  min?: number;
}): SettingItem["submenu"] {
  return (currentValue: string, done: (selectedValue?: string) => void) => {
    const state = { value: currentValue };
    return {
      invalidate(): void { /* no-op */ },
      render(): string[] {
        const hints: string[] = [];
        if (opts.cancelHint) hints.push(opts.cancelHint);
        if (opts.confirmHint) hints.push(opts.confirmHint);
        return [
          opts.label,
          "",
          `  ${state.value}`,
          "",
          hints.join(" | "),
        ];
      },
      handleInput(data: string): void {
        if (data === "\x1b") { done(); return; }
        if (data === "\r" || data === "\n") {
          const n = parseInt(state.value, 10);
          if (Number.isFinite(n) && (!opts.min || n >= opts.min)) done(String(n));
          else done();
          return;
        }
        if (data === "\x7f" || data === "\x08") { state.value = state.value.slice(0, -1); }
        else if (/^\d$/.test(data)) { state.value += data; }
      },
    };
  };
}

// ── Settings UI ─────────────────────────────────────────────────────────

export function openSettings(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const config: HephaestusConfig = { ...DEFAULT_CONFIG };

  // Load saved config
  const savedConfig = loadConfig();
  Object.assign(config, savedConfig);

  ctx.ui.custom((tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: HephaestusConfig) => void) => {
    const items: SettingItem[] = [
      {
        id: "mutedTheme",
        label: "Muted Theme",
        description: "Use muted colors for thinking blocks",
        currentValue: config.mutedTheme ? "On" : "Off",
        values: ["On", "Off"],
      },
      {
        id: "codeUnindent",
        label: "Code Unindent",
        description: "Remove 2-space indent from code blocks",
        currentValue: config.codeUnindent ? "On" : "Off",
        values: ["On", "Off"],
      },
      {
        id: "labelText",
        label: "Label Text",
        description: "Text shown before thinking blocks",
        currentValue: config.labelText,
        submenu: createTextSubmenu({
          label: "Enter label text (ESC to cancel):",
          cancelHint: "ESC: cancel",
          confirmHint: "ENTER: confirm",
        }),
      },
      {
        id: "labelColor",
        label: "Label Color",
        description: "RGB color for thinking label (e.g. 255,215,0)",
        currentValue: config.labelColor,
        submenu: createTextSubmenu({
          label: "Enter RGB color (ESC to cancel):",
          cancelHint: "ESC: cancel",
          confirmHint: "ENTER: confirm",
        }),
      },
      {
        id: "diffTheme",
        label: "Diff Theme",
        description: "Shiki syntax-highlighting theme for diffs",
        currentValue: config.diffTheme,
        submenu: createTextSubmenu({
          label: "Enter Shiki theme (ESC to cancel):",
          cancelHint: "ESC: cancel",
          confirmHint: "ENTER: confirm",
        }),
      },
      {
        id: "diffSplitMinWidth",
        label: "Split Min Width",
        description: "Min terminal columns for split view (≥ 100)",
        currentValue: String(config.diffSplitMinWidth),
        submenu: createNumberSubmenu({
          label: "Enter min width (ESC to cancel):",
          cancelHint: "ESC: cancel",
          confirmHint: "min 100",
          min: 100,
        }),
      },
      {
        id: "diffSplitMinCodeWidth",
        label: "Split Min Code Width",
        description: "Min code columns per side in split (≥ 30)",
        currentValue: String(config.diffSplitMinCodeWidth),
        submenu: createNumberSubmenu({
          label: "Enter min code width (ESC to cancel):",
          cancelHint: "ESC: cancel",
          confirmHint: "min 30",
          min: 30,
        }),
      },
      {
        id: "save",
        label: "Save",
        description: "Save changes and exit",
        currentValue: "",
        values: ["Save"],
      },
    ];

    const settingsList = new SettingsList(items, 10, getSettingsListTheme(), (id: string, newValue: string) => {
      switch (id) {
        case "mutedTheme": config.mutedTheme = newValue === "On"; break;
        case "codeUnindent": config.codeUnindent = newValue === "On"; break;
        case "labelText": config.labelText = newValue; break;
        case "labelColor": config.labelColor = newValue; break;
        case "diffTheme": config.diffTheme = newValue; break;
        case "diffSplitMinWidth": config.diffSplitMinWidth = parseInt(newValue, 10); break;
        case "diffSplitMinCodeWidth": config.diffSplitMinCodeWidth = parseInt(newValue, 10); break;
        case "save": {
          saveConfig(config);
          done(config);
          return;
        }
      }
    }, () => {
      // ESC cancels without saving
      done(config);
    });

    return settingsList;
  });
}
```

**Note:** The `openSettings` function uses dynamic `import()` for `loadConfig` and `saveConfig` to avoid circular dependencies (settings.ts imports from config.ts, but config.ts doesn't import from settings.ts). This is safe because the dynamic import happens inside the async callback, not at module load time.

**Steps:**
- [ ] Create `src/config.ts` with the complete content shown above
- [ ] Create `src/settings.ts` with the complete content shown above
- [ ] Run `npx tsc --noEmit` to verify types compile
  - This will fail because old files still exist and index.ts imports config/settings logic inline — expected. We'll fix in Task 6.

**Acceptance criteria:**
- [ ] `src/config.ts` exports `HephaestusConfig`, `DEFAULT_CONFIG`, `loadConfig()`, `saveConfig()`
- [ ] `src/settings.ts` exports `openSettings()` with factory-based submenus
- [ ] Factory functions produce the correct `{ invalidate, render, handleInput }` shape
- [ ] Number submenu validates min values (100 for width, 30 for code width)
- [ ] Text submenu handles ESC to cancel, ENTER to confirm, backspace to delete

---

### Task 3: Rename visual.ts to chrome.ts and Update Imports

**Context:**
`src/visual.ts` is confusingly named — it contains editor chrome constants (borders, frames, prefixes) and palette resolution. Renaming to `chrome.ts` communicates its purpose clearly. Two files import from it: `editor/index.ts` and `message/index.ts`.

**Files:**
- Create: `src/chrome.ts` (copy of visual.ts)
- Modify: `src/editor/index.ts` (update import path)
- Modify: `src/message/index.ts` (update import path)
- Delete: `src/visual.ts` (after verifying no other imports)

**What to implement:**

#### 3a. Create `src/chrome.ts`

Copy the ENTIRE contents of `src/visual.ts` to `src/chrome.ts` verbatim. No changes to content.

#### 3b. Update `src/editor/index.ts`

Change the import line:
```typescript
// FROM:
import { RESET, PAD_X, PI_STR, PI_WIDTH, PI_SYMBOL_COL, AUTOCOMPLETE_CURSOR, HINT_MARGIN_RIGHT, resolvePalette } from "../visual.js";
// TO:
import { RESET, PAD_X, PI_STR, PI_WIDTH, PI_SYMBOL_COL, AUTOCOMPLETE_CURSOR, HINT_MARGIN_RIGHT, resolvePalette } from "../chrome.js";
```

#### 3c. Update `src/message/index.ts`

Change the import line:
```typescript
// FROM:
import { RESET, resolvePalette, setThemeBg } from "../visual.js";
// TO:
import { RESET, resolvePalette, setThemeBg } from "../chrome.js";
```

#### 3d. Delete `src/visual.ts`

After verifying no other files import from `../visual.js`, delete the file:
```bash
rm src/visual.ts
```

**Steps:**
- [ ] Copy `src/visual.ts` entirely to `src/chrome.ts` (verbatim, no changes)
- [ ] Update import in `src/editor/index.ts`: `../visual.js` → `../chrome.js`
- [ ] Update import in `src/message/index.ts`: `../visual.js` → `../chrome.js`
- [ ] Delete `src/visual.ts`
- [ ] Run `npx tsc --noEmit` to verify types compile
  - Should show fewer errors than before (visual imports fixed)

**Acceptance criteria:**
- [ ] `src/chrome.ts` exists with identical content to the original `visual.ts`
- [ ] `src/editor/index.ts` imports from `../chrome.js`
- [ ] `src/message/index.ts` imports from `../chrome.js`
- [ ] `src/visual.ts` no longer exists
- [ ] No other files import from `../visual.js`

---

### Task 4: Split Startup Module into Focused Files

**Context:**
`src/startup/index.ts` is ~640 lines mixing logo animation, version fetching, section parsing, column formatting, and chat container patching. This task extracts four focused modules.

**Files:**
- Create: `src/startup/logo.ts`
- Create: `src/startup/sections.ts`
- Create: `src/startup/version.ts`
- Create: `src/startup/capture.ts`
- Modify: `src/startup/index.ts` (slim down to orchestrator)

**What to implement:**

#### 4a. `src/startup/logo.ts` — Logo animation (~120 lines)

```typescript
// src/startup/logo.ts
import { visibleWidth } from "@mariozechner/pi-tui";
import { gray, rgb, extractRgb, lerp } from "../../utils/ansi.js";

// ── Truecolor detection ────────────────────────────────────────────────

export const TRUECOLOR = /truecolor|24bit/i.test(process.env.COLORTERM ?? "")
  || (process.env.TERM ?? "").includes("256color")
  || process.env.TERM_PROGRAM === "iTerm.app"
  || process.env.TERM_PROGRAM === "WezTerm"
  || process.env.TERM_PROGRAM === "vscode"
  || process.env.WT_SESSION !== undefined;

// ── Logo ───────────────────────────────────────────────────────────────

export const LOGO = [
  "████████████    ",
  "████████████    ",
  "████    ████    ",
  "████    ████    ",
  "████████    ████",
  "████████    ████",
  "████        ████",
  "████        ████",
];

export const CHAR_FADE_FRAMES = 22;
export const LOGO_SETTLE_FRAME = 90;
export const LOGO_PAD = 0;
export const LOGO_GAP = 4;

export function getShinedLogo(frame: number): string[] {
  if (!TRUECOLOR) return LOGO;

  return LOGO.map((line, y) => {
    let result = "";
    for (let x = 0; x < line.length; x++) {
      const char = line[x];
      if (char === " ") { result += " "; continue; }

      const revealAt = ((x / 2) * 1.2 + (y / 2) * 3.5) * 1.4;
      const age = frame - revealAt;

      if (age <= 0) { result += " "; continue; }

      const t = Math.min(1, age / CHAR_FADE_FRAMES);
      const eased = 1 - (1 - t) * (1 - t);
      const brightness = Math.floor(lerp(50, 255, eased));
      result += gray(brightness, char);
    }
    return result;
  });
}
```

#### 4b. `src/startup/sections.ts` — Section parsing (~220 lines)

This file contains all section detection, parsing, column formatting, and item wrapping logic. Copy the following code blocks from the original `src/startup/index.ts`:

**Imports (add at top):**
```typescript
import { clampLine } from "../../utils/text.js";
import { stripAnsi } from "../../utils/ansi.js";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";
```

**Types (copy from original lines ~107-125):**
```typescript
const SECTION_KEYS = ["Models", "Context", "Prompts", "Skills", "Extensions", "Themes"] as const;
type SectionKey = (typeof SECTION_KEYS)[number];
type RenderSectionKey = SectionKey | "Version";

export interface ParsedSection {
  name: SectionKey;
  items: string[];
}

interface RenderSection {
  name: RenderSectionKey;
  items: string[];
}
```

**Constants (copy from original, these are used by formatColumns):**
```typescript
const RAMP_FRAMES = 22;
const STAGGER_FRAMES = 0;
const BASE_FADE_DELAY = 3;
const MAX_STAGGER = BASE_FADE_DELAY + 5 * STAGGER_FRAMES;
```

**Functions to copy (from original lines ~440-570):**
- `detectSection(plain)` — detect which section key a plain string belongs to
- `parseSectionText(plain)` — parse section text into ParsedSection
- `parseModelScope(plain)` — parse model scope line into ParsedSection
- `extractName(path, section)` — extract display name from path
- `detectOrigin(path)` — detect npm:/git: prefix
- `cleanName(name)` — strip extensions
- `sectionExtractors` — per-section name extraction functions
- `formatColumns(sections, theme, maxW, ref)` — multi-column layout
- `buildItemWrapper(sectionAge, revealed, startRgb, mutedRgb, muted)` — fade-in wrapper

**Important changes for sections.ts:**
1. `TRUECOLOR` is no longer defined here — it's in `logo.ts`. The `formatColumns` function references `TRUECOLOR` — change all references from bare `TRUECOLOR` to importing it: `import { TRUECOLOR } from "./logo.js";`
2. `gray`, `rgb`, `extractRgb`, `lerp` are no longer defined here — import them: `import { gray, rgb, extractRgb, lerp } from "../../utils/ansi.js";`
3. `stripAnsi` is no longer defined locally — import it from `../../utils/ansi.js`
4. `clampLine` is no longer imported from `../shared.js` — use the new path `../../utils/text.js`
5. The `RAMP_FRAMES`, `STAGGER_FRAMES`, `BASE_FADE_DELAY`, `MAX_STAGGER` constants need to stay local (they're used by formatColumns) but are also defined in startup/index.ts. Since sections.ts is a consumer, these constants should be defined here as they are rendering-specific.

**The complete sections.ts file should look like:**
```typescript
// src/startup/sections.ts
import { clampLine } from "../../utils/text.js";
import { stripAnsi, gray, rgb, extractRgb, lerp } from "../../utils/ansi.js";
import { TRUECOLOR } from "./logo.js";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";

const SECTION_KEYS = ["Models", "Context", "Prompts", "Skills", "Extensions", "Themes"] as const;
type SectionKey = (typeof SECTION_KEYS)[number];
type RenderSectionKey = SectionKey | "Version";

export interface ParsedSection {
  name: SectionKey;
  items: string[];
}

interface RenderSection {
  name: RenderSectionKey;
  items: string[];
}

const RAMP_FRAMES = 22;
const STAGGER_FRAMES = 0;
const BASE_FADE_DELAY = 3;
const MAX_STAGGER = BASE_FADE_DELAY + 5 * STAGGER_FRAMES;

// --- All functions from original startup/index.ts lines ~440-570 ---
// (detectSection, parseSectionText, parseModelScope, extractName, detectOrigin,
//  cleanName, sectionExtractors, formatColumns, buildItemWrapper)
// Keep ALL logic identical — only change imports and references.

export { detectSection, parseSectionText, parseModelScope, extractName };
export { formatColumns, buildItemWrapper };
export type { SectionKey, RenderSectionKey };
```

**Execution instruction:** The agent should read the original `src/startup/index.ts` and copy lines ~440-570 (from `detectSection` through `buildItemWrapper`) into this file, replacing:
- `TRUECOLOR` → imported from `./logo.js`
- `gray/rgb/extractRgb/lerp` → imported from `../../utils/ansi.js`
- `stripAnsi` → imported from `../../utils/ansi.js`
- `clampLine` import → `../../utils/text.js`

All function bodies remain unchanged.

#### 4c. `src/startup/version.ts` — Version checking (~60 lines)

```typescript
// src/startup/version.ts
const NPM_REGISTRY_URL = "https://registry.npmjs.org/@mariozechner/pi-coding-agent/latest";
const FETCH_TIMEOUT_MS = 4000;

export async function fetchLatestVersion(): Promise<string | undefined> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(NPM_REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return undefined;
    const data = (await res.json()) as { version?: string };
    return data.version;
  } catch {
    return undefined;
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
  }
  return 0;
}
```

#### 4d. `src/startup/capture.ts` — Model scope capture (~40 lines)

```typescript
// src/startup/capture.ts
const g: Record<string | symbol, unknown> = globalThis as unknown as typeof global & Record<string | symbol, unknown>;

const MODEL_SCOPE_RE = /Model scope:\s*(.+)/;
export const CAPTURED_MODELS = Symbol.for("splashscreen:capturedModels");
export const PATCHED_LOG = Symbol.for("splashscreen:logPatched");

export function patchConsoleLog(): void {
  if (g[PATCHED_LOG]) return;
  g[PATCHED_LOG] = true;
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    try {
      if (args.length === 1 && typeof args[0] === "string") {
        const plain = (args[0] as string).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
        const m = MODEL_SCOPE_RE.exec(plain);
        if (m) {
          const raw = m[1].replace(/\s*\(Ctrl\+\w[\w\s]*\)/gi, "");
          g[CAPTURED_MODELS] = raw
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean);
          return;
        }
      }
    } catch {
      /* ignore errors in patching logic */
    }
    origLog.apply(console, args);
  };
}
```

**Note:** `patchConsoleLog()` writes to `g[CAPTURED_MODELS]` which is read by `parseModelScope()` in `sections.ts`. Both use the same Symbol key — no import needed between them.

#### 4e. Rewrite `src/startup/index.ts` (~280 lines)

The new file imports from the extracted modules and keeps only:
- `renderHeader()` — composes logo + sections + padding (imports from logo.ts, sections.ts)
- `patchStartupListing()` — finds chat container, patches `addChild`, runs animation loop
- `ListingRef` interface
- Animation constants (`RAMP_FRAMES`, `STAGGER_FRAMES`, `BASE_FADE_DELAY`, `REVEAL_DEBOUNCE_MS`, `MIN_HEADER_LINES`)
- Symbol keys for animation state (`LISTING_REF`, `ANIM_INTERVAL`, `DEBOUNCE_TIMER`, `PATCHED_CLEAR`, `PATCHED_LISTING`)

The new file is structured as:

```typescript
// src/startup/index.ts
import { VERSION, type Theme } from "@mariozechner/pi-coding-agent";
import { getShinedLogo, TRUECOLOR, LOGO_PAD, LOGO_SETTLE_FRAME } from "./logo.js";
import { detectSection, parseSectionText, parseModelScope, formatColumns, buildItemWrapper, type ParsedSection, type SectionKey, type RenderSectionKey } from "./sections.js";
import { fetchLatestVersion, compareVersions } from "./version.js";
import { patchConsoleLog } from "./capture.js";
import { resetInstanceCount } from "../message/index.js";
import { clampLine } from "../utils/text.js";
import { Text, Spacer, Container, TUI, truncateToWidth, visibleWidth, type Component } from "@mariozechner/pi-tui";

// Symbol keys (survive hot-reload)
const LISTING_REF = Symbol.for("splashscreen:listingRef");
const ANIM_INTERVAL = Symbol.for("splashscreen:animInterval");
const DEBOUNCE_TIMER = Symbol.for("splashscreen:debounceTimer");
const PATCHED_CLEAR = Symbol.for("splashscreen:clearPatched");
const PATCHED_LISTING = Symbol.for("splashscreen:listingPatched");

// Animation constants
const RAMP_FRAMES = 22;
const STAGGER_FRAMES = 0;
const BASE_FADE_DELAY = 3;
const MAX_STAGGER = BASE_FADE_DELAY + 5 * STAGGER_FRAMES;
const REVEAL_DEBOUNCE_MS = 150;
const MAX_RENDER_WIDTH = 9999;
const MIN_HEADER_LINES = 11;

export interface ListingRef {
  sections: ParsedSection[];
  frame: number;
  revealed: boolean;
  revealedAt: number;
  scaffoldAt: number;
  latestVersion?: string;
  settled: boolean;
  cachedLines?: string[];
  cachedWidth?: number;
  cachedHeight?: number;
  maxHeaderHeight?: number;
}

// ── renderHeader() — composes logo + sections + padding ────────────────
export function renderHeader(theme: Theme, ref: ListingRef, width: number, height: number): string[] {
  // ... (imports getShinedLogo from logo.ts, uses formatColumns/buildItemWrapper from sections.ts)
}

// ── patchStartupListing() — orchestrates animation + chat container ────
export function patchStartupListing(tui: TUI, _theme: Theme, ref: ListingRef): void {
  // ... (imports detectSection, parseSectionText, parseModelScope from sections.ts)
}
```

**Important:** The `patchConsoleLog()` call moves from `index.ts` (main entry) to here. The main `src/index.ts` will import and call it.

**Steps:**
- [ ] Create `src/startup/logo.ts` with the content shown above
- [ ] Create `src/startup/sections.ts` — copy all section parsing functions from the original `startup/index.ts` (lines ~440-570) plus `formatColumns()` and `buildItemWrapper()`
- [ ] Create `src/startup/version.ts` with the content shown above
- [ ] Create `src/startup/capture.ts` with the content shown above
- [ ] Rewrite `src/startup/index.ts` — keep only `renderHeader()`, `patchStartupListing()`, `ListingRef` interface, and animation constants. Import from the new modules.
- [ ] Run `npx tsc --noEmit` to verify types compile

**Acceptance criteria:**
- [ ] `src/startup/logo.ts` exports `TRUECOLOR`, `LOGO`, `CHAR_FADE_FRAMES`, `LOGO_SETTLE_FRAME`, `LOGO_PAD`, `getShinedLogo()`
- [ ] `src/startup/sections.ts` exports `SECTION_KEYS`, `ParsedSection`, `RenderSectionKey`, `detectSection()`, `parseSectionText()`, `parseModelScope()`, `extractName()`, `formatColumns()`, `buildItemWrapper()`
- [ ] `src/startup/version.ts` exports `fetchLatestVersion()`, `compareVersions()`
- [ ] `src/startup/capture.ts` exports `CAPTURED_MODELS`, `PATCHED_LOG`, `patchConsoleLog()`
- [ ] `src/startup/index.ts` is ~280 lines and imports from the four new modules
- [ ] TypeScript compiles

---

### Task 5: Split footer/utils/formatting.ts into icons.ts and format.ts

**Context:**
`src/footer/utils/formatting.ts` (~82 lines) mixes icon constants with formatting functions. This task separates them into two focused files.

**Files:**
- Create: `src/footer/utils/icons.ts`
- Create: `src/footer/utils/format.ts`
- Delete: `src/footer/utils/formatting.ts`
- Modify: `src/footer/index.ts` (update import paths)

**What to implement:**

#### 5a. `src/footer/utils/icons.ts` — Icon constants (~30 lines)

```typescript
// src/footer/utils/icons.ts
// Nerd Font icons
export const footerIcons = {
  model: "\udb81\udea9 ",
  directory: "\uf4d3 ",
  branch: "\uf126",
  worktree: "\u{f0405}",
  contextWindow: "\uee9c",
} as const;

// Git status display icons
export const gitDisplayIcons = {
  staged: "●",
  unstaged: "~",
  untracked: "U",
  ahead: "↑",
  behind: "↓",
} as const;

const gitStatusColors: Record<keyof typeof gitDisplayIcons, "success" | "warning" | "dim" | "info"> = {
  staged: "success",
  unstaged: "warning",
  untracked: "dim",
  ahead: "info",
  behind: "warning",
};

export const thinkingLevelColors: Record<string, string> = {
  off: "dim",
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
};

// Re-export gitStatusColors for use in format.ts
export { gitStatusColors };

// Color function type used by formatting functions
export type ColorFn = (token: string, s: string) => string;
```

#### 5b. `src/footer/utils/format.ts` — Formatting functions (~50 lines)

```typescript
// src/footer/utils/format.ts
import type { ColorFn } from "./icons.js";
import { footerIcons, gitDisplayIcons, gitStatusColors, thinkingLevelColors } from "./icons.js";

export function formatTokenCount(count: number): string {
  const K = 1024;
  const M = 1048576;
  if (count < K) return count.toString();
  if (count < K * 10) return (count / K).toFixed(1) + "k";
  if (count < M) return Math.round(count / K) + "k";
  if (count < M * 10) return (count / M).toFixed(1) + "M";
  return Math.round(count / M) + "M";
}

export function formatContextBar(colorize: ColorFn, percentValue: number, availableSpace: number): string {
  if (availableSpace <= 2) return "";
  const pct = Math.min(1, percentValue / 100);
  const filledLength = percentValue > 0 ? Math.max(1, Math.round(pct * availableSpace)) : 0;
  const emptyLength = availableSpace - filledLength;
  const barToken = pct >= 0.9 ? "error" : pct >= 0.7 ? "warning" : "syntaxString";
  const filledBar = filledLength > 0 ? colorize(barToken, "━".repeat(filledLength)) : "";
  const emptyBar = emptyLength > 0 ? colorize("dim", "━".repeat(emptyLength)) : "";
  const bar = filledBar + emptyBar;
  return colorize(barToken, footerIcons.contextWindow) + "  " + bar + " " + colorize(barToken, Math.round(percentValue) + "%");
}

export function formatGitStatusIndicators(
  gitStatus: { staged: number; unstaged: number; untracked: number; ahead: number; behind: number },
  colorize: ColorFn,
): string {
  const statusParts: string[] = [];
  if (gitStatus.staged > 0) statusParts.push(colorize(gitStatusColors.staged, gitDisplayIcons.staged + gitStatus.staged));
  if (gitStatus.unstaged > 0) statusParts.push(colorize(gitStatusColors.unstaged, gitDisplayIcons.unstaged + gitStatus.unstaged));
  if (gitStatus.untracked > 0) statusParts.push(colorize(gitStatusColors.untracked, gitDisplayIcons.untracked + gitStatus.untracked));
  if (gitStatus.ahead > 0) statusParts.push(colorize(gitStatusColors.ahead, gitDisplayIcons.ahead + gitStatus.ahead));
  if (gitStatus.behind > 0) statusParts.push(colorize(gitStatusColors.behind, gitDisplayIcons.behind + gitStatus.behind));
  return statusParts.join("");
}

export function formatThinkingIndicator(thinkingLevel: string, colorize: ColorFn): string {
  return thinkingLevel !== "off" ? colorize(thinkingLevelColors[thinkingLevel] || "dim", "◐ " + thinkingLevel) : "";
}
```

**Note:** `ColorFn` type is defined inline in the icons.ts file or re-exported from there.

#### 5c. Update `src/footer/index.ts`

Change the import:
```typescript
// FROM:
import { formatContextBar, formatGitStatusIndicators, formatThinkingIndicator, footerIcons, formatTokenCount } from "./utils/formatting.js";
// TO:
import { formatContextBar, formatGitStatusIndicators, formatThinkingIndicator, formatTokenCount } from "./utils/format.js";
import { footerIcons } from "./utils/icons.js";
```

#### 5d. Delete `src/footer/utils/formatting.ts`

```bash
rm src/footer/utils/formatting.ts
```

**Steps:**
- [ ] Create `src/footer/utils/icons.ts` with icon constants and color maps
- [ ] Create `src/footer/utils/format.ts` with formatting functions (imports from icons.ts)
- [ ] Update import in `src/footer/index.ts` to use the two new files
- [ ] Delete `src/footer/utils/formatting.ts`
- [ ] Run `npx tsc --noEmit` to verify types compile

**Acceptance criteria:**
- [ ] `src/footer/utils/icons.ts` exports `footerIcons`, `gitDisplayIcons`, `gitStatusColors`, `thinkingLevelColors`, and defines `ColorFn` type
- [ ] `src/footer/utils/format.ts` exports `formatTokenCount`, `formatContextBar`, `formatGitStatusIndicators`, `formatThinkingIndicator`
- [ ] `src/footer/index.ts` imports from both new files
- [ ] `src/footer/utils/formatting.ts` no longer exists

---

### Task 6: Wire Everything Together — Update index.ts, Delete Old Files, Typecheck

**Context:**
This final task rewrites the main entry point as a thin orchestrator, deletes all old files, and verifies the entire codebase compiles.

**Files:**
- Modify: `src/index.ts` (rewrite as thin orchestrator)
- Delete: `src/visual.ts` (if not already deleted in Task 3)
- Delete: `src/shared.ts`
- Delete: `src/utils.ts`
- Delete: `src/thinking/hsl.ts`

**What to implement:**

#### 6a. Rewrite `src/index.ts` (~150 lines)

The new file is a thin orchestrator that imports from all the extracted modules:

```typescript
// src/index.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ExtensionAPI, ExtensionContext, ExtensionCommandContext, KeybindingsManager, getSettingsListTheme, getAgentDir } from "@mariozechner/pi-coding-agent";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { SettingsList, SettingItem, TUI, EditorTheme, Component } from "@mariozechner/pi-tui";

import registerFooter from "./footer/index.js";
import { registerDiffTools, type HephaestusDiffConfig } from "./diff-render/index.js";
import { patchThinkingRenderer } from "./thinking/patch.js";
import { transformThinkingContent } from "./thinking/transform.js";
import { HephaestusEditor } from "./editor/index.js";
import { patchUserMessage, resetInstanceCount } from "./message/index.js";
import { renderHeader, patchStartupListing, ListingRef } from "./startup/index.js";
import { patchConsoleLog } from "./startup/capture.js";
import { openSettings } from "./settings.js";
import { loadConfig, type HephaestusConfig } from "./config.js";

export default function (pi: ExtensionAPI): void {
  // Patch console.log for model scope capture
  patchConsoleLog();

  // Register footer
  registerFooter(pi);

  // session_start handler
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    // Set animated header
    const ref: ListingRef = {
      sections: [],
      frame: 0,
      revealed: false,
      revealedAt: 0,
      scaffoldAt: 0,
      settled: false,
    };
    const headerFactory = (tui: TUI, theme: Theme): Component & { dispose?(): void } => {
      const comp: Component & { dispose?(): void } = {
        invalidate(): void { /* no-op */ },
        render(width: number): string[] {
          return renderHeader(theme, ref, width, tui.terminal.rows - 3);
        },
      };
      patchStartupListing(tui, theme, ref);
      return comp;
    };
    ctx.ui.setHeader(headerFactory);

    // Shared response times array
    const responseTimes: number[] = [];

    // Set editor component
    ctx.ui.setEditorComponent((tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager) => {
      const theme = ctx.ui.theme;
      return new HephaestusEditor(tui, editorTheme, keybindings, {
        getTheme: () => theme,
        isIdle: () => ctx.isIdle(),
        shutdown: () => ctx.shutdown(),
      });
    });

    // Patch thinking renderer
    patchThinkingRenderer(() => ctx.ui.theme);

    // Patch user message response time
    patchUserMessage(() => ctx.ui.theme, responseTimes);

    // Register diff-enhanced write/edit tools
    registerDiffTools(pi, () => ctx.ui.theme, () => loadConfig());

    // Register events
    pi.on("message_end", (event, _ctx) => {
      transformThinkingContent(event.message as any);
      const rawMsg = event.message as any;
      if (rawMsg.duration) {
        const idx = rawMsg.instanceIndex ?? responseTimes.length;
        responseTimes[idx] = rawMsg.duration;
      }
    });

    pi.on("session_shutdown", (_event, _ctx) => {
      const g: Record<string | symbol, unknown> = globalThis as unknown as typeof global & Record<string | symbol, unknown>;
      const ref = g["listingRef"] as ListingRef | undefined;
      if (ref) { ref.settled = true; }
      responseTimes.length = 0;
      resetInstanceCount();
      ctx.ui.setEditorComponent(undefined);
    });
  });

  // Register /hephaestus command
  pi.registerCommand("hephaestus", {
    description: "Open Hephaestus settings",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      openSettings(pi, ctx);
    },
  });
}
```

**Note:** The old `loadConfig`, `saveConfig`, and `openSettings` inline implementations are removed — they're now in `config.ts` and `settings.ts`.

**Important:** This file still uses the original global variable `g` for the `session_shutdown` handler (same pattern as before). The `patchConsoleLog` function sets `g[PATCHED_LOG]` and `g[CAPTURED_MODELS]` which are read by `parseModelScope()` in sections.ts via Symbol keys.

#### 6b. Update remaining import paths

The following files still import from old paths that are being deleted. Update each:

1. **`src/editor/index.ts`** — change import:
   ```typescript
   // FROM: import { isParentBorder, formatKey } from "../utils.js";
   // TO:   import { isParentBorder, formatKey } from "../utils/text.js";
   ```

2. **`src/footer/index.ts`** — change import:
   ```typescript
   // FROM: import { clampLine } from "../shared.js";
   // TO:   import { clampLine } from "../utils/text.js";
   ```

3. **`src/thinking/theme.ts`** — change import:
   ```typescript
   // FROM: import { deriveDimColor, hslToRgb, parseAnsiFgToRgb, rgbToHsl, rgbToTruecolorFg, hexToRgb } from "./hsl.js";
   // TO:   import { deriveDimColor, hslToRgb, parseAnsiFgToRgb, rgbToHsl, rgbToTruecolorFg, hexToRgb } from "../utils/color.js";
   ```

4. **`src/diff-render/ansi.ts`** — add import and replace `strip()` calls:
   ```typescript
   // Add at top: import { stripSgr } from "../utils/ansi.js";
   // Replace all local strip() function calls with stripSgr()
   // The function signature is identical: strip(s: string): string → stripSgr(s: string): string
   ```

#### 6c. Delete old files

```bash
rm src/visual.ts 2>/dev/null || true
rm src/shared.ts
rm src/utils.ts
rm src/thinking/hsl.ts
```

**Note:** `src/visual.ts` should already be deleted in Task 3. The `|| true` handles that case gracefully.

#### 6c. Update diff-render/ansi.ts to use stripSgr from utils

In `src/diff-render/ansi.ts`, change the import and usage:
```typescript
// Add at top:
import { stripSgr } from "../utils/ansi.js";

// Replace all calls to local strip() with stripSgr()
// The function signature is identical: strip(s: string): string → stripSgr(s: string): string
```

**Steps:**
- [ ] Rewrite `src/index.ts` with the complete content shown above (thin orchestrator)
- [ ] Update import in `src/editor/index.ts`: `../utils.js` → `../utils/text.js`
- [ ] Update import in `src/footer/index.ts`: `../shared.js` → `../utils/text.js`
- [ ] Update import in `src/thinking/theme.ts`: `./hsl.js` → `../utils/color.js`
- [ ] In `src/diff-render/ansi.ts`, add `import { stripSgr } from "../utils/ansi.js"` at the top, then replace all calls to the local `strip()` function with `stripSgr()`
- [ ] In `src/diff-render/render.ts`, the `Ansi.strip` reference comes from `* as Ansi` import of `./ansi.js`. Since `diff-render/ansi.ts` now re-exports `stripSgr` (or the local `strip` is removed), update: `import { stripSgr } from "../utils/ansi.js";` and replace `Ansi.strip()` calls with `stripSgr()`. Keep `Ansi.*` for all other functions (fit, ansiState, lnum, rule, etc.) that are still exported from `diff-render/ansi.ts`.
- [ ] Delete `src/visual.ts` (safety net — should already be deleted in Task 3)
- [ ] Delete `src/shared.ts`
- [ ] Delete `src/utils.ts`
- [ ] Delete `src/thinking/hsl.ts`
- [ ] Run `npx tsc --noEmit` to verify types compile
  - **This is the critical verification step.** If it passes, the refactoring is structurally correct.
- [ ] If there are type errors, fix them (likely import path issues)
- [ ] Commit with message: "refactor: comprehensive codebase cleanup — modularized files, unified utilities"

**Acceptance criteria:**
- [ ] `src/index.ts` is ~150 lines and imports from all extracted modules
- [ ] Old files deleted: `visual.ts`, `shared.ts`, `utils.ts`, `hsl.ts`
- [ ] `diff-render/ansi.ts` imports `stripSgr` from `utils/ansi.js`
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] All exports are accessible from their new locations

---

## Execution Order

Tasks must be executed sequentially:
```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6
```

Each task builds on the previous one's committed work. The final typecheck in Task 6 validates the entire refactoring.

## Known Issues to Address (Bonus)

During Task 6 or as a separate follow-up:
- `thinking/patch.ts` has a hardcoded `THINKING_LABEL` — wire it to the config's `labelText`/`labelColor` by adding a `getConfig` parameter to `patchThinkingRenderer()`
- No automated test suite exists — add `tsc --noEmit` to package.json scripts for CI
