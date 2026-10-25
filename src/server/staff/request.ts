import "server-only";
import { cookies } from "next/headers";
import type { ConsoleSectionSlug, StaffRole } from "@/lib/staff-permissions";
import { STAFF_COOKIE, requireStaff, resolveStaff } from "./auth";

// The staff member behind this request, from the httpOnly cookie. Pages and server actions call
// these; the role check always happens here on the server.

export async function currentStaff() {
  return resolveStaff((await cookies()).get(STAFF_COOKIE)?.value);
}

/** The staff member if allowed; pass the console section so this restaurant's role changes apply */
export async function staffFor(allowed: readonly StaffRole[], section?: ConsoleSectionSlug) {
  return requireStaff((await cookies()).get(STAFF_COOKIE)?.value, allowed, new Date(), section);
}
