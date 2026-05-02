import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
  KeybindingsManager,
  getSettingsListTheme,
  getAgentDir,
} from "@mariozechner/pi-coding-agent";
import type { Theme } from "@mariozechner/pi-coding-agent";
import {
  SettingsList,
  SettingItem,
  TUI,
  EditorTheme,
  Component,
} from "@mariozechner/pi-tui";

import registerFooter from "./footer/index.js";

const SETTINGS_PATH = join(getAgentDir(), "settings.json");
import { patchThinkingRenderer } from "./thinking/patch.js";
import { transformThinkingContent } from "./thinking/transform.js";
import { HephaestusEditor } from "./editor/index.js";
import { patchUserMessage, resetInstanceCount } from "./message/index.js";
import { renderHeader, patchStartupListing, ListingRef } from "./startup/index.js";

// ── Globals (module-level, survive hot-reload via Symbol keys) ──────────────

const g: Record<string | symbol, unknown> = globalThis as unknown as typeof global & Record<string | symbol, unknown>;

const MODEL_SCOPE_RE = /Model scope:\s*(.+)/;
const CAPTURED_MODELS = Symbol.for("splashscreen:capturedModels");
const PATCHED_LOG = Symbol.for("splashscreen:logPatched");

// ── Model scope capture ────────────────────────────────────────────────────

function patchConsoleLog(): void {
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

// ── Config persistence ─────────────────────────────────────────────────────

interface HephaestusConfig {
  mutedTheme: boolean;
  codeUnindent: boolean;
  labelText: string;
  labelColor: string;
}

function loadConfig(): HephaestusConfig {
  const defaultConfig: HephaestusConfig = {
    mutedTheme: false,
    codeUnindent: true,
    labelText: "Thinking...",
    labelColor: "255,215,0",
  };

  if (existsSync(SETTINGS_PATH)) {
    try {
      const full = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
      return { ...defaultConfig, ...(full.hephaestus ?? {}) };
    } catch {
      /* ignore corrupt file */
    }
  }
  return defaultConfig;
}

function saveConfig(config: HephaestusConfig): void {
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

// ── Settings UI ────────────────────────────────────────────────────────────

function openSettings(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const config: HephaestusConfig = {
    mutedTheme: false,
    codeUnindent: true,
    labelText: "Thinking...",
    labelColor: "255,215,0",
  };

  // Load saved config from session entries
  const savedConfig = loadConfig();
  config.mutedTheme = savedConfig.mutedTheme;
  config.codeUnindent = savedConfig.codeUnindent;
  config.labelText = savedConfig.labelText;
  config.labelColor = savedConfig.labelColor;

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
        submenu: (currentValue: string, done: (selectedValue?: string) => void) => {
          const state = { value: currentValue };
          return {
            invalidate(): void { /* no-op */ },
            render(): string[] {
              return [
                "Enter label text (ESC to cancel):",
                "",
                `  ${state.value}`,
                "",
                "ESC: cancel | ENTER: confirm",
              ];
            },
            handleInput(data: string): void {
              if (data === "\x1b") {
                done();
                return;
              }
              if (data === "\r" || data === "\n") {
                done(state.value);
                return;
              }
              if (data === "\x7f" || data === "\x08") {
                state.value = state.value.slice(0, -1);
              } else if (data.length === 1) {
                state.value += data;
              }
            },
          };
        },
      },
      {
        id: "labelColor",
        label: "Label Color",
        description: "RGB color for thinking label (e.g. 255,215,0)",
        currentValue: config.labelColor,
        submenu: (currentValue: string, done: (selectedValue?: string) => void) => {
          const state = { value: currentValue };
          return {
            invalidate(): void { /* no-op */ },
            render(): string[] {
              return [
                "Enter RGB color (ESC to cancel):",
                "",
                `  ${state.value}`,
                "",
                "ESC: cancel | ENTER: confirm",
              ];
            },
            handleInput(data: string): void {
              if (data === "\x1b") {
                done();
                return;
              }
              if (data === "\r" || data === "\n") {
                done(state.value);
                return;
              }
              if (data === "\x7f" || data === "\x08") {
                state.value = state.value.slice(0, -1);
              } else if (data.length === 1) {
                state.value += data;
              }
            },
          };
        },
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
      // Update config values when settings change
      switch (id) {
        case "mutedTheme":
          config.mutedTheme = newValue === "On";
          break;
        case "codeUnindent":
          config.codeUnindent = newValue === "On";
          break;
        case "labelText":
          config.labelText = newValue;
          break;
        case "labelColor":
          config.labelColor = newValue;
          break;
        case "save":
          saveConfig(config);
          done(config);
          return;
      }
    }, () => {
      // ESC cancels without saving
      done(config);
    });

    return settingsList;
  });
}

// ── Extension factory ──────────────────────────────────────────────────────

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
        invalidate(): void {
          // No cached state to invalidate
        },
        render(width: number): string[] {
          // -1 footer, -2 spacers (header container wraps custom header with Spacer(1) top/bottom)
          return renderHeader(theme, ref, width, tui.terminal.rows - 3);
        },
      };
      patchStartupListing(tui, theme, ref);
      return comp;
    };
    ctx.ui.setHeader(headerFactory);

    // Shared response times array (used by both patchUserMessage and message_end)
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

    // Register events
    pi.on("message_end", (event, _ctx) => {
      // Transform thinking content (unindent code blocks)
      transformThinkingContent(event.message as any);

      // Track response time from the raw message
      const rawMsg = event.message as any;
      if (rawMsg.duration) {
        const idx = rawMsg.instanceIndex ?? responseTimes.length;
        responseTimes[idx] = rawMsg.duration;
      }
    });

    pi.on("session_shutdown", (_event, _ctx) => {
      // Clear animation intervals
      const ref: ListingRef = g["listingRef"] as ListingRef;
      if (ref) {
        ref.settled = true;
      }

      // Clear response times
      responseTimes.length = 0;

      // Reset instance count
      resetInstanceCount();

      // Clear editor component override
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
