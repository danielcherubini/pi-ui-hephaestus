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
