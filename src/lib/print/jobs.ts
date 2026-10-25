// What a print job is and how far it can honestly get. Pure data shared by the screens, which show
// the status, and the server, which refuses a status a transport cannot truthfully claim.

export const PRINT_KINDS = ["receipt", "bill", "kot", "order_slip", "day_close", "test"] as const;
export type PrintKind = (typeof PRINT_KINDS)[number];
export const isPrintKind = (v: unknown): v is PrintKind => typeof v === "string" && (PRINT_KINDS as readonly string[]).includes(v);

/** Which printer assignment a kind of slip goes to: kitchen tickets to the kitchen printer, the rest to the receipt printer */
export type PrinterRole = "receipt" | "kitchen";
export const roleForKind = (kind: PrintKind): PrinterRole => (kind === "kot" ? "kitchen" : "receipt");

export const JOB_STATUSES = ["queued", "sent", "confirmed", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const isJobStatus = (v: unknown): v is JobStatus => typeof v === "string" && (JOB_STATUSES as readonly string[]).includes(v);

/**
 * queued    accepted, not yet handed to anything
 * sent      handed to the browser's print window, the operating system or the printer; nothing says paper came out
 * confirmed the printer itself said it printed. Only transports that can say so ever reach this
 * failed    could not be handed over, or the printer reported a fault
 * cancelled stopped before it was sent
 */
const NEXT: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["sent", "confirmed", "failed", "cancelled"],
  sent: ["confirmed", "failed"],
  confirmed: [],
  failed: ["queued", "sent", "confirmed"],
  cancelled: [],
};

/** Whether a job may move from one status to another; `confirmable` is whether its transport can ever confirm */
export function canMove(from: JobStatus, to: JobStatus, confirmable: boolean) {
  if (from === to) return true;
  if (to === "confirmed" && !confirmable) return false;
  return NEXT[from].includes(to);
}

/** How a status reads on screen, without claiming more than is known */
export function describeJob(status: JobStatus, o: { confirmable: boolean; printerName?: string | null; detail?: string | null }) {
  const where = o.printerName ? ` for ${o.printerName}` : "";
  switch (status) {
    case "queued": return `Getting it ready${where}…`;
    case "sent": return o.confirmable
      ? `Sent${where}. Waiting for the printer to say it printed.`
      : `Sent${where}. TableQR cannot confirm that paper came out, so check the printer.`;
    case "confirmed": return `Printed${where}. The printer confirmed it.`;
    case "failed": return o.detail ? `Could not print${where}. ${o.detail}` : `Could not print${where}.`;
    case "cancelled": return "Print cancelled.";
  }
}

export const PRINTER_NAME_MAX = 60;
export const MAX_PRINTERS_PER_OUTLET = 12;
export const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
