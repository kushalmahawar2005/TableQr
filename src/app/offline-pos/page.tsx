import type { Metadata } from "next";
import { OfflinePosShell } from "./offline-pos-shell";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Offline POS · Tableeqr", robots: { index: false, follow: false } };

// Static, user-independent fallback. Staff and outlet data are loaded from the local device store
// only by the client shell after the cached 12-hour POS session is checked.
export default function OfflinePosPage() {
  return <OfflinePosShell />;
}
