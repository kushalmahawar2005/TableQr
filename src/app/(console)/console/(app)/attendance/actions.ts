"use server";
import { AppError } from "@/server/errors";
import { consoleSectionRoles } from "@/lib/staff-permissions";
import { markAllPresent, markAttendance } from "@/server/attendance/register";
import { staffFor } from "@/server/staff/request";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

async function run<T>(work: (s: Awaited<ReturnType<typeof staffFor>>) => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await work(await staffFor(consoleSectionRoles.attendance, "attendance")) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    console.error("[attendance] action failed", err);
    return { ok: false, message: "That didn't go through. Try again." };
  }
}

const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);

export async function markAction(input: { userId: string; date: string; status: string | null; note?: string | null; outletId?: string }) {
  return run((s) => markAttendance(s, { userId: str(input.userId, 36), date: str(input.date, 10), status: input.status === null ? null : str(input.status, 12), note: input.note == null ? null : str(input.note, 200), outletId: input.outletId ? str(input.outletId, 36) : undefined }));
}

export async function markAllPresentAction(input: { date: string; outletId?: string }) {
  return run((s) => markAllPresent(s, { date: str(input.date, 10), outletId: input.outletId ? str(input.outletId, 36) : undefined }));
}
