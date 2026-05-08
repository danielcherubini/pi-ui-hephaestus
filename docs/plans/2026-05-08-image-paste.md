# Image Paste Plan

**Goal:** Add lightweight clipboard image paste and drag-drop support to pi-ui-hephaestus with inline preview after submit, controlled by pi's existing `terminal.showImages` setting.

**Architecture:** New `src/image-paste/` module with four files: `clipboard.ts` (cross-platform clipboard reader ported from pi-image-tools), `types.ts` (shared types), `preview.ts` (registerMessageRenderer for inline display), and `index.ts` (orchestration — shortcut registration, input handler, queue management, config reading). Drag-drop is handled in the `pi.on("input")` handler by scanning submitted text for image file paths (not in the editor, which is unreliable for terminal drag-drop). Config reads `terminal.showImages` from `~/.pi/agent/settings.json`.

**Tech Stack:** TypeScript, Node.js `spawnSync` (wl-paste/xclip/PowerShell), `@mariozechner/clipboard` (optional native addon via `createRequire`), pi SDK (`pi.on("input")`, `pi.registerShortcut`, `pi.registerMessageRenderer`, `pi.sendMessage`)

**Task Dependencies:** Tasks 1–3 can run in parallel. Task 4 depends on all of Tasks 1–3. Task 5 depends on Task 4.

---

### Task 1: Create src/image-paste/types.ts and src/image-paste/clipboard.ts

**Context:**
The clipboard reader is the foundation — it reads image bytes from the clipboard across all platforms. We port the reader from pi-image-tools (`/home/daniel/Coding/Javascript/pi-image-tools/src/clipboard.ts`) with minimal changes. The types file defines the shared interfaces used throughout the module.

**Files:**
- Create: `src/image-paste/types.ts`
- Create: `src/image-paste/clipboard.ts`

**What to implement:**

1. Create `src/image-paste/types.ts` with exactly these types:
   ```typescript
   export interface ClipboardImage {
     bytes: Uint8Array;
     mimeType: string;  // "image/png", "image/jpeg", "image/webp", "image/gif"
   }

   export interface PendingImage {
     id: string;         // UUID — unique per paste operation
     base64: string;
     mimeType: string;
   }

   export interface ImageMarker {
     id: string;         // matches PendingImage.id
     text: string;       // "[Image #N]" — the exact text inserted
     index: number;      // 1-based insertion order (for N in "[Image #N]")
   }
   ```

2. Create `src/image-paste/clipboard.ts` by copying `/home/daniel/Coding/Javascript/pi-image-tools/src/clipboard.ts` with these modifications:
   - Change the `ClipboardImage` import to use our own `types.ts`: `import type { ClipboardImage } from "./types.js"`
   - Remove the `ClipboardModule` import from `./types.js` — define it locally as:
     ```typescript
     interface ClipboardModule {
       hasImage: () => boolean;
       getImageBinary: () => Promise<Array<number> | Uint8Array>;
     }
     ```
   - Keep ALL platform detection logic unchanged: `hasGraphicalSession()`, `isWaylandSession()`, `loadClipboardModule()`, `readClipboardImageViaNativeModule()`, `readClipboardImageViaPowerShell()`, `readClipboardImageViaWlPaste()`, `readClipboardImageViaXclip()`
   - The main export is `async function readClipboardImage(options?)` returning `ClipboardImage | null`
   - It returns `null` when no image is on the clipboard
   - It throws when infrastructure is unavailable (no clipboard tools installed, no graphical session)
   - The `SUPPORTED_IMAGE_MIME_TYPES` constant should include: `"image/png"`, `"image/jpeg"`, `"image/webp"`, `"image/gif"`, `"image/bmp"`

