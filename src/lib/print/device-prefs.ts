import type { DevicePrefs } from "./manager";

// Which printer this one device uses, kept on the device (never on the server) and per outlet, so a
// tablet shared by two restaurants never carries one restaurant's printer choice into the other.

const NONE: DevicePrefs = { receiptPrinterId: null, kitchenPrinterId: null };
const keyOf = (outletId: string) => `tq.print.device.v1.${outletId}`;
const listeners = new Set<() => void>();

const clean = (v: unknown): string | null => (typeof v === "string" && /^[0-9a-f-]{36}$/.test(v) ? v : null);

export function loadDevicePrefs(outletId: string): DevicePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(keyOf(outletId)) ?? "null") as Partial<DevicePrefs> | null;
    return raw ? { receiptPrinterId: clean(raw.receiptPrinterId), kitchenPrinterId: clean(raw.kitchenPrinterId) } : NONE;
  } catch {
    return NONE;
  }
}

export function saveDevicePrefs(outletId: string, prefs: DevicePrefs) {
  try {
    const value = { receiptPrinterId: clean(prefs.receiptPrinterId), kitchenPrinterId: clean(prefs.kitchenPrinterId) };
    if (!value.receiptPrinterId && !value.kitchenPrinterId) localStorage.removeItem(keyOf(outletId));
    else localStorage.setItem(keyOf(outletId), JSON.stringify(value));
  } catch { /* private window: this device falls back to the outlet's choice */ }
  listeners.forEach((fn) => fn());
}

export const subscribeDevicePrefs = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

const DESKTOP_MAP_KEY = (outletId: string) => `tq.print.desktop.v1.${outletId}`;
const DESKTOP_READY_KEY = "tq.print.desktop.ready.v1";
const desktopListeners = new Set<() => void>();

export function loadDesktopPrinterMap(outletId: string): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(DESKTOP_MAP_KEY(outletId)) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).filter(([, name]) => typeof name === "string" && name.trim()).map(([id, name]) => [id, (name as string).trim()]));
  } catch { return {}; }
}

/** The Windows printer name is local to this device; the outlet's printer record never stores it. */
export function loadDesktopPrinterName(outletId: string, printerId: string): string | null {
  try {
    const raw = JSON.parse(localStorage.getItem(DESKTOP_MAP_KEY(outletId)) ?? "{}") as Record<string, unknown>;
    const name = raw[printerId];
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch { return null; }
}

export function saveDesktopPrinterName(outletId: string, printerId: string, name: string | null) {
  try {
    const key = DESKTOP_MAP_KEY(outletId);
    const raw = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    if (name?.trim()) raw[printerId] = name.trim();
    else delete raw[printerId];
    if (Object.keys(raw).length) localStorage.setItem(key, JSON.stringify(raw));
    else localStorage.removeItem(key);
  } catch { /* storage unavailable: this device uses browser print */ }
  desktopListeners.forEach((fn) => fn());
}

export const subscribeDesktopPrinterMap = (fn: () => void) => { desktopListeners.add(fn); return () => { desktopListeners.delete(fn); }; };

export function desktopBridgeIsReady() {
  try { return localStorage.getItem(DESKTOP_READY_KEY) === "1"; } catch { return false; }
}

export function saveDesktopBridgeReady() {
  try { localStorage.setItem(DESKTOP_READY_KEY, "1"); } catch { /* private window */ }
}

const UNSENT_KEY = (outletId: string) => `tq.print.unsent.v1.${outletId}`;
/** Reports of prints that could not reach the server yet, per outlet */
export const unsentStorage = (outletId: string) => ({
  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(UNSENT_KEY(outletId)) ?? "[]");
      return Array.isArray(raw) ? raw.filter((r) => r && typeof r.requestId === "string").slice(-50) : [];
    } catch { return []; }
  },
  save(reports: unknown[]) {
    try {
      if (reports.length) localStorage.setItem(UNSENT_KEY(outletId), JSON.stringify(reports));
      else localStorage.removeItem(UNSENT_KEY(outletId));
    } catch { /* storage full or blocked: the reports stay in memory for this visit */ }
  },
});
