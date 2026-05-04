import { relative } from "node:path";

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