3. Add a new function `readFileAsImage(filePath: string): Promise<ClipboardImage | null>`:
   ```typescript
   import { existsSync } from "node:fs";
   import { readFile } from "node:fs/promises";

   const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

   export function isImageFilePath(path: string): boolean {
     return IMAGE_EXTENSIONS.has(path.toLowerCase().split(".").pop() ?? "");
   }

   export async function readFileAsImage(filePath: string): Promise<ClipboardImage | null> {
     if (!existsSync(filePath)) return null;
     const ext = filePath.toLowerCase().split(".").pop() ?? "";
     const mimeMap: Record<string, string> = {
       png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
       webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
     };
     const mimeType = mimeMap[ext];
     if (!mimeType) return null;
     try {
       const bytes = await readFile(filePath);
       if (bytes.length === 0) return null;
       return { bytes: new Uint8Array(bytes), mimeType };
     } catch {
       return null;
     }
   }
   ```
   **IMPORTANT:** Use `readFile` from `node:fs/promises` (async), NOT `readFileSync`. The function is `async` and must not block the event loop for files up to 20MB.

**Do NOT change:** The clipboard reading logic itself. Copy from pi-image-tools exactly, only adjusting imports.

**Steps:**
- [ ] Create `src/image-paste/types.ts` with the three interfaces above
- [ ] Copy `/home/daniel/Coding/Javascript/pi-image-tools/src/clipboard.ts` to `src/image-paste/clipboard.ts`
- [ ] Adjust imports in clipboard.ts to use local types
- [ ] Add `isImageFilePath()` and `readFileAsImage()` functions
- [ ] Run `npx tsc --noEmit` to verify types compile
- [ ] Commit with message: "feat: add image paste types and clipboard reader"

**Acceptance criteria:**
- [ ] `src/image-paste/types.ts` exports `ClipboardImage`, `PendingImage`, `ImageMarker`
- [ ] `src/image-paste/clipboard.ts` exports `readClipboardImage()`, `isImageFilePath()`, `readFileAsImage()`
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)
- [ ] Clipboard reader handles all platforms: Windows (PowerShell), Linux (wl-paste/xclip), macOS (native)

---

### Task 2: Create src/image-paste/preview.ts

**Context:**
The preview module registers a custom message renderer that displays pasted images inline in the chat. It uses pi-coding-agent's `registerMessageRenderer` API with a custom type `hephaestus-image-preview`. The renderer uses pi-tui's `Image` component to display images with terminal-native rendering.

**Files:**
- Create: `src/image-paste/preview.ts`

**What to implement:**

Create `src/image-paste/preview.ts` with exactly this content:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Container, Image, Spacer, Text } from "@mariozechner/pi-tui";

import type { PendingImage } from "./types.js";

const CUSTOM_TYPE = "hephaestus-image-preview";

interface PreviewDetails {
  images: Array<{ data: string; mimeType: string }>;
}

export function registerImagePreview(pi: ExtensionAPI): void {
  pi.registerMessageRenderer<PreviewDetails>(CUSTOM_TYPE, (message, _options, theme) => {
    const details = message.details as PreviewDetails;
    if (!details?.images || details.images.length === 0) {
      return undefined;
    }

    // Theme.fg is runtime-available but not exposed in the Theme type definition
    const fg = (theme as any).fg as ((color: string, text: string) => string) | undefined;
    if (!fg) return undefined;

    const container = new Container();
    const imageCount = details.images.length;
    const label = imageCount === 1 ? "image" : "images";

    container.addChild(new Spacer(1));
    container.addChild(new Text(fg("muted", `↳ pasted ${label} preview`), 0, 0));

    for (const img of details.images) {
      container.addChild(new Spacer(1));
      container.addChild(
        new Image(img.data, img.mimeType, {
          fallbackColor: (text: string) => fg("toolOutput", text),
        }, {
          maxWidthCells: 60,
        }),
      );
    }

    return container;
  });
}

