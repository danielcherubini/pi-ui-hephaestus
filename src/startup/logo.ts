import { visibleWidth } from "@mariozechner/pi-tui";
import { gray, rgb, extractRgb, lerp } from "../utils/index.js";

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
