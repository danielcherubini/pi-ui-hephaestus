export function formatTokenCount(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return (count / 1000).toFixed(1) + "k";
  if (count < 1000000) return Math.round(count / 1000) + "k";
  if (count < 10000000) return (count / 1000000).toFixed(1) + "M";
  return Math.round(count / 1000000) + "M";
}

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

type GitStatusColor = "success" | "warning" | "dim" | "info";

const gitStatusColors: Record<keyof typeof gitDisplayIcons, GitStatusColor> = {
  staged: "success",
  unstaged: "warning",
  untracked: "dim",
  ahead: "info",
  behind: "warning",
};

export type ColorFn = (token: string, s: string) => string;

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

export const thinkingLevelColors: Record<string, string> = {
  off: "dim",
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
};

export function formatThinkingIndicator(thinkingLevel: string, colorize: ColorFn): string {
  return thinkingLevel !== "off" ? colorize(thinkingLevelColors[thinkingLevel] || "dim", "◐ " + thinkingLevel) : "";
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