export function sendPreviewMessage(
  pi: ExtensionAPI,
  images: PendingImage[],
): void {
  if (images.length === 0) return;

  pi.sendMessage(
    {
      customType: CUSTOM_TYPE,
      content: "",
      display: true,
      details: {
        images: images.map((img) => ({
          data: img.base64,
          mimeType: img.mimeType,
        })),
      },
    },
    { triggerTurn: false },
  );
}
```

**NOTE:** The preview message sends base64 image data in `details` with `display: true`. This increases session file size proportionally to the image data. This is acceptable for a lightweight preview — the actual images are already attached via the `input` handler's `images` field.

**Steps:**
- [ ] Create `src/image-paste/preview.ts` with the content above
- [ ] Run `npx tsc --noEmit` to verify types compile
- [ ] Commit with message: "feat: add image preview renderer"

**Acceptance criteria:**
- [ ] `registerImagePreview(pi)` registers a message renderer for `hephaestus-image-preview`
- [ ] `sendPreviewMessage(pi, images)` sends a companion custom message with image data
- [ ] Renderer uses pi-tui `Image` component with `maxWidthCells: 60`
- [ ] TypeScript compiles without errors

---

### Task 3: Create src/image-paste/index.ts — main orchestration module

**Context:**
This is the main entry point that ties everything together. It manages the pending image queue, registers shortcuts, handles input events for submit-time image attachment, reads the `showImages` config, and coordinates with the editor for drag-drop support.

**Files:**
- Create: `src/image-paste/index.ts`

**What to implement:**

Create `src/image-paste/index.ts` with the following structure:

```typescript
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

import { readClipboardImage, isImageFilePath, readFileAsImage } from "./clipboard.js";
import { registerImagePreview, sendPreviewMessage } from "./preview.js";
import type { ClipboardImage, PendingImage, ImageMarker } from "./types.js";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

// ── Config ──────────────────────────────────────────────────────

function loadShowImages(): boolean {
  try {
    const settingsPath = join(getAgentDir(), "settings.json");
    if (!existsSync(settingsPath)) return true;
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    return settings?.terminal?.showImages ?? true;
  } catch {
    return true;
  }
}

// ── Queue management ────────────────────────────────────────────

interface ImageQueue {
  images: PendingImage[];
  markers: ImageMarker[];
  nextIndex: number;
}

function createImageQueue(): ImageQueue {
  return { images: [], markers: [], nextIndex: 1 };
}

// Marker key: the visible text WITHOUT trailing space (e.g. "[Image #1]")
// This is used for both detection and replacement — consistent strategy.
function markerKey(marker: ImageMarker): string {
  return marker.text.trim();
}

function queueImage(
  queue: ImageQueue,
  image: ClipboardImage,
  ctx: ExtensionContext,
): ImageMarker {
  const id = randomUUID();
  const placeholder = `[Image #${queue.nextIndex}] `;

  const pending: PendingImage = {
    id,
    base64: Buffer.from(image.bytes).toString("base64"),
    mimeType: image.mimeType,
  };
  queue.images.push(pending);

  const marker: ImageMarker = {
    id,
    text: placeholder,
    index: queue.nextIndex,
  };
  queue.markers.push(marker);
  queue.nextIndex += 1;

  // Insert placeholder into editor
  ctx.ui.pasteToEditor(placeholder);
  return marker;
}

// ── Registration ────────────────────────────────────────────────

function getImagePasteShortcuts(): string[] {
  if (process.platform === "win32") {
    return ["alt+v", "ctrl+alt+v"];
  }
  return ["ctrl+v", "alt+v", "ctrl+alt+v"];
}

// Module-level state — registered once, queue reset per session
let _ctx: ExtensionContext | null = null;
let _queue: ImageQueue | null = null;
let _pasting = false;

