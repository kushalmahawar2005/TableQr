import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canSee } from "@/lib/staff-permissions";
import { tenantFeatures } from "@/server/plan";
import { getRooms, stayHistory } from "@/server/staff/rooms";
import { currentStaff } from "@/server/staff/request";
import { FeatureLocked } from "../_components/feature-locked";
import { RoomsScreen } from "./_components/rooms-screen";

export const metadata: Metadata = { title: "Rooms", robots: { index: false, follow: false } };

// Hotel rooms: who is in which room, check-in and check-out, room food and room requests.
// Kept apart from the restaurant floor.
export default async function RoomsPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/console/login");
  if (!canSee(staff, "rooms")) {
    return (
      <main className="p-8">
        <h1 className="font-display text-title font-bold text-ink">Only the owner, a manager or reception can open Rooms.</h1>
      </main>
    );
  }
  if (!(await tenantFeatures(staff.tenantId)).rooms) return <FeatureLocked feature="rooms" />;
  const [initial, history] = await Promise.all([getRooms(staff), stayHistory(staff)]);
  return <RoomsScreen initial={initial} history={history} />;
}
