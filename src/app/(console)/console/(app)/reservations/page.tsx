import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { getReservationCalendar } from "@/server/staff/reservations";
import { tenantFeatures } from "@/server/plan";
import { currentStaff } from "@/server/staff/request";
import { ReservationCalendar } from "./_components/reservation-calendar";
import { FeatureLocked } from "../_components/feature-locked";

export const metadata: Metadata = { title: "Reservations", robots: { index: false, follow: false } };

// Reservation Calendar. The layout has already checked sign-in; the role is checked here (so other
// roles see a plain message, never an error page) and again in every action.
export default async function ReservationsPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff, "reservations")) {
    return (
      <main className="p-8">
        <h1 className="font-display text-title font-bold text-ink">You don&apos;t have access to reservations.</h1>
        <p className="mt-2 text-body text-muted">Ask a manager if you need it.</p>
      </main>
    );
  }
  if (!(await tenantFeatures(staff.tenantId, staff.outletId)).reservations) return <FeatureLocked feature="reservations" />;
  const data = await getReservationCalendar(staff);
  return <ReservationCalendar initial={data} realtimeUrl={process.env.REALTIME_URL?.replace(/^http/, "ws") ?? null} />;
}
