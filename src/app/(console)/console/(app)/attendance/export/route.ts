import { canSee } from "@/lib/staff-permissions";
import { monthCsv } from "@/server/attendance/register";
import { AppError } from "@/server/errors";
import { currentStaff } from "@/server/staff/request";

// The month's register as a spreadsheet file, for managers and owners.
export async function GET(request: Request) {
  const staff = await currentStaff();
  if (!staff || !canSee(staff, "attendance")) return new Response("Not allowed", { status: 403, headers: { "Cache-Control": "no-store" } });
  const q = new URL(request.url).searchParams;
  try {
    const { month, csv } = await monthCsv(staff, { month: q.get("month") ?? undefined, outletId: q.get("outlet") ?? undefined });
    return new Response(`﻿${csv}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="attendance-${month}.csv"`, "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AppError) return new Response(err.message, { status: err.code === "forbidden" ? 403 : 400, headers: { "Cache-Control": "no-store" } });
    console.error("[attendance] export failed", err);
    return new Response("Could not make the file", { status: 500 });
  }
}
