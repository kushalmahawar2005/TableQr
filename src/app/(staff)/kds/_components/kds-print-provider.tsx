"use client";

import type { ReactNode } from "react";
import { PrintProvider } from "@/components/print/print-provider";
import { printSetupAction, recordPrintAction } from "../actions";

/** Printing for a kitchen wall screen, which signs in with its device credential, not a person */
export function KdsPrintProvider({ outletId, children }: { outletId: string; children: ReactNode }) {
  return <PrintProvider outletId={outletId} loadSetup={async () => { const r = await printSetupAction(); return r.ok ? { ok: true as const, data: r.data } : { ok: false as const, message: r.message }; }} report={recordPrintAction}>{children}</PrintProvider>;
}
