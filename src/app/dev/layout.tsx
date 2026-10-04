import type { ReactNode } from "react";
import { notFound } from "next/navigation";

// Every /dev review board is development-only. Pages also check this themselves; the layout makes
// it impossible for a board that forgets to be reachable in production.
export default function DevLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return children;
}
