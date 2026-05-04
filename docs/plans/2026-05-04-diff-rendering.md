# Diff Rendering Integration Plan

**Goal:** Bundle pi-split-diff's Shiki-powered syntax-highlighted diff rendering into pi-ui-hephaestus so users get rich diff output for `write` and `edit` tools automatically.

**Architecture:** Copy pi-split-diff's rendering code into `src/diff-render/` as a module (not a standalone extension). Refactor the extension wrapper into `registerDiffTools(pi, getTheme, getConfig)` called from Hephaestus's `session_start` handler. Config (Shiki theme, split thresholds) moves from environment variables into Hephaestus's `/hephaestus` settings menu.

**Tech Stack:** `@shikijs/cli` (syntax highlighting via WASM), `diff` (structured patching), TypeScript, pi SDK (`createWriteTool`, `createEditTool`, `pi.registerTool`)

---

### Task 1: Add dependencies and scaffold diff-render module

**Context:**
Hephaestus currently has zero runtime dependencies. We need `@shikijs/cli` for Shiki syntax highlighting and `diff` for structured patching. We also create the directory structure and copy the core diff parser (`parseDiff`) from pi-split-diff. This task is purely additive — no existing files are modified except `package.json`.

**Task Dependencies:** Strictly sequential. Task 1 → Task 2 → Task 3 → Task 4.

**Files:**
- Modify: `package.json`
- Create: `src/diff-render/core/diff.ts`

**What to implement:**

1. In `package.json`, add to `dependencies`:
   ```json
   "@shikijs/cli": "^4.0.2",
   "diff": "^8.0.0"
   ```
   Note: `diff@8.0.4` is already installed as a transitive dependency of `@mariozechner/pi-coding-agent`. Using `^8.0.0` avoids duplicate installations.
2. In `package.json`, add to `devDependencies`:
   ```json
   "@types/diff": "^7.0.2",
   "shiki": "^4.0.0"
   ```
   Note: `shiki` is added as a devDependency for type-only imports (`BundledLanguage`, `BundledTheme`). Without it, TypeScript may fail to resolve these types from the transitive dependency of `@shikijs/cli`.
3. Run `npm install` to install the new dependencies.
4. Create `src/diff-render/core/diff.ts` by copying `/home/daniel/Coding/Javascript/pi-split-diff/src/core/diff.ts` verbatim. This file exports:
   - `interface DiffLine` — `{ type: "add" | "del" | "ctx" | "sep", oldNum, newNum, content }`
   - `interface ParsedDiff` — `{ lines: DiffLine[], added: number, removed: number, chars: number }`
   - `function parseDiff(oldContent, newContent, ctx?)` — parses unified diff into structured lines

**Do NOT change:** The `parseDiff` function or its interfaces. Copy exactly.

**Steps:**
- [ ] Add `@shikijs/cli` and `diff` to `dependencies` in `package.json`
- [ ] Add `@types/diff` to `devDependencies` in `package.json`
- [ ] Run `npm install`
- [ ] Create `src/diff-render/core/diff.ts` by copying the file from pi-split-diff
- [ ] Run `npx tsc --noEmit` to verify types compile
- [ ] Commit with message: "feat: add diff rendering dependencies and core parser"

**Acceptance criteria:**
- [ ] `npm install` succeeds without errors
- [ ] `src/diff-render/core/diff.ts` exists and matches the original
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)

---

### Task 2: Create src/diff-render/index.ts — the diff rendering module

**Context:**
This is the main integration work. We take pi-split-diff's `src/index.ts` (~700 lines) and refactor it from a standalone extension into a module that Hephaestus calls. Key changes:
- Remove `export default async function diffRendererExtension(pi)` wrapper
- Add `export function registerDiffTools(pi, getTheme, getConfig)` as the entry point
- Replace `process.env.DIFF_THEME` → `getConfig().diffTheme`
- Replace `envInt("DIFF_SPLIT_MIN_WIDTH", 150)` → `getConfig().diffSplitMinWidth`
- Replace `envInt("DIFF_SPLIT_MIN_CODE_WIDTH", 60)` → `getConfig().diffSplitMinCodeWidth`
- Make Shiki initialization lazy (only on first diff render, not module load)
- Remove `__testing` export
- Keep ALL rendering logic unchanged: split/unified views, word diff, Shiki caching, ANSI helpers, theme color auto-derive

