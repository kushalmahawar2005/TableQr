import { useSyncExternalStore } from "react";

// What is waiting right now, shared by the console's menu, Dashboard and Orders. It comes from the
// server on every notification check, so it survives a reload and clears once the kitchen starts.

export type LiveOrderCounts = { table: number; guest: number };

const NONE: LiveOrderCounts = { table: 0, guest: 0 };
let counts = NONE;
const listeners = new Set<() => void>();

export function setLiveOrderCounts(next: LiveOrderCounts) {
  if (next.table === counts.table && next.guest === counts.guest) return;
  counts = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export const useLiveOrderCounts = () => useSyncExternalStore(subscribe, () => counts, () => NONE);
