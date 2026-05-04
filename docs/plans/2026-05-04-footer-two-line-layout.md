# Footer Two-Line Layout Plan

**Goal:** Split the footer into two lines when terminal width falls below `diffSplitMinWidth` (default 150), improving readability on narrower terminals.

**Architecture:** The footer extension's `render(width)` function checks `width < cfg.diffSplitMinWidth`. When true, it returns a 2-element string array: Line 1 contains system info (dir, branch, model, thinking, worktree) and Line 2 contains usage stats (↑↓R W $cost + context progress bar). The TUI renders each array element on its own row.

**Tech Stack:** TypeScript, `@mariozechner/pi-tui` (for `visibleWidth`, `truncateToWidth`), existing footer extension infrastructure.

---

### Task 1: Implement two-line footer split in `src/footer/index.ts`

**Context:**
The current footer renders everything on a single line via `clampLine(fullLine, width)`. When the terminal is narrow (< 150 cols by default), the line gets truncated and important info is lost. The fix is to detect narrow terminals and split into two lines: system info on Line 1, stats+bar on Line 2. This reuses `diffSplitMinWidth` from config — the same threshold the diff tool uses to decide between unified and split views.

**Files:**
- Modify: `src/footer/index.ts`

**What to implement:**

1. Add import for `loadConfig` from `../config.js`:
   ```ts
   import { loadConfig } from "../config.js";
   ```

2. In the `session_start` handler (before `setFooter`), cache the split threshold once to avoid reading config on every render frame:
   ```ts
   const splitThreshold = loadConfig().diffSplitMinWidth;
   ```
3. Inside `render(width)`, use the cached value:
   ```ts
   const shouldSplit = width < splitThreshold;
   ```

3. When `shouldSplit` is true, return a 2-element array:
   - **Line 1:** `leftSectionStr` (the system info section: dir | branch+status | model | thinking | worktree), clamped via `clampLine(leftSectionStr, width)`
     - **Important:** Line 1 consists of ONLY `leftSectionStr`. The outer `sectionSeparator` (`" | "`) that currently joins left and right sections is NOT included on either line when splitting.
   - **Line 2:** The stats section + context bar, assembled the same way as the current right section but calculated against `width` instead of the remaining space after the left section. Clamp via `clampLine(rightSectionStr, width)`.

4. When `shouldSplit` is false, keep the existing single-line behavior unchanged.

**Line 2 assembly logic (when splitting):**
- Build `statsParts` array and `statsSectionStr` exactly as currently done
- Calculate bar space: `const availableBarSpace = Math.max(2, width - visibleWidth(statsSectionStr) - 13)`
  - The `13` accounts for: `" | "` separator (3 chars) + context icon+spaces (4) + space before percentage (1) + percentage string like "100%" (4-5)
- Build `contextBarStr` using `formatContextBar(colorize, contextPercentValue, availableBarSpace)`
- Assemble line 2: if both stats and bar exist, join with `" | "`, else use whichever exists
- **Edge case guard:** If both `statsSectionStr` and `contextBarStr` are empty (early session), return only `[clampLine(leftSectionStr, width)]` — a single-element array — instead of a two-element array with an empty second line
- Wrap in `clampLine(line2, width)`

**What NOT to change:**
- The `formatContextBar`, `formatTokenCount`, `formatGitStatusIndicators`, `formatThinkingIndicator` functions in `src/footer/utils/*.ts` — no changes needed there
- The git status, token stats, or context window info gathering logic
- Any imports other than the new `loadConfig` import

**Steps:**
- [ ] Add `import { loadConfig } from "../config.js";` to `src/footer/index.ts`
- [ ] In `render(width)`, after all section strings are computed and before assembling the final line, add:
  ```ts
  const cfg = loadConfig();
  const shouldSplit = width < cfg.diffSplitMinWidth;
  ```
- [ ] Add conditional logic: if `shouldSplit` is true, build Line 1 (left section clamped) and Line 2 (stats + bar, recalculated against full width), return `[line1, line2]`; otherwise return current single-line result
- [ ] For Line 2 stats+bar calculation, reuse the existing `statsParts` assembly and `formatContextBar` call, but use `Math.max(2, width - visibleWidth(statsSectionStr) - 10)` as the available bar space
- [ ] Run `npx tsc --noEmit` to verify TypeScript compiles cleanly
  - Did it succeed with no errors? If not, fix type errors and re-run before continuing.
- [ ] Manually test by running the app and resizing the terminal:
  - At wide width (>= 150): footer should be one line, identical to current behavior
  - At narrow width (< 150): footer should split into two lines with system info on top, stats+bar below
- [ ] (Optional, deferred) Consider adding a simple unit test that mocks `width` and verifies the return array length: `render(200) → length 1`, `render(100) → length 2`. The project currently has no test infrastructure.
- [ ] Commit with message: "feat: split footer into two lines when terminal is narrow"

**Acceptance criteria:**
- [ ] Footer renders as one line when `width >= cfg.diffSplitMinWidth` (default 150) — identical to current behavior
- [ ] Footer renders as two lines when `width < cfg.diffSplitMinWidth` — Line 1: system info, Line 2: stats + context bar
- [ ] Both lines are clamped to `width` via `clampLine()` — no overflow beyond terminal width
- [ ] TypeScript compiles cleanly (`npx tsc --noEmit`)
- [ ] No changes to any files other than `src/footer/index.ts`
