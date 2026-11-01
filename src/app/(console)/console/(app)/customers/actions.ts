"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import * as s from "@/db/schema";
import { canSee } from "@/lib/staff-permissions";
import { setGuestBlocked } from "@/server/guest/table-confirmation";
import { currentStaff } from "@/server/staff/request";

/** Stops or restores table and cash orders for one customer number. */
export async function setCustomerBlockedAction(phone: string, blocked: boolean) {
  const staff = await currentStaff();
  if (!staff || !canSee(staff, "customers") || !/^\d{10}$/.test(phone)) return { ok: false as const };
  const [guest] = await db.select({ id: s.guests.id }).from(s.guests).where(and(eq(s.guests.tenantId, staff.tenantId), eq(s.guests.phone, `+91${phone}`)));
  if (!guest) return { ok: false as const };
  await setGuestBlocked(staff, guest.id, blocked);
  revalidatePath("/console/customers");
  return { ok: true as const };
}
