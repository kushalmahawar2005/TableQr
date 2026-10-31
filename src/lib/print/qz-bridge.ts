import type { PaperMm } from "./thermal";
import { saveDesktopBridgeReady } from "./device-prefs";

type QzApi = {
  websocket: { isActive(): boolean; connect(options?: { retries?: number; delay?: number }): Promise<void> };
  printers: { find(): Promise<string[]> };
  configs: { create(name: string, options?: Record<string, unknown>): unknown };
  print(config: unknown, data: Array<Record<string, unknown>>): Promise<void>;
};

let apiPromise: Promise<QzApi> | null = null;

async function qz(): Promise<QzApi> {
  if (!apiPromise) {
    apiPromise = import("qz-tray").then((module) => {
      const candidate = (module as unknown as { default?: QzApi }).default ?? module as unknown as QzApi;
      if (!candidate.websocket || !candidate.printers || !candidate.configs) {
        throw new Error("QZ Tray connector did not load. Refresh this page and try again.");
      }
      return candidate;
    }).catch((error) => { apiPromise = null; throw error; });
  }
  return apiPromise;
}

export async function connectDesktopBridge() {
  const bridge = await qz();
  if (!bridge.websocket.isActive()) await bridge.websocket.connect({ retries: 2, delay: 1 });
  return bridge;
}

export async function findDesktopPrinters() {
  const bridge = await connectDesktopBridge();
  const printers = await bridge.printers.find();
  saveDesktopBridgeReady();
  return printers;
}

export async function printHtmlThroughDesktopBridge(input: {
  html: string;
  printerName: string;
  paperMm: PaperMm;
  pageHeightMm: number;
}) {
  const bridge = await connectDesktopBridge();
  const config = bridge.configs.create(input.printerName, {
    units: "mm",
    size: { width: input.paperMm, height: input.pageHeightMm, custom: true },
    margins: 0,
    orientation: "portrait",
    scaleContent: false,
    colorType: "blackwhite",
    jobName: "Tableeqr receipt",
  });
  // QZ's HTML renderer otherwise falls back to the printer's default page size. On receipt
  // printers that can shift the first line down and clip the tail even though the config uses a
  // custom roll size. These per-document dimensions are in inches (QZ pixel HTML API).
  await bridge.print(config, [{
    type: "pixel",
    format: "html",
    flavor: "plain",
    data: input.html,
    options: {
      pageWidth: input.paperMm / 25.4,
      pageHeight: input.pageHeightMm / 25.4,
    },
  }]);
}
