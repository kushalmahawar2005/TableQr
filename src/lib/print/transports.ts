import { fitThermalHtml, printHtml } from "./runtime";
import { desktopBridgeIsReady, loadDesktopPrinterName } from "./device-prefs";
import type { PaperMm } from "./thermal";

// How a slip reaches a printer. A transport is a small module with one job: take a finished slip
// and say honestly what became of it. The screens, the settings and the server only know this
// interface, so a new way of printing (Bluetooth, a network printer, a desktop helper) is a new
// transport and nothing else changes. Only the browser and desktop helper are built; the rest are
// named here so a printer can never be saved with a transport that does nothing.

export type TransportId = "browser" | "bluetooth_ble" | "bluetooth_spp" | "network" | "cloud" | "desktop_bridge";
export const TRANSPORT_IDS: readonly TransportId[] = ["browser", "bluetooth_ble", "bluetooth_spp", "network", "cloud", "desktop_bridge"];
export const isTransportId = (v: unknown): v is TransportId => typeof v === "string" && (TRANSPORT_IDS as readonly string[]).includes(v);

export type TransportCapabilities = {
  /** "printer": the printer can report that it printed. "none": the best we can say is "sent" */
  confirmation: "none" | "printer";
  /** Prints without the browser's print window */
  silent: boolean;
  /** Where the job is delivered from */
  runsOn: "this_device" | "server";
  /** Several staff devices can print to the same printer through it */
  shared: boolean;
};

export type SendJob = { id: string; kind: string; paperMm: PaperMm; html: string; printerId: string | null; outletId: string | null; printerName: string | null; config: Record<string, string | number | boolean> | null; background: boolean };
export type SendResult =
  | { status: "sent" | "confirmed"; via?: string }
  | { status: "failed"; code: string; message: string; retryable: boolean };

export type PrintTransport = {
  id: TransportId;
  label: string;
  description: string;
  capabilities: TransportCapabilities;
  /** False for a transport that is only named, not built */
  implemented: boolean;
  /** Whether this device can use it right now */
  availability(context?: { printer: { id: string } | null; outletId: string | null }): { ok: true } | { ok: false; reason: string };
  validateConfig(config: unknown): { ok: true; config: Record<string, string | number | boolean> | null } | { ok: false; message: string };
  send(job: SendJob): Promise<SendResult>;
};

/** The browser's own print window (or the hidden frame): works on any device, never silent, never confirms */
export const browserTransport: PrintTransport = {
  id: "browser",
  label: "Browser print",
  description: "Opens this device's print window. Pick the receipt printer there. Works on every device, but the window appears each time and Tableeqr cannot tell whether paper came out.",
  capabilities: { confirmation: "none", silent: false, runsOn: "this_device", shared: false },
  implemented: true,
  availability: () => (typeof window === "undefined" ? { ok: false, reason: "Printing needs a browser." } : { ok: true }),
  validateConfig: () => ({ ok: true, config: null }),
  async send(job) {
    try {
      const via = printHtml(job.html, { background: job.background });
      return { status: "sent", via };
    } catch (err) {
      return { status: "failed", code: "browser_print_failed", message: err instanceof Error ? err.message : "The browser could not open the print window.", retryable: true };
    }
  },
};