export function registerImagePaste(pi: ExtensionAPI): void {
  // Register preview renderer (once)
  registerImagePreview(pi);

  // Register shortcuts (once)
  const pasteImage = async (): Promise<void> => {
    if (_pasting) return; // Mutex: prevent concurrent paste operations
    if (!_ctx || !_queue || !_ctx.hasUI) return;
    _pasting = true;
    try {
      const image = await readClipboardImage();
      if (!image) {
        _ctx.ui.notify("No image found in clipboard.", "warning");
        return;
      }
      if (image.bytes.length > MAX_FILE_SIZE_BYTES) {
        _ctx.ui.notify(
          `Image too large (${(image.bytes.length / 1024 / 1024).toFixed(1)}MB > 20MB).`,
          "warning",
        );
        return;
      }
      queueImage(_queue, image, _ctx);
      _ctx.ui.notify("Image attached from clipboard.", "info");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      _ctx.ui.notify(`Image paste failed: ${msg}`, "warning");
    } finally {
      _pasting = false;
    }
  };

  for (const shortcut of getImagePasteShortcuts()) {
    pi.registerShortcut(shortcut, {
      description: "Attach clipboard image to draft",
      handler: pasteImage,
    });
  }

  // Input event handler — attach images on submit (once)
  pi.on("input", async (event) => {
    if (event.source === "extension") {
      return { action: "continue" as const };
    }
    if (!_queue || !_queue.markers.length || !_ctx) {
      return { action: "continue" as const };
    }

    // ── Drag-drop detection: scan for image file paths ──
    // Terminal drag-drop sends file paths as text. We detect them by
    // scanning for paths ending with image extensions.
    const imagePathRegex = /([\w\-./\\~]+\.(png|jpg|jpeg|webp|gif|bmp))(?:\s|$|\n)/gi;
    const filePathMatches = event.text.match(imagePathRegex);
    if (filePathMatches) {
      for (const match of filePathMatches) {
        const path = match.trim();
        if (isImageFilePath(path)) {
          try {
            const image = await readFileAsImage(path);
            if (image && image.bytes.length <= MAX_FILE_SIZE_BYTES) {
              queueImage(_queue, image, _ctx);
              _ctx.ui.notify(`Image attached: ${path.split("/").pop()?.split("\\").pop() ?? path}`, "info");
            }
          } catch {
            // Silently skip unreadable files
          }
        }
      }
    }

    // ── Marker matching: use consistent key (trimmed text) ──
    let hasMarkers = false;
    for (const marker of _queue.markers) {
      if (event.text.includes(markerKey(marker))) {
        hasMarkers = true;
        break;
      }
    }

    if (!hasMarkers) {
      // No markers found — clear queue (user removed them)
      _queue.images.length = 0;
      _queue.markers.length = 0;
      _queue.nextIndex = 1;
      return { action: "continue" as const };
    }

    // Match markers to images using trimmed key
    const imagesToAttach: PendingImage[] = [];
    let strippedText = event.text;

    for (const marker of _queue.markers) {
      const key = markerKey(marker);
      if (strippedText.includes(key)) {
        const pending = _queue.images.find((img) => img.id === marker.id);
        if (pending) {
          imagesToAttach.push(pending);
        }
        // Replace the key plus any trailing whitespace
        strippedText = strippedText.replace(
          new RegExp(key.replace(/[\[\]]/g, "\\$&") + "\\s*"),
          "",
        );
      }
    }

    // Clean up extra whitespace/newlines
    strippedText = strippedText.replace(/\n{3,}/g, "\n\n").trim();

    // Clear queue
    _queue.images.length = 0;
    _queue.markers.length = 0;
    _queue.nextIndex = 1;

    if (imagesToAttach.length === 0) {
      return { action: "continue" as const };
    }

    // Send preview if showImages is enabled
    if (loadShowImages()) {
      try {
        sendPreviewMessage(pi, imagesToAttach);
      } catch {
        // Preview is optional — don't fail the submit
      }
    }

    return {
      action: "transform" as const,
      text: strippedText,
      images: imagesToAttach.map((img) => ({
        type: "image" as const,
        data: img.base64,
        mimeType: img.mimeType,
      })),
    };
  });
}

