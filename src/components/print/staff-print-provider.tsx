"use client";

import type { ReactNode } from "react";
import { printSetupAction, recordPrintJobAction } from "@/app/print/actions";
import { PrintProvider } from "./print-provider";

/** Printing for screens a signed-in staff member uses: the console, the POS, the waiter app */
export function StaffPrintProvider({ outletId, children }: { outletId: string; children: ReactNode }) {
  return <PrintProvider outletId={outletId} loadSetup={printSetupAction} report={recordPrintJobAction}>{children}</PrintProvider>;
}
