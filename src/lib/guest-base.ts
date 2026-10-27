"use client";
import { useSyncExternalStore } from "react";

// Guest pages run in the browser at /r/CODE/... and inside the restaurant's installed app at
// /r/CODE/app/... (see proxy.ts). Links keep the guest wherever they are. The server renders the
// browser base; the app base takes over right after hydration.

const subscribe = () => () => {};

export function useGuestBase(code: string) {
  const plain = `/r/${encodeURIComponent(code)}`;
  const inApp = useSyncExternalStore(subscribe, () => window.location.pathname.startsWith(`${plain}/app`), () => false);
  return inApp ? `${plain}/app` : plain;
}