const PLANNED: Record<Exclude<TransportId, "browser">, { label: string; description: string; capabilities: TransportCapabilities }> = {
  bluetooth_ble: {
    label: "Bluetooth (BLE)",
    description: "Direct from Android Chrome to a printer that speaks Bluetooth Low Energy. Needs a compatible printer model; not built yet.",
    capabilities: { confirmation: "none", silent: true, runsOn: "this_device", shared: false },
  },
  bluetooth_spp: {
    label: "Bluetooth (Classic)",
    description: "Classic Bluetooth printers cannot be reached from a web page. Needs a small helper app on the device; not built yet.",
    capabilities: { confirmation: "none", silent: true, runsOn: "this_device", shared: false },
  },
  network: {
    label: "Network printer",
    description: "A printer on the restaurant's WiFi or cable. Needs a compatible printer and a way for Tableeqr to reach it; not built yet.",
    capabilities: { confirmation: "printer", silent: true, runsOn: "server", shared: true },
  },
  cloud: {
    label: "Cloud print",
    description: "A printer that collects its jobs from Tableeqr over the internet, so any device can print to it. Needs a compatible printer; not built yet.",
    capabilities: { confirmation: "printer", silent: true, runsOn: "server", shared: true },
  },
  desktop_bridge: {
    label: "Direct print (QZ Tray)",
    description: "Prints through QZ Tray on this Windows computer, using the receipt's measured page size. Install QZ Tray and allow Tableeqr to connect.",
    capabilities: { confirmation: "none", silent: false, runsOn: "this_device", shared: false },
  },
};

const desktopBridgeTransport: PrintTransport = {
  id: "desktop_bridge",
  ...PLANNED.desktop_bridge,
  implemented: true,
  availability: (context) => {
    if (typeof window === "undefined") return { ok: false, reason: "Direct printing needs a browser on the printer computer." };
    if (!desktopBridgeIsReady()) return { ok: false, reason: "Connect QZ Tray from Printer settings first." };
    if (context?.printer && context.outletId && !loadDesktopPrinterName(context.outletId, context.printer.id)) {
      return { ok: false, reason: "Map this outlet printer to a Windows printer on this device." };
    }
    return { ok: true };
  },
  validateConfig: () => ({ ok: true, config: null }),
  async send(job) {
    const systemPrinterName = job.outletId && job.printerId ? loadDesktopPrinterName(job.outletId, job.printerId) : null;
    if (!systemPrinterName) return { status: "failed", code: "printer_name_missing", message: "Map this outlet printer to a Windows printer in Settings on this computer.", retryable: false };
    try {
      const [{ html, heightMm }, bridge] = await Promise.all([
        fitThermalHtml(job.html),
        import("./qz-bridge"),
      ]);
      await bridge.printHtmlThroughDesktopBridge({ html, pageHeightMm: heightMm, paperMm: job.paperMm, printerName: systemPrinterName });
      return { status: "sent", via: "desktop_bridge" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not reach QZ Tray on this computer.";
      const notRunning = /websocket|connect|qz tray|localhost|timed out/i.test(message);
      return {
        status: "failed",
        code: notRunning ? "desktop_bridge_unavailable" : "desktop_print_failed",
        message: notRunning ? "Start QZ Tray on this computer, then try printing again." : message,
        retryable: true,
      };
    }
  },
};

function plannedTransport(id: Exclude<TransportId, "browser">): PrintTransport {
  const p = PLANNED[id];
  return {
    id,
    ...p,
    implemented: false,
    availability: () => ({ ok: false, reason: `${p.label} is not available yet.` }),
    validateConfig: () => ({ ok: false, message: `${p.label} is not available yet.` }),
    send: async () => ({ status: "failed", code: "transport_not_available", message: `${p.label} is not available yet. Use browser print.`, retryable: false }),
  };
}

const registry = new Map<TransportId, PrintTransport>([["browser", browserTransport]]);
for (const id of TRANSPORT_IDS) if (id !== "browser" && id !== "desktop_bridge") registry.set(id, plannedTransport(id as Exclude<TransportId, "browser">));
registry.set("desktop_bridge", desktopBridgeTransport);

export const getTransport = (id: string): PrintTransport => (isTransportId(id) ? registry.get(id)! : browserTransport);
export const allTransports = (): PrintTransport[] => TRANSPORT_IDS.map((id) => registry.get(id)!);
/** For a future transport to register itself, and for tests */
export const registerTransport = (t: PrintTransport) => { registry.set(t.id, t); };
export const confirmable = (id: string) => getTransport(id).capabilities.confirmation === "printer";
