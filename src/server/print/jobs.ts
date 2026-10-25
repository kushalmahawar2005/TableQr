import "server-only";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { uuidv7 } from "@/db/id";
import * as s from "@/db/schema";
import { canMove, isJobStatus, isPrintKind, REQUEST_ID, type JobStatus, type PrintKind } from "@/lib/print/jobs";
import { confirmable, isTransportId } from "@/lib/print/transports";
import { canPrintKind, type StaffRole } from "@/lib/staff-permissions";
import { AppError } from "../errors";
import type { StaffSession } from "../staff/auth";

// The record of each print. A screen reports what became of a print; this checks who may print what
// here, refuses a status the transport cannot truthfully claim, and treats a repeated report (a double
// tap, a retry after a timeout, an offline queue flushed late) as the same job.

/** Who is printing: a signed-in person, or a kitchen wall screen (kitchen tickets only) */
export type PrintActor = { tenantId: string; outletId: string; roles: readonly StaffRole[]; userId: string | null; deviceId: string | null };

export const actorOf = (staff: Pick<StaffSession, "tenantId" | "outletId" | "roles" | "userId">): PrintActor => ({ tenantId: staff.tenantId, outletId: staff.outletId, roles: staff.roles, userId: staff.userId, deviceId: null });

export type JobReport = {
  requestId: string;
  kind: string;
  printerId?: string | null;
  transport: string;
  paperMm: number;
  status: string;
  subject?: { type: string; id: string } | null;
  failureCode?: string | null;
  failureDetail?: string | null;
  reprintOf?: string | null;
};
export type JobResult = { jobId: string; status: JobStatus; attempts: number; duplicate: boolean };

const short = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max) || null;

export async function recordPrintJob(actor: PrintActor, input: JobReport, now = new Date()): Promise<JobResult> {
  if (!isPrintKind(input.kind)) throw new AppError("invalid_state", "Unknown kind of print.");
  const kind: PrintKind = input.kind;
  if (actor.deviceId ? kind !== "kot" : !canPrintKind(actor.roles, kind)) throw new AppError("forbidden", "Your role can't print this. Ask a manager.");
  if (!REQUEST_ID.test(String(input.requestId ?? ""))) throw new AppError("invalid_state", "Invalid print request.");
  if (!isTransportId(input.transport)) throw new AppError("invalid_state", "Unknown way of printing.");
  if (input.paperMm !== 58 && input.paperMm !== 80) throw new AppError("invalid_state", "Choose a 58 mm or 80 mm roll.");
  if (!isJobStatus(input.status)) throw new AppError("invalid_state", "Unknown print status.");
  const status = input.status;
  if (status === "confirmed" && !confirmable(input.transport)) throw new AppError("invalid_state", "This way of printing cannot confirm that paper came out.");
  const subjectType = input.subject ? short(input.subject.type, 20) : null;
  const subjectId = input.subject ? short(input.subject.id, 40) : null;
  if (input.subject && (!subjectType || !subjectId || !/^[a-z_]+$/.test(subjectType))) throw new AppError("invalid_state", "Invalid print subject.");
  const scope = { tenantId: actor.tenantId, outletId: actor.outletId };

  return db.transaction(async (tx) => {
    let printerId: string | null = null;
    if (input.printerId) {
      const [p] = await tx.select({ id: s.printers.id }).from(s.printers).where(and(eq(s.printers.tenantId, scope.tenantId), eq(s.printers.outletId, scope.outletId), eq(s.printers.id, String(input.printerId))));
      if (!p) throw new AppError("not_found", "That printer is not set up at this outlet.");
      printerId = p.id;
    }
    let reprintOf: string | null = null;
    if (input.reprintOf) {
      const [orig] = await tx.select({ id: s.printJobs.id }).from(s.printJobs).where(and(eq(s.printJobs.tenantId, scope.tenantId), eq(s.printJobs.outletId, scope.outletId), eq(s.printJobs.id, String(input.reprintOf))));
      reprintOf = orig?.id ?? null;
    }
    // Take the job's row with one statement that cannot deadlock when many reports of the same
    // request arrive together: insert it, or touch the one already there without changing it
    const newId = uuidv7();
    await tx.insert(s.printJobs).values({
      id: newId, tenantId: scope.tenantId, outletId: scope.outletId, printerId, kind, subjectType, subjectId, requestId: input.requestId, transport: input.transport, paperMm: input.paperMm, status,
      failureCode: status === "failed" ? short(input.failureCode, 40) : null, failureDetail: status === "failed" ? short(input.failureDetail, 200) : null,
      reprintOf, actorUserId: actor.userId, deviceId: actor.deviceId, statusAt: now, createdAt: now,
    }).onDuplicateKeyUpdate({ set: { id: sql`${s.printJobs.id}` } });
    const [row] = await tx.select().from(s.printJobs).where(and(eq(s.printJobs.tenantId, scope.tenantId), eq(s.printJobs.requestId, input.requestId))).for("update");
    if (row.id === newId) return { jobId: row.id, status, attempts: 1, duplicate: false };
    // The same request id from another outlet is not this job
    if (row.outletId !== scope.outletId || row.kind !== kind) throw new AppError("conflict", "That print request was already used.");
    if (row.status === status) return { jobId: row.id, status: row.status, attempts: row.attempts, duplicate: true };
    // A report that arrives late and would move a job backwards changes nothing
    if (!canMove(row.status, status, confirmable(row.transport))) return { jobId: row.id, status: row.status, attempts: row.attempts, duplicate: true };
    const attempts = row.status === "failed" ? row.attempts + 1 : row.attempts;
    await tx.update(s.printJobs).set({
      status, attempts, statusAt: now, printerId: printerId ?? row.printerId,
      failureCode: status === "failed" ? short(input.failureCode, 40) : null, failureDetail: status === "failed" ? short(input.failureDetail, 200) : null,
    }).where(and(eq(s.printJobs.tenantId, scope.tenantId), eq(s.printJobs.id, row.id)));
    return { jobId: row.id, status, attempts, duplicate: false };
  });
}

