import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { SettingsList, SettingItem, TUI } from "@earendil-works/pi-tui";
import { loadConfig, saveConfig, DEFAULT_CONFIG, type HephaestusConfig } from "./config.js";

// ── Factory: text submenu ───────────────────────────────────────────────

function createTextSubmenu(opts: {
  label: string;
  cancelHint?: string;
  confirmHint?: string;
}): SettingItem["submenu"] {
  return (currentValue: string, done: (selectedValue?: string) => void) => {
    const state = { value: currentValue };
    return {
      invalidate(): void { /* no-op */ },
      render(): string[] {
        const hints: string[] = [];
        if (opts.cancelHint) hints.push(opts.cancelHint);
        if (opts.confirmHint) hints.push(opts.confirmHint);
        return [
          opts.label,
          "",
          `  ${state.value}`,
          "",
          hints.join(" | "),
        ];
      },
      handleInput(data: string): void {
        if (data === "\x1b") { done(); return; }
        if (data === "\r" || data === "\n") { done(state.value); return; }
        if (data === "\x7f" || data === "\x08") { state.value = state.value.slice(0, -1); }
        else if (data.length === 1) { state.value += data; }
      },
    };
  };
}

// ── Factory: number submenu ─────────────────────────────────────────────

function createNumberSubmenu(opts: {
  label: string;
  cancelHint?: string;
  confirmHint?: string;
  min?: number;
}): SettingItem["submenu"] {
  return (currentValue: string, done: (selectedValue?: string) => void) => {
    const state = { value: currentValue };
    return {
      invalidate(): void { /* no-op */ },
      render(): string[] {
        const hints: string[] = [];
        if (opts.cancelHint) hints.push(opts.cancelHint);
        if (opts.confirmHint) hints.push(opts.confirmHint);
        return [
          opts.label,
          "",
          `  ${state.value}`,
          "",
          hints.join(" | "),
        ];
      },
      handleInput(data: string): void {
        if (data === "\x1b") { done(); return; }
        if (data === "\r" || data === "\n") {
          const n = parseInt(state.value, 10);
          if (Number.isFinite(n) && (!opts.min || n >= opts.min)) done(String(n));
          else done();
          return;
        }
        if (data === "\x7f" || data === "\x08") { state.value = state.value.slice(0, -1); }
        else if (/^\d$/.test(data)) { state.value += data; }
      },
    };
  };
}

// ── Settings UI ─────────────────────────────────────────────────────────

export function openSettings(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const config: HephaestusConfig = { ...DEFAULT_CONFIG };

  // Load saved config
  const savedConfig = loadConfig();
  Object.assign(config, savedConfig);

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
        submenu: createTextSubmenu({
          label: "Enter label text (ESC to cancel):",
          cancelHint: "ESC: cancel",
          confirmHint: "ENTER: confirm",
        }),
      },
      {
        id: "labelColor",
        label: "Label Color",
        description: "RGB color for thinking label (e.g. 255,215,0)",
        currentValue: config.labelColor,
        submenu: createTextSubmenu({
          label: "Enter RGB color (ESC to cancel):",
          cancelHint: "ESC: cancel",
          confirmHint: "ENTER: confirm",
        }),
      },
      {
        id: "diffTheme",
        label: "Diff Theme",
        description: "Shiki syntax-highlighting theme for diffs",
        currentValue: config.diffTheme,
        submenu: createTextSubmenu({
          label: "Enter Shiki theme (ESC to cancel):",
          cancelHint: "ESC: cancel",
          confirmHint: "ENTER: confirm",
        }),
      },
      {
        id: "diffSplitMinWidth",
        label: "Split Min Width",
        description: "Min terminal columns for split view (≥ 100)",
        currentValue: String(config.diffSplitMinWidth),
        submenu: createNumberSubmenu({
          label: "Enter min width (ESC to cancel):",
          cancelHint: "ESC: cancel",
          confirmHint: "min 100",
          min: 100,
        }),
      },
      {
        id: "diffSplitMinCodeWidth",
        label: "Split Min Code Width",
        description: "Min code columns per side in split (≥ 30)",
        currentValue: String(config.diffSplitMinCodeWidth),
        submenu: createNumberSubmenu({
          label: "Enter min code width (ESC to cancel):",
          cancelHint: "ESC: cancel",
          confirmHint: "min 30",
          min: 30,
        }),
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
      switch (id) {
        case "mutedTheme": config.mutedTheme = newValue === "On"; break;
        case "codeUnindent": config.codeUnindent = newValue === "On"; break;
        case "labelText": config.labelText = newValue; break;
        case "labelColor": config.labelColor = newValue; break;
        case "diffTheme": config.diffTheme = newValue; break;
        case "diffSplitMinWidth": config.diffSplitMinWidth = parseInt(newValue, 10); break;
        case "diffSplitMinCodeWidth": config.diffSplitMinCodeWidth = parseInt(newValue, 10); break;
        case "save": {
          saveConfig(config);
          done(config);
          return;
        }
      }
    }, () => {
      // ESC cancels without saving
      done(config);
    });

    return settingsList;
  });
}
