import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Container, Image, Spacer, Text } from "@mariozechner/pi-tui";

import type { PendingImage } from "./types.js";

const CUSTOM_TYPE = "hephaestus-image-preview";

interface PreviewDetails {
  images: Array<{ data: string; mimeType: string }>;
}

export function registerImagePreview(pi: ExtensionAPI): void {
  pi.registerMessageRenderer<PreviewDetails>(CUSTOM_TYPE, (message, _options, theme) => {
    try {
      // Theme.fg is runtime-available but not exposed in the Theme type definition
      const fg = (theme as any).fg as ((color: string, text: string) => string) | undefined;
      if (!fg) return undefined;

      const container = new Container();
      container.addChild(new Spacer(1));
      container.addChild(new Text(fg("muted", "↳ pasted image preview"), 0, 0));
      container.addChild(new Spacer(1));
      container.addChild(
        new Image(message.content as string, "image/png", {
          fallbackColor: (text: string) => fg("toolOutput", text),
        }, {
          maxWidthCells: 60,
        }),
      );
      return container;
    } catch {
      return undefined;
    }
  });
}

export function sendPreviewMessage(
  pi: ExtensionAPI,
  images: PendingImage[],
): void {
  if (images.length === 0) return;

  // Send each image as a separate custom message with image in content
  // This ensures pi renders the image inline using its built-in image support
  for (const img of images) {
    pi.sendMessage(
      {
        customType: CUSTOM_TYPE,
        content: [
          { type: "image" as const, data: img.base64, mimeType: img.mimeType },
        ],
        display: true,
      },
      { triggerTurn: false },
    );
  }
}
