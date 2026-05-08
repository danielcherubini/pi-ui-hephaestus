/**
 * dir | model | ◐thinking | branch [+status] | worktree | ↑↓R W $cost | ━━━━━ context%
 * Splits into two lines when terminal width < diffSplitMinWidth (default 150):
 *   Line 1: system info (dir, branch, model, thinking, worktree)
 *   Line 2: usage stats (↑↓R W $cost + context progress bar)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getGitStatus, getWorktreeBranch } from "./utils/git.js";
import { getContextWindowInfo, getTokenUsageStats } from "./utils/stats.js";
import { formatContextBar, formatGitStatusIndicators, formatThinkingIndicator, formatTokenCount } from "./utils/format.js";
import { footerIcons } from "./utils/icons.js";
import { clampLine } from "../utils/text.js";
import { loadConfig } from "../config.js";

export default function(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const splitThreshold = loadConfig().diffSplitMinWidth;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsubscribe,
        invalidate() { },
        render(width: number): string[] {
          try {
            const colorize = (token: string, s: string) => theme.fg(token as any, s);
            const activeModel = ctx.model?.id || "no-model";
            const currentBranch = footerData.getGitBranch();
            const currentDirectory = process.cwd().split("/").pop() || process.cwd();
            const gitStatus = getGitStatus();
            const worktreeBranch = getWorktreeBranch();
            const thinkingLevel = pi.getThinkingLevel();
            const { totalInput, totalOutput, totalCacheRead, totalCacheWrite, totalCost } = getTokenUsageStats(ctx);
            const { percent: contextPercent, percentValue: contextPercentValue, windowSize: contextWindowSize } = getContextWindowInfo(ctx);

            // ── Two-line split for narrow terminals ────────────────────────────

            const shouldSplit = width < splitThreshold;

            // Thinking display
            const thinkingIndicatorStr = formatThinkingIndicator(thinkingLevel, colorize);

            // Git status indicators
            const gitStatusStr = formatGitStatusIndicators(gitStatus, colorize);

            // Left section: dir | branch [+status] | model | thinking | worktree
            const leftSections = [
              colorize("syntaxFunction", " " + footerIcons.directory + currentDirectory),
              currentBranch ? colorize("success", footerIcons.branch + " " + currentBranch + (gitStatusStr ? " " + gitStatusStr : "")) : "",
              colorize("syntaxType", footerIcons.model + " " + activeModel),
              thinkingIndicatorStr,
              worktreeBranch ? colorize("syntaxNumber", footerIcons.worktree + " " + worktreeBranch) : "",
            ].filter(Boolean);

            const separator = theme.fg("dim", " | ");
            const leftSectionStr = leftSections.join(separator);

            // Token stats with context percentage
            const statsParts: string[] = [];
            if (totalInput) statsParts.push("↑" + formatTokenCount(totalInput));
            if (totalOutput) statsParts.push("↓" + formatTokenCount(totalOutput));
            if (totalCacheRead) statsParts.push("R" + formatTokenCount(totalCacheRead));
            if (totalCacheWrite) statsParts.push("W" + formatTokenCount(totalCacheWrite));
            if (totalCost) statsParts.push("$" + totalCost.toFixed(2));

            const contextUsed = contextWindowSize * (contextPercentValue / 100);
            const contextDisplay =
              contextPercent === "?"
                ? "?"
                : formatTokenCount(contextUsed) + "/" + formatTokenCount(contextWindowSize);
            const contextColored =
              contextPercentValue > 95
                ? theme.fg("error", contextDisplay)
                : contextPercentValue > 80
                  ? theme.fg("warning", contextDisplay)
                  : contextDisplay;
            statsParts.push(contextColored);

            const rawStatsSectionStr = statsParts.join(" ");
            const statsSectionStr = theme.fg("dim", rawStatsSectionStr);

            if (shouldSplit) {
              // ── Two-line mode ──────────────────────────────────────────────

              // Calculate available space for the context progress bar on line 2
              const availableBarSpace = Math.max(2, width - visibleWidth(statsSectionStr) - 13);

              // Context progress bar (expands to fill remaining space)
              const contextBarStr = formatContextBar(colorize as (token: string, s: string) => string, contextPercentValue, availableBarSpace);

              // Assemble line 2: stats | bar
              const rightSections: string[] = [];
              if (statsSectionStr) rightSections.push(statsSectionStr);
              if (contextBarStr) rightSections.push(contextBarStr);
              const rightSectionStr = rightSections.join(theme.fg("dim", " | "));

              // Edge case: if both stats and bar are empty, return only line 1
              if (!rightSectionStr) {
                return [clampLine(leftSectionStr, width)];
              }

              return [
                clampLine(leftSectionStr, width),
                clampLine(rightSectionStr, width),
              ];
            }

            // ── Single-line mode ───────────────────────────────────────────────

            // Separator between left and right sections
            const sectionSeparator = theme.fg("dim", " | ");

            // Calculate available space for the context progress bar (after stats)
            const availableBarSpace = Math.max(
              2,
              width - visibleWidth(leftSectionStr) - 1 - visibleWidth(sectionSeparator) - visibleWidth(statsSectionStr) - 10,
            );

            // Context progress bar (expands to fill remaining space)
            const contextBarStr = formatContextBar(colorize as (token: string, s: string) => string, contextPercentValue, availableBarSpace);

            // Assemble: left | stats | bar
            const rightSections: string[] = [];
            if (statsSectionStr) rightSections.push(statsSectionStr);
            if (contextBarStr) rightSections.push(contextBarStr);
            const rightSectionStr = rightSections.join(theme.fg("dim", " | "));

            return [clampLine(leftSectionStr + sectionSeparator + rightSectionStr, width)];
          } catch (e) {
            return [];
          }
        },
      };
    });
  });
}