export type JobRow = { id: string; kind: string; status: JobStatus; printerName: string | null; transport: string; paperMm: number; attempts: number; reprint: boolean; failure: string | null; at: number };

/** The latest prints at this outlet, for the Settings screen; managers and owners only */
export async function recentPrintJobs(staff: Pick<StaffSession, "tenantId" | "outletId" | "roles">, limit = 15): Promise<JobRow[]> {
  if (!staff.roles.some((r) => r === "owner" || r === "manager")) throw new AppError("forbidden", "Only a manager or owner can see print history.");
  const rows = await db
    .select({ job: s.printJobs, printer: s.printers.name })
    .from(s.printJobs)
    .leftJoin(s.printers, and(eq(s.printers.tenantId, s.printJobs.tenantId), eq(s.printers.id, s.printJobs.printerId)))
    .where(and(eq(s.printJobs.tenantId, staff.tenantId), eq(s.printJobs.outletId, staff.outletId)))
    .orderBy(desc(s.printJobs.createdAt))
    .limit(Math.min(Math.max(1, limit), 50));
  return rows.map(({ job, printer }) => ({ id: job.id, kind: job.kind, status: job.status, printerName: printer, transport: job.transport, paperMm: job.paperMm, attempts: job.attempts, reprint: !!job.reprintOf, failure: job.failureDetail, at: job.createdAt.getTime() }));
}

/** Old print records are not kept for ever: this removes a batch older than `days`, from the scheduled job */
export async function prunePrintJobs(now = new Date(), days = 60, batch = 500) {
  const before = new Date(now.getTime() - days * 86_400_000);
  // isolation-exempt: system clean-up of old records across all restaurants, by age only
  const [res] = await db.delete(s.printJobs).where(lt(s.printJobs.createdAt, before)).limit(batch);
  return res.affectedRows;
}
