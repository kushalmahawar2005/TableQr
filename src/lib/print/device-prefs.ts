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
