import { truncateToWidth } from "@earendil-works/pi-tui";
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
