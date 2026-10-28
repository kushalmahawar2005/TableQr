"use client";

import { useEffect } from "react";
import { clearOfflinePosAccess } from "@/lib/pos-offline-queue";

/** Sign-in page is reached after a successful online sign-out; keep local orders, clear POS access. */
export function ClearOfflinePosAccess() {
  useEffect(() => { void clearOfflinePosAccess().catch(() => {}); }, []);
  return null;
}
