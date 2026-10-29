import "server-only";
import { cookies } from "next/headers";
import { requireStaff, resolveStaff } from "./auth";
import type { StaffRole } from "@/lib/staff-permissions";
export const RIDER_COOKIE = "tq_rider";
export const RIDER_OUTLET_COOKIE = "tq_rider_outlet";
export async function currentRider() {
  const staff = await resolveStaff((await cookies()).get(RIDER_COOKIE)?.value);
  return staff?.roles.includes("rider") ? staff : null;
}
export async function riderFor(allowed: readonly StaffRole[] = ["rider"]) {
  return requireStaff((await cookies()).get(RIDER_COOKIE)?.value, allowed);
}