**Files:**
- Create: `src/diff-render/index.ts`

**What to implement:**

1. Copy all rendering code from `/home/daniel/Coding/Javascript/pi-split-diff/src/index.ts` into `src/diff-render/index.ts`.

2. **Imports** — The file must have exactly these imports at the top:
   ```typescript
   import { existsSync, readFileSync } from "node:fs";
   import { extname, relative } from "node:path";
   import { codeToANSI } from "@shikijs/cli";
   import * as Diff from "diff";
   import type { BundledLanguage, BundledTheme } from "shiki";
   import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
   import { type DiffLine, type ParsedDiff, parseDiff } from "./core/diff.js";
   ```

3. **Config interface and module-level config** — Add near the top of the file:
   ```typescript
   export interface HephaestusDiffConfig {
     diffTheme: string;
     diffSplitMinWidth: number;
     diffSplitMinCodeWidth: number;
   }

   const DEFAULT_DIFF_CONFIG: HephaestusDiffConfig = {
     diffTheme: "github-dark",
     diffSplitMinWidth: 150,
     diffSplitMinCodeWidth: 60,
   };

   // Delegate pattern — _readConfig is set by registerDiffTools,
   // getConfig() always returns the latest config from the caller.
   let _readConfig: () => HephaestusDiffConfig = () => DEFAULT_DIFF_CONFIG;
   function getConfig(): HephaestusDiffConfig { return _readConfig(); }
   ```

4. **Replace env var reads** — Replace the three module-level constants:
   - Remove: `const THEME: BundledTheme = (process.env.DIFF_THEME as BundledTheme | undefined) ?? "github-dark";`
   - Remove: `const SPLIT_MIN_WIDTH = envInt("DIFF_SPLIT_MIN_WIDTH", 150);`
   - Remove: `const SPLIT_MIN_CODE_WIDTH = envInt("DIFF_SPLIT_MIN_CODE_WIDTH", 60);`
   - Everywhere `THEME` is used → replace with `getConfig().diffTheme`
   - Everywhere `SPLIT_MIN_WIDTH` is used → replace with `getConfig().diffSplitMinWidth`
   - Everywhere `SPLIT_MIN_CODE_WIDTH` is used → replace with `getConfig().diffSplitMinCodeWidth`

5. **Lazy Shiki initialization** — Replace the module-level pre-warm (`codeToANSI("", "typescript", THEME).catch(() => {});`) with:
   ```typescript
   let _shikiReady = false;
   async function ensureShiki(): Promise<void> {
     if (_shikiReady) return;
     _shikiReady = true;
     codeToANSI("", "typescript", getConfig().diffTheme).catch(() => {});
   }
   ```
   Inside `hlBlock()`, call `await ensureShiki();` before the `codeToANSI` call.

6. **Create `registerDiffTools` function** — This is the entry point. Signature:
   ```typescript
   export function registerDiffTools(
     pi: ExtensionAPI,
     getTheme: () => Theme,
     readConfig: () => HephaestusDiffConfig,
   ): void {
     _readConfig = readConfig;
     
     // Dynamic imports (same as original)
     let createWriteTool: any, createEditTool: any, TextComponent: any;
     try {
       const sdk = await import("@mariozechner/pi-coding-agent");
       const tui = await import("@mariozechner/pi-tui");
       createWriteTool = sdk.createWriteTool;
       createEditTool = sdk.createEditTool;
       TextComponent = tui.Text;
     } catch (error) {
       console.error(`[hephaestus-diff] failed to load SDK: ${error}`);
       return;
     }
     if (!createWriteTool || !createEditTool || !TextComponent) return;

     // ... pi.registerTool("write", ...) and pi.registerTool("edit", ...)
   }
   ```
   Note: The function body is synchronous but the dynamic imports are async. Use an IIFE or top-level await inside the function. Since the original code uses `async function diffRendererExtension(pi)`, keep the tool registration logic async but wrap it so `registerDiffTools` itself is `void`:
   ```typescript
   export function registerDiffTools(
     pi: ExtensionAPI,
     getTheme: () => Theme,
     readConfig: () => HephaestusDiffConfig,
   ): void {
     _readConfig = readConfig;
     (async () => {
       // ... dynamic imports and pi.registerTool calls
     })().catch(console.error);
   }
   ```

