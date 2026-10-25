"use server";
import { AppError } from "@/server/errors";
import { staffRoles } from "@/lib/staff-permissions";
import { actorOf, recordPrintJob, type JobReport, type JobResult } from "@/server/print/jobs";
import { printSetup, type PrintSetup } from "@/server/print/printers";
import { staffFor } from "@/server/staff/request";

// What a staff screen needs to print: this outlet's printers, and a way to report each print.
// The restaurant and outlet come from the signed-in session, never from the screen.

export type PrintSetupResult = { ok: true; data: PrintSetup } | { ok: false; message: string };
export type PrintReportResult = { ok: true; data: JobResult } | { ok: false; message: string; refused: true };

export async function printSetupAction(): Promise<PrintSetupResult> {
  try {
    return { ok: true, data: await printSetup(await staffFor(staffRoles)) };
  } catch (err) {
    return { ok: false, message: err instanceof AppError ? err.message : "Printers could not be loaded." };
  }
}

export async function recordPrintJobAction(report: JobReport): Promise<PrintReportResult> {
  try {
    const staff = await staffFor(staffRoles);
    return { ok: true, data: await recordPrintJob(actorOf(staff), report) };
  } catch (err) {
    // A refusal is final; anything else is thrown so the screen keeps the report and tries again
    if (err instanceof AppError) return { ok: false, message: err.message, refused: true };
    throw err;
  }
}
