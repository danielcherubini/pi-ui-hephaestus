import { ExtensionAPI, ExtensionContext, ExtensionCommandContext, KeybindingsManager } from "@mariozechner/pi-coding-agent";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { TUI, EditorTheme, Component } from "@mariozechner/pi-tui";

import registerFooter from "./footer/index.js";
import { registerDiffTools } from "./diff-render/index.js";
import { patchThinkingRenderer } from "./thinking/patch.js";
import { transformThinkingContent } from "./thinking/transform.js";
import { HephaestusEditor } from "./editor/index.js";
import { patchUserMessage, resetInstanceCount } from "./message/index.js";
import { renderHeader, patchStartupListing, ListingRef } from "./startup/index.js";
import { patchConsoleLog } from "./startup/capture.js";
import { openSettings } from "./settings.js";
import { loadConfig, type HephaestusConfig } from "./config.js";
import {
  registerImagePaste,
  initImagePasteSession,
  shutdownImagePaste,
} from "./image-paste/index.js";

export default function (pi: ExtensionAPI): void {
  // Patch console.log for model scope capture
  patchConsoleLog();

  // Register footer
  registerFooter(pi);

  // Register image paste (shortcuts, input handler, preview renderer)
  // Called once at module load — NOT inside session_start
  registerImagePaste(pi);

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
        invalidate(): void { /* no-op */ },
        render(width: number): string[] {
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

    // Register diff-enhanced write/edit tools
    registerDiffTools(pi, () => ctx.ui.theme, () => loadConfig());

    // Initialize image paste queue for this session
    initImagePasteSession(ctx);

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
      const g: Record<string | symbol, unknown> = globalThis as unknown as typeof global & Record<string | symbol, unknown>;
      const ref = g["listingRef"] as ListingRef | undefined;
      if (ref) { ref.settled = true; }

      // Clear response times
      responseTimes.length = 0;

      // Reset instance count
      resetInstanceCount();

      // Clear editor component override
      ctx.ui.setEditorComponent(undefined);

      // Clear image paste state
      shutdownImagePaste();
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
