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