// Called on session_start to initialize/reset the queue
export function initImagePasteSession(ctx: ExtensionContext): void {
  _ctx = ctx;
  _queue = createImageQueue();
}

// Called on session_shutdown to clear state
export function shutdownImagePaste(): void {
  _ctx = null;
  _queue = null;
}
```

**Key design decisions:**
- `registerImagePaste(pi)` is called **once** at the top level of the extension factory (outside `session_start`), like `registerFooter(pi)`. This prevents duplicate handler registration on session switches.
- `initImagePasteSession(ctx)` is called inside `session_start` to initialize/reset the queue per session.
- `shutdownImagePaste()` is called inside `session_shutdown` to clear state.
- Markers are tracked internally with UUIDs — no text-based regex matching
- Marker key is the trimmed text (e.g., `[Image #1]`) used consistently for both detection and replacement with regex that handles trailing whitespace
- `loadShowImages()` reads the config file on each submit (live reload)
- Preview is sent after submit via `sendPreviewMessage()` — not on paste
- If no markers are found in the submitted text, the queue is cleared (user removed them)
- `MAX_FILE_SIZE_BYTES` = 20MB — larger images are rejected with a toast
- Drag-drop is handled in the `pi.on("input")` handler by scanning submitted text for image file paths (not in the editor, which is unreliable for terminal drag-drop)
- Paste mutex (`_pasting` flag) prevents concurrent paste operations from racing
- No `globalThis` coupling — module-level state with proper exports

**Steps:**
- [ ] Create `src/image-paste/index.ts` with the content above
- [ ] Run `npx tsc --noEmit` to verify types compile
- [ ] Commit with message: "feat: add image paste orchestration module"

**Acceptance criteria:**
- [ ] `registerImagePaste(pi, ctx)` registers shortcuts, input handler, and preview renderer
- [ ] Paste handler reads clipboard image, queues it, inserts placeholder
- [ ] Input handler matches markers by UUID, strips them, attaches images
- [ ] Preview is sent after submit only when `showImages` is `true`
- [ ] Queue is cleared when no markers found in submitted text
- [ ] TypeScript compiles without errors

---

### Task 4: Wire image-paste into src/index.ts

**Context:**
The image-paste module needs to be wired into Hephaestus's main entry point. Registration happens at the top level (outside `session_start`) to prevent duplicate handlers on session switches. Queue initialization happens inside `session_start`.

**Files:**
- Modify: `src/index.ts`

**What to implement:**

1. In `src/index.ts`, add imports at the top:
   ```typescript
   import {
     registerImagePaste,
     initImagePasteSession,
     shutdownImagePaste,
   } from "./image-paste/index.js";
   ```

2. In `src/index.ts`, at the top level of the extension factory function (outside `session_start`, after `patchConsoleLog()` and before `registerFooter(pi)`), add:
   ```typescript
   // Register image paste (shortcuts, input handler, preview renderer)
   // Called once at module load — NOT inside session_start
   registerImagePaste(pi);
   ```

3. In `src/index.ts`, inside the `session_start` handler (after the existing patches), add:
   ```typescript
   // Initialize image paste queue for this session
   initImagePasteSession(ctx);
   ```

4. In `src/index.ts`, inside the `session_shutdown` handler, add:
   ```typescript
   // Clear image paste state
   shutdownImagePaste();
   ```

**Do NOT modify:** `src/editor/index.ts`. Drag-drop is handled in the `pi.on("input")` handler, not in the editor.

**Steps:**
- [ ] Add imports for `registerImagePaste`, `initImagePasteSession`, `shutdownImagePaste` to `src/index.ts`
- [ ] Call `registerImagePaste(pi)` at the top level (outside `session_start`)
- [ ] Call `initImagePasteSession(ctx)` inside `session_start` handler
- [ ] Call `shutdownImagePaste()` inside `session_shutdown` handler
- [ ] Run `npx tsc --noEmit` to verify types compile
- [ ] Commit with message: "feat: wire image paste into Hephaestus entry point"

**Acceptance criteria:**
- [ ] `registerImagePaste(pi)` is called once at module load (outside `session_start`)
- [ ] `initImagePasteSession(ctx)` is called on session start
- [ ] `shutdownImagePaste()` is called on session shutdown
- [ ] TypeScript compiles without errors
- [ ] No existing functionality is broken
- [ ] No `globalThis` coupling between modules

---

### Task 5: Update package.json and README

**Context:**
The extension now has image paste capability. Update the package metadata and documentation to reflect this.

**Files:**
- Modify: `package.json`
- Modify: `README.md`

**What to implement:**

1. In `package.json`, update the `description` field to include image paste:
   ```json
   "description": "Muted thinking blocks, framed editor, animated header, response time, rich footer, and clipboard image paste for pi"
   ```

2. In `package.json`, update `keywords` to include image-related terms:
   ```json
   "keywords": [
     "pi-package",
     "image-paste",
     "clipboard-image"
   ]
   ```

3. In `README.md`, add a section about image paste:
   ```markdown
   ## Image Paste

   Paste images from your clipboard directly into your messages:

   - **Ctrl+V** (Linux) / **Alt+V** (Windows) — paste image from clipboard
     - On Linux, Ctrl+V is used exclusively for image paste (pi uses Ctrl+Shift+V for text paste)
     - On Windows, Alt+V is used because the terminal reserves Ctrl+V for text paste
   - **Drag-and-drop** — drop an image file into the editor
   - Images are attached as content blocks and sent to the agent
   - Inline preview renders after submit (controlled by `terminal.showImages` in settings)

   ### Settings

   Toggle image preview in `/hephaestus` settings or via `~/.pi/agent/settings.json`:

   ```json
   {
     "terminal": {
       "showImages": true
     }
   }
   ```

   When `showImages` is `false`, images are still attached to messages but no inline preview is shown.
   ```

**Steps:**
- [ ] Update `package.json` description and keywords
- [ ] Update `README.md` with image paste documentation
- [ ] Commit with message: "docs: update package.json and README for image paste"

**Acceptance criteria:**
- [ ] `package.json` description mentions image paste
- [ ] `README.md` documents image paste usage and settings
- [ ] No existing documentation is broken

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | `src/image-paste/types.ts`, `src/image-paste/clipboard.ts` | Types and clipboard reader |
| 2 | `src/image-paste/preview.ts` | Message renderer for inline preview |
| 3 | `src/image-paste/index.ts` | Main orchestration: shortcuts, queue, input handler |
| 4 | `src/index.ts` | Wire into Hephaestus entry point |
| 5 | `package.json`, `README.md` | Documentation |

## Review Notes

This plan was reviewed by the reviewer subagent and updated to address:
- **Critical:** Drag-drop detection moved from `HephaestusEditor.handleInput()` to `pi.on("input")` handler (terminal drag-drop sends paths as text, not reliably detectable in editor)
- **Major:** Registration moved outside `session_start` to prevent duplicate handlers on session switches
- **Major:** Marker text matching uses consistent trimmed key with regex for replacement
- **Major:** `readFileAsImage` uses async `readFile` from `node:fs/promises` instead of blocking `readFileSync`
- **Major:** Removed `globalThis` coupling — module-level state with proper exports
- **Minor:** Added `.bmp` to `IMAGE_EXTENSIONS` and `mimeMap`
- **Minor:** Removed unused `PLACEHOLDER_PREFIX` constant
- **Minor:** Added runtime guard for `theme.fg` cast in preview renderer
- **Minor:** Added paste mutex (`_pasting` flag) to prevent concurrent paste operations
- **Minor:** Clarified shortcut differences between Linux and Windows in README
- **Minor:** Documented session file size impact of preview base64 data
