import { truncateToWidth, type TUI } from "@mariozechner/pi-tui";

/** Clamp a line to maxW visible characters, preserving ANSI escapes. */
export function clampLine(line: string, maxW: number): string {
  return truncateToWidth(line, maxW);
}

/** Clamp an array of lines to maxW visible characters each. */
export function clampLines(lines: string[], maxW: number): string[] {
  return lines.map((l) => clampLine(l, maxW));
}