7. **Move tool registration** — The `pi.registerTool("write", ...)` and `pi.registerTool("edit", ...)` calls from the original extension become the body of `registerDiffTools`. Keep all logic identical. The `theme` parameter in render callbacks (`renderCall`, `renderResult`) works as-is — no need to replace with `getTheme()` (the SDK passes the current theme on every call).

8. **Remove** `export const __testing = { ... }`.

9. **Remove** the `envInt` helper function (no longer needed).

**Do NOT change:**
- Any ANSI rendering logic (wrapAnsi, injectBg, stripes, fit, etc.)
- Split/unified view rendering algorithms
- Word diff analysis (`wordDiffAnalysis`, `injectBg`)
- Shiki caching (`hlBlock`, `_cache`) — except adding `await ensureShiki()` call
- Theme color auto-derivation (`autoDeriveBgFromTheme`, `resolveDiffColors`)
- Language detection (`EXT_LANG`, `lang()`)
- Diff line parsing (that's in core/diff.ts, untouched)
- The `theme` parameter usage in render callbacks (it works correctly as-is)

**Steps:**
- [ ] Copy pi-split-diff's src/index.ts content into src/diff-render/index.ts
- [ ] Add HephaestusDiffConfig interface and module-level _config variable
- [ ] Replace all env var reads with getConfig() calls
- [ ] Replace Shiki pre-warm with lazy ensureShiki()
- [ ] Create registerDiffTools() function signature
- [ ] Move tool registration (write, edit) into registerDiffTools()
- [ ] Remove __testing export
- [ ] Remove envInt helper
- [ ] Add proper imports (ExtensionAPI, Theme from pi-coding-agent)
- [ ] Run `npx tsc --noEmit` to verify types compile
- [ ] Fix any type errors
- [ ] Commit with message: "feat: create diff-render module with registerDiffTools"

**Acceptance criteria:**
- [ ] `src/diff-render/index.ts` compiles without TypeScript errors
- [ ] Exports `HephaestusDiffConfig` interface and `registerDiffTools` function
- [ ] No references to `process.env.DIFF_*` remain
- [ ] No `__testing` export
- [ ] Shiki initialization is lazy (no module-level `codeToANSI` call)

---

### Task 3: Wire diff-render into src/index.ts and add settings

**Context:**
Connect the diff-render module to Hephaestus's main entry point. Add config fields to `HephaestusConfig`, call `registerDiffTools` in `session_start`, and add 3 settings items to the `/hephaestus` menu.

**Files:**
- Modify: `src/index.ts`

**What to implement:**

1. Add import at top:
   ```typescript
   import { registerDiffTools, type HephaestusDiffConfig } from "./diff-render/index.js";
   ```

2. Extend `HephaestusConfig` interface:
   ```typescript
   interface HephaestusConfig extends HephaestusDiffConfig {
     mutedTheme: boolean;
     codeUnindent: boolean;
     labelText: string;
     labelColor: string;
   }
   ```

3. Update `defaultConfig` in `loadConfig()`:
   ```typescript
   const defaultConfig: HephaestusConfig = {
     mutedTheme: false,
     codeUnindent: true,
     labelText: "Thinking...",
     labelColor: "255,215,0",
     diffTheme: "github-dark",
     diffSplitMinWidth: 150,
     diffSplitMinCodeWidth: 60,
   };
   ```

4. In `session_start` handler, after existing setup, add:
   ```typescript
   // Load config for diff tools
   const config = loadConfig();
   
   // Register diff-enhanced write/edit tools
   registerDiffTools(pi, () => ctx.ui.theme, () => loadConfig());
   ```
   Note: `() => loadConfig()` reads from disk on each call. This is fine — `loadConfig()` is a simple JSON parse (~microseconds) and is only called during diff renders (not on every frame). This ensures settings changes are picked up immediately without restarting.

   Alternatively, if performance is a concern, use `() => config` (snapshot) but note that settings changes require a session restart to take effect for diff rendering.

5. In `openSettings()`, add 3 new `SettingItem` entries before the "save" item:

   **Diff Theme** — text submenu (same pattern as labelText):
   ```typescript
   {
     id: "diffTheme",
     label: "Diff Theme",
     description: "Shiki syntax-highlighting theme for diffs",
     currentValue: config.diffTheme,
     submenu: (currentValue: string, done: (selectedValue?: string) => void) => {
       const state = { value: currentValue };
       return {
         invalidate(): void { /* no-op */ },
         render(): string[] {
           return [
             "Enter Shiki theme (ESC to cancel):",
             "",
             `  ${state.value}`,
             "",
             "ESC: cancel | ENTER: confirm",
           ];
         },
         handleInput(data: string): void {
           if (data === "\x1b") { done(); return; }
           if (data === "\r" || data === "\n") { done(state.value); return; }
           if (data === "\x7f" || data === "\x08") { state.value = state.value.slice(0, -1); }
           else if (data.length === 1) { state.value += data; }
         },
       };
     },
   }
   ```

   **Split Min Width** — number submenu:
   ```typescript
   {
     id: "diffSplitMinWidth",
     label: "Split Min Width",
     description: "Min terminal columns for split view (≥ 100)",
     currentValue: String(config.diffSplitMinWidth),
     submenu: (currentValue: string, done: (selectedValue?: string) => void) => {
       const state = { value: currentValue };
       return {
         invalidate(): void { /* no-op */ },
         render(): string[] {
           return [
             "Enter min width (ESC to cancel):",
             "",
             `  ${state.value}`,
             "",
             "ESC: cancel | ENTER: confirm",
           ];
         },
         handleInput(data: string): void {
           if (data === "\x1b") { done(); return; }
           if (data === "\r" || data === "\n") {
             const n = parseInt(state.value, 10);
             if (Number.isFinite(n) && n >= 100) done(String(n));
             else done(); // invalid, keep current
             return;
           }
           if (data === "\x7f" || data === "\x08") { state.value = state.value.slice(0, -1); }
           else if (/^\d$/.test(data)) { state.value += data; }
         },
       };
     },
   }
   ```
   Note: Minimum is 100 (not 80) because split view needs room for both panels plus gutters. Below 100, split view becomes unreadable regardless of code width.

   **Split Min Code Width** — number submenu (same pattern, ≥ 30):
   ```typescript
   {
     id: "diffSplitMinCodeWidth",
     label: "Split Min Code Width",
     description: "Min code columns per side in split (≥ 30)",
     currentValue: String(config.diffSplitMinCodeWidth),
     submenu: (currentValue: string, done: (selectedValue?: string) => void) => {
       const state = { value: currentValue };
       return {
         invalidate(): void { /* no-op */ },
         render(): string[] {
           return [
             "Enter min code width (ESC to cancel):",
             "",
             `  ${state.value}`,
             "",
             "ESC: cancel | ENTER: confirm",
           ];
         },
         handleInput(data: string): void {
           if (data === "\x1b") { done(); return; }
           if (data === "\r" || data === "\n") {
             const n = parseInt(state.value, 10);
             if (Number.isFinite(n) && n >= 30) done(String(n));
             else done(); // invalid, keep current
             return;
           }
           if (data === "\x7f" || data === "\x08") { state.value = state.value.slice(0, -1); }
           else if (/^\d$/.test(data)) { state.value += data; }
         },
       };
     },
   }
   ```

6. In the settings callback (the `(id, newValue)` handler in `SettingsList`), add cases:
   ```typescript
   case "diffTheme":
     config.diffTheme = newValue;
     break;
   case "diffSplitMinWidth":
     config.diffSplitMinWidth = parseInt(newValue, 10);
     break;
   case "diffSplitMinCodeWidth":
     config.diffSplitMinCodeWidth = parseInt(newValue, 10);
     break;
   ```

7. The `saveConfig` and `loadConfig` functions already handle the full `HephaestusConfig` object (they serialize/deserialize the entire `hephaestus` key in settings.json). No changes needed — the new fields are automatically persisted.

**Steps:**
- [ ] Add import for registerDiffTools and HephaestusDiffConfig
- [ ] Extend HephaestusConfig interface with HephaestusDiffConfig
- [ ] Add default values for diffTheme, diffSplitMinWidth, diffSplitMinCodeWidth
- [ ] Call registerDiffTools in session_start handler
- [ ] Add 3 SettingItem entries for diff config (before "save")
- [ ] Add switch cases for diff settings in SettingsList callback
- [ ] Run `npx tsc --noEmit` to verify types compile
- [ ] Fix any type errors
- [ ] Commit with message: "feat: wire diff-render into Hephaestus with settings UI"

**Acceptance criteria:**
- [ ] `src/index.ts` compiles without TypeScript errors
- [ ] `HephaestusConfig` extends `HephaestusDiffConfig`
- [ ] `registerDiffTools` is called in `session_start`
- [ ] 3 new settings items appear in `/hephaestus` menu
- [ ] Diff settings are persisted to settings.json automatically

---

### Task 4: Update README.md

**Context:**
Document the new diff rendering feature in Hephaestus's README so users know it's included.

**Files:**
- Modify: `README.md`

**What to implement:**

1. Update the package description to mention diff rendering.
2. Add a "Diff Rendering" section describing the feature:
   - Syntax-highlighted diffs for `write` and `edit` tools
   - Split view (side-by-side) for edits, unified view (stacked) for writes
   - Word-level emphasis on changed characters
   - Auto-derives colors from the pi theme
   - Configurable via `/hephaestus` settings (Shiki theme, split thresholds)
3. If there are screenshots available from pi-split-diff's `media/` directory, reference them or copy them to Hephaestus's `docs/` directory.

**Steps:**
- [ ] Update README.md description to mention diff rendering
- [ ] Add "Diff Rendering" feature section
- [ ] Copy media/split.png and media/unified.png from pi-split-diff to docs/ (optional, if screenshots should be included)
- [ ] Commit with message: "docs: update README with diff rendering feature"

**Acceptance criteria:**
- [ ] README.md mentions diff rendering as a feature
- [ ] Configuration options are documented

---

## Notes

- **Tests**: `diff.test.ts` from pi-split-diff is NOT migrated. Hephaestus has no test runner. Tests can be added in a follow-up.
- **Graceful degradation**: If Shiki WASM fails to load, `hlBlock()` falls back to plain `code.split("\n")` — diffs render without syntax highlighting but still show diff structure.
- **Conflict detection**: If both Hephaestus and standalone pi-split-diff are active, users should uninstall pi-split-diff. No runtime guard is implemented (kept simple).
- **Hardcoded constants**: `MAX_PREVIEW_LINES` (60), `MAX_RENDER_LINES` (150), `MAX_HL_CHARS` (80000), `CACHE_LIMIT` (192), `WORD_DIFF_MIN_SIM` (0.15), and all wrap thresholds remain hardcoded — not exposed as user settings.
- **Terminal width**: `termW()` remains environment-derived (`process.stdout.columns`, `process.env.COLUMNS`). Not part of config.
- **Smoke test**: After Task 3, verify by launching pi with Hephaestus enabled, triggering a `write` or `edit` tool, and confirming syntax-highlighted diff output appears in the terminal. If Shiki WASM is cold, the first render may have a brief delay before highlighting appears.
